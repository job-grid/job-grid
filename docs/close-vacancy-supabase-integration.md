# Close Job backend integration proposal

**Status: draft implementation proposal. Not owner-approved, deployed, or applied to any database.**

## Proposed default architecture

Use Supabase Auth to verify the employer/moderator session, a Supabase Edge Function as the trusted Close Job API, and PostgreSQL for the single-transaction state transition. The existing Cloudflare Pages static shell can remain the public presentation layer and call the API once an authenticated employer interface and approved origin are available.

This is a proposed default because it uses the already selected Supabase data platform and avoids treating the static website or browser as a trusted runtime. It still needs explicit owner review before merge or deployment.

## Additive schema contract — still subject to owner approval

The migration now assumes a Phase 2A core schema exists. It must **not** be applied to the current empty public schema by itself.

CI first creates `supabase/tests/phase2a_schema_contract.sql`, a disposable structural contract based on the Phase 2A logical data dictionary, and then applies the lifecycle migration against it. This proves the extension does not create a second `organizations`, `organization_memberships`, `platform_roles` or `vacancies` table. The fixture contains only the minimum columns and role/grant behavior the lifecycle slice depends on; it is not a substitute for an approved canonical migration or evidence about production.

Before execution, the owner-approved Phase 2A migration must provide compatible types and constraints for:
- organization tenant identity and membership/role state;
- canonical `vacancies` identity, `organization_id`, `created_by`, geography/worksite, state, version and publication window;
- a `status` vocabulary containing `published` and `closed`;
- Row Level Security and the intended visibility policy baseline;
- restricted public/authenticated column grants that do not expose creator identity or privileged moderation internals through table-wide SELECT.

The lifecycle migration adds only closure fields and lifecycle-owned catalog/audit/idempotency objects, policy/function integration and minimum RPC privileges. It fails if existing closure states conflict with the new closure metadata constraint. A reviewer must still compare every identifier, state rule, grant and RLS policy with the owner-approved physical core schema and handle any existing vacancy records before approving execution.

## What this proposal contains

- An additive lifecycle extension against the proposed Phase 2A core entities `organizations`, `organization_memberships`, `platform_roles` and `vacancies`. This change no longer creates those core tables.
- Two vacancy closure metadata fields (`closed_at`, `closure_reason_code`) with a foreign key and a consistency constraint; the core schema retains ownership of organization, identity, geography, vacancy content, moderation and application columns.
- A controlled closure-reason catalog, append-only lifecycle audit events and durable idempotency records.
- Row-level security that exposes only in-window published vacancies to anonymous callers, while active organization members can view vacancies in their own organization.
- An append-only vacancy audit table.
- Durable idempotency records and a PostgreSQL function that locks the vacancy row, authorizes an active organization owner/admin/recruiter or active moderator/admin, requires the exact expected version, updates published to closed, increments the version, and inserts the audit event and idempotency record in the same transaction.
- An Edge Function that validates the bearer session with Supabase Auth, derives the actor from that verified session, enforces an explicit origin allowlist, limits payload size, rejects client-supplied actor/role/status fields, and calls the database function using server-side credentials.
- A pinned SDK dependency and a CI type-check workflow.

The implementation has no vacancy-create, independent moderation, employer portal, or application-submission workflow. Consequently it is **not by itself the full recruitment marketplace** and no real Close Job button has been added to the public website. Existing applications are not modified or deleted by closure; the vacancy row itself is retained.

## Phase 2A schema compatibility — open blocker

PR #25, `docs/phase-2a-recruitment-spec.md`, is currently open, unmerged and draft. It is a proposed logical model, not an owner-approved physical schema. This Close Job migration must not be described as reconciled to an approved canonical schema.

The mapping is only partial today:

| Phase 2A concept | Current Close Job proposal | Compatibility gap |
|---|---|---|
| `organizations` | Minimal tenant row with legal/display names and status | The logical model also includes organization type, registration jurisdiction/number, verification status and later branches/worksites. |
| `organization_memberships` | Tenant-scoped user, role and active/revoked state | Identity uses Supabase `auth.users`; role/identity model still requires owner approval and an implemented membership administration flow. |
| `vacancies` | Minimum status/version, country/location, title/body and publication-window fields | The logical model also includes branch/geography references, occupation/sector/skill fields, employment and compensation terms, moderation/verification state, and application deadline. Those are not represented by this minimum proposal. |
| `job_applications` | No production table exists in this proposal or the verified empty public schema | SQL CI now creates a disposable table using the Phase 2A `job_applications` contract name to test that closure does not delete a related application row. This is a contract fixture, not evidence of a live application table or real candidate history. |

**Release gate:** until the owner approves a single Phase 2A core schema, do not apply this migration. The implementation must then be reworked as additive closure columns, policies, audit and idempotency objects against those canonical entities, rather than creating a competing simplified organization/vacancy model. No live database or application data was changed by this PR.

## Security boundaries

- The API gateway verifies JWTs and the function validates the access token against Supabase Auth.
- The actor ID comes from the verified user, not the request body.
- PostgreSQL re-checks active organization membership and role or active moderator/admin status.
- The close operation is a single PostgreSQL function call; changes to the vacancy, audit record and idempotency record are committed or rolled back together.
- The database function can be executed only by the service role. Do not expose the service-role key to a browser or commit it to GitHub.
- Anonymous reads are constrained by RLS to vacancies with published status, a publication time not in the future, and no expired deadline.
- Audit events and idempotency requests have no client read/write policies. Audit updates/deletes are explicitly blocked.
- Closing never deletes a vacancy; existing related records are not cascaded away.

## Required runtime configuration

Before the function can be deployed, an authorized project operator must set **ALLOWED_ORIGINS** to the exact trusted frontend origin(s). **SUPABASE_URL** and **SUPABASE_SERVICE_ROLE_KEY** are provided by the Supabase Edge Function environment; the service-role key must remain server-side. Do not use a wildcard origin or place secrets in static assets.

## Release gates not completed by this PR

1. Owner approves Supabase Auth + Edge Function as the initial API/runtime architecture and reviews role semantics and reason codes.
2. The intended Job Grid project is independently re-verified from the authorized Supabase connection. The current authoring session has not been able to access the project reference from the separately supplied verification report.
3. A separately approved isolated database target is available for migration and integration tests. The recovery project is not assumed safe for testing.
4. The migration is reviewed and executed only against that approved isolated target; SQL syntax, RLS behavior, role checks, transaction rollback and concurrent/idempotent calls are tested against PostgreSQL.
5. The Edge Function is deployed to the approved project and tested with real authenticated users from two organizations, including unauthorized and moderator cases.
6. The employer management interface and a secure vacancy creation/moderation/public-search flow are implemented and connected. Both public list and direct-detail routes must honor the database visibility rules.
7. Production migration and deployment receive separate approval and a verified rollback/forward-fix and recovery plan.

No migration was executed, no database was written, no secret or runtime setting was changed, and no deployment was performed by this PR.
