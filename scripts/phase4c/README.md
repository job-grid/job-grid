# Phase 4C backup executor

`backup_executor.py` implements one production logical-backup operation. This branch does **not** execute it.

## Execution boundary

Phase 4C is **cloud/live-only**. There is no supported local-development or developer-machine execution path.

The current GitHub Actions workflow is validation-only. It runs synthetic/mocked tests on a GitHub-hosted runner and does not connect to PostgreSQL, R2, Supabase, or production secrets.

A real backup is fail-closed behind `assert_backup_authorized()`. The executor requires all three conditions before `--backup` can create a backup:

1. `GITHUB_ACTIONS=true`
2. `GITHUB_ENVIRONMENT=phase4c-production-approved`
3. `GITHUB_EVENT_NAME=workflow_dispatch`
4. `PHASE4C_BACKUP_AUTHORIZED=true`

The production execution workflow is `.github/workflows/phase4c-protected-production-backup.yml`. It is workflow_dispatch-only and references the protected GitHub Environment `phase4c-production-approved`. Environment protection must pass before that job can access its environment-scoped secrets.

The explicit authorization marker is an executor-level assertion in addition to the workflow environment gate. The validation workflow does not set it and cannot invoke `--backup`.

## Production source identity

The production source is an inseparable project/host pair:

- project ref: `tnrdovdhlwitjzecduxa`
- PostgreSQL host: `db.tnrdovdhlwitjzecduxa.supabase.co`

Recovery project `vbxyigsljxjfcvytdoiq` is rejected even if supplied with the production host.

## R2 boundary

The executor accepts only the dedicated backup settings and the exact approved private endpoint:

- endpoint: `https://6952ddf46cc39605326ecf0583cde02e.r2.cloudflarestorage.com`
- bucket: `job-grid-backups`
- `BACKUP_R2_ACCESS_KEY_ID`
- `BACKUP_R2_SECRET_ACCESS_KEY`

Generic AWS credential environment variables are rejected. No credentials are changed by this PR.

## PostgreSQL dump

`pg_dump` uses custom format with `--no-owner`, `--no-privileges`, and `--no-subscriptions`. The password is passed only through `PGPASSWORD`, never argv.

The child process receives only `PATH`, locale settings, and `PGPASSWORD`; the executor does not copy its full environment into `pg_dump`.

## Artifact set and reconciliation

Every successful backup ID must contain exactly these four objects:

`phase4c/backups/<backup-id>/`

- `database.dump.enc`
- `database.dump.sha256`
- `manifest.json.enc`
- `manifest.json.sha256`

Each checksum file contains the SHA-256 digest of its corresponding encrypted artifact. Every object is uploaded and read-back verified.

If any upload succeeds and a later upload or read-back verification fails, every object recorded as created by that attempt is explicitly deleted and each deletion is verified with a subsequent HEAD check. If the provider or network prevents deletion or verification, the executor reports reconciliation failure; it does not claim guaranteed deletion.

## Encryption and plaintext handling

`BACKUP_ENCRYPTION_KEY` must be strict Base64 containing 16, 24, or 32 decoded bytes. AES-GCM uses a random 12-byte nonce.

Plaintext dump and manifest files exist only in the authorized cloud runner's temporary working directory, are removed after encryption, and the work directory is best-effort cleaned in `finally`. This is not a claim of guaranteed secure deletion.

Only encrypted artifacts and checksum metadata cross the R2 boundary. No production plaintext dump is stored in GitHub artifacts/logs/commits.

## Manifest

The encrypted manifest contains non-secret provenance, encrypted-artifact metadata/checksums, encryption metadata, and recovery-boundary declarations. It contains no credentials, connection strings, keys, access tokens, or passwords.

## Testing

All tests use synthetic database bytes, an in-memory fake R2 client, and a fake command runner. They do not create or connect to PostgreSQL or R2. No production credentials are supplied.

Regression coverage includes:

- production project + wrong PostgreSQL host rejection
- recovery project + production host rejection
- unapproved R2 endpoint rejection
- bucket pinning
- child-environment secret isolation
- database upload followed by manifest upload failure reconciliation
- database read-back failure reconciliation
- manifest read-back failure reconciliation
- complete four-object artifact layout and checksum contents
- protected authorization enforcement
- no restore/scheduling path

## Explicitly absent

This PR does not add:

- restore or `pg_restore`
- scheduling
- production/R2 credential changes
- Supabase or Cloudflare changes
- local backup execution
