"""Fail-closed Phase 4C backup preflight checks.

All preflight checks return fixed status codes only. Provider diagnostics,
database errors, credentials, and TLS details are never returned or logged.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import socket
import ssl
import struct
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Protocol

import psycopg
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from phase4c_tooling import SafetyError, decode_aes_key

PG_DUMP_PATH = "/usr/lib/postgresql/17/bin/pg_dump"
PG_DUMP_MAJOR = "17"
PREFLIGHT_TIMEOUT_SECONDS = 5
POSTGRES_STATEMENT_TIMEOUT_MS = 5000
MIN_FREE_SPACE_BYTES = 2 * 1024 * 1024 * 1024
R2_PREFLIGHT_PREFIX = "phase4c/preflight/"
SSL_REQUEST_CODE = 80877103


class PreflightCode(str, Enum):
    CLIENT_FAILED = "PREFLIGHT_CLIENT_FAILED"
    DNS_FAILED = "PREFLIGHT_DNS_FAILED"
    TCP_FAILED = "PREFLIGHT_TCP_FAILED"
    TLS_FAILED = "PREFLIGHT_TLS_FAILED"
    AUTH_FAILED = "PREFLIGHT_AUTH_FAILED"
    DATABASE_ACCESS_FAILED = "PREFLIGHT_DATABASE_ACCESS_FAILED"
    READABILITY_FAILED = "PREFLIGHT_READABILITY_FAILED"
    FILESYSTEM_FAILED = "PREFLIGHT_FILESYSTEM_FAILED"
    R2_FAILED = "PREFLIGHT_R2_FAILED"
    ENCRYPTION_FAILED = "PREFLIGHT_ENCRYPTION_FAILED"


class PreflightFailure(RuntimeError):
    """A terminal, fixed-code preflight failure."""

    def __init__(self, code: PreflightCode | str):
        self.code = str(code.value if isinstance(code, PreflightCode) else code)
        super().__init__(self.code)


class PreflightR2Client(Protocol):
    def head_bucket(self, *, Bucket: str) -> object:
        ...

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentLength: int) -> object:
        ...

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        ...

    def delete_object(self, *, Bucket: str, Key: str) -> object:
        ...


@dataclass(frozen=True)
class PreflightConfig:
    project_ref: str
    host: str
    port: str
    database: str
    username: str
    password: str
    major_version: str
    r2_endpoint: str
    r2_bucket: str
    r2_access_key: str
    r2_secret_key: str
    encryption_key: bytes
    work_dir: Path


def _fixed_failure(code: PreflightCode) -> PreflightFailure:
    return PreflightFailure(code)


def _run_safely(argv: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise _fixed_failure(PreflightCode.CLIENT_FAILED) from exc


def check_postgres_client(expected_major: str) -> None:
    if expected_major != PG_DUMP_MAJOR:
        raise _fixed_failure(PreflightCode.CLIENT_FAILED)
    try:
        resolved = os.path.realpath(shutil.which("pg_dump") or "")
        if resolved != PG_DUMP_PATH:
            raise _fixed_failure(PreflightCode.CLIENT_FAILED)
        completed = subprocess.run(
            [PG_DUMP_PATH, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise _fixed_failure(PreflightCode.CLIENT_FAILED) from exc
    if completed.returncode != 0 or not completed.stdout.startswith("pg_dump (PostgreSQL) 17"):
        raise _fixed_failure(PreflightCode.CLIENT_FAILED)


def check_dns(host: str) -> None:
    if host != "db.tnrdovdhlwitjzecduxa.supabase.co":
        raise _fixed_failure(PreflightCode.DNS_FAILED)
    try:
        completed = subprocess.run(
            ["getent", "ahostsv4", host],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise _fixed_failure(PreflightCode.DNS_FAILED) from exc
    if completed.returncode != 0:
        raise _fixed_failure(PreflightCode.DNS_FAILED)


def check_tcp(host: str, port: str) -> None:
    try:
        with socket.create_connection((host, int(port)), timeout=PREFLIGHT_TIMEOUT_SECONDS):
            return
    except (OSError, ValueError, TimeoutError) as exc:
        raise _fixed_failure(PreflightCode.TCP_FAILED) from exc


def check_tls(host: str, port: str) -> None:
    raw = None
    try:
        raw = socket.create_connection((host, int(port)), timeout=PREFLIGHT_TIMEOUT_SECONDS)
        raw.settimeout(PREFLIGHT_TIMEOUT_SECONDS)
        raw.sendall(struct.pack("!II", 8, SSL_REQUEST_CODE))
        response = raw.recv(1)
        if response != b"S":
            raise _fixed_failure(PreflightCode.TLS_FAILED)
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        with context.wrap_socket(raw, server_hostname=host):
            return
    except PreflightFailure:
        raise
    except (OSError, ssl.SSLError, ValueError, TimeoutError) as exc:
        raise _fixed_failure(PreflightCode.TLS_FAILED) from exc
    finally:
        if raw is not None:
            try:
                raw.close()
            except OSError:
                pass


def _connect_postgres(config: PreflightConfig):
    try:
        return psycopg.connect(
            host=config.host,
            port=int(config.port),
            dbname=config.database,
            user=config.username,
            password=config.password,
            connect_timeout=PREFLIGHT_TIMEOUT_SECONDS,
            sslmode="verify-full",
            autocommit=True,
            options=f"-c statement_timeout={POSTGRES_STATEMENT_TIMEOUT_MS}",
        )
    except psycopg.Error as exc:
        sqlstate = getattr(exc, "sqlstate", None) or ""
        if sqlstate.startswith("28"):
            raise _fixed_failure(PreflightCode.AUTH_FAILED) from exc
        if sqlstate == "3D000":
            raise _fixed_failure(PreflightCode.DATABASE_ACCESS_FAILED) from exc
        raise _fixed_failure(PreflightCode.AUTH_FAILED) from exc


def check_authentication(config: PreflightConfig) -> None:
    conn = _connect_postgres(config)
    try:
        if not conn.info.ssl_in_use:
            raise _fixed_failure(PreflightCode.TLS_FAILED)
    finally:
        conn.close()


def check_database_access(config: PreflightConfig) -> None:
    conn = _connect_postgres(config)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT current_database(), current_user, "
                "has_database_privilege(current_user, current_database(), 'CONNECT')"
            )
            database, _user, can_connect = cur.fetchone()
        if database != config.database or not can_connect:
            raise _fixed_failure(PreflightCode.DATABASE_ACCESS_FAILED)
    except PreflightFailure:
        raise
    except psycopg.Error as exc:
        raise _fixed_failure(PreflightCode.DATABASE_ACCESS_FAILED) from exc
    finally:
        conn.close()


READABILITY_SQL = """
WITH relations AS (
    SELECT c.oid, c.relkind, n.nspname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
)
SELECT
    pg_has_role(current_user, 'pg_read_all_data', 'member')
    OR (
        COALESCE(
            (SELECT bool_and(has_schema_privilege(current_user, nspname, 'USAGE'))
             FROM (SELECT DISTINCT nspname FROM relations) AS schemas),
            TRUE
        )
        AND COALESCE(
            (SELECT bool_and(has_table_privilege(current_user, oid, 'SELECT'))
             FROM relations WHERE relkind <> 'S'),
            TRUE
        )
        AND COALESCE(
            (SELECT bool_and(has_sequence_privilege(current_user, oid, 'SELECT'))
             FROM relations WHERE relkind = 'S'),
            TRUE
        )
    )
