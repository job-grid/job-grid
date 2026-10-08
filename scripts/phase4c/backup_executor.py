"""Production logical-backup executor for Phase 4C.

This module is intentionally execution-capable but authorization-neutral:
constructing an executor does not access infrastructure. Callers must invoke
BackupExecutor.create_backup() explicitly.

The executor has no restore implementation and never schedules itself.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Mapping, Protocol

import psycopg

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from production_preflight import BackupPreflight, PreflightConfig, PreflightFailure
from phase4c_tooling import (
    AES_GCM_NONCE_BYTES,
    PRODUCTION_PROJECT_REF,
    RECOVERY_PROJECT_REF,
    RestoreTarget,
    SafetyError,
    assert_restore_target,
    build_manifest,
    canonical_json,
    decode_aes_key,
    encrypted_object_key,
    sha256_file,
)


BACKUP_BUCKET = "job-grid-backups"
APPROVED_PRODUCTION_POSTGRES_HOST = "db.tnrdovdhlwitjzecduxa.supabase.co"
APPROVED_R2_ENDPOINT_URL = "https://6952ddf46cc39605326ecf0583cde02e.r2.cloudflarestorage.com"
PROTECTED_EXECUTION_ENVIRONMENT = "phase4c-production-approved"
PROTECTED_AUTHORIZATION_ENV = "PHASE4C_BACKUP_AUTHORIZED"
BACKUP_SOURCE_PREFIX = "BACKUP_SOURCE_POSTGRES_"
R2_PREFIX = "BACKUP_R2_"
ENCRYPTION_ENV = "BACKUP_ENCRYPTION_KEY"
PG_DUMP = "pg_dump"
PG_DUMP_VERSION_ARGUMENT = "--version"
CHUNK_SIZE = 1024 * 1024
ARTIFACT_DUMP = "database.dump.enc"
ARTIFACT_MANIFEST = "manifest.json.enc"
ARTIFACT_DUMP_SHA = "database.dump.sha256"
ARTIFACT_MANIFEST_SHA = "manifest.json.sha256"


class BackupError(RuntimeError):
    """Raised when a backup cannot be safely completed."""


class CommandRunner(Protocol):
    def run(self, argv: list[str], *, env: Mapping[str, str], output_path: Path) -> None:
        ...


class R2Client(Protocol):
    def head_bucket(self, *, Bucket: str) -> object:
        ...

    def head_object(self, *, Bucket: str, Key: str) -> Mapping[str, object]:
        ...

    def put_object(self, *, Bucket: str, Key: str, Body: BinaryIO, ContentLength: int) -> object:
        ...

    def get_object(self, *, Bucket: str, Key: str) -> Mapping[str, object]:
        ...


def _parse_pg_dump_major(version_output: str) -> str:
    match = re.match(r"^\s*pg_dump \(PostgreSQL\) (\d+)(?:\.\d+)*(?:[-+~_][0-9A-Za-z][0-9A-Za-z.+~_-]*)?(?:\s+.*)?\s*$", version_output)
    if not match:
        raise BackupError("Unable to determine pg_dump client major version.")
    return match.group(1)


def assert_pg_dump_major_version(expected_major: str, version_output: str) -> None:
    expected = expected_major.strip()
    if not expected.isdigit():
        raise SafetyError("Approved PostgreSQL major version is invalid.")
    installed = _parse_pg_dump_major(version_output)
    if installed != expected:
        raise SafetyError("PostgreSQL client major version does not match the approved source major version.")


def verify_pg_dump_major_version(expected_major: str) -> None:
    try:
        completed = subprocess.run(
            [PG_DUMP, PG_DUMP_VERSION_ARGUMENT],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise BackupError("pg_dump is not installed on the execution host.") from exc
    if completed.returncode != 0:
        raise BackupError("Unable to determine pg_dump client version.")
    assert_pg_dump_major_version(expected_major, completed.stdout)


class SubprocessCommandRunner:
    """Runs pg_dump without placing the database password in argv."""

    def run(self, argv: list[str], *, env: Mapping[str, str], output_path: Path) -> None:
        if argv[0] != PG_DUMP:
            raise BackupError("Only pg_dump is permitted by the production backup runner.")
        expected_major = os.environ.get("BACKUP_SOURCE_POSTGRES_MAJOR_VERSION", "")
        verify_pg_dump_major_version(expected_major)
        try:
            with output_path.open("wb") as output:
                completed = subprocess.run(
                    argv,
                    env=dict(env),
                    stdout=output,
                    stderr=subprocess.PIPE,
                    check=False,
                )
        except FileNotFoundError as exc:
            raise BackupError("pg_dump is not installed on the execution host.") from exc
        if completed.returncode != 0:
            # stderr can contain connection details; classify it locally and never forward it.
            diagnostic = pg_dump_failure_diagnostic(completed.stderr, completed.returncode)
            raise BackupError(diagnostic)


class BotoR2Client:
    """Minimal S3-compatible client for Cloudflare R2."""

    def __init__(self, *, endpoint_url: str, access_key_id: str, secret_access_key: str):
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
            config=BotoConfig(signature_version="s3v4"),
        )

    def head_bucket(self, **kwargs):
        return self._client.head_bucket(**kwargs)

    def head_object(self, **kwargs):
        return self._client.head_object(**kwargs)

    def put_object(self, **kwargs):
        return self._client.put_object(**kwargs)

    def get_object(self, **kwargs):
        return self._client.get_object(**kwargs)

    def delete_object(self, **kwargs):
        return self._client.delete_object(**kwargs)


@dataclass(frozen=True)
class SourcePostgresConfig:
    project_ref: str
    host: str
    port: str
    database: str
    username: str
    password: str
    major_version: str = "17"

    def validate(self) -> None:
        if self.project_ref == RECOVERY_PROJECT_REF:
            raise SafetyError("Recovery project cannot be a backup source.")
        if self.project_ref != PRODUCTION_PROJECT_REF:
            raise SafetyError("Backup source must be the approved production project.")
        if self.host != APPROVED_PRODUCTION_POSTGRES_HOST:
            raise SafetyError("Backup source PostgreSQL host is not the approved production host.")
        if not all((self.host, self.port, self.database, self.username, self.password)):
            raise SafetyError("All backup source PostgreSQL credentials are required.")


@dataclass(frozen=True)
class R2Config:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    bucket: str = BACKUP_BUCKET

    def validate(self) -> None:
        if not all((self.endpoint_url, self.access_key_id, self.secret_access_key)):
            raise SafetyError("Dedicated backup R2 credentials and endpoint are required.")
        if self.endpoint_url != APPROVED_R2_ENDPOINT_URL:
            raise SafetyError("Backup R2 endpoint is not the approved private endpoint.")
        if self.bucket != BACKUP_BUCKET:
            raise SafetyError("Backup R2 bucket does not match the approved private bucket.")
        if "AWS_ACCESS_KEY_ID" in os.environ or "AWS_SECRET_ACCESS_KEY" in os.environ:
            # Generic AWS variables must never silently become the backup credential source.
            raise SafetyError("Generic AWS credentials are forbidden for Phase 4C backup execution.")


@dataclass(frozen=True)
class BackupConfig:
    source: SourcePostgresConfig
    r2: R2Config
    encryption_key: bytes
    work_dir: Path
    dump_jobs: int = 1

    @classmethod
    def from_environment(cls, *, work_dir: Path) -> "BackupConfig":
        source = SourcePostgresConfig(
            project_ref=_required("BACKUP_SOURCE_PROJECT_REF"),
            host=_required("BACKUP_SOURCE_POSTGRES_HOST"),
            port=_required("BACKUP_SOURCE_POSTGRES_PORT"),
            database=_required("BACKUP_SOURCE_POSTGRES_DB"),
            username=_required("BACKUP_SOURCE_POSTGRES_USER"),
            password=_required("BACKUP_SOURCE_POSTGRES_PASSWORD"),
            major_version=os.environ.get("BACKUP_SOURCE_POSTGRES_MAJOR_VERSION", "17"),
        )
        r2 = R2Config(
            endpoint_url=_required("BACKUP_R2_ENDPOINT_URL"),
            access_key_id=_required("BACKUP_R2_ACCESS_KEY_ID"),
            secret_access_key=_required("BACKUP_R2_SECRET_ACCESS_KEY"),
            bucket=os.environ.get("BACKUP_R2_BUCKET", BACKUP_BUCKET),
        )
        source.validate()
        r2.validate()
        key = decode_aes_key(_required(ENCRYPTION_ENV))
        dump_jobs = _parse_jobs(os.environ.get("BACKUP_DUMP_JOBS", "1"))
        return cls(source=source, r2=r2, encryption_key=key, work_dir=work_dir, dump_jobs=dump_jobs)

    def validate(self) -> None:
        self.source.validate()
        self.r2.validate()
        if len(self.encryption_key) != 32:
            raise SafetyError("Phase 4C requires a 32-byte AES-256 encryption key.")
        if self.dump_jobs < 1 or self.dump_jobs > 4:
            raise SafetyError("BACKUP_DUMP_JOBS must be between 1 and 4.")
        if self.source.project_ref != PRODUCTION_PROJECT_REF:
            raise SafetyError("Only production may be used as the backup source.")


@dataclass(frozen=True)
class BackupResult:
    backup_id: str
    database_artifact_sha256: str
    manifest_artifact_sha256: str
    database_artifact_size: int
    manifest_artifact_size: int
    database_object_key: str
    manifest_object_key: str
    status: str = "BACKUP_COMPLETE"


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SafetyError(f"Required protected setting {name} is missing.")
    return value


def _parse_jobs(value: str) -> int:
    try:
        jobs = int(value)
    except ValueError as exc:
        raise SafetyError("BACKUP_DUMP_JOBS must be an integer.") from exc
    return jobs


def _new_backup_id(now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{secrets.token_hex(8)}"


def _read_migration_state(source: SourcePostgresConfig) -> str:
    try:
        with psycopg.connect(
            host=source.host,
            port=int(source.port),
            dbname=source.database,
            user=source.username,
            password=source.password,
            connect_timeout=5,
            sslmode="verify-full",
            autocommit=True,
            options="-c statement_timeout=5000",
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT current_setting('server_version_num'), "
                    "current_setting('server_version'), "
                    "to_regclass('supabase_migrations.schema_migrations')"
                )
                server_num, server_version, migration_table = cur.fetchone()
                latest = None
                if migration_table is not None:
                    cur.execute(
                        "SELECT version, name "
                        "FROM supabase_migrations.schema_migrations "
                        "ORDER BY version DESC LIMIT 1"
                    )
                    row = cur.fetchone()
                    latest = {"version": str(row[0]), "name": str(row[1])} if row else None
        return json.dumps(
            {
                "server_version_num": str(server_num),
                "server_version": str(server_version),
                "migration_table_present": migration_table is not None,
                "latest_migration": latest,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    except Exception:
        raise BackupError("DATABASE_METADATA_FAILED") from None


def _sha256_path(path: Path) -> str:
    return sha256_file(path)


def _write_checksum(path: Path, digest: str, artifact_name: str) -> None:
    path.write_text(f"{digest}  {artifact_name}\n", encoding="utf-8")


def _encrypt_file(source: Path, destination: Path, key: bytes) -> None:
    nonce = secrets.token_bytes(AES_GCM_NONCE_BYTES)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    with source.open("rb") as src, destination.open("wb") as dst:
        # File format: magic + nonce + ciphertext + 16-byte GCM tag.
        dst.write(b"JG4C")
        dst.write(nonce)
        for chunk in iter(lambda: src.read(CHUNK_SIZE), b""):
            dst.write(encryptor.update(chunk))
        dst.write(encryptor.finalize())
        dst.write(encryptor.tag)


def _object_exists(client: R2Client, *, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except KeyError:
        return False
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = exc.response.get("Error", {}).get("Code")
        if status == 404 or code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise BackupError("Unable to verify whether the R2 destination object exists.") from exc


def _upload_only(
    client: R2Client,
    *,
    bucket: str,
    object_key: str,
    path: Path,
    created_objects: list[str],
) -> None:
    if _object_exists(client, bucket=bucket, key=object_key):
        raise BackupError("R2_UPLOAD_FAILED")
    try:
        with path.open("rb") as body:
            client.put_object(
                Bucket=bucket,
                Key=object_key,
                Body=body,
                ContentLength=path.stat().st_size,
            )
        created_objects.append(object_key)
    except Exception:
        raise BackupError("R2_UPLOAD_FAILED") from None


def _read_back_verify(
    client: R2Client,
    *,
    bucket: str,
    object_key: str,
    path: Path,
    expected_sha256: str,
) -> None:
    try:
        head = client.head_object(Bucket=bucket, Key=object_key)
        if int(head.get("ContentLength", -1)) != path.stat().st_size:
            raise BackupError("R2_READ_BACK_FAILED")
        response = client.get_object(Bucket=bucket, Key=object_key)
        body = response["Body"]
        digest = hashlib.sha256()
        try:
            while True:
                chunk = body.read(CHUNK_SIZE)
                if not chunk:
                    break
                digest.update(chunk)
        finally:
            close = getattr(body, "close", None)
            if close:
                close()
        if digest.hexdigest() != expected_sha256:
            raise BackupError("R2_READ_BACK_FAILED")
    except BackupError:
        raise
    except Exception:
        raise BackupError("R2_READ_BACK_FAILED") from None


def _upload_and_verify(
    client: R2Client,
    *,
    bucket: str,
    object_key: str,
    path: Path,
    expected_sha256: str,
    created_objects: list[str] | None = None,
) -> None:
    owned = created_objects if created_objects is not None else []
    _upload_only(
        client, bucket=bucket, object_key=object_key, path=path, created_objects=owned
    )
    _read_back_verify(
        client,
        bucket=bucket,
        object_key=object_key,
        path=path,
        expected_sha256=expected_sha256,
    )


def _delete_and_verify(client: R2Client, *, bucket: str, key: str) -> None:
    try:
        client.delete_object(Bucket=bucket, Key=key)
    except Exception as exc:
        raise BackupError(f"Failed to reconcile R2 object {key}.") from exc
    if _object_exists(client, bucket=bucket, key=key):
        raise BackupError(f"R2 object {key} remains after reconciliation.")


def _reconcile_objects(client: R2Client, *, bucket: str, keys: list[str]) -> None:
    errors = []
    for key in reversed(dict.fromkeys(keys)):
        try:
            _delete_and_verify(client, bucket=bucket, key=key)
        except BackupError as exc:
            errors.append(str(exc))
    if errors:
        raise BackupError("Backup reconciliation failed: " + "; ".join(errors))


def _build_dump_command(source: SourcePostgresConfig, output_path: Path) -> list[str]:
    # Password is supplied only through PGPASSWORD. This command intentionally
    # preserves ACL/grant statements for recovery; ownership remains detached.
    return [
        "/usr/lib/postgresql/17/bin/pg_dump",
        "--host", source.host,
        "--port", source.port,
        "--username", source.username,
        "--dbname", source.database,
        "--format=custom",
        "--no-owner",
        "--no-subscriptions",
        "--file", str(output_path),
    ]


def _child_env(source: SourcePostgresConfig) -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C"),
        "LC_ALL": os.environ.get("LC_ALL", "C"),
        "PGPASSWORD": source.password,
    }


def assert_backup_authorized() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SafetyError("Real backup execution requires GitHub Actions.")
    if os.environ.get("GITHUB_ENVIRONMENT") != PROTECTED_EXECUTION_ENVIRONMENT:
        raise SafetyError("Real backup execution requires the protected production environment.")
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise SafetyError("Real backup execution requires a manual workflow dispatch.")
    if os.environ.get(PROTECTED_AUTHORIZATION_ENV) != "true":
        raise SafetyError("Protected backup authorization is not present.")


class BackupExecutor:
    """Create one encrypted logical backup; never restore or schedule."""

    def __init__(
        self,
        config: BackupConfig,
        *,
        command_runner: CommandRunner | None = None,
        r2_client: R2Client | None = None,
        clock=None,
    ):
        config.validate()
        self._config = config
        self._runner = command_runner or SubprocessCommandRunner()
        self._r2 = r2_client or BotoR2Client(
            endpoint_url=config.r2.endpoint_url,
            access_key_id=config.r2.access_key_id,
            secret_access_key=config.r2.secret_access_key,
        )
        self._preflight = BackupPreflight(
            r2_client=self._r2,
            bucket=config.r2.bucket,
        )
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def create_backup(self) -> BackupResult:
        try:
            self._preflight.run(
                PreflightConfig(
                    host=self._config.source.host,
                    port=int(self._config.source.port),
                    database=self._config.source.database,
                    username=self._config.source.username,
                    password=self._config.source.password,
                    major_version=self._config.source.major_version,
                    work_dir=self._config.work_dir,
                    encryption_key=self._config.encryption_key,
                )
            )
        except PreflightFailure:
            raise

        backup_id = _new_backup_id(self._clock())
        self._config.work_dir.mkdir(parents=True, exist_ok=True)
        work_root = self._config.work_dir / f"phase4c-{backup_id}"
        work_root.mkdir(parents=False, exist_ok=False)
        plaintext = work_root / "database.dump"
        encrypted_dump = work_root / ARTIFACT_DUMP
        encrypted_dump_sha = work_root / ARTIFACT_DUMP_SHA
        encrypted_manifest = work_root / ARTIFACT_MANIFEST
        encrypted_manifest_sha = work_root / ARTIFACT_MANIFEST_SHA
        created_objects: list[str] = []
        try:
            try:
                self._runner.run(
                    _build_dump_command(self._config.source, plaintext),
                    env=_child_env(self._config.source),
                    output_path=plaintext,
                )
                if not plaintext.is_file() or plaintext.stat().st_size == 0:
                    raise RuntimeError
            except Exception:
                raise BackupError("PG_DUMP_FAILED") from None

            try:
                _encrypt_file(plaintext, encrypted_dump, self._config.encryption_key)
            except Exception:
                raise BackupError("ENCRYPTION_FAILED") from None
            plaintext.unlink(missing_ok=True)

            db_sha = _sha256_path(encrypted_dump)
            db_size = encrypted_dump.stat().st_size
            _write_checksum(encrypted_dump_sha, db_sha, ARTIFACT_DUMP)
            manifest = build_manifest(
                backup_id=backup_id,
                created_at=self._clock().isoformat(),
                source_project_ref=self._config.source.project_ref,
                postgres_major_version=self._config.source.major_version,
                artifacts=[
                    {"name": ARTIFACT_DUMP, "size_bytes": db_size, "sha256": db_sha},
                    {"name": ARTIFACT_DUMP_SHA, "size_bytes": encrypted_dump_sha.stat().st_size, "sha256": _sha256_path(encrypted_dump_sha)},
                ],
                migration_state=_read_migration_state(self._config.source),
            )
            manifest_bytes = canonical_json(manifest)
            manifest_plain = work_root / "manifest.json"
            manifest_plain.write_bytes(manifest_bytes)
            try:
                _encrypt_file(manifest_plain, encrypted_manifest, self._config.encryption_key)
                manifest_plain.unlink(missing_ok=True)
            except Exception:
                raise BackupError("ENCRYPTION_FAILED") from None

            try:
                manifest_sha = _sha256_path(encrypted_manifest)
            manifest_size = encrypted_manifest.stat().st_size
                _write_checksum(encrypted_manifest_sha, manifest_sha, ARTIFACT_MANIFEST)
            except Exception:
                raise BackupError("CHECKSUM_FAILED") from None

            artifacts = [
                (ARTIFACT_DUMP, encrypted_dump, db_sha),
                (ARTIFACT_DUMP_SHA, encrypted_dump_sha, _sha256_path(encrypted_dump_sha)),
                (ARTIFACT_MANIFEST, encrypted_manifest, manifest_sha),
                (ARTIFACT_MANIFEST_SHA, encrypted_manifest_sha, _sha256_path(encrypted_manifest_sha)),
            ]
            for artifact_name, path, digest in artifacts:
                key = encrypted_object_key(backup_id, artifact_name)
                _upload_only(
                    self._r2,
                    bucket=self._config.r2.bucket,
                    object_key=key,
                    path=path,
                    created_objects=created_objects,
                )            try:
                for artifact_name, path, digest in artifacts:
                    key = encrypted_object_key(backup_id, artifact_name)
                    _read_back_verify(
                        self._r2,
                        bucket=self._config.r2.bucket,
                        object_key=key,
                        path=path,
                        expected_sha256=digest,
                    )
            except BackupError:
                raise
            except Exception:
                raise BackupError("R2_READ_BACK_FAILED") from None


            return BackupResult(
                backup_id=backup_id,
                database_artifact_sha256=db_sha,
                manifest_artifact_sha256=manifest_sha,
                database_artifact_size=db_size,
                manifest_artifact_size=manifest_size,
                database_object_key=encrypted_object_key(backup_id, ARTIFACT_DUMP),
                manifest_object_key=encrypted_object_key(backup_id, ARTIFACT_MANIFEST),
            )
        except Exception as exc:
            if created_objects:
                try:
                    _reconcile_objects(self._r2, bucket=self._config.r2.bucket, keys=created_objects)
                except BackupError as cleanup_exc:
                    raise BackupError(f"{exc}; {cleanup_exc}") from exc
            raise
        finally:
            # Best-effort cleanup only; this is not guaranteed secure deletion.
            shutil.rmtree(work_root, ignore_errors=True)


def assert_no_restore_target(target_project_ref: str) -> None:
    """Shared hard guard for any future restore caller."""
    assert_restore_target(
        RestoreTarget(project_ref=target_project_ref, host="validated-later")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 4C production logical backup executor")
    parser.add_argument("--backup", action="store_true", help="Create one backup.")
    parser.add_argument(
        "--check-pg-dump-version",
        action="store_true",
        help="Verify the installed pg_dump major version without database access.",
    )
    args = parser.parse_args()

    if args.check_pg_dump_version:
        verify_pg_dump_major_version(_required("BACKUP_SOURCE_POSTGRES_MAJOR_VERSION"))
        print("pg_dump major version validated.")
        return 0

    if not args.backup:
        parser.error("No action selected. Backup execution requires explicit --backup authorization.")
    assert_backup_authorized()
    config = BackupConfig.from_environment(work_dir=Path(tempfile.gettempdir()))
    result = BackupExecutor(config).create_backup()
    print(json.dumps({
        "backup_id": result.backup_id,
        "database_artifact_sha256": result.database_artifact_sha256,
        "manifest_artifact_sha256": result.manifest_artifact_sha256,
        "database_artifact_size": result.database_artifact_size,
        "manifest_artifact_size": result.manifest_artifact_size,
        "database_object_key": result.database_object_key,
        "manifest_object_key": result.manifest_object_key,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
