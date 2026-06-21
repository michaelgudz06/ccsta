-- Migration 026: real operational data from Curtis (2026-06-20)
--   • Yard correction (name / address / postal)
--   • Admin notification email → admin@ccsta.ca
--   • Member-school flags (only 4 remain members)
--   • Real bus fleet (28 units) with Samsara vehicle IDs + VINs — replaces demo fleet
--   • Real driver roster (36 drivers) — demo drivers deactivated, not deleted
--
-- NOTE: driver_bus_clearances are NOT seeded here — Curtis did not provide which
-- bench sizes (18/47/56) each driver is cleared to operate. suggest_assignment
-- needs that data; see the companion note. Until then, assignment can't match
-- drivers to buses by size.

-- ── 1. Yard correction ───────────────────────────────────────────────────────
UPDATE public.yards
SET name    = 'Surrey Yard',
    address = '16099 Fraser Highway, Surrey, BC V4N 3G2',
    lat     = 49.11229,
    lng     = -122.77854,
    updated_at = now()
WHERE is_default = true;

-- Langley yard (second yard). Abbotsford + Ladner to be added later.
INSERT INTO public.yards (name, address, is_default)
SELECT 'Langley Yard', '4053 208 Street, Township of Langley, BC, V3A 2H3', false
WHERE NOT EXISTS (SELECT 1 FROM public.yards WHERE name = 'Langley Yard');

-- ── 2. Admin notification email ──────────────────────────────────────────────
UPDATE public.app_config SET value = 'admin@ccsta.ca', updated_at = now()
WHERE key = 'notify_admin_email';

-- ── 3. Member schools — reset all, then flag the confirmed 4 ──────────────────
UPDATE public.schools SET is_member = false;
UPDATE public.schools SET is_member = true
WHERE name IN (
  'Credo Christian Elementary School',
  'Credo Christian High School',
  'Langley Christian School',
  'Surrey Christian School'
);

-- ── 4. Real bus fleet ────────────────────────────────────────────────────────
-- Remove demo buses (only if no trip references them).
DELETE FROM public.buses
WHERE fleet_number IN ('Bus 01','Bus 02','Bus 10','Bus 11','Bus 12','Bus 20','Bus 21')
  AND id NOT IN (SELECT bus_id FROM public.trips WHERE bus_id IS NOT NULL);

-- Upsert the real fleet. home_yard_id stays null (only the Surrey yard record
-- exists); each bus's actual home yard is recorded in notes.
INSERT INTO public.buses (fleet_number, bench_count, air_brake_req, active, serial_number, samsara_vehicle_id, notes)
VALUES
  ('Bus 49', 47, false, true, '1BAKGCPH4CF283189', 'GV6C-E9T-U3W', 'Spare. Home yard: Surrey.'),
  ('Bus 50', 47, false, true, '1BAKGCPH2CF283191', 'GX3Z-XAG-ZUY', '2012 BB conventional. Home yard: Langley.'),
  ('Bus 51', 47, true,  true, '1BAKGCBA5GF315115', 'G86G-4JN-SK4', '2016 BB conventional. Home yard: Surrey.'),
  ('Bus 52', 47, true,  true, '1BAKGCBA7GF315116', 'GJ67-5PP-UH2', '2016 BB conventional. Home yard: Surrey.'),
  ('Bus 53', 56, true,  true, '1BABNCPA3GF323356', 'G3WF-YZ2-8AE', '2016 BB All American. Home yard: Ladner.'),
  ('Bus 54', 56, true,  true, '1BABNBPA7GF323273', 'GNZG-FDS-G7U', 'Spare. Home yard: Surrey.'),
  ('Bus 56', 47, true,  true, '1BAKGCEA6JF328717', 'GYE2-XDR-NH5', '2018 BB conventional. Home yard: Langley.'),
  ('Bus 57', 47, true,  true, '1BAKGCEA8JF328718', 'G7E3-CUZ-FK3', '2018 BB conventional. Home yard: Abbotsford. Bench count not given by Curtis — inferred 47 from VIN family; confirm.'),
  ('Bus 58', 56, true,  true, '1BABNBSA8JF342705', 'G8VK-W4M-72B', 'Spare. Home yard: Surrey.'),
  ('Bus 59', 56, true,  true, '1BABNCSA5JF342652', 'GT26-AKP-5YC', '2018 All American. Home yard: Abbotsford.'),
  ('Bus 62', 56, true,  true, '1BABNBXA66F231697', 'GFPF-K8P-WBX', 'Spare. Home yard: Surrey.'),
  ('Bus 64', 47, false, true, '1BAKGCPH99F254697', 'GEYE-SSY-5NA', 'Spare. Home yard: Surrey.'),
  ('Bus 65', 47, true,  true, '1BAKGCEA2LF359739', 'GS5G-CNH-SH4', '2020 BB conventional. Home yard: Langley.'),
  ('Bus 66', 47, true,  true, NULL,                'GY4X-6RZ-7UV', 'Home yard: Surrey.'),
  ('Bus 67', 47, true,  true, NULL,                'GHEH-KWE-T5A', 'Home yard: Surrey.'),
  ('Bus 69', 47, true,  true, NULL,                'G28F-H6Z-97C', 'Home yard: Surrey.'),
  ('Bus 72', 47, false, true, NULL,                'GX8E-VEJ-UHG', 'Spare. Home yard: Surrey.'),
  ('Bus 73', 47, false, true, NULL,                'GFGE-DWD-99K', 'Home yard: Surrey.'),
  ('Bus 74', 56, false, true, NULL,                'G62Z-K8S-CYY', 'Home yard: Surrey. Curtis listed 52 → corrected to 56.'),
  ('Bus 75', 18, false, true, NULL,                'G566-XA3-JCX', 'Home yard: Surrey.'),
  ('Bus 79', 47, false, true, NULL,                'GKNU-P3J-4B5', 'Home yard: Surrey.'),
  ('Bus 80', 47, false, true, NULL,                'G499-5XA-WV9', 'Home yard: Surrey.'),
  ('Bus 81', 47, false, true, NULL,                'G9W4-SFU-ARX', 'Home yard: Langley.'),
  ('Bus 82', 47, false, true, NULL,                'G2WX-52H-U3D', 'Home yard: Langley.'),
  ('Bus 83', 47, false, true, NULL,                'GSXA-8P2-94T', 'Home yard: Surrey.'),
  ('Bus 84', 47, false, true, NULL,                'GWGB-WMN-EBZ', 'Home yard: Langley.'),
  ('Bus 85', 47, false, true, NULL,                'GGC9-6X8-DGG', 'Home yard: Surrey.'),
  ('Bus 86', 56, true,  true, NULL,                'G2WZ-U8H-4KP', 'Home yard: Abbotsford.')
