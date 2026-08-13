-- Migration 074: route tracking links, per school.
--
-- APPLIED 2026-08-12. Verified an ANONYMOUS caller reads zero rows before any
-- real link was stored.
--
-- Phase 1 of the parent portal, and deliberately the piece that is useful on
-- its own. Today the three Samsara links (AM, PM, late start) exist only inside
-- emails CCSTA has sent. Nobody can find the current one without searching
-- their sent folder, and when a link changes there is no single place to change
-- it. This fixes that whether or not a parent ever logs in.
--
-- Per school, not CCSTA-wide (Mila, 2026-08-11).

CREATE TABLE IF NOT EXISTS public.school_routes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- Free text, not an enum. Today it's AM / PM / late start, but "late start"
  -- is already a Friday-only oddity and schools will have their own words for
  -- things. An enum would mean a migration every time a school names a route
  -- differently.
  label        text NOT NULL,
  samsara_url  text NOT NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, label)
);

CREATE INDEX IF NOT EXISTS school_routes_school ON public.school_routes (school_id) WHERE active;

ALTER TABLE public.school_routes ENABLE ROW LEVEL SECURITY;

-- Admin-only for now, BOTH directions.
--
-- Deliberately NOT public-read, unlike yards and rate_config. A Samsara share
-- link is a live position feed for a bus carrying children: the link itself is
-- the only thing protecting it, so it must not be readable by anyone who
-- happens to query the API. Parent read access gets added with the parent role,
-- scoped to their own school.
DROP POLICY IF EXISTS "school_routes_admin" ON public.school_routes;
CREATE POLICY "school_routes_admin" ON public.school_routes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

COMMENT ON TABLE public.school_routes IS
  'Samsara share links per school route (AM / PM / late start). NOT public-read: the link is the only thing protecting a live feed of a bus carrying children. Parent access comes later, scoped per school.';

COMMENT ON COLUMN public.school_routes.samsara_url IS
  'Public Samsara share link. Anyone holding it can watch the bus, logged in or not — the portal makes these findable, not private. Rotate in Samsara if one leaks.';
