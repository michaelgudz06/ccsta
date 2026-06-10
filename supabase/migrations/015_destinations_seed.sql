-- Migration 015: destinations lookup table with pre-calculated drive times from Surrey yard
-- Source: 2026-2027 quote templates (Destinations sheet).
-- pre_hours = drive time yard→location; post_hours = location→yard.
-- Used by estimate engine to add driver yard-travel time to billable hours.

CREATE TABLE IF NOT EXISTS public.destinations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  address    text,
  pre_hours  numeric(5,3),   -- yard → location (hours)
  post_hours numeric(5,3),   -- location → yard (hours)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER destinations_updated_at
  BEFORE UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "destinations_auth_read"
  ON public.destinations FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "destinations_admin_write"
  ON public.destinations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

-- Seed: ~100 locations with confirmed drive times from Surrey yard (8888 162 St)
INSERT INTO public.destinations (name, address, pre_hours, post_hours) VALUES
  ('Abbotsford Christian Middle & Secondary School','35011 Old Clayburn Rd, Abbotsford, BC V2S 7L7',1.500,1.250),
  ('Aldergrove Community Secondary School (ACSS)','26850 29 Ave, Aldergrove, BC V4W 3C1',1.000,0.750),
  ('Alice Brown Elementary School','20011 44 Ave, Langley, BC V3A 6L8',0.750,0.500),
  ('BC Christian Academy High School','3000 Christmas Way, Coquitlam, BC V3C 2K7',1.000,0.750),
  ('Belmont Elementary','20390 40 Ave, Langley, BC V3A 2X1',1.000,0.750),
  ('Betty Gilbert Middle School','26845 27 Ave, Aldergrove, BC V4W 3E6',1.000,0.750),
  ('Betty Huff Elementary','13055 Huntley Ave, Surrey, BC V3V 1V1',0.750,0.500),
  ('Bothwell Elementary School','17070 102 Ave, Surrey, BC V4N 4N6',0.500,0.250),
  ('Brookswood Secondary','20902 37 A Ave, Langley, BC V3A 5N2',1.000,0.750),
  ('Carson Graham Secondary School','2145 Jones Ave, North Vancouver, BC V7M 2W7',1.000,0.750),
  ('Cedar Hills Elementary','12370 98 Ave, Surrey, BC V3V 2K3',0.750,0.500),
  ('Centennial Secondary','570 Poirier St, Coquitlam, BC V3J 6A8',0.750,0.500),
  ('Chilliwack Secondary School','46363 Yale Rd, Chilliwack, BC V2P 2P8',1.750,1.500),
  ('Christian Life Assembly','21277 56 Ave, Langley, BC V2Y 1M3',1.000,0.750),
  ('Clayton Heights Secondary School','7003 188 St, Surrey, BC V4N 3G6',0.750,0.500),
  ('Clearbrook Mennonite Brethren Church','2719 Clearbrook Rd, Abbotsford, BC V2T 2Y9',1.250,1.000),
  ('Cloverdale Catholic School','17511 59 Ave, Surrey, BC V3S 1P3',0.750,0.500),
  ('Cloverdale United Church','17575 58A Ave, Surrey, BC V3S 1N1',0.750,0.500),
  ('Coast Meridian Elementary','8222 168a St, Surrey, BC V4N 4T8',0.500,0.250),
  ('Coyote Creek Elementary','8131 156 St, Surrey, BC V3S 3R4',0.500,0.250),
  ('Credo Christian High School','21846 52 Ave, Langley, BC V2Y 1L3',1.000,0.750),
  ('Creekside Elementary School','13838 91 Ave, Surrey, BC V3V 1C2',0.500,0.250),
  ('D.W. Poppy Secondary School','23752 52 Ave, Langley Twp, BC V2Z 2P3',1.000,0.750),
  ('David Brankin Elementary School','9160 128 St, Surrey, BC V3V 1S8',0.750,0.500),
  ('Delta Christian School','4789 53 St, Delta, BC V4K 2Y9',1.000,0.750),
  ('Dogwood Elementary School','10752 157 St, Surrey, BC V4N 3L7',0.500,0.250),
  ('Don Christian Elementary','6256 184 St, Surrey, BC V3S 8E6',0.750,0.500),
  ('Douglas Park Community School','5409 206 St, Langley, BC V3A 2C5',1.000,0.750),
  ('Dr. F.D. Sinclair Elementary School','7480 128 St, Surrey, BC V3W 4E5',0.750,0.500),
  ('Earl Marriott Secondary School','15751 16 Ave, Surrey, BC V4A 1S1',0.750,0.500),
  ('École Gabrielle-Roy','6887 132 St, Surrey, BC V3W 4L9',0.750,0.500),
  ('École Heritage Park Middle School','33700 Prentis Ave, Mission, BC V2V 7B1',1.500,1.250),
  ('École Salish Secondary School','7278 184 St, Surrey, BC V4N 5V2',0.750,0.500),
  ('Elgin Park Secondary School','13484 24 Ave, Surrey, BC V4A 2G5',0.750,0.500),
  ('Ellendale Elementary','14525 110a Ave, Surrey, BC V3R 2B5',0.750,0.500),
  ('Enver Creek Secondary School','14505 84 Ave, Surrey, BC V3S 8X2',0.500,0.250),
  ('Erma Stephenson Elementary','10929 160 St, Surrey, BC V4N 1P3',0.500,0.250),
  ('Fairview Elementary','12209 206 St, Maple Ridge, BC V2X 1T8',0.750,0.500),
  ('Fleetwood Park Secondary School','7940 156 St, Surrey, BC V3S 3R3',0.500,0.250),
  ('Frank Hurt Secondary School','13940 77 Ave, Surrey, BC V3W 7V7',0.500,0.250),
  ('Fraser Heights Secondary School','16060 108 Ave, Surrey, BC V4N 1M1',0.500,0.250),
  ('Fraser Wood Elementary','10650 164 St, Surrey, BC V4N 1W8',0.500,0.250),
  ('Frost Road Elementary School','8606 162 St, Surrey, BC V4N 1B5',0.375,0.125),
  ('George Greenaway Elementary','17285 61a Ave, Surrey, BC V3S 1W3',0.500,0.250),
  ('Goldstone Park Elementary School','6287 146 St, Surrey, BC V3S 1X5',0.750,0.500),
  ('Gordon Greenwood Elementary School','9175 206 St, Langley Twp, BC V1M 2X2',0.750,0.500),
  ('Green Timbers Elementary','8824 144 St, Surrey, BC V3V 5Z7',0.500,0.250),
  ('Guildford Park Secondary School','10707 146 St, Surrey, BC V3R 1T5',0.750,0.500),
  ('H.D. Stafford Middle School','20441 Grade Crescent, Langley, BC V3A 4J8',0.750,0.500),
  ('Hazelgrove Elementary School','7057 191 St, Surrey, BC V4N 6E5',0.750,0.500),
  ('Holly Elementary','10719 150 St, Surrey, BC V3R 4C8',0.500,0.250),
  ('Holy Cross Regional High School','16193 88 Ave, Surrey, BC V4N 1G3',0.375,0.125),
  ('Hugh McRoberts Secondary','8980 Williams Rd, Richmond, BC V7A 1G6',1.250,1.000),
  ('James Hill Elementary School','22144 Old Yale Rd, Langley, BC V2Z 1B5',1.000,0.750),
  ('James Kennedy Elementary School','9060 212 St, Langley Twp, BC V1M 2B9',0.750,0.500),
  ('James Park Elementary','1761 Westminster Ave, Port Coquitlam, BC V3B 1E5',0.750,0.500),
  ('Jessie Lee Elementary','2064 154 St, Surrey, BC V4A 4S3',0.750,0.500),
  ('Johnston Heights Secondary School','15350 99 Ave, Surrey, BC V3R 0R9',0.500,0.250),
  ('Josette Dandurand Elementary','20143 82 Ave, Langley Twp, BC V2Y 2A8',0.750,0.500),
  ('Kennedy Trail Elementary','8305 122a St, Surrey, BC V3W 0T1',0.750,0.500),
  ('Kwantlen Park Secondary School','10441 132 St, Surrey, BC V3T 3V3',0.750,0.500),
  ('L.A. Matheson Secondary School','9484 122 St, Surrey, BC V3V 1N5',0.750,0.500),
  ('Langley Christian Middle & High School','22702 48 Ave, Langley Twp, BC V2Z 2T6',1.000,0.750),
  ('Langley Christian School Elementary','22930 48 Ave, Langley Township, BC V2Z 2T7',1.000,0.750),
  ('Langley Meadows Community School','2244 Willoughby Way, Langley, BC V2Y 1C1',0.750,0.500),
  ('Langley Secondary','21405 56 Ave, Langley, BC V2Y 1M3',0.750,0.500),
  ('Lena Shaw Elementary School','14250 100a Ave, Surrey, BC V3T 1K6',0.500,0.250),
  ('Lord Tweedsmuir Secondary School','6151 180 St, Surrey, BC V3S 4L5',0.750,0.500),
  ('Lynn Fripps Elementary School','21020 83 Ave, Langley Twp, BC V2Y 0K8',0.750,0.500),
  ('Maddaugh Elementary','19405 76 Ave, Surrey, BC V4N 6C6',0.750,0.500),
  ('Maple Ridge Christian School','12140 204b St, Maple Ridge, BC V2X 2Z5',0.750,0.500),
  ('Martha Jane Norris Elementary School','12928 66A Ave, Surrey, BC V3W 8Y1',0.750,0.500),
  ('Mennonite Educational Institute (MEI)','4081 Clearbrook Rd, Abbotsford, BC V4X 2M8',1.250,1.000),
  ('New Westminster Secondary School','820 6th St, New Westminster, BC V3L 3C8',1.000,0.750),
  ('Newton Elementary','13359 81 Ave, Surrey, BC V3W 3C5',0.500,0.250),
  ('North Surrey Secondary School','15945 96 Ave, Surrey, BC V4N 2R8',0.500,0.250),
  ('Pacific Academy','10238 168 St, Surrey, BC V4N 1Z4',0.500,0.250),
  ('Panorama Ridge Secondary School','13220 64 Ave, Surrey, BC V3X 3S3',0.750,0.500),
  ('Peter Ewart Middle School','7755 202a St, Langley Twp, BC V2Y 1W4',0.750,0.500),
  ('Queen Elizabeth Secondary School','9457 King George Blvd, Surrey, BC V3V 5W4',0.750,0.500),
  ('Regent Christian Academy','15100 66A Ave, Surrey, BC V3S 2A6',0.500,0.250),
  ('Regent Christian Academy Cloverdale Campus','5950 179 St, Surrey, BC V3S 1Y4',0.750,0.500),
  ('Richard Bulpitt Elementary School','20965 77A Ave, Langley Twp, BC V2Y 2E5',0.750,0.500),
  ('Riverdale Elementary School','14835 108a Ave, Surrey, BC V3R 1W9',0.750,0.500),
  ('Royal Heights Elementary School','11665 97 Ave, Surrey, BC V3V 2B9',1.000,0.750),
  ('Scott Creek Middle School','1240 Lansdowne Dr, Coquitlam, BC V3E 3E7',1.000,0.750),
  ('St. Matthew''s Elementary School','16065 88 Ave, Surrey, BC V4N 1G3',0.500,0.250),
  ('Strawberry Hill Elementary School','7633 124 St, Surrey, BC V3W 8N2',0.750,0.500),
  ('Sullivan Heights Secondary School','6248 144 St, Surrey, BC V3X 1A1',0.750,0.500),
  ('Sunrise Ridge Elementary School','18690 60 Ave, Surrey, BC V3S 8L8',0.750,0.500),
  ('Surrey Christian School — Fleetwood Campus','8888 162 St, Surrey, BC V4N 3G1',0.500,0.250),
  ('Surrey Christian School — Secondary Campus','15353 92 Ave, Surrey, BC V3R 1C3',0.500,0.250),
  ('Vancouver Christian School','3496 Mons Dr, Vancouver, BC V5M 3E6',0.750,0.500),
  ('Vanguard Secondary School','3825 244 St, Langley Twp, BC V2Z 2L1',1.000,0.750),
  ('Walnut Grove Secondary School','8919 Walnut Grove Dr, Langley Twp, BC V1M 2C9',0.750,0.500),
  ('West Langley Elementary School','9403 212 St, Langley Twp, BC V1M 1M1',0.750,0.500),
  ('Westerman Elementary School','7626 122 St, Surrey, BC V3W 1H4',0.750,0.500),
  ('White Rock Christian Academy','2265 152nd St, Surrey, BC V4A 4P1',0.750,0.500),
  ('William F. Davidson Elementary School','15550 99a Ave, Surrey, BC V3R 9H5',0.500,0.250),
  ('William Watson Elementary School','16450 80 Ave, Surrey, BC V4N 0H3',0.500,0.250),
  ('Wix-Brown Elementary School','23851 24 Ave, Langley Twp, BC V2Z 3A3',1.000,0.750),
  ('Woodland Park Elementary School','9025 158 St, Surrey, BC V4N 5G4',0.500,0.250),
  ('Yorkson Creek Middle School','20686 84 Ave, Langley Twp, BC V2Y 2B5',0.750,0.500),
  ('Southridge School','2656 160 St, Surrey, BC V3Z 0B7',0.750,0.500)
ON CONFLICT DO NOTHING;