ON CONFLICT (fleet_number) DO UPDATE SET
  bench_count        = EXCLUDED.bench_count,
  air_brake_req      = EXCLUDED.air_brake_req,
  active             = EXCLUDED.active,
  serial_number      = EXCLUDED.serial_number,
  samsara_vehicle_id = EXCLUDED.samsara_vehicle_id,
  notes              = EXCLUDED.notes,
  updated_at         = now();

-- ── 5. Real driver roster ────────────────────────────────────────────────────
-- Deactivate demo drivers so they aren't assigned (kept for portal-login testing).
UPDATE public.drivers SET active = false, updated_at = now()
WHERE notes ILIKE '%DEMO%'
   OR (first_name = 'Test' AND last_name = 'Driver');

-- Insert real drivers (idempotent: skips any name already present).
-- email + profile_id are null (no logins yet — drivers are notified by SMS).
-- trip_type is mapped from Curtis's free-text; air-brake for the second group
-- ("Air-brake not specified") defaults to false pending confirmation.
INSERT INTO public.drivers (first_name, last_name, phone, air_brake_cert, trip_type, active, notes)
SELECT v.first_name, v.last_name, v.phone, v.air_brake_cert, v.trip_type::public.driver_trip_type, true, v.notes
FROM (VALUES
  ('Angela',    'Bidell',        '604-306-9948', false, 'both',       'Home yard: Surrey.'),
  ('Francisco', 'Cabanos',       '604-809-5961', false, 'route',      'Goes by Franco. Home yard: Surrey.'),
  ('Sandy',     'Campbell',      '604-341-1444', true,  'both',       'Home yard: Abbotsford.'),
  ('Brad',      'DeBoer',        '604-825-4301', true,  'both',       'Home yard: Abbotsford.'),
  ('Birgitt',   'Demeester',     '604-842-4770', false, 'both',       'Home yard: Surrey.'),
  ('Chandar',   'Dutt',          '778-751-5590', true,  'both',       'Home yard: Surrey.'),
  ('Bruce',     'Ferguson',      '604-340-5210', true,  'both',       'Trips sometimes. Home yard: Langley.'),
  ('Ray',       'Hamel',         '778-222-1693', true,  'both',       'Trips sometimes. Home yard: Langley.'),
  ('Arnold',    'Horan',         '604-655-6566', false, 'both',       'Home yard: Surrey.'),
  ('Ricky',     'Lam',           '604-725-4321', true,  'both',       'Home yard: Surrey.'),
  ('Gian',      'Lehal',         '604-889-5346', false, 'both',       'Home yard: Surrey.'),
  ('Ryan',      'Overall',       '604-250-1104', false, 'route',      'Trips only if emergency, usually route only. Home yard: Langley.'),
  ('Saber',     'Oweis',         '778-986-3656', false, 'both',       'Spare driver, rarely works for us. Home yard: not specified.'),
  ('Earl',      'Scott',         '604-290-8781', false, 'route',      'Home yard: Langley.'),
  ('Rupi',      'Sidhu',         '778-957-6343', false, 'both',       'Both but mainly route. Home yard: Surrey.'),
  ('Brian',     'Stevens',       '604-671-5960', false, 'route',      'Home yard: Surrey.'),
  ('Sharon',    'Struik',        '778-230-6497', true,  'route',      'Home yard: Surrey.'),
  ('Kuldip',    'Tatla',         '604-226-0333', false, 'both',       'Recent accident — currently training at different yards. Home yard: any.'),
  ('Cheryl',    'Van Den Hoven', '604-500-2139', true,  'both',       'Home yard: Surrey.'),
  ('Wendy',     'Wall',          '604-351-2580', true,  'both',       'Home yard: Surrey.'),
  ('Bob',       'Willms',        '604-862-6971', true,  'both',       'Home yard: Surrey.'),
  ('Anita',     'Antolin',       '778-886-1640', false, 'both',       'Spare; also works for other companies. Air-brake not specified. Home yard: Surrey.'),
  ('Larry',     'Asseltine',     '604-789-6585', false, 'field_trip', 'Trips. Air-brake not specified. Home yard: Surrey.'),
  ('Rick',      'Baker',         '604-500-1376', false, 'field_trip', 'Yard manager; does some trips, usually the longer ones. Air-brake not specified. Home yard: any.'),
  ('Jorge',     'Cardoza',       '604-306-1432', false, 'both',       'Both, but also works for other companies. Air-brake not specified. Home yard: Surrey.'),
  ('Ruby',      'Dhaliwal',      '604-621-0088', false, 'both',       'Spare. Air-brake not specified. Home yard: Langley.'),
  ('George',    'Hudson',        '778-668-3852', false, 'field_trip', 'Trips and maintenance. Air-brake not specified. Home yard: Surrey.'),
  ('Judy',      'Klapwyk',       '604-230-2304', false, 'field_trip', 'Spare (does trips). Air-brake not specified. Home yard: Surrey.'),
  ('Jim',       'Mace',          '604-805-1028', false, 'field_trip', 'Spare (trips). Air-brake not specified. Home yard: Surrey.'),
  ('Barry',     'McMillan',      '604-649-3579', false, 'both',       'Routes, trips sometimes. Air-brake not specified. Home yard: Langley.'),
  ('Tim',       'Monette',       '778-999-3903', false, 'field_trip', 'Spare (trips). Air-brake not specified. Home yard: Surrey.'),
  ('Francois',  'Nantel',        '604-572-3123', false, 'field_trip', 'Spare (trips). Air-brake not specified. Home yard: Surrey.'),
  ('KellieLynn','Pirie',         '778-549-7372', false, 'both',       'Spare (both). Air-brake not specified. Home yard: Langley.'),
  ('Bob',       'Raines',        '672-699-7833', false, 'field_trip', 'Spare (trips). Air-brake not specified. Home yard: Langley.'),
  ('Jerry',     'Scholtens',     '604-996-7623', false, 'both',       'Spare (both). Air-brake not specified. Home yard: Langley.'),
  ('Lakhbir',   'Suddi',         '604-722-6520', false, 'both',       'Goes by Lucky. Basically never works for us. Air-brake not specified. Home yard: unknown.')
) AS v(first_name, last_name, phone, air_brake_cert, trip_type, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.drivers d
  WHERE d.first_name = v.first_name AND d.last_name = v.last_name
);

