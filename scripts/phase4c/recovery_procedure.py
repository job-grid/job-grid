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
import subprocess
import tempfile
from pathlib import Path
from typing import Mapping

import boto3
from botocore.config import Config as BotoConfig
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import psycopg

from phase4c_tooling import PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF, SafetyError


PG_RESTORE = "/usr/lib/postgresql/17/bin/pg_restore"
ARTIFACTS = (
    "database.dump.enc",
    "database.dump.sha256",
    "manifest.json.enc",
    "manifest.json.sha256",
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


def restore_backup(
    *,
    dump_path: Path,
    host: str,
    port: str,
    database: str,
    username: str,
    password: str,
) -> None:
    argv = [
        PG_RESTORE,
        "--host", host,
        "--port", port,
        "--username", username,
        "--dbname", database,
        "--no-owner",
        "--no-subscriptions",
        "--single-transaction",
        str(dump_path),
    ]
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": "C",
        "LC_ALL": "C",
        "PGPASSWORD": password,
    }
    try:
        result = subprocess.run(
            argv,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=30 * 60,
        )
    except (OSError, subprocess.TimeoutExpired):
        _fixed("RECOVERY_RESTORE_FAILED")
    if result.returncode != 0:
        _fixed("RECOVERY_RESTORE_FAILED")


VALIDATION_SQL = """
WITH
tables AS (
  SELECT count(*)::int AS n FROM pg_class c
  JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND nsp.nspname NOT IN ('pg_catalog','information_schema')
),
constraints AS (
  SELECT count(*)::int AS n FROM pg_constraint WHERE contype IN ('p','u','f','c','x')
),
indexes AS (
  SELECT count(*)::int AS n FROM pg_class WHERE relkind='i'
),
functions AS (
  SELECT count(*)::int AS n FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
),
triggers AS (
  SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal
),
rls AS (
  SELECT count(*)::int AS n FROM pg_class
  WHERE relrowsecurity
),
policies AS (
  SELECT count(*)::int AS n FROM pg_policy
),
grants AS (
  SELECT count(*)::int AS n FROM pg_class WHERE relacl IS NOT NULL
),
migrations AS (
  SELECT count(*)::int AS n FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
)
SELECT
  (SELECT n FROM tables),
  (SELECT n FROM constraints),
  (SELECT n FROM indexes),
  (SELECT n FROM functions),
  (SELECT n FROM triggers),
  (SELECT n FROM rls),
  (SELECT n FROM policies),
  (SELECT n FROM grants),
  (SELECT n FROM migrations);
"""


def validate_recovery(
    *,
    host: str,
    port: str,
    database: str,
    username: str,
    password: str,
    expected_migration_state: str,
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
            autocommit=True,
            options="-c statement_timeout=5000",
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                opened = cur.fetchone()[0]
                cur.execute(VALIDATION_SQL)
                values = cur.fetchone()
                cur.execute(
                    "SELECT version, name FROM supabase_migrations.schema_migrations "
                    "ORDER BY version DESC LIMIT 1"
                )
                migration = cur.fetchone()
        if opened != database:
            _fixed("RECOVERY_DATABASE_ACCESS_FAILED")
        labels = (
            "tables", "constraints", "indexes", "functions", "triggers",
            "rls", "policies", "grants", "migration_table",
        )
        counts = dict(zip(labels, values))
        required = ("tables","constraints","indexes","functions","triggers","rls","policies","grants","migration_table")
        if any(counts[name] <= 0 for name in required):
            _fixed("RECOVERY_SCHEMA_SECURITY_VALIDATION_FAILED")
        if expected_migration_state:
            expected = json.loads(expected_migration_state)
            latest = {"version": str(migration[0]), "name": str(migration[1])} if migration else None
            if expected.get("latest_migration") != latest:
                _fixed("RECOVERY_MIGRATION_MISMATCH")
        return {"database": opened, "counts": counts, "migration": migration}
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
