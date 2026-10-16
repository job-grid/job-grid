"""Repeatable, isolated recovery procedure for Phase 4C.

This module never targets production. It requires an explicitly supplied recovery
project identity and separate recovery credentials. It emits fixed failure codes.
It is invoked only by the dedicated manual recovery workflow.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Mapping

import boto3
from botocore.config import Config as BotoConfig
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import psycopg

from phase4c_tooling import PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF, SafetyError
from schema_inventory import (
    collect_migration_history,
    collect_publication_snapshot,
    collect_schema_inventory,
    sha256_json,
)


PG_RESTORE = "/usr/lib/postgresql/17/bin/pg_restore"
ARTIFACT_DUMP = "database.dump.enc"
ARTIFACT_DUMP_SHA = "database.dump.sha256"
ARTIFACT_MANIFEST = "manifest.json.enc"
ARTIFACT_MANIFEST_SHA = "manifest.json.sha256"

ARTIFACTS = (
    ARTIFACT_DUMP,
    ARTIFACT_DUMP_SHA,
    ARTIFACT_MANIFEST,
    ARTIFACT_MANIFEST_SHA,
)

# A newly provisioned Supabase project already contains these managed schemas.
# Keep the recovery target's platform-owned objects intact; restore the app's
# public schema and the production migration ledger from our logical backup.
SUPABASE_MANAGED_SCHEMAS = (
    "auth",
    "storage",
    "realtime",
    "extensions",
    "graphql",
    "graphql_public",
    "pgbouncer",
    "vault",
)


class RecoveryFailure(RuntimeError):
    pass


def _fixed(code: str) -> None:
    raise RecoveryFailure(code)


def assert_recovery_target(project_ref: str, host: str) -> None:
    if project_ref == PRODUCTION_PROJECT_REF or project_ref != RECOVERY_PROJECT_REF:
        raise SafetyError("Recovery target is not the approved separate project.")
    if not host:
        raise SafetyError("Recovery target host is missing.")


def assert_recovery_credentials(env: Mapping[str, str]) -> None:
    required = (
        "RECOVERY_POSTGRES_HOST",
        "RECOVERY_POSTGRES_PORT",
        "RECOVERY_POSTGRES_DB",
        "RECOVERY_POSTGRES_USER",
        "RECOVERY_POSTGRES_PASSWORD",
        "RECOVERY_PROJECT_REF",
        "PGSSLROOTCERT",
        "BACKUP_R2_ENDPOINT_URL",
        "BACKUP_R2_BUCKET",
        "BACKUP_R2_ACCESS_KEY_ID",
        "BACKUP_R2_SECRET_ACCESS_KEY",
        "BACKUP_ENCRYPTION_KEY",
    )
    if any(not env.get(name) for name in required):
        _fixed("RECOVERY_CREDENTIALS_FAILED")
    if env["RECOVERY_PROJECT_REF"] != RECOVERY_PROJECT_REF:
        _fixed("RECOVERY_TARGET_FAILED")
    if not Path(env["PGSSLROOTCERT"]).is_file():
        _fixed("RECOVERY_TLS_CA_FAILED")
    if "BACKUP_SOURCE_POSTGRES_PASSWORD" in env or "PRODUCTION_POSTGRES_PASSWORD" in env:
        _fixed("RECOVERY_CREDENTIALS_FAILED")


def _key(encoded: str) -> bytes:
    try:
        value = base64.b64decode(encoded, validate=True)
    except Exception:
        _fixed("RECOVERY_ENCRYPTION_FAILED")
    if len(value) != 32:
        _fixed("RECOVERY_ENCRYPTION_FAILED")
    return value


def decrypt_file(source: Path, destination: Path, key: bytes) -> None:
    try:
        payload = source.read_bytes()
        if len(payload) < 4 + 12 + 16 or payload[:4] != b"JG4C":
            _fixed("RECOVERY_DECRYPT_FAILED")
        nonce = payload[4:16]
        ciphertext = payload[16:-16]
        tag = payload[-16:]
        decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        plaintext = decryptor.update(ciphertext) + decryptor.finalize()
        destination.write_bytes(plaintext)
    except RecoveryFailure:
        raise
    except Exception:
        _fixed("RECOVERY_DECRYPT_FAILED")


def verify_checksum(data_path: Path, checksum_path: Path, expected_name: str) -> None:
    try:
        line = checksum_path.read_text(encoding="utf-8").strip()
        expected_hash, name = line.split(maxsplit=1)
        if name != expected_name or expected_hash != hashlib.sha256(data_path.read_bytes()).hexdigest():
            _fixed("RECOVERY_CHECKSUM_FAILED")
    except RecoveryFailure:
        raise
    except Exception:
        _fixed("RECOVERY_CHECKSUM_FAILED")


def download_backup(r2_client, *, bucket: str, backup_id: str, root: Path) -> None:
    if not backup_id or "/" in backup_id or "\\" in backup_id:
        _fixed("RECOVERY_BACKUP_ID_FAILED")
    for filename in ARTIFACTS:
        key = f"phase4c/backups/{backup_id}/{filename}"
        destination = root / filename
        try:
            response = r2_client.get_object(Bucket=bucket, Key=key)
            body = response["Body"]
            with destination.open("wb") as output:
                while True:
                    chunk = body.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            close = getattr(body, "close", None)
            if close:
                close()
        except Exception:
            _fixed("RECOVERY_DOWNLOAD_FAILED")


def classify_pg_restore_failure(stderr: bytes | str) -> str:
    """Map pg_restore stderr to a fixed safe category; never return raw diagnostics."""
    if isinstance(stderr, bytes):
        message = stderr.decode("utf-8", errors="replace").lower()
    else:
        message = str(stderr).lower()

    patterns = (
        ("authentication_failed", (
            "password authentication failed",
            "no password supplied",
            "authentication failed",
        )),
        ("tls_verification_failed", (
            "certificate verify failed",
            "root certificate file",
            "ssl certificate problem",
            "tlsv1 alert",
            "ssl error",
        )),
        ("dns_resolution_failed", (
            "could not translate host name",
            "name or service not known",
            "temporary failure in name resolution",
        )),
        ("connection_timeout", (
            "connection timed out",
            "timeout expired",
            "could not receive data from server: timeout",
        )),
        ("connection_refused", (
            "connection refused",
            "could not connect to server",
        )),
        ("permission_denied", (
            "permission denied",
            "must be owner of",
            "must be superuser",
            "insufficient privilege",
        )),
        ("restore_object_conflict", (
            "already exists",
            "duplicate key value violates unique constraint",
            "multiple primary keys",
            "cannot drop",
            "duplicate object",
            "is already a member",
        )),
        ("restore_dependency_missing", (
            "does not exist",
            "not found",
            "could not find",
            "has no schema",
            "missing referenced",
        )),
        ("invalid_dump_format", (
            "unsupported version in file header",
            "did not find magic string",
            "input file appears to be a text format dump",
        )),
        ("server_terminated_connection", (
            "server closed the connection unexpectedly",
            "terminating connection due to administrator command",
        )),
    )
    for category, needles in patterns:
        if any(needle in message for needle in needles):
            return category
    if "pg_restore: error: could not execute query" in message:
        return "restore_query_failed"
    if "pg_restore:" in message or "fatal:" in message or "error:" in message:
        return "generic_pg_restore_error"
    return "unknown_pg_restore_error"


def _prepare_restore_toc(dump_path: Path) -> Path:
    """Build a pg_restore list excluding CREATE SCHEMA public only.

    Supabase recovery projects already provision the public schema. We must leave
    that schema itself in place while restoring the production application's
    public-schema objects, along with the migration ledger. Never use --clean.
    """
    try:
        listed = subprocess.run(
            [PG_RESTORE, "--list", str(dump_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        _fixed("RECOVERY_TOC_LIST_FAILED")
    if listed.returncode != 0 or not listed.stdout:
        _fixed("RECOVERY_TOC_LIST_FAILED")

    lines = listed.stdout.decode("utf-8", errors="replace").splitlines()
    public_schema_entry = re.compile(
        r"^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public(?:\s|$)",
        re.IGNORECASE,
    )
    public_platform_function = re.compile(
        r"^\s*\d+;\s+\d+\s+\d+\s+FUNCTION\s+public\s+rls_auto_enable\s*\(\s*\)\s+\S+",
        re.IGNORECASE,
    )
    public_platform_function_acl = re.compile(
        r"^\s*\d+;\s+\d+\s+\d+\s+ACL\s+public\s+(?:FUNCTION\s+)?rls_auto_enable\s*\(\s*\)(?:\s|$)",
        re.IGNORECASE,
    )
    filtered_lines = [
        line for line in lines
        if not public_schema_entry.search(line)
        and not public_platform_function.search(line)
        and not public_platform_function_acl.search(line)
    ]
    if not filtered_lines:
        _fixed("RECOVERY_TOC_LIST_FAILED")

    toc_path = dump_path.with_name(dump_path.name + ".restore-list")
    try:
        toc_path.write_text("\n".join(filtered_lines) + "\n", encoding="utf-8")
    except OSError:
        _fixed("RECOVERY_TOC_LIST_FAILED")
    return toc_path


def restore_backup(
    *,
    dump_path: Path,
    host: str,
    port: str,
    database: str,
    username: str,
    password: str,
) -> None:
    ca_file = os.environ.get("PGSSLROOTCERT", "").strip()
    if not ca_file or not Path(ca_file).is_file():
        _fixed("RECOVERY_TLS_CA_FAILED")
    toc_path = _prepare_restore_toc(dump_path)
    argv = [
        PG_RESTORE,
        "--host", host,
        "--port", port,
        "--username", username,
        "--dbname", database,
        "--no-owner",
        "--no-subscriptions",
        "--single-transaction",
        "--exit-on-error",
        "--use-list", str(toc_path),
        *[f"--exclude-schema={schema}" for schema in SUPABASE_MANAGED_SCHEMAS],
        str(dump_path),
    ]
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": "C",
        "LC_ALL": "C",
        "PGPASSWORD": password,
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": ca_file,
    }
    try:
        result = subprocess.run(
            argv,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            check=False,
            timeout=30 * 60,
        )
    except subprocess.TimeoutExpired:
        _fixed("RECOVERY_RESTORE_FAILED[restore_timeout]")
    except OSError:
        _fixed("RECOVERY_RESTORE_FAILED[pg_restore_unavailable]")
    if result.returncode != 0:
        # Only a fixed category is emitted. Raw pg_restore output may contain
        # database identifiers or other sensitive details and must not enter logs.
        _fixed(f"RECOVERY_RESTORE_FAILED[{classify_pg_restore_failure(result.stderr or b'')}]")


VALIDATION_SQL = """
WITH
app_tables AS (
  SELECT count(*)::int AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations') AND c.relkind IN ('r','p')
),
app_constraints AS (
  SELECT count(*)::int AS n
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations')
),
app_indexes AS (
  SELECT count(*)::int AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations') AND c.relkind IN ('i','I')
),
app_functions AS (
  SELECT count(*)::int AS n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname IN ('public','supabase_migrations')
    AND NOT (ns.nspname = 'public' AND p.proname = 'rls_auto_enable'
             AND pg_get_function_identity_arguments(p.oid) = '')
),
app_triggers AS (
  SELECT count(*)::int AS n
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations') AND NOT t.tgisinternal
),
app_rls AS (
  SELECT count(*)::int AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations') AND c.relrowsecurity
),
app_policies AS (
  SELECT count(*)::int AS n
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations')
),
app_grants AS (
  SELECT count(*)::int AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public','supabase_migrations') AND c.relacl IS NOT NULL
),
migration_table AS (
  SELECT count(*)::int AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations'
    AND c.relkind IN ('r','p')
)
SELECT
  (SELECT n FROM app_tables),
  (SELECT n FROM app_constraints),
  (SELECT n FROM app_indexes),
  (SELECT n FROM app_functions),
  (SELECT n FROM app_triggers),
  (SELECT n FROM app_rls),
  (SELECT n FROM app_policies),
  (SELECT n FROM app_grants),
  (SELECT n FROM migration_table);
"""


def validate_schema_counts(values: tuple) -> dict:
    """Validate required application objects; exact identities are checked separately."""
    labels = (
        "tables", "constraints", "indexes", "functions", "triggers",
        "rls", "policies", "grants", "migration_table",
    )
    if len(values) != len(labels):
        _fixed("RECOVERY_SCHEMA_SECURITY_VALIDATION_FAILED")
    counts = dict(zip(labels, values))
    if any(not isinstance(count, int) or count < 0 for count in counts.values()):
        _fixed("RECOVERY_SCHEMA_SECURITY_VALIDATION_FAILED")
    if counts["tables"] <= 0 or counts["migration_table"] != 1:
        _fixed("RECOVERY_SCHEMA_SECURITY_VALIDATION_FAILED")
    return counts


def validate_manifest_migration_state(migration_state_json: str) -> dict:
    """Reject legacy/incomplete metadata and verify the inventory embedded in the manifest."""
    try:
        state = json.loads(migration_state_json)
    except Exception:
        _fixed("RECOVERY_MANIFEST_INVENTORY_MISSING")
    if not isinstance(state, dict):
        _fixed("RECOVERY_MANIFEST_INVENTORY_MISSING")
    inventory = state.get("schema_inventory")
    history = state.get("migration_history")
    if not isinstance(inventory, dict) or not isinstance(inventory.get("items"), list):
        _fixed("RECOVERY_MANIFEST_INVENTORY_MISSING")
    if not isinstance(history, dict) or not history.get("present"):
        _fixed("RECOVERY_MANIFEST_INVENTORY_MISSING")
    items = inventory["items"]
    if (
        inventory.get("sha256") != sha256_json(items)
        or inventory.get("item_count") != len(items)
        or not isinstance(inventory.get("counts_by_kind"), dict)
        or not isinstance(history.get("rows_sha256"), str)
        or not re.fullmatch(r"[0-9a-f]{64}", history["rows_sha256"])
        or history.get("row_count") != len(history.get("versions", []))
        or state.get("latest_migration") != history.get("latest_migration")
        or state.get("latest_migration") != (
            history.get("versions", [])[-1] if history.get("versions") else None
        )
    ):
        _fixed("RECOVERY_MANIFEST_INVENTORY_FAILED")
    counts_by_kind: dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("kind"), str):
            _fixed("RECOVERY_MANIFEST_INVENTORY_FAILED")
        counts_by_kind[item["kind"]] = counts_by_kind.get(item["kind"], 0) + 1
    if dict(sorted(counts_by_kind.items())) != inventory.get("counts_by_kind"):
        _fixed("RECOVERY_MANIFEST_INVENTORY_FAILED")
    app_tables = [
        item for item in items
        if item.get("kind") == "relation"
        and item.get("schema_name") == "public"
        and item.get("relkind") in ("r", "p")
    ]
    migration_table = any(
        item.get("kind") == "relation"
        and item.get("schema_name") == "supabase_migrations"
        and item.get("object_name") == "schema_migrations"
        and item.get("relkind") in ("r", "p")
        for item in items
    )
    if not app_tables or not migration_table or not history.get("present"):
        _fixed("RECOVERY_MANIFEST_INVENTORY_INCOMPLETE")
    return state


def validate_recovery(
    *,
    host: str,
    port: str,
    database: str,
    username: str,
    password: str,
    expected_migration_state: dict,
    expected_publications: list[dict],
) -> dict:
    try:
        with psycopg.connect(
            host=host,
            port=int(port),
            dbname=database,
            user=username,
            password=password,
            connect_timeout=5,
            sslmode="verify-full",
            sslrootcert=os.environ["PGSSLROOTCERT"],
            autocommit=True,
            options="-c statement_timeout=10000",
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                opened = cur.fetchone()[0]
                cur.execute(VALIDATION_SQL)
                values = cur.fetchone()
                actual_inventory = collect_schema_inventory(cur)
                actual_history = collect_migration_history(cur)
                actual_publications = collect_publication_snapshot(cur)
        if opened != database:
            _fixed("RECOVERY_DATABASE_ACCESS_FAILED")
        counts = validate_schema_counts(values)

        expected_inventory = expected_migration_state["schema_inventory"]
        if (
            actual_inventory["sha256"] != expected_inventory["sha256"]
            or actual_inventory["items"] != expected_inventory["items"]
            or actual_inventory["counts_by_kind"] != expected_inventory["counts_by_kind"]
        ):
            _fixed("RECOVERY_SCHEMA_INVENTORY_MISMATCH")

        expected_history = expected_migration_state["migration_history"]
        for field in ("present", "row_count", "versions", "latest_migration", "rows_sha256"):
            if actual_history.get(field) != expected_history.get(field):
                _fixed("RECOVERY_MIGRATION_HISTORY_MISMATCH")
        if expected_migration_state.get("latest_migration") != actual_history.get("latest_migration"):
            _fixed("RECOVERY_MIGRATION_MISMATCH")

        if actual_publications != expected_publications:
            _fixed("RECOVERY_PUBLICATION_STATE_CHANGED")
        return {
            "database": opened,
            "counts": counts,
            "inventory_sha256": actual_inventory["sha256"],
            "inventory_item_count": actual_inventory["item_count"],
            "migration_history": {
                "row_count": actual_history["row_count"],
                "rows_sha256": actual_history["rows_sha256"],
            },
            "publication_count": len(actual_publications),
        }
    except RecoveryFailure:
        raise
    except Exception:
        _fixed("RECOVERY_VALIDATION_FAILED")


def recovery_runbook() -> tuple[str, ...]:
    return (
        "1. Obtain an authorized backup_id from the private R2 backup namespace.",
        "2. Dispatch only the dedicated recovery workflow with the backup_id.",
        "3. Verify RECOVERY_PROJECT_REF equals the approved Job-Grid-Recovery project.",
        "4. Download all four encrypted/checksum objects from the exact backup prefix.",
        "5. Verify SHA-256 checksums before decrypting.",
        "6. Decrypt database.dump.enc and manifest.json.enc using the separate recovery encryption key.",
        "7. Verify manifest source is production, PostgreSQL major is 17, and backup_id matches.",
        "8. Restore with PostgreSQL 17 pg_restore into the isolated recovery database using --single-transaction.",
        "9. Run the schema/security/migration validator.",
        "10. Record only fixed status codes and sanitized validation counts; never copy production data to logs.",
    )
PLATFORM_SCHEMA_ALLOWLIST = frozenset({
    "auth",
    "extensions",
    "graphql",
    "graphql_public",
    "pgbouncer",
    "public",
    "realtime",
    "storage",
    "vault",
    "pg_catalog",
    "information_schema",
})


def assert_application_restore_target_empty(
    *,
    host: str,
    port: str,
    database: str,
    username: str,
    password: str,
) -> list[dict]:
    """Read-only fail-closed check of every non-platform schema plus public objects."""
    ca_file = os.environ.get("PGSSLROOTCERT", "").strip()
    if not ca_file or not Path(ca_file).is_file():
        _fixed("RECOVERY_TLS_CA_FAILED")
    platform_schemas = tuple(sorted(PLATFORM_SCHEMA_ALLOWLIST))
    placeholders = ",".join(["%s"] * len(platform_schemas))
    query = f"""
        SELECT
          EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
          ),
          EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND NOT (p.proname = 'rls_auto_enable'
                       AND pg_get_function_identity_arguments(p.oid) = '')
          ),
          EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype IN ('d','e','r','m')
          ),
          EXISTS (
            SELECT 1 FROM pg_namespace n
            WHERE n.nspname NOT IN ({placeholders})
              AND n.nspname NOT LIKE 'pg_toast%%'
              AND n.nspname NOT LIKE 'pg_temp_%%'
              AND n.nspname NOT LIKE 'pg_toast_temp_%%'
          )
    """
    try:
        with psycopg.connect(
            host=host,
            port=int(port),
            dbname=database,
            user=username,
            password=password,
            connect_timeout=10,
            sslmode="verify-full",
            sslrootcert=ca_file,
            autocommit=True,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(query, platform_schemas)
                row = cur.fetchone()
                publications = collect_publication_snapshot(cur)
    except Exception:
        _fixed("RECOVERY_TARGET_CHECK_FAILED")
    if not row or any(bool(value) for value in row):
        _fixed("RECOVERY_TARGET_NOT_EMPTY")
    return publications


def run_recovery(backup_id: str) -> None:
    env = os.environ
    assert_recovery_credentials(env)
    assert_recovery_target(env["RECOVERY_PROJECT_REF"], env["RECOVERY_POSTGRES_HOST"])
    assert_application_restore_target_empty(
        host=env["RECOVERY_POSTGRES_HOST"],
        port=env["RECOVERY_POSTGRES_PORT"],
        database=env["RECOVERY_POSTGRES_DB"],
        username=env["RECOVERY_POSTGRES_USER"],
        password=env["RECOVERY_POSTGRES_PASSWORD"],
    )
    key = _key(env["BACKUP_ENCRYPTION_KEY"])
    client = boto3.client(
        "s3",
        endpoint_url=env["BACKUP_R2_ENDPOINT_URL"],
        aws_access_key_id=env["BACKUP_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["BACKUP_R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=BotoConfig(signature_version="s3v4"),
    )
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        download_backup(client, bucket=env["BACKUP_R2_BUCKET"], backup_id=backup_id, root=root)
        verify_checksum(root / ARTIFACT_DUMP, root / ARTIFACT_DUMP_SHA, ARTIFACT_DUMP)
        verify_checksum(root / ARTIFACT_MANIFEST, root / ARTIFACT_MANIFEST_SHA, ARTIFACT_MANIFEST)
        manifest_plain = root / "manifest.json"
        dump_plain = root / "database.dump"
        decrypt_file(root / ARTIFACT_MANIFEST, manifest_plain, key)
        decrypt_file(root / ARTIFACT_DUMP, dump_plain, key)
        try:
            manifest = json.loads(manifest_plain.read_text(encoding="utf-8"))
        except Exception:
            _fixed("RECOVERY_MANIFEST_FAILED")
        if (
            manifest.get("backup_id") != backup_id
            or manifest.get("source", {}).get("supabase_project_ref") != PRODUCTION_PROJECT_REF
            or manifest.get("source", {}).get("postgres_major_version") != "17"
        ):
            _fixed("RECOVERY_MANIFEST_BOUNDARY_FAILED")
        migration_state = manifest.get("database", {}).get("migration_state", "")
        restore_backup(
            dump_path=dump_plain,
            host=env["RECOVERY_POSTGRES_HOST"],
            port=env["RECOVERY_POSTGRES_PORT"],
            database=env["RECOVERY_POSTGRES_DB"],
            username=env["RECOVERY_POSTGRES_USER"],
            password=env["RECOVERY_POSTGRES_PASSWORD"],
        )
        result = validate_recovery(
            host=env["RECOVERY_POSTGRES_HOST"],
            port=env["RECOVERY_POSTGRES_PORT"],
            database=env["RECOVERY_POSTGRES_DB"],
            username=env["RECOVERY_POSTGRES_USER"],
            password=env["RECOVERY_POSTGRES_PASSWORD"],
            expected_migration_state=migration_state,
        )
        print(json.dumps({"status": "RECOVERY_TEST_COMPLETE", "counts": result["counts"]}, sort_keys=True))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Phase 4C isolated recovery test")
    parser.add_argument("--backup-id", required=True)
    args = parser.parse_args()
    try:
        run_recovery(args.backup_id)
    except (RecoveryFailure, SafetyError) as exc:
        print(str(exc))
        raise SystemExit(1)
