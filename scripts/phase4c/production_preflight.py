"""Fail-closed production backup preflight.

This module performs bounded, deterministic checks only. It emits fixed stage
codes and never exposes provider errors, credentials, SQL text, or stderr.
"""

from __future__ import annotations

import os
import shutil
import socket
import ssl
import subprocess
import struct
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Protocol

import psycopg
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PG_DUMP_PATH = "/usr/lib/postgresql/17/bin/pg_dump"
PG_MAJOR = "17"
APPROVED_HOST = "db.tnrdovdhlwitjzecduxa.supabase.co"
PREFLIGHT_TIMEOUT = 5
MIN_FREE_SPACE_BYTES = 2 * 1024 * 1024 * 1024
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
    def __init__(self, code: PreflightCode | str):
        self.code = code.value if isinstance(code, PreflightCode) else str(code)
        super().__init__(self.code)


@dataclass(frozen=True)
class PreflightConfig:
    host: str
    port: int
    database: str
    username: str
    password: str
    major_version: str
    work_dir: Path
    encryption_key: bytes


class R2Probe(Protocol):
    def head_bucket(self, *, Bucket: str) -> object: ...
    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentLength: int) -> object: ...
    def get_object(self, *, Bucket: str, Key: str) -> dict: ...
    def delete_object(self, *, Bucket: str, Key: str) -> object: ...


def _fail(code: PreflightCode) -> None:
    raise PreflightFailure(code)


