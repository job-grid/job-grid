# Location profile persistence contract

**Status: proposed; migration is not applied.** This contract prepares profile persistence for the country/place selector. The available Supabase connector does not expose a clearly identified, active Job Grid project, so this change is repository-only.

## MVP data contract

A signed-in user has at most one preferred location, stored in `public.user_location_preferences` and keyed by their `auth.users.id`. The record includes the selected country code/name; the place provider and provider ID; place name/type/feature code; optional administrative labels; a display label; optional coordinate pair; and an update timestamp.

Administrative levels are **optional display metadata**, not a parent-child graph. This keeps missing Kenya/Japan parent edges from blocking a selected location and prevents an absent edge being invented.

## Security model

- Each authenticated user can read, insert, update and delete only the row whose `user_id = auth.uid()`.
- Anonymous access is revoked.
- The user ID is the primary key and cascades when the auth user is deleted.
- The table has row-level security enabled and four explicit owner-scoped policies.
- Coordinates must be both present or both absent and must be within WGS84 ranges.
- The two-letter country check verifies shape only. It does **not** certify official ISO status, legal geography, residence or employment eligibility.
- A provider ID is not an internal Job Grid place ID. Before using this data for authoritative job filtering, a trusted server endpoint must resolve and validate the provider identity against the approved catalog. Do not trust a browser-sent country/provider pairing as proof.

## RLS review test

A non-destructive structural test is provided at `supabase/tests/location_preference_rls_contract.sql`. It checks that RLS is enabled, the four expected policies exist, each applies only to the authenticated role, and the policy command has the appropriate `USING` / `WITH CHECK` shape. It does not claim to replace the two-user runtime isolation test; run both only against the verified Job Grid project after the reviewed migration is applied.

## Migration handling

Migration: `supabase/migrations/20261012183500_add_user_location_preferences.sql`.

It is intentionally only proposed on PR #29. **Do not apply it** until:
1. The correct active Job Grid Supabase project is available and verified.
2. The owner approves this minimal profile-location table and its relationship to the future candidate profile schema.
3. CI validates the migration, and an authorized database security check confirms owner isolation with two distinct authenticated users.
4. The location provider terms/data policy and data-retention decisions are accepted.

No project/schema lookup, live migration, seed/import, table write, profile save or deployment was performed for this proposal.
