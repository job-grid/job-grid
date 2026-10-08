# Phase 4C — Implementation Contract

## Safety status

This branch is tooling-only.

The implementation stage must stop after static/unit validation. It must not create a production backup, restore a database, merge a PR, deploy application code, or modify production infrastructure.

## Strict stages

1. backup creation
2. artifact verification
3. restore authorization
4. restore
5. validation

These stages are separate commands and separate authorization boundaries.

A successful backup never invokes restore automatically.

## Targets

Production project ref: `tnrdovdhlwitjzecduxa`

Recovery project ref: `vbxyigsljxjfcvytdoiq`

The production ref is permanently forbidden as a restore target.

The tooling must fail closed if the target identity cannot be positively established as the approved recovery project.

## Credentials

Restore requires a dedicated recovery PostgreSQL connection credential, stored only in a protected secret mechanism. It must be separate from production credentials.

Required logical credential set:

- recovery PostgreSQL host
- recovery PostgreSQL port
- recovery PostgreSQL database
- recovery PostgreSQL username
- recovery PostgreSQL password

The implementation must never commit, print, compare, interpolate into diagnostic output, or otherwise expose these values.

Production database credentials must never be accepted as restore credentials.

## Encryption

Encrypted backup artifacts use AES-GCM. The encryption key is supplied only through a protected secret mechanism.

The key is never placed in the manifest, source tree, command output, or artifact metadata.

Plaintext lifetime is minimized. Plaintext is never uploaded and never logged. Temporary files are cleaned up after encryption/restore processing.

No claim of guaranteed secure deletion is made.

## Artifact layout

```
phase4c/backups/<backup-id>/
  database.dump.enc
  database.dump.sha256
  manifest.json.enc
  manifest.json.sha256
```

The layout is immutable: an approved backup ID is never silently overwritten.

## Manifest

The manifest records non-secret provenance and integrity metadata:

- format version
- backup ID
- creation timestamp
- source project reference
- PostgreSQL major version
- artifact names
- artifact sizes
- SHA-256 digests
- encryption algorithm and nonce size
- migration-state identifier where available
- recovery-boundary declarations

No credential, connection string, encryption key, access key, token, or password is permitted.

## Production protection

The restore guard rejects:

- production project reference
- unknown project reference
- missing target identity
- mismatched recovery project
- ambiguous target configuration

The guard runs before any restore operation.

## Recovery validation

Validation covers:

- schemas
- tables
- columns
- indexes
- sequences
- primary keys
- foreign keys
- unique constraints
- check constraints
- NOT NULL requirements
- functions
- triggers
- RLS enablement
- RLS policies
- migration state
- relational/data integrity

Auth, Storage objects, and external configuration are validated as separate recovery boundaries and are not silently inferred from PostgreSQL success.

## Abort conditions

Abort immediately on:

- target identity failure
- target equals production
- credential-boundary failure
- checksum mismatch
- decryption/authentication failure
- malformed artifact
- restore error
- validation mismatch
- secret exposure
- unexpected production connectivity
- unapproved production/configuration/database mutation

## Implementation-stage stop

The tooling stage ends after static/unit validation.

No backup command is executed by the implementation-stage validation.

Actual backup creation requires a separate explicit authorization after architectural review.
