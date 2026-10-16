# Phase 4C Production Backup Foundation

## Pipeline

PREFLIGHT -> BACKUP -> ENCRYPT -> INTEGRITY -> R2 -> READ-BACK -> RECOVERY TEST

Production backup remains manual-only. The production workflow is `workflow_dispatch` and requires the protected `phase4c-production-approved` environment. CI never supplies production credentials.

## Sanitized PostgreSQL 17 command

The executor invokes:

    /usr/lib/postgresql/17/bin/pg_dump
      --host <approved-host>
      --port <approved-port>
      --username <approved-user>
      --dbname <approved-database>
      --format=custom
      --no-owner
      --no-subscriptions
      --file <temporary-dump-path>

The password is supplied only through the child process environment as `PGPASSWORD`; it is never an argv value.

`--no-privileges` is intentionally absent. The backup must preserve ACL/grant statements so isolated recovery can validate them. `--no-owner` remains so recovery does not depend on production ownership identities.

## Artifact contract

Every backup uses exactly:

- `database.dump.enc`
- `database.dump.sha256`
- `manifest.json.enc`
- `manifest.json.sha256`

The database dump and manifest are encrypted with AES-256-GCM. SHA-256 covers each encrypted artifact. The plaintext dump is removed before any R2 operation.

The version-2 manifest contains sanitized source/project metadata, the complete ordered migration-ledger identity list and digest, and a deterministic inventory of application-schema objects, definitions, RLS policies, constraints, indexes, triggers, types, and grants. It contains no credentials, tokens, encryption key, database password, or application row data. Version-1 backups lack the metadata required by the strict recovery validator and must never be declared a recovery PASS.

## R2 controls

The R2 endpoint and bucket are pinned. Upload refuses to overwrite an existing object. Partial uploads are reconciled only within the backup namespace. Upload and read-back verification are separate stages.

No plaintext object is sent to R2.

## Recovery procedure

Recovery is isolated to `Job-Grid-Recovery` and has its own manual workflow/environment and credential namespace. Production is rejected as a restore target.

The repeatable recovery sequence is:

1. Obtain an authorized backup ID.
2. Manually dispatch the isolated recovery workflow.
3. Verify the recovery project identity.
4. Download all four objects.
5. Verify encrypted-artifact SHA-256 values.
6. Decrypt the manifest and dump with the separate recovery encryption key.
7. Verify the manifest source boundary, backup ID, PostgreSQL major version, and require manifest format version 2 with complete inventory metadata before any restore.
8. Build a `pg_restore` TOC list and omit only the pre-existing `CREATE SCHEMA public` entry and the known Supabase-managed `public.rls_auto_enable()` function/ACL. The function definition exists on both projects; preserve the target's object and target-specific grants. Retain application objects, data, comments, constraints, indexes, functions, triggers, grants, and the full `supabase_migrations` ledger.
9. Exclude Supabase-managed schemas (`auth`, `storage`, `realtime`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `vault`) and source publications. The target's application-owned schemas must be empty before restore. Never use `--clean` or destructive cleanup.
10. Restore using PostgreSQL 17 `pg_restore --use-list --single-transaction --no-owner --no-subscriptions --no-publications --exit-on-error`. Publications are database-level objects, not schema-bound; the recovery project already owns its managed `supabase_realtime` publication, so source publications must not be recreated.
11. Compare the restored deterministic schema-object/definition/grant inventory and digest against the encrypted version-2 manifest; verify every migration-ledger row and digest; explicitly assert required tables, constraints, indexes, functions, triggers, RLS policies and grants; and confirm the recovery project's existing publication definitions and memberships are unchanged.
12. Keep Supabase-managed Auth/Storage outside the stated logical restore scope and verify the declared boundary. Retention/legal-hold structures must be established by the actual project schema; if required structures are absent, validation remains BLOCKED rather than inventing or creating them.
13. Record only sanitized status, object counts, and digests. Never copy raw PostgreSQL errors, database rows, credentials, or secrets to logs.

When restore fails, the workflow records only a fixed diagnostic category. Missing dependencies are classified separately from genuine object conflicts. Raw `pg_restore` stderr is never logged because it can contain database identifiers or other sensitive details. The target's publication snapshot is compared before and after restore.

No production restore path exists.

## Production completion gate

This implementation does not claim Phase 4C completion. Production execution and recovery evidence remain separate authorized operations.

Completion requires:

- production preflight PASS;
- real backup PASS;
- all four encrypted R2 artifacts;
- R2 read-back PASS;
- isolated recovery restore PASS;
- recovered security/schema validation PASS;
- recovery evidence recorded.
