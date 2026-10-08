# Phase 4C backup executor

`backup_executor.py` implements one production logical-backup operation. This branch does **not** execute it.

## Execution boundary

Phase 4C is **cloud/live-only**. There is no supported local-development or developer-machine execution path.

The executor performs exactly one backup only when an approved cloud operator explicitly invokes the executor from an authorized cloud runner. It has no restore method and no scheduling path. A successful backup never triggers restore.

The current GitHub Actions workflow is **validation-only**. It runs synthetic/mocked tests on a GitHub-hosted runner and does not connect to PostgreSQL, R2, Supabase, or production secrets.

### Production source

The production execution path requires:

- `BACKUP_SOURCE_PROJECT_REF=tnrdovdhlwitjzecduxa`
- `BACKUP_SOURCE_POSTGRES_HOST`
- `BACKUP_SOURCE_POSTGRES_PORT`
- `BACKUP_SOURCE_POSTGRES_DB`
- `BACKUP_SOURCE_POSTGRES_USER`
- `BACKUP_SOURCE_POSTGRES_PASSWORD`
- `BACKUP_SOURCE_POSTGRES_MAJOR_VERSION=17`

Recovery credentials are not accepted by the backup executor.

### R2

Only the dedicated settings are accepted:

- `BACKUP_R2_ENDPOINT_URL`
- `BACKUP_R2_ACCESS_KEY_ID`
- `BACKUP_R2_SECRET_ACCESS_KEY`
- `BACKUP_R2_BUCKET=job-grid-backups`

Generic AWS credential environment variables are rejected so boto3 cannot silently select another credential source.

The executor refuses to overwrite an existing object, checks remote object size, then streams each encrypted object back and verifies its SHA-256 digest.

### PostgreSQL dump

The executor invokes `pg_dump` in custom format with `--no-owner`, `--no-privileges`, and `--no-subscriptions`.

The database password is passed only to the child process through `PGPASSWORD`; it is never placed in command-line arguments. `pg_dump` stderr is suppressed from application errors to prevent diagnostic leakage.

The production project is the **only** permitted backup source. The approved recovery project `vbxyigsljxjfcvytdoiq` is explicitly rejected as a source.

### Encryption and plaintext handling

`BACKUP_ENCRYPTION_KEY` must be strict Base64 containing 16, 24, or 32 decoded bytes. AES-GCM uses a random 12-byte nonce.

The encrypted format is:

`JG4C | 12-byte nonce | ciphertext | 16-byte GCM tag`

The plaintext dump exists only inside the authorized cloud runner's temporary working directory, is removed after encryption, and the directory is best-effort cleaned in `finally`. This is **not** a claim of guaranteed secure deletion.

Only encrypted dump and encrypted manifest objects are uploaded to R2.

No production secret is stored in the repository, committed to Git, or placed in CI artifacts.

### Manifest

The encrypted manifest records non-secret provenance, artifact metadata/checksums, encryption metadata, and recovery-boundary declarations.

It contains no credentials, connection strings, keys, access tokens, or passwords.

### Testing

All executor tests are intended to run in the GitHub Actions cloud runner. They use synthetic dump bytes, an in-memory fake R2 client, and a fake command runner; they do not create or connect to a local PostgreSQL instance.

CI does not receive production/R2 secrets and does not invoke `--backup`.

### Cloud execution prerequisite for the real backup

Before the first real backup can be authorized, the project needs an independently verified protected cloud execution environment that provides:

1. PostgreSQL 17 client tooling including `pg_dump`.
2. Production source credentials exposed only as protected cloud secrets.
3. Dedicated R2 credentials and the private `job-grid-backups` endpoint.
4. `BACKUP_ENCRYPTION_KEY` as a protected secret.
5. A protected/manual approval gate preventing accidental execution.
6. Evidence that the runner can reach the production PostgreSQL endpoint and private R2 endpoint.
7. Evidence that the runner is not configured with recovery credentials as the source.
8. No restore step or restore credentials in the backup job.

Until those capabilities are independently verified, the real backup remains **BLOCKED**.

No local machine, EMPIRE device, local PostgreSQL, local R2 service, or local production-secret file is an approved substitute.