def check_client(major: str) -> None:
    if major != PG_MAJOR:
        _fail(PreflightCode.CLIENT_FAILED)
    try:
        if os.path.realpath(shutil.which("pg_dump") or "") != PG_DUMP_PATH:
            _fail(PreflightCode.CLIENT_FAILED)
        result = subprocess.run(
            [PG_DUMP_PATH, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=PREFLIGHT_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired):
        _fail(PreflightCode.CLIENT_FAILED)
    if result.returncode != 0 or not result.stdout.startswith("pg_dump (PostgreSQL) 17"):
        _fail(PreflightCode.CLIENT_FAILED)


def check_dns(host: str) -> None:
    """Resolve the pinned hostname using every address family available.

    The database hostname pin is intentionally unchanged. AF_UNSPEC-style
    resolution avoids incorrectly rejecting an IPv6-only direct endpoint
    during a DNS-only check; actual socket reachability is tested separately.
    """
    if host != APPROVED_HOST:
        _fail(PreflightCode.DNS_FAILED)
    try:
        addresses = socket.getaddrinfo(
            host,
            None,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except (OSError, ValueError, socket.gaierror, TimeoutError):
        _fail(PreflightCode.DNS_FAILED)
    if not addresses:
        _fail(PreflightCode.DNS_FAILED)


def check_tcp(host: str, port: int) -> None:
    try:
        with socket.create_connection((host, port), timeout=PREFLIGHT_TIMEOUT):
            return
    except (OSError, ValueError, TimeoutError):
        _fail(PreflightCode.TCP_FAILED)


def check_tls(host: str, port: int) -> None:
    raw = None
    try:
        raw = socket.create_connection((host, port), timeout=PREFLIGHT_TIMEOUT)
        raw.settimeout(PREFLIGHT_TIMEOUT)
        raw.sendall(struct.pack("!II", 8, SSL_REQUEST_CODE))
        if raw.recv(1) != b"S":
            _fail(PreflightCode.TLS_FAILED)
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        with context.wrap_socket(raw, server_hostname=host):
            return
    except PreflightFailure:
        raise
    except (OSError, ssl.SSLError, ValueError, TimeoutError):
        _fail(PreflightCode.TLS_FAILED)
    finally:
        if raw is not None:
            try:
                raw.close()
            except OSError:
                pass


def _connect(config: PreflightConfig):
    try:
        return psycopg.connect(
            host=config.host,
            port=config.port,
            dbname=config.database,
            user=config.username,
            password=config.password,
            connect_timeout=PREFLIGHT_TIMEOUT,
            sslmode="verify-full",
            autocommit=True,
            options="-c statement_timeout=5000",
        )
    except psycopg.Error as exc:
        state = getattr(exc, "sqlstate", "") or ""
        if state.startswith("28"):
            _fail(PreflightCode.AUTH_FAILED)
        if state == "3D000":
            _fail(PreflightCode.DATABASE_ACCESS_FAILED)
        _fail(PreflightCode.AUTH_FAILED)


def check_authentication(config: PreflightConfig) -> None:
    conn = _connect(config)
    try:
        if not conn.info.ssl_in_use:
            _fail(PreflightCode.TLS_FAILED)
    finally:
        conn.close()


def check_database_access(config: PreflightConfig) -> None:
    conn = _connect(config)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user")
            database, _user = cur.fetchone()
        if database != config.database:
            _fail(PreflightCode.DATABASE_ACCESS_FAILED)
    except PreflightFailure:
        raise
    except psycopg.Error:
        _fail(PreflightCode.DATABASE_ACCESS_FAILED)
    finally:
        conn.close()


READABILITY_SQL = """
SELECT
  COALESCE(pg_has_role(current_user, 'pg_read_all_data', 'member'), false)
  OR COALESCE((
    SELECT bool_and(has_table_privilege(current_user, c.oid, 'SELECT'))
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r','p','v','m','f')
  ), true)
"""


def check_readability(config: PreflightConfig) -> None:
    conn = _connect(config)
    try:
        with conn.cursor() as cur:
            cur.execute(READABILITY_SQL)
            capable = bool(cur.fetchone()[0])
        if not capable:
            _fail(PreflightCode.READABILITY_FAILED)
    except PreflightFailure:
        raise
    except psycopg.Error:
        _fail(PreflightCode.READABILITY_FAILED)
    finally:
        conn.close()


def check_filesystem(work_dir: Path) -> None:
    probe = work_dir / ("phase4c-probe-" + uuid.uuid4().hex)
    try:
        probe.mkdir(parents=True, exist_ok=False)
        if shutil.disk_usage(probe).free < MIN_FREE_SPACE_BYTES:
            _fail(PreflightCode.FILESYSTEM_FAILED)
        source = probe / "a"
        target = probe / "b"
        source.write_bytes(b"phase4c")
        if source.read_bytes() != b"phase4c":
            _fail(PreflightCode.FILESYSTEM_FAILED)
        source.rename(target)
        if target.read_bytes() != b"phase4c":
            _fail(PreflightCode.FILESYSTEM_FAILED)
    except PreflightFailure:
        raise
    except OSError:
        _fail(PreflightCode.FILESYSTEM_FAILED)
    finally:
        shutil.rmtree(probe, ignore_errors=True)


def check_r2(client: R2Probe, bucket: str) -> None:
    key = "phase4c/preflight/" + uuid.uuid4().hex
    payload = b"phase4c-r2-preflight"
    created = False
    try:
        client.head_bucket(Bucket=bucket)
        client.put_object(Bucket=bucket, Key=key, Body=payload, ContentLength=len(payload))
        created = True
        body = client.get_object(Bucket=bucket, Key=key)["Body"]
        data = body.read() if hasattr(body, "read") else body
        if data != payload:
            _fail(PreflightCode.R2_FAILED)
    except PreflightFailure:
        raise
    except Exception:
        _fail(PreflightCode.R2_FAILED)
    finally:
        if created:
            try:
                client.delete_object(Bucket=bucket, Key=key)
            except Exception:
                _fail(PreflightCode.R2_FAILED)


def check_encryption(key: bytes) -> None:
    if len(key) != 32:
        _fail(PreflightCode.ENCRYPTION_FAILED)
    try:
        nonce = b"phase4c-test!"[:12]
        enc = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
        ciphertext = enc.update(b"phase4c") + enc.finalize()
        dec = Cipher(algorithms.AES(key), modes.GCM(nonce, enc.tag)).decryptor()
        if dec.update(ciphertext) + dec.finalize() != b"phase4c":
            _fail(PreflightCode.ENCRYPTION_FAILED)
    except PreflightFailure:
        raise
    except Exception:
        _fail(PreflightCode.ENCRYPTION_FAILED)


class BackupPreflight:
    def __init__(self, *, r2_client: R2Probe, bucket: str):
        self.r2_client = r2_client
        self.bucket = bucket

    def run(self, config: PreflightConfig) -> None:
        check_client(config.major_version)
        check_dns(config.host)
        check_tcp(config.host, config.port)
        check_tls(config.host, config.port)
        check_authentication(config)
        check_database_access(config)
        check_readability(config)
        check_filesystem(config.work_dir)
        check_r2(self.r2_client, self.bucket)
        check_encryption(config.encryption_key)
