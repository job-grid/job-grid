# Phase 4C recovery review — PR #51

Reviewed commit: `46166049c7129cefdbf2f52cbbec42f7cb7a05e0`

## Decision

**Changes required. Do not merge or run another restore yet.**

The addition of PostgreSQL 17 `pg_restore --no-publications` is reasonable because source database-level publications must not overwrite platform-managed publication objects already provisioned in the recovery project. The flag is present with `--no-subscriptions`, `--single-transaction`, `--exit-on-error`, `--no-owner`, TLS hostname/certificate verification, managed-schema exclusions, and TOC filtering. The pre-restore application-target guard is read-only, rejects non-empty `public`, and rejects an existing migration ledger. It does not use destructive cleanup.

However, no real restore has run on PR #51, there is no independent review recorded, and the validator is insufficient to report recovery success.

## Required fixes

1. **Diagnostic precision.** `classify_pg_restore_failure()` groups the broad substring `does not exist` under `restore_object_conflict`. That wording may indicate a missing dependency or restore ordering error rather than an existing-object collision. Remove this substring from the conflict allowlist, add a separate fixed category such as `restore_dependency_missing`, and test both it and true object conflicts. Never log raw `pg_restore` stderr.

2. **Manifest-backed schema validation.** `validate_schema_counts()` currently accepts zero application tables/functions/triggers/policies and validates only aggregate catalog counts plus the latest migration row. Equal aggregate counts do not prove object identity or definitions. Before a recovery can pass, add a deterministic privacy-safe inventory of application schema objects (object types and schema-qualified names plus definition/grant fingerprints; no row data or secrets) to trusted encrypted backup metadata. Compare the restored schema and complete migration ledger with that inventory. Explicitly assert required tables, constraints, indexes, functions, triggers, RLS policies, and grants.

3. **Restore TOC allowlist tests.** Expand TOC fixture coverage to show that only the exact `SCHEMA - public` creation entry is omitted. Confirm application table/data, migration ledger, comments, constraints, indexes, functions, triggers, policies, and grants remain selected as expected; managed Supabase schemas and publications remain excluded.

4. **Application-target guard.** The existing guard checks application relations in `public` and the presence of `supabase_migrations.schema_migrations`. Add checks for any app-owned relations in other application schemas using an explicit platform-schema allowlist, and fail closed if found. Add tests that prove the guard is read-only and blocks such state.

## Evidence

- PR #51 head: `46166049c7129cefdbf2f52cbbec42f7cb7a05e`
- Latest PR CI workflows passed, including Phase 0 CI, Phase 4C tooling, Phase 4C backup-executor synthetic validation, and Phase 4C production-foundation synthetic validation.
- Prior real recovery attempt [run 38714977211](https://github.com/job-grid/job-grid/actions/runs/38714977211) failed on main commit `e70bff38d90135e01f5fd1c52c2bb6f02829a94a` with `RECOVERY_RESTORE_FAILED[restore_object_conflict]` after offline tests passed.
- PR #51 has no submitted human review at the time of review.
- `--no-publications` has not yet been proven against a real restore on PR #51's commit.

## Safety boundary

No production database was modified. No migration was executed against production. No recovery workflow was dispatched by this review. The recovery is an application-schema logical restore, not a complete clone of Supabase-managed Auth/Storage state. Keep catalogue publication blocked until an approved real recovery run emits `RECOVERY_TEST_COMPLETE` and its schema/migration verification passes.
