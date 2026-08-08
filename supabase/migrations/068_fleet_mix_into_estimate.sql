-- Migration 068: the admin fleet mix flows through pricing.
--
-- APPLIED 2026-08-05. Verified 063/064/065/066 all survived the patch, and that
-- fuel is still multiplied by bus_count.
--
-- Choosing three 47s instead of two 56s changes the RATE (rate_config is keyed
-- on bench_count) and the multiplier on base cost, fuel, overtime and
-- long-distance. So it can't just live in the assignment panel.
--
-- Note the recount: overriding the SIZE re-derives how many buses are needed.
-- Switching 56s to 47s requires more of them, and silently keeping the old
-- count would seat the group short — a booking error, not a pricing one.
DO $mig$
DECLARE v_src text; v_new text; v_prev text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'calculate_estimate' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'calculate_estimate not found'; END IF;
  IF position('v_rate := COALESCE(v_ver.override_hourly_rate, v_rate);' in v_src) = 0 THEN
    RAISE EXCEPTION 'migration 066 not applied; refusing to patch';
  END IF;

  v_new := v_src;

  v_prev := v_new;
  v_new := replace(v_new,
    '  v_bus_count    int;',
    '  v_bus_count    int;' || E'\n' ||
    '  v_sys_bench_count int;' || E'\n' ||
    '  v_sys_bus_count   int;');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 1 (declaration) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '  v_bus_count := GREATEST(1, CEIL(v_seats / v_bench_seats));',
    '  v_bus_count := GREATEST(1, CEIL(v_seats / v_bench_seats));' || E'\n' || E'\n' ||
    '  -- Admin fleet-mix override (067/068). Kept separate from the seat maths' || E'\n' ||
    '  -- so the UI can show what the calculation wanted alongside what was' || E'\n' ||
    '  -- chosen.' || E'\n' ||
    '  v_sys_bench_count := v_bench_count;' || E'\n' ||
    '  v_sys_bus_count   := v_bus_count;' || E'\n' ||
    '  IF v_ver.override_bench_count IS NOT NULL THEN' || E'\n' ||
    '    v_bench_count := v_ver.override_bench_count;' || E'\n' ||
    '    v_bench_seats := CASE v_bench_count WHEN 18 THEN 9 WHEN 47 THEN 23.67 ELSE 28 END;' || E'\n' ||
    '    -- Recount for the new size: switching 56s to 47s needs MORE buses, and' || E'\n' ||
    '    -- silently keeping the old count would seat the group short.' || E'\n' ||
    '    v_bus_count := GREATEST(1, CEIL(v_seats / v_bench_seats));' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  v_bus_count := COALESCE(v_ver.override_bus_count, v_bus_count);');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 2 (bus count) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '    ''bench_count'', v_bench_count,',
    '    ''bench_count'', v_bench_count,' || E'\n' ||
    '    ''system_bench_count'', v_sys_bench_count,' || E'\n' ||
    '    ''system_bus_count'', v_sys_bus_count,' || E'\n' ||
    '    ''override_bench_count'', v_ver.override_bench_count,' || E'\n' ||
    '    ''override_bus_count'', v_ver.override_bus_count,');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 3 (json) not found'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_estimate patched: fleet mix is now overridable';
END
$mig$;