-- ── 6. Link buses + drivers to their home yard (Surrey + Langley only) ────────
-- Abbotsford / Ladner / "any" / unspecified stay unlinked until those yards exist.
UPDATE public.buses   SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Surrey Yard')  WHERE notes ILIKE '%home yard: surrey%';
UPDATE public.buses   SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Langley Yard') WHERE notes ILIKE '%home yard: langley%';
UPDATE public.drivers SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Surrey Yard')  WHERE notes ILIKE '%home yard: surrey%';
UPDATE public.drivers SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Langley Yard') WHERE notes ILIKE '%home yard: langley%';

-- ── 7. Driver–bus clearances ─────────────────────────────────────────────────
-- Bench size is NOT a constraint — drivers can operate any size. Air-brake cert
-- is the only gate (enforced by suggest_assignment vs buses.air_brake_req).
-- So every active driver is cleared for all three sizes.
DELETE FROM public.driver_bus_clearances
WHERE driver_id IN (SELECT id FROM public.drivers WHERE NOT active);

INSERT INTO public.driver_bus_clearances (driver_id, bench_count)
SELECT d.id, b.bench
FROM public.drivers d
CROSS JOIN (VALUES (18),(47),(56)) AS b(bench)
WHERE d.active
ON CONFLICT DO NOTHING;
