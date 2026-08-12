-- Migration 072: cut the driver suggestion label down to name + availability.
--
-- APPLIED 2026-08-11. Verified: the new label is in place, the "same yard" TEXT
-- is gone, but same_yard is still a returned field, still the first sort key,
-- and air_brake_cert is still returned so the trip sheet's mismatch warning
-- keeps working.
--
-- Mila, looking at the live dropdown: "all of this information is too much, can
-- you simplify it to driver name and availability".
--
-- She's right. Every row read
--   "Antolin, Anita — same yard · nothing booked today"
-- and with 20 Surrey drivers listed, "same yard" appeared on all of them. A
-- fact that's true of every visible option carries no information; it just
-- makes the list wider and slower to scan. Same for "air brake" on the ones
-- that have it — useful when it's relevant, noise when you're just picking a
-- name.
--
-- Nothing is actually lost:
--   * same yard is still the FIRST sort key, so those drivers appear at the top
--     and ★ marks the best pick. The ORDER says it instead of the text.
--   * air_brake_cert is still returned, and the trip sheet warns when a
--     non-certified driver is put on a bus that requires it — at the moment it
--     matters, rather than while scrolling.
--
-- Left the BUS labels alone. There the size genuinely varies between options
-- (buses of every size are listed on purpose, so Melody can change the mix), so
-- "47 bench" is doing work that "same yard" wasn't.
--
-- Patched in place rather than re-created, so this can't quietly revert 067.
DO $mig$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'recommend_drivers' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'recommend_drivers not found'; END IF;

  v_new := replace(v_src,
    '      ''why'',         concat_ws('' · '','
    || E'\n' || '                       CASE WHEN d.home_yard_id IS NOT DISTINCT FROM v_yard THEN ''same yard'' END,'
    || E'\n' || '                       CASE WHEN COALESCE(hrs.h, 0) = 0 THEN ''nothing booked today'''
    || E'\n' || '                            ELSE ROUND(COALESCE(hrs.h, 0), 1) || ''h booked today'' END,'
    || E'\n' || '                       CASE WHEN d.air_brake_cert THEN ''air brake'' END)',
    '      -- Availability only (072). Same-yard is carried by the sort order and'
    || E'\n' || '      -- the air-brake mismatch is warned about at selection time.'
    || E'\n' || '      ''why'',         CASE WHEN COALESCE(hrs.h, 0) = 0 THEN ''free all day'''
    || E'\n' || '                          ELSE ROUND(COALESCE(hrs.h, 0), 1) || ''h booked'' END');

  IF v_new = v_src THEN RAISE EXCEPTION 'why-expression anchor not found'; END IF;
  EXECUTE v_new;
  RAISE NOTICE 'recommend_drivers: label simplified to name + availability';
END
$mig$;
