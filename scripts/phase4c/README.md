# Phase 4C backup executor

`backup_executor.py` implements one production logical-backup operation. This branch does **not** execute it.

## Execution boundary

The executor performs exactly one backup only when an operator explicitly invokes `python -m backup_executor --backup`.
It has no restore method and no scheduling path. A successful backup never triggers restore.

### Production source

The executor requires:

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
The database password is passed only to the child process through `PGPASSWORD`; it is never placed in command-line arguments.
`pg_dump` stderr is suppressed from application errors to prevent diagnostic leakage.

The production project is the **only** permitted backup source. The approved recovery project `vbxyigsljxjfcvytdoiq` is explicitly rejected as a source.

### Encryption and plaintext handling

`BACKUP_ENCRYPTION_KEY` must be strict Base64 containing 16, 24, or 32 decoded bytes. AES-GCM uses a random 12-byte nonce.
The encrypted format is `JG4C | 12-byte nonce | ciphertext | 16-byte GCM tag`.

The plaintext dump exists only in a temporary working directory, is removed after encryption, and the directory is best-effort cleaned in `finally`. This is **not** a claim of guaranteed secure deletion.

Only encrypted dump and encrypted manifest objects are uploaded to R2.

### Manifest

The encrypted manifest records non-secret provenance, artifact metadata/checksums, encryption metadata, and recovery-boundary declarations.
It contains no credentials, connection strings, keys, access tokens, or passwords.

### Testing

Tests use synthetic dump bytes, an in-memory fake R2 client, and a fake command runner. CI does not receive production/R2 secrets and does not invoke `--backup`.

Supabase's current documentation describes `pg_dump` as a logical backup mechanism and recommends appropriate PostgreSQL client tooling for dump operations.