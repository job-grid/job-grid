# Phase 4C Supabase PostgreSQL CA setup

The protected backup and recovery workflows keep PostgreSQL TLS verification enabled with `sslmode=verify-full`. Supabase's database pooler may use a Supabase-issued certificate chain that is not in the GitHub runner's default public CA store. These workflows therefore require the root certificate downloaded from each respective Supabase project's dashboard.

## Production environment

1. Open the **production Supabase project** in the Supabase Dashboard.
2. Open **Database Settings → SSL Configuration** and download the database root certificate.
3. Open GitHub repository **Settings → Environments → `phase4c-production-approved` → Environment secrets**.
4. Create or update the environment secret `BACKUP_SOURCE_POSTGRES_CA_CERT` with the full PEM text from the downloaded certificate, including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines. Preserve the real line breaks.
5. Do not put the database password or any other credential in this certificate secret.

At run time, the workflow writes the certificate to a runner-temporary file with restrictive permissions and sets `PGSSLROOTCERT` to that path. The preflight loads the CA explicitly, and both psycopg and `pg_dump` use `sslmode=verify-full`. The workflow fails closed if the secret is missing or the certificate cannot be parsed.

## Recovery environment

Repeat the steps against the **separate recovery Supabase project** and save that project's certificate as `RECOVERY_POSTGRES_CA_CERT` under GitHub Environment `phase4c-recovery-approved`.

The recovery workflow uses that distinct trust file for `pg_restore` and its post-restore validation connection. Production certificates/secrets must not be substituted for recovery credentials.

## Security rule

Do not fix certificate errors by disabling certificate validation, switching to `sslmode=require`, using `sslmode=no-verify`, or allowing plaintext fallback. `verify-full` must remain enabled so both the CA chain and the requested hostname are checked. If validation still fails with the project's downloaded root certificate, stop and investigate the actual presented certificate chain rather than weakening TLS.
