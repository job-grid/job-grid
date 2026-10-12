# Vacancy closure lifecycle — implementation contract

**Status:** Domain rule and unit tests only. Not a live employer portal/API or database-backed feature.

## Required behavior

An authorized employer organization member or moderator may transition a vacancy from `published` to `closed`. Closing means:
- no new applications can be submitted;
- public search and public detail endpoints stop returning the vacancy;
- existing applications and their history are preserved;
- the closure reason/time and actor are captured in an append-only audit event;
- the old vacancy is never deleted merely to close it.

Only `published → closed` is valid for this operation. Closing a draft, submitted, approved, suspended, expired, rejected or archived vacancy is rejected. Re-opening a closed record is not supported here; if reopening is ever approved, it should require a separate controlled version and review path.

## Domain helper added

`scripts/vacancy-lifecycle.js` exports:
- `closePublishedVacancy(input)`: validates one proposed transition and returns the updated vacancy projection plus an audit event, or a structured failure.
- `isPubliclyDiscoverableVacancy(vacancy, asOf)`: a conservative visibility predicate requiring `published` status and a valid publication window.

The public static-site build does **not** ship this module. It is a backend-neutral domain rule only. Calling it does not persist the returned record, authorize a user by itself, or cause the live website to close a job.

## Trusted integration requirements

Before using the helper from an API, the server must:
1. Derive the actor from the verified session, not from request body fields.
2. Query current active organization membership/permissions or moderator permissions, including conflict checks.
3. Verify the vacancy is in the actor's allowed scope.
4. Resolve `reasonCode` against an active, approved reason catalog; the helper checks identifier shape only.
5. Read the current vacancy version and call the helper with the expected version.
6. In one database transaction, conditionally update only where the current status is `published` and version equals the expected version, increment the version, and insert the returned audit event. Roll back both operations if either fails.
7. Store/use the idempotency key so request retries cannot create duplicate closure events.
8. Ensure both list and direct-detail public queries select only published records inside the effective time window; never depend on browser filtering for access control.

The helper's `authorization` argument is a **trusted server-created capability object**, not a client input. Do not expose an endpoint where clients can supply `allowed: true`.

## Errors

| Code | Meaning |
|---|---|
| `UNAUTHENTICATED` | No verified actor identity |
| `FORBIDDEN` | Capability does not match actor/vacancy/organization scope |
| `INVALID_STATE` | Vacancy is not published |
| `ALREADY_CLOSED` | Another closure has already succeeded |
| `VERSION_CONFLICT` | Vacancy changed since it was read |
| `IDEMPOTENCY_CONFLICT` | A key was reused for a different closure reason |
| `INVALID_REASON` | Reason code is missing or malformed |
| `INVALID_TIMESTAMP` | Server closure timestamp is not canonical UTC |
| `INVALID_REQUEST_ID` | Request or idempotency token is invalid |

## Verification

`tests/vacancy-lifecycle.test.js` covers successful closure, moderator scope, mismatched authorization, cross-organization denial, invalid states, idempotent replay, reason conflicts, stale versions, malformed reason/time/request identifiers, preservation of existing applications, and public-visibility filtering.

## Remaining work before this is operational

- Choose and connect the correct active Job Grid Supabase project (the currently connected account did not expose one clearly identified active Job Grid project).
- Owner-review the real membership/role schema and reason-code catalog.
- Create a reviewed migration for vacancy status/version/closure metadata and append-only vacancy audit events.
- Implement authenticated server endpoints with transactional compare-and-swap and idempotency persistence.
- Integrate employer UI with confirmation and closure reason, then verify public search and direct detail hide closed vacancies.
- Run real authenticated authorization/tenant-isolation tests against the approved project, then review deployment separately.

No database migration, live data write, frontend button, production deployment, or job closure has been performed by this change.
