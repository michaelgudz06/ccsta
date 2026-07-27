-- Migration 052: fiscal-year quote numbers that restart at 001 each July.
--
-- Was:  'Q-' || calendar_year || '-' || lpad(nextval('quote_number_seq'), 4)
--       -> Q-2026-0126, counter never resets, calendar year.
-- Now:  'Q-' || fiscal_year || '-' || lpad(per-year counter, 3)
--       -> Q-2027-001, counter restarts each fiscal year.
--
-- CCSTA's fiscal year runs July -> June, so July 2026 onward is FY2027.
--
-- Why a counter table instead of a sequence: a sequence can't restart per
-- year without someone remembering to reset it every July. A plain
-- "SELECT max(...)+1" would race under concurrent submissions -- that's the
-- same class of bug as BUG_BACKLOG #5. The INSERT ... ON CONFLICT DO UPDATE
-- below is atomic: it row-locks the counter for the fiscal year, so two
-- simultaneous submissions get 001 and 002, never 001 twice.
--
-- quote_number_seq is deliberately NOT dropped. It costs nothing to keep and
-- means reverting this migration doesn't need the old sequence rebuilt.
--
-- submit_quote is CREATE OR REPLACE'd here. Per NEXT_SESSION.md section 6,
-- this body is based on the CURRENT LIVE version (migration 051, applied and
-- verified 2026-07-24) -- everything except the quote-number line is
-- unchanged from it.

-- ── Fiscal year helper ──────────────────────────────────────────────────
-- July or later => next calendar year. June or earlier => current year.
CREATE OR REPLACE FUNCTION public._fiscal_year(p_at timestamptz DEFAULT now())
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN extract(month FROM p_at) >= 7
      THEN extract(year FROM p_at)::int + 1
    ELSE extract(year FROM p_at)::int
  END;
$$;

-- ── Per-fiscal-year counter ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quote_number_counters (
  fiscal_year int PRIMARY KEY,
  last_no     int NOT NULL DEFAULT 0
);

