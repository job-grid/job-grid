# Close Job backend integration proposal

**Status: draft implementation proposal. Not owner-approved, deployed, or applied to any database.**

## Proposed default architecture

Use Supabase Auth to verify the employer/moderator session, a Supabase Edge Function as the trusted Close Job API, and PostgreSQL for the single-transaction state transition. The existing Cloudflare Pages static shell can remain the public presentation layer and call the API once an authenticated employer interface and approved origin are available.

This is a proposed default because it uses the already selected Supabase data platform and avoids treating the static website or browser as a trusted runtime. It still needs explicit owner review before merge or deployment.

## What this proposal contains

- A small, controlled organization/membership and platform-role model for authorization.
- A vacancy foundation with versioning and explicit status.
- A controlled closure-reason catalog.
- Row-level security that exposes only in-window published vacancies to anonymous callers, while active organization members can view vacancies in their own organization.
- An append-only vacancy audit table.
- Durable idempotency records and a PostgreSQL function that locks the vacancy row, authorizes an active organization owner/admin/recruiter or active moderator/admin, requires the exact expected version, updates published to closed, increments the version, and inserts the audit event and idempotency record in the same transaction.
- An Edge Function that validates the bearer session with Supabase Auth, derives the actor from that verified session, enforces an explicit origin allowlist, limits payload size, rejects client-supplied actor/role/status fields, and calls the database function using server-side credentials.
- A pinned SDK dependency and a CI type-check workflow.

The implementation has no vacancy-create, independent moderation, employer portal, or application-submission workflow. Consequently it is **not by itself the full recruitment marketplace** and no real Close Job button has been added to the public website. Existing applications are not modified or deleted by closure; the vacancy row itself is retained.

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