"""


def check_backup_readability(config: PreflightConfig) -> None:
    conn = _connect_postgres(config)
    try:
        with conn.cursor() as cur:
            cur.execute(READABILITY_SQL)
            capable = bool(cur.fetchone()[0])
        if not capable:
            raise _fixed_failure(PreflightCode.READABILITY_FAILED)
    except PreflightFailure:
        raise
    except psycopg.Error as exc:
        raise _fixed_failure(PreflightCode.READABILITY_FAILED) from exc
    finally:
        conn.close()


def check_filesystem(work_dir: Path) -> None:
    probe_dir = work_dir / f"phase4c-preflight-{uuid.uuid4().hex}"
    probe_file = probe_dir / "probe"
    renamed_file = probe_dir / "probe-renamed"
    try:
        probe_dir.mkdir(parents=True, exist_ok=False)
        usage = shutil.disk_usage(probe_dir)
        if usage.free < MIN_FREE_SPACE_BYTES:
            raise _fixed_failure(PreflightCode.FILESYSTEM_FAILED)
        payload = b"phase4c-preflight"
        probe_file.write_bytes(payload)
        if probe_file.read_bytes() != payload:
            raise _fixed_failure(PreflightCode.FILESYSTEM_FAILED)
        probe_file.rename(renamed_file)
        if renamed_file.read_bytes() != payload:
            raise _fixed_failure(PreflightCode.FILESYSTEM_FAILED)
    except PreflightFailure:
        raise
    except (OSError, ValueError) as exc:
        raise _fixed_failure(PreflightCode.FILESYSTEM_FAILED) from exc
    finally:
        shutil.rmtree(probe_dir, ignore_errors=True)


def check_r2(
    client: PreflightR2Client,
    *,
    bucket: str,
) -> None:
    probe_key = f"{R2_PREFLIGHT_PREFIX}{uuid.uuid4().hex}"
    payload = hashlib.sha256(probe_key.encode("ascii")).digest()
    created = False
    try:
        client.head_bucket(Bucket=bucket)
        client.put_object(
            Bucket=bucket,
            Key=probe_key,
            Body=payload,
            ContentLength=len(payload),
        )
        created = True
        response = client.get_object(Bucket=bucket, Key=probe_key)
        body = response["Body"]
        data = body.read() if hasattr(body, "read") else body
        if hashlib.sha256(data).digest() != hashlib.sha256(payload).digest():
            raise _fixed_failure(PreflightCode.R2_FAILED)
    except PreflightFailure:
        raise
    except Exception as exc:
        raise _fixed_failure(PreflightCode.R2_FAILED) from exc
    finally:
        if created:
            try:
                client.delete_object(Bucket=bucket, Key=probe_key)
            except Exception as exc:
                raise _fixed_failure(PreflightCode.R2_FAILED) from exc


def check_encryption(encryption_key: bytes) -> None:
    if len(encryption_key) not in (16, 24, 32):
        raise _fixed_failure(PreflightCode.ENCRYPTION_FAILED)
    try:
        nonce = os.urandom(12)
        plaintext = b"phase4c-preflight"
        encryptor = Cipher(algorithms.AES(encryption_key), modes.GCM(nonce)).encryptor()
        ciphertext = encryptor.update(plaintext) + encryptor.finalize()
        decryptor = Cipher(
            algorithms.AES(encryption_key),
            modes.GCM(nonce, encryptor.tag),
        ).decryptor()
        if decryptor.update(ciphertext) + decryptor.finalize() != plaintext:
            raise _fixed_failure(PreflightCode.ENCRYPTION_FAILED)
    except PreflightFailure:
        raise
    except Exception as exc:
        raise _fixed_failure(PreflightCode.ENCRYPTION_FAILED) from exc


class PreflightRunner:
    """Execute every required preflight in fixed order, failing closed."""

    def __init__(self, *, r2_client: PreflightR2Client):
        self._r2 = r2_client

    def run(self, config: PreflightConfig) -> None:
        check_postgres_client(config.major_version)
        check_dns(config.host)
        check_tcp(config.host, config.port)
        check_tls(config.host, config.port)
        check_authentication(config)
        check_database_access(config)
        check_backup_readability(config)
        check_filesystem(config.work_dir)
        check_r2(self._r2, bucket=config.r2_bucket)
        check_encryption(config.encryption_key)


def build_preflight_config(config, *, work_dir: Path) -> PreflightConfig:
    return PreflightConfig(
        project_ref=config.source.project_ref,
        host=config.source.host,
        port=config.source.port,
        database=config.source.database,
        username=config.source.username,
        password=config.source.password,
        major_version=config.source.major_version,
        r2_endpoint=config.r2.endpoint_url,
        r2_bucket=config.r2.bucket,
        r2_access_key=config.r2.access_key_id,
        r2_secret_key=config.r2.secret_access_key,
        encryption_key=config.encryption_key,
        work_dir=work_dir,
    )