-- No policies are defined on purpose. RLS is on and nothing is granted, so
-- the table is unreachable from the client; only SECURITY DEFINER functions
-- (i.e. _next_quote_number, called by submit_quote) can touch it.
ALTER TABLE public.quote_number_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._next_quote_number(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy int := public._fiscal_year(p_at);
  v_no int;
BEGIN
  INSERT INTO public.quote_number_counters (fiscal_year, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fiscal_year)
  DO UPDATE SET last_no = public.quote_number_counters.last_no + 1
  RETURNING last_no INTO v_no;

  -- 3 digits normally, widening automatically past 999 rather than wrapping
  -- or colliding (lpad only pads, it never truncates).
  RETURN 'Q-' || v_fy::text || '-' || lpad(v_no::text, 3, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public._next_quote_number(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION submit_quote(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_quote_no     text;
  v_quote_id     uuid;
  v_ver_id       uuid;
  v_school_id    uuid;
  v_cust_email   text;
  v_trip_type    public.quote_trip_type;
  v_trip_date    date;
  v_shuttle_runs jsonb;
  v_stops        jsonb;
  v_departure    time;
  v_return       time;
  -- Email-building only (customer confirmation + admin alert) -- everything
  -- above is unchanged from migration 038.
  v_greeting     text;
  v_school_esc   text;
  v_trip_date_fmt text;
  v_depart_fmt   text;
  v_return_fmt   text;
  v_group_size   text;
  v_times_label  text;
  v_trip_type_label text;
  v_detail_html_upper text;
  v_detail_text_upper text;
  v_dropoff_html text;
  v_dropoff_text text;
  v_students_html_cust  text;
  v_students_html_admin text;
  v_students_text text;
  v_detail_html  text;
  v_detail_text  text;
  v_extra_html   text;
  v_extra_text   text;
  v_elem         jsonb;
  v_ord          int;
  v_body_text    text;
  v_body_html    text;
  -- Admin-alert-only additions (migration 051).
  v_contact_name  text;
  v_contact_phone text;
  v_contact_email text;
  v_admin_detail_html text;
  v_admin_detail_text text;
  v_admin_body_text  text;
  v_admin_body_html  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_trip_type := COALESCE(NULLIF(p_data->>'trip_type', '')::public.quote_trip_type, 'two_way');
  IF v_trip_type = 'multi_trip' THEN
    RAISE EXCEPTION 'multi_trip bookings are not self-serve — contact the office directly';
  END IF;

  -- Trip-date bounds: must not be in the past, capped 2 years out. Applied
  -- as early as possible, alongside the other top-level input guards above.
  v_trip_date := NULLIF(p_data->>'trip_date', '')::date;
  IF v_trip_date IS NOT NULL THEN
    IF v_trip_date < CURRENT_DATE THEN
      RAISE EXCEPTION 'Trip date can''t be in the past — please choose a date from today onward.';
    END IF;
    IF v_trip_date > (CURRENT_DATE + INTERVAL '2 years') THEN
      RAISE EXCEPTION 'Trip date is too far in the future — please choose a date within the next 2 years, or call us to plan further ahead.';
    END IF;
  END IF;

  v_shuttle_runs := p_data->'shuttle_runs';
  v_stops        := p_data->'stops';

  IF v_trip_type = 'shuttle' THEN
    IF v_shuttle_runs IS NULL OR jsonb_typeof(v_shuttle_runs) <> 'array' OR jsonb_array_length(v_shuttle_runs) = 0 THEN
      RAISE EXCEPTION 'shuttle trips require at least one run';
    END IF;
    -- Bus is engaged continuously from the first pickup to the last drop-off.
    SELECT MIN((elem->>'pickup_time')::time), MAX((elem->>'dropoff_time')::time)
    INTO v_departure, v_return
    FROM jsonb_array_elements(v_shuttle_runs) AS elem;
  ELSIF v_trip_type = 'multi_destination' THEN
    IF v_stops IS NULL OR jsonb_typeof(v_stops) <> 'array' OR jsonb_array_length(v_stops) = 0 THEN
      RAISE EXCEPTION 'multi-destination trips require at least one stop';
    END IF;
    -- Start = the explicit pickup departure time (same field/logic as the
    -- two-way/one-way case below — no longer derived from stop times).
    v_departure := NULLIF(p_data->>'departure_time', '')::time;
    -- End = latest arrival time across all stops (the last stop in the
    -- sequence is always chronologically last, whether it's a regular
    -- stop or the return leg — no special-casing needed).
    SELECT MAX((elem->>'arrival_time')::time)
    INTO v_return
    FROM jsonb_array_elements(v_stops) AS elem;
  ELSE
    v_departure := NULLIF(p_data->>'departure_time', '')::time;
    v_return    := NULLIF(p_data->>'return_time', '')::time;
  END IF;

  -- Find existing school by name (case-insensitive) or create a new one
  SELECT id INTO v_school_id
  FROM public.schools
  WHERE lower(trim(name)) = lower(trim(p_data->>'school_name'))
  LIMIT 1;

  IF v_school_id IS NULL THEN
    INSERT INTO public.schools (name, address)
    VALUES (trim(p_data->>'school_name'), p_data->>'pickup_address')
    RETURNING id INTO v_school_id;
  END IF;

  -- Quote number: fiscal-year scoped, restarts at 001 each July (migration
  -- 052). Was 'Q-' || calendar year || 4-digit global sequence.
  v_quote_no := public._next_quote_number();

  -- Insert quote (without current_version_id first to avoid circular FK issue)
  INSERT INTO public.quotes (quote_number, school_id, customer_id, status)
  VALUES (v_quote_no, v_school_id, v_user_id, 'requested')
  RETURNING id INTO v_quote_id;

  -- Insert first version with all form data. destination_name/address stay
  -- NULL for multi_destination — the real destinations live in
  -- quote_multi_stops instead of this single-destination pair.
  INSERT INTO public.quote_versions (
    quote_id, version_number,
    destination_name, destination_address,
    trip_date, departure_time, return_time, trip_type,
    student_count, adults_count, grade_breakdown,
    cargo_needed, pickup_address,
    contact_primary, contact_secondary, contact_day_of,
    special_requests, created_by
  ) VALUES (
    v_quote_id, 1,
    p_data->>'destination_name',
    p_data->>'destination_address',
    v_trip_date,
    v_departure,
    v_return,
    v_trip_type,
    NULLIF(p_data->>'student_count', '')::smallint,
    NULLIF(p_data->>'adults_count', '')::smallint,
    p_data->'grade_breakdown',
    COALESCE((p_data->>'cargo_needed')::boolean, false),
    p_data->>'pickup_address',
    p_data->'contact_primary',
    p_data->'contact_secondary',
    p_data->'contact_day_of',
    p_data->>'special_requests',
    v_user_id
  )
  RETURNING id INTO v_ver_id;

  IF v_trip_type = 'shuttle' THEN
    INSERT INTO public.quote_shuttle_runs (quote_version_id, run_number, pickup_time, dropoff_time)
    SELECT v_ver_id,
           COALESCE(NULLIF(elem->>'run_number', '')::smallint, ord::smallint),
           (elem->>'pickup_time')::time,
           (elem->>'dropoff_time')::time
    FROM jsonb_array_elements(v_shuttle_runs) WITH ORDINALITY AS t(elem, ord);
  ELSIF v_trip_type = 'multi_destination' THEN
    INSERT INTO public.quote_multi_stops (quote_version_id, stop_number, destination_name, destination_address, arrival_time, departure_time, lat, lng)
    SELECT v_ver_id,
           COALESCE(NULLIF(elem->>'stop_number', '')::smallint, ord::smallint),
           elem->>'destination_name',
           elem->>'destination_address',
           (elem->>'arrival_time')::time,
           NULLIF(elem->>'departure_time', '')::time,
           NULLIF(elem->>'lat', '')::numeric,
           NULLIF(elem->>'lng', '')::numeric
    FROM jsonb_array_elements(v_stops) WITH ORDINALITY AS t(elem, ord);
  END IF;

  -- Link version back to quote
  UPDATE public.quotes
  SET current_version_id = v_ver_id
  WHERE id = v_quote_id;

  -- ── Build the customer confirmation email (text + HTML) ──────────────────
  v_greeting := COALESCE(NULLIF(split_part(trim(p_data->'contact_primary'->>'name'), ' ', 1), ''), 'there');
  v_school_esc := _html_escape(COALESCE(trim(p_data->>'school_name'), 'TBD'));
  v_trip_date_fmt := CASE
    WHEN v_trip_date IS NOT NULL
      THEN to_char(v_trip_date, 'FMDay, FMMonth FMDD, YYYY')
    ELSE 'TBD'
  END;
  v_depart_fmt := CASE WHEN v_departure IS NOT NULL THEN to_char(v_departure, 'FMHH12:MI AM') ELSE 'TBD' END;
  v_return_fmt := CASE WHEN v_return IS NOT NULL THEN to_char(v_return, 'FMHH12:MI AM') ELSE 'TBD' END;
  v_group_size := COALESCE(p_data->>'student_count', '0') || ' students + ' || COALESCE(p_data->>'adults_count', '0') || ' adults';
  v_times_label := CASE WHEN v_trip_type IN ('shuttle', 'multi_destination') THEN 'Bus engaged' ELSE 'Times' END;
  v_trip_type_label := CASE v_trip_type
    WHEN 'two_way' THEN 'Round trip'
    WHEN 'one_way' THEN 'One way'
    WHEN 'shuttle' THEN 'Shuttle'
    WHEN 'multi_destination' THEN 'Multi-destination'
    ELSE v_trip_type::text END;

  v_detail_html_upper :=
    format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; vertical-align:top;">Trip date</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s</td></tr>', v_trip_date_fmt)
    || format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; vertical-align:top;">Trip type</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s</td></tr>', v_trip_type_label)
    || format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; width:120px; vertical-align:top;">Organization</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s</td></tr>', v_school_esc)
    || format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; vertical-align:top;">%s</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s &rarr; %s%s</td></tr>',
         v_times_label, v_depart_fmt, v_return_fmt,
         CASE WHEN v_trip_type = 'shuttle' THEN '<br><span style="color:#6b7280; font-size:13px;">continuous, see the runs below</span>' ELSE '' END)
    || format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; vertical-align:top;">Pickup</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s</td></tr>', _html_escape(COALESCE(p_data->>'pickup_address', 'TBD')));

  v_detail_text_upper :=
    '  Trip date:   ' || v_trip_date_fmt || E'\n'
    || '  Trip type:   ' || v_trip_type_label || E'\n'
    || '  Organization: ' || COALESCE(trim(p_data->>'school_name'), 'TBD') || E'\n'
    || '  ' || v_times_label || ':' || repeat(' ', greatest(1, 12 - length(v_times_label) - 1)) || v_depart_fmt || ' -> ' || v_return_fmt || E'\n'
    || '  Pickup:      ' || COALESCE(p_data->>'pickup_address', 'TBD') || E'\n';

  v_dropoff_html := CASE WHEN v_trip_type IN ('two_way', 'one_way', 'shuttle') THEN
      format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; vertical-align:top;">Drop off</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s<br><span style="color:#6b7280; font-size:13px;">%s</span></td></tr>',
        _html_escape(COALESCE(p_data->>'destination_name', 'TBD')), _html_escape(COALESCE(p_data->>'destination_address', '')))
    ELSE '' END;

  v_dropoff_text := CASE WHEN v_trip_type IN ('two_way', 'one_way', 'shuttle') THEN
      '  Drop off:    ' || COALESCE(p_data->>'destination_name', 'TBD') || ', ' || COALESCE(p_data->>'destination_address', 'TBD') || E'\n'
    ELSE '' END;

  v_students_html_cust  := format('<tr><td style="padding:8px 0; font-size:13px; color:#6b7280; vertical-align:top;">Students</td><td style="padding:8px 0; font-size:14px; color:#1f2b4d; vertical-align:top;">%s</td></tr>', v_group_size);
  v_students_html_admin := format('<tr><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:13px; color:#6b7280; vertical-align:top;">Students</td><td style="padding:8px 0; border-bottom:1px solid #eceef2; font-size:14px; color:#1f2b4d; vertical-align:top;">%s</td></tr>', v_group_size);
  v_students_text       := '  Students:    ' || v_group_size || E'\n';

  v_detail_html := v_dropoff_html || v_students_html_cust;
  v_detail_text := v_dropoff_text || v_students_text;

  v_extra_html := '';
  v_extra_text := '';

  IF v_trip_type = 'shuttle' THEN
    FOR v_elem, v_ord IN
      SELECT elem, ord FROM jsonb_array_elements(v_shuttle_runs) WITH ORDINALITY AS t(elem, ord)
    LOOP
      v_extra_html := v_extra_html || format(
        '<tr><td style="padding:8px 14px; font-size:13px; color:#6b7280; width:70px;">Run %s</td><td style="padding:8px 14px; font-size:14px; color:#1f2b4d;">%s &rarr; %s</td></tr>',
        v_ord,
        to_char((v_elem->>'pickup_time')::time, 'FMHH12:MI AM'),
        to_char((v_elem->>'dropoff_time')::time, 'FMHH12:MI AM')
      );
      v_extra_text := v_extra_text || '  Run ' || v_ord || ': '
        || to_char((v_elem->>'pickup_time')::time, 'FMHH12:MI AM') || ' -> '
        || to_char((v_elem->>'dropoff_time')::time, 'FMHH12:MI AM') || E'\n';
    END LOOP;

  ELSIF v_trip_type = 'multi_destination' THEN
    FOR v_elem, v_ord IN
      SELECT elem, ord FROM jsonb_array_elements(v_stops) WITH ORDINALITY AS t(elem, ord)
    LOOP
      IF NULLIF(v_elem->>'departure_time', '') IS NULL THEN
        v_extra_html := v_extra_html || format(
          '<tr><td style="padding:10px 14px; font-size:13px; color:#6b7280; width:24px; vertical-align:top; %1$s">%2$s.</td><td style="padding:10px 14px; font-size:14px; color:#1f2b4d; vertical-align:top; %1$s">Return to %3$s<br><span style="color:#6b7280; font-size:13px;">arrive %4$s</span></td></tr>',
          CASE WHEN v_ord = 1 THEN '' ELSE 'border-top:1px solid #eceef2;' END,
          v_ord,
          v_school_esc,
          to_char((v_elem->>'arrival_time')::time, 'FMHH12:MI AM')
        );
        v_extra_text := v_extra_text || '  ' || v_ord || '. Return to '
          || COALESCE(trim(p_data->>'school_name'), 'school') || ', arrive '
          || to_char((v_elem->>'arrival_time')::time, 'FMHH12:MI AM') || E'\n';
      ELSE
        v_extra_html := v_extra_html || format(
          '<tr><td style="padding:10px 14px; font-size:13px; color:#6b7280; width:24px; vertical-align:top; %1$s">%2$s.</td><td style="padding:10px 14px; font-size:14px; color:#1f2b4d; vertical-align:top; %1$s">%3$s<br><span style="color:#6b7280; font-size:13px;">arrive %4$s &middot; depart %5$s</span></td></tr>',
          CASE WHEN v_ord = 1 THEN '' ELSE 'border-top:1px solid #eceef2;' END,
          v_ord,
          _html_escape(COALESCE(v_elem->>'destination_address', 'Stop ' || v_ord)),
          to_char((v_elem->>'arrival_time')::time, 'FMHH12:MI AM'),
          to_char((v_elem->>'departure_time')::time, 'FMHH12:MI AM')
        );
        v_extra_text := v_extra_text || '  ' || v_ord || '. '
          || COALESCE(v_elem->>'destination_address', 'Stop ' || v_ord)
          || ', arrive ' || to_char((v_elem->>'arrival_time')::time, 'FMHH12:MI AM')
          || ', depart ' || to_char((v_elem->>'departure_time')::time, 'FMHH12:MI AM') || E'\n';
      END IF;
    END LOOP;
  END IF;

  v_body_text :=
    'Hi ' || v_greeting || ',' || E'\n\n'
    || 'Thanks for requesting a field trip quote with CCSTA! We''ve received your request. Here''s a summary so you can make sure everything''s correct.' || E'\n\n'
    || 'Quote number: ' || v_quote_no || E'\n\n'
    || v_detail_text_upper
    || CASE WHEN v_extra_text <> '' THEN
         E'\n' || CASE WHEN v_trip_type = 'shuttle' THEN 'Runs:' ELSE 'Stops:' END || E'\n' || v_extra_text
       ELSE '' END
    || v_detail_text
    || E'\nPlease take a look at the details above. If anything doesn''t look right, contact our office at 778-986-9011 or Admin@ccsta.net and we''ll fix it. No need to resubmit.' || E'\n\n'
    || 'What happens next: Melody will review your request and follow up with your official price, usually within one business day.' || E'\n\n'
    || 'Check your quote status any time: ' || _site_url() || '/portal' || E'\n\n'
    || 'Melody Vanderwal' || E'\nCCSTA Admin' || E'\n778-986-9011' || E'\nAdmin@ccsta.net';

  v_body_html :=
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>We received your quote request</title></head>'
    || '<body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:24px 0;"><tr><td align="center">'
    || '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; max-width:600px; width:100%;">'
    || '<tr><td style="background-color:#1f2b4d; padding:20px 32px;"><span style="color:#ffffff; font-size:18px; font-weight:700; letter-spacing:0.5px;">CCSTA</span>'
    || '<div style="color:#c7cde3; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-top:2px;">Combined Christian Schools Transportation Association</div></td></tr>'
    || '<tr><td style="padding:32px;">'
    || format('<p style="margin:0 0 16px; font-size:15px; line-height:1.5; color:#1f2b4d;">Hi %s,</p>', _html_escape(v_greeting))
    || '<p style="margin:0 0 20px; font-size:15px; line-height:1.5; color:#333333;">Thanks for requesting a field trip quote with CCSTA! We''ve received your request. Here''s a summary so you can make sure everything''s correct.</p>'
    || format('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background-color:#fdf0d5; border-radius:6px; padding:8px 14px;"><span style="font-size:13px; color:#7a5a12; font-weight:600;">Quote number: %s</span></td></tr></table>', v_quote_no)
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:8px;">' || v_detail_html_upper || '</table>'
    || CASE WHEN v_extra_html <> '' THEN
         format('<p style="margin:16px 0 6px; font-size:13px; font-weight:600; color:#1f2b4d;">%s</p><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:20px; background-color:#f9fafb; border-radius:6px;">%s</table>',
           CASE WHEN v_trip_type = 'shuttle' THEN 'Runs' ELSE 'Stops' END, v_extra_html)
       ELSE '<div style="margin-bottom:12px;"></div>' END
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:8px;">' || v_detail_html || '</table>'
    || '<p style="margin:0 0 20px; font-size:13px; line-height:1.5; color:#6b7280;">Please take a look at the details above. If anything doesn''t look right, contact our office at <strong style="color:#1f2b4d;">778-986-9011</strong> or <strong style="color:#1f2b4d;">Admin@ccsta.net</strong> and we''ll fix it. No need to resubmit.</p>'
    || '<p style="margin:0 0 24px; font-size:15px; line-height:1.5; color:#333333;"><strong>What happens next:</strong> Melody will review your request and follow up with your official price, usually within one business day.</p>'
    || format('<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background-color:#1f2b4d; border-radius:6px;"><a href="%s/portal" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none;">Check your quote status</a></td></tr></table>', _site_url())
    || '</td></tr>'
    || '<tr><td style="padding:24px 32px; background-color:#f9fafb; border-top:1px solid #eceef2;">'
    || '<p style="margin:0 0 2px; font-size:13px; font-weight:600; color:#1f2b4d;">Melody Vanderwal</p>'
    || '<p style="margin:0 0 2px; font-size:12px; color:#6b7280;">CCSTA Admin</p>'
    || '<p style="margin:0 0 2px; font-size:12px; color:#6b7280;">778-986-9011</p>'
    || '<p style="margin:0 0 12px; font-size:12px; color:#6b7280;">Admin@ccsta.net</p>'
    || '<img src="https://ccsta.net/ccsta-logo.jpg" width="140" alt="CCSTA logo" style="display:block; border:0; max-width:140px; height:auto;">'
    || '</td></tr>'
    || '</table></td></tr></table></body></html>';

  -- ── Admin "new quote request" alert (migration 051) ──────────────────────
  v_contact_name  := COALESCE(NULLIF(trim(p_data->'contact_primary'->>'name'), ''), '—');
  v_contact_phone := COALESCE(NULLIF(trim(p_data->'contact_primary'->>'phone'), ''), '—');
  v_contact_email := COALESCE(NULLIF(trim(p_data->'contact_primary'->>'email'), ''), '—');

  v_admin_detail_html := v_dropoff_html
    || v_students_html_admin
    || format('<tr><td style="padding:8px 0; font-size:13px; color:#6b7280; vertical-align:top;">Contact</td><td style="padding:8px 0; font-size:14px; color:#1f2b4d; vertical-align:top;">%s<br><span style="color:#6b7280; font-size:13px;">%s &middot; %s</span></td></tr>',
         _html_escape(v_contact_name), _html_escape(v_contact_phone), _html_escape(v_contact_email));

  v_admin_detail_text := v_dropoff_text
    || v_students_text
    || '  Contact:     ' || v_contact_name || ', ' || v_contact_phone || ', ' || v_contact_email || E'\n';

  v_admin_body_text :=
    'A new field trip quote was just submitted.' || E'\n\n'
    || 'Quote number: ' || v_quote_no || E'\n\n'
    || v_detail_text_upper
    || CASE WHEN v_extra_text <> '' THEN
         E'\n' || CASE WHEN v_trip_type = 'shuttle' THEN 'Runs:' ELSE 'Stops:' END || E'\n' || v_extra_text
       ELSE '' END
    || v_admin_detail_text
    || E'\nReview it in the dispatch dashboard: ' || _site_url() || '/admin';

  v_admin_body_html :=
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New quote request</title></head>'
    || '<body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:24px 0;"><tr><td align="center">'
    || '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; max-width:600px; width:100%;">'
    || '<tr><td style="background-color:#1f2b4d; padding:20px 32px;"><span style="color:#ffffff; font-size:18px; font-weight:700; letter-spacing:0.5px;">CCSTA</span>'
    || '<div style="color:#c7cde3; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-top:2px;">Combined Christian Schools Transportation Association</div></td></tr>'
    || '<tr><td style="padding:32px;">'
    || '<p style="margin:0 0 20px; font-size:15px; line-height:1.5; color:#333333;">A new field trip quote was just submitted.</p>'
    || format('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background-color:#fdf0d5; border-radius:6px; padding:8px 14px;"><span style="font-size:13px; color:#7a5a12; font-weight:600;">Quote number: %s</span></td></tr></table>', v_quote_no)
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:8px;">' || v_detail_html_upper || '</table>'
    || CASE WHEN v_extra_html <> '' THEN
         format('<p style="margin:16px 0 6px; font-size:13px; font-weight:600; color:#1f2b4d;">%s</p><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:20px; background-color:#f9fafb; border-radius:6px;">%s</table>',
           CASE WHEN v_trip_type = 'shuttle' THEN 'Runs' ELSE 'Stops' END, v_extra_html)
       ELSE '<div style="margin-bottom:12px;"></div>' END
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:8px;">' || v_admin_detail_html || '</table>'
    || format('<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background-color:#1f2b4d; border-radius:6px;"><a href="%s/admin" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none;">Review in dispatch dashboard</a></td></tr></table>', _site_url())
    || '</td></tr>'
    || '</table></td></tr></table></body></html>';

  -- Queue notification emails (delivered by the notify-send Edge Function).
  v_cust_email := COALESCE(
    NULLIF(btrim(p_data->'contact_primary'->>'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  PERFORM _queue_email(
    v_cust_email,
    'We received your quote request ' || v_quote_no,
    v_body_text,
    v_quote_id,
    v_body_html
  );

  PERFORM _queue_email(
    _admin_email(),
    'New quote request ' || v_quote_no || ' — ' || COALESCE(trim(p_data->>'school_name'), 'Unknown organization'),
    v_admin_body_text,
    v_quote_id,
    v_admin_body_html
  );

  RETURN jsonb_build_object(
    'quote_number', v_quote_no,
    'quote_id',     v_quote_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_quote(jsonb) TO authenticated;
