-- Migration 030: add the remaining two yards (Ladner, Abbotsford) and link the
-- buses/drivers that were left unlinked in 026 (home yard recorded in notes only).

INSERT INTO public.yards (name, address, is_default)
SELECT 'Ladner Yard', '4789 53 St, Delta, BC V4K 2Y9', false
WHERE NOT EXISTS (SELECT 1 FROM public.yards WHERE name = 'Ladner Yard');

INSERT INTO public.yards (name, address, is_default)
SELECT 'Abbotsford Yard', '29475 Fraser Hwy, Abbotsford, BC V4X 1H2', false
WHERE NOT EXISTS (SELECT 1 FROM public.yards WHERE name = 'Abbotsford Yard');

UPDATE public.buses   SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Ladner Yard')     WHERE notes ILIKE '%home yard: ladner%'     AND home_yard_id IS NULL;
UPDATE public.buses   SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Abbotsford Yard') WHERE notes ILIKE '%home yard: abbotsford%' AND home_yard_id IS NULL;
UPDATE public.drivers SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Ladner Yard')     WHERE notes ILIKE '%home yard: ladner%'     AND home_yard_id IS NULL;
UPDATE public.drivers SET home_yard_id = (SELECT id FROM public.yards WHERE name = 'Abbotsford Yard') WHERE notes ILIKE '%home yard: abbotsford%' AND home_yard_id IS NULL;
