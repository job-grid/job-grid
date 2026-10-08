# Phase 4C Production Backup Foundation

## Pipeline

PREFLIGHT -> BACKUP -> ENCRYPT -> INTEGRITY -> R2 -> READ-BACK -> RECOVERY TEST

Production backup remains manual-only. The production workflow is workflow_dispatch and requires the protected phase4c-production-approved environment. CI never supplies production credentials.

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

The password is supplied only through the child process environment as PGPASSWORD; it is never an argv value.

--no-privileges was intentionally removed. The backup must preserve ACL/grant statements so the isolated recovery validation can verify them. --no-owner remains so recovery does not depend on production ownership identities.

## Artifact contract

Every backup uses exactly:

- database.dump.enc
- database.dump.sha256
- manifest.json.enc
- manifest.json.sha256

The database dump and manifest are encrypted with AES-256-GCM. SHA-256 covers each encrypted artifact. The plaintext dump is removed before any R2 operation.

The manifest contains only sanitized metadata: backup ID, creation timestamp, source project reference, PostgreSQL major version, migration state, encryption format, and artifact metadata. It contains no credentials, tokens, encryption key, database password, or production data.

## R2 controls

The R2 endpoint and bucket are pinned. Upload refuses to overwrite an existing object. Partial uploads are reconciled only within the backup namespace. Upload and read-back verification are separate stages.

No plaintext object is sent to R2.

## Recovery procedure

Recovery is isolated to Job-Grid-Recovery and has its own manual workflow/environment and credential namespace. Production is rejected as a restore target.

The repeatable recovery sequence is:

1. Obtain an authorized backup ID.
2. Manually dispatch the isolated recovery workflow.
3. Verify the recovery project identity.
4. Download all four objects.
5. Verify encrypted-artifact SHA-256 values.
6. Decrypt the manifest and dump with the separate recovery encryption key.
7. Verify the manifest source boundary, backup ID, and PostgreSQL major version.
8. Restore using PostgreSQL 17 pg_restore --single-transaction --no-owner --no-subscriptions.
9. Validate database access, tables, constraints, indexes, functions, triggers, RLS, policies, grants, and migration history.
10. Record only fixed status/count evidence.

No production restore path exists.

## Recovery validation boundary

The validator deliberately checks PostgreSQL catalog security structures. Retention/legal-hold structures are not assumed by name in code; the actual project schema must establish those structures before the recovery gate can be declared PASS. If they are absent from the recovered database, the recovery validation must remain BLOCKED rather than inventing or creating them.

## Production completion gate

This implementation does not claim Phase 4C completion. Production execution and recovery evidence remain separate authorized operations.

Completion requires:

- production preflight PASS;
- real backup PASS;
- four encrypted R2 artifacts;
- R2 read-back PASS;
- isolated recovery restore PASS;
- recovered security/schema validation PASS;
- recovery evidence recorded.
