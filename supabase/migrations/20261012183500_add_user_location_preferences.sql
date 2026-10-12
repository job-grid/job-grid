-- Draft migration for PR #29; DO NOT APPLY until the correct Job Grid Supabase project
-- and the candidate/profile authorization contract are approved.
-- Location values are user-selected profile preferences, not trusted legal/work-eligibility evidence.

CREATE TABLE public.user_location_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  country_code text NOT NULL
    CHECK (country_code ~ '^[A-Z]{2}$'),
  country_name text NOT NULL
    CHECK (length(btrim(country_name)) BETWEEN 1 AND 120),
  place_provider text NOT NULL
    CHECK (length(btrim(place_provider)) BETWEEN 1 AND 80),
  provider_place_id text NOT NULL
    CHECK (length(btrim(provider_place_id)) BETWEEN 1 AND 128),
  place_name text NOT NULL
    CHECK (length(btrim(place_name)) BETWEEN 1 AND 200),
  place_type text NOT NULL
    CHECK (place_type IN ('populated_place', 'administrative_area', 'unknown')),
  feature_code text
    CHECK (feature_code IS NULL OR length(feature_code) <= 40),
  admin_areas jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(admin_areas) = 'array'),
  display_label text NOT NULL
    CHECK (length(btrim(display_label)) BETWEEN 1 AND 500),
  latitude double precision
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_location_preferences_coordinate_pair
    CHECK ((latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);

COMMENT ON TABLE public.user_location_preferences IS
  'User-selected location preference. Not proof of residence, jurisdiction, work eligibility or authoritative geography.';
COMMENT ON COLUMN public.user_location_preferences.country_code IS
  'Two-letter product lookup code copied from the approved country picker. This constraint validates shape only, not ISO authority.';
COMMENT ON COLUMN public.user_location_preferences.provider_place_id IS
  'External provider identifier; resolve and validate server-side before using as canonical Job Grid geography.';
COMMENT ON COLUMN public.user_location_preferences.admin_areas IS
  'Optional display metadata; missing levels are valid and must not be used to invent parent relationships.';

ALTER TABLE public.user_location_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_location_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_location_preferences TO authenticated;
GRANT ALL ON TABLE public.user_location_preferences TO service_role;

CREATE POLICY user_location_preferences_select_own
  ON public.user_location_preferences
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY user_location_preferences_insert_own
  ON public.user_location_preferences
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_location_preferences_update_own
  ON public.user_location_preferences
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_location_preferences_delete_own
  ON public.user_location_preferences
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
