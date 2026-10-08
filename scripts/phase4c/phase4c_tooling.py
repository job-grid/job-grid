"""Phase 4C safety and artifact tooling.

This module deliberately contains no automatic restore path and no production
database/R2 operation. It provides deterministic validation primitives that can
be unit-tested without credentials or infrastructure access.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PRODUCTION_PROJECT_REF = "tnrdovdhlwitjzecduxa"
RECOVERY_PROJECT_REF = "vbxyigsljxjfcvytdoiq"
AES_GCM_NONCE_BYTES = 12
ARTIFACT_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class SafetyError(ValueError):
    """Raised when a Phase 4C safety invariant is violated."""


@dataclass(frozen=True)
class RestoreTarget:
    project_ref: str
    host: str


def assert_restore_target(target: RestoreTarget) -> None:
    """Fail closed unless target is the explicitly approved recovery project."""
    if not target.project_ref:
        raise SafetyError("Restore target identity is missing.")
    if target.project_ref == PRODUCTION_PROJECT_REF:
        raise SafetyError("Production is permanently forbidden as a restore target.")
    if target.project_ref != RECOVERY_PROJECT_REF:
        raise SafetyError("Restore target is not the approved recovery project.")
    if not target.host:
        raise SafetyError("Recovery PostgreSQL host is missing.")


def assert_separate_credential_names(names: Iterable[str]) -> None:
    """Reject credential names that would blur production/recovery boundaries."""
    normalized = {name.strip().upper() for name in names}
    if any("PRODUCTION" in name or name.startswith("PROD_") for name in normalized):
        raise SafetyError("Production credentials cannot be used for recovery restore.")
    required = {
        "RECOVERY_POSTGRES_HOST",
        "RECOVERY_POSTGRES_PORT",
        "RECOVERY_POSTGRES_DB",
        "RECOVERY_POSTGRES_USER",
        "RECOVERY_POSTGRES_PASSWORD",
    }
    missing = required - normalized
    if missing:
        raise SafetyError("Required recovery PostgreSQL credential names are missing.")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_artifact_name(name: str) -> None:
    if not name or not ARTIFACT_RE.fullmatch(name):
        raise SafetyError("Artifact name contains unsafe characters.")
    if "/" in name or "\\ " in name:
        raise SafetyError("Artifact name must not contain path separators.")


def build_manifest(
    *,
    backup_id: str,
    created_at: str,
    source_project_ref: str,
    postgres_major_version: str,
    artifacts: list[dict],
    migration_state: str | None = None,
) -> dict:
    if source_project_ref != PRODUCTION_PROJECT_REF:
        raise SafetyError("Backup source is not the approved production project.")
    if not backup_id:
        raise SafetyError("backup_id is required.")
    if not artifacts:
        raise SafetyError("At least one artifact is required.")

    for artifact in artifacts:
        validate_artifact_name(artifact["name"])
        if "sha256" not in artifact or not re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]):
            raise SafetyError("Artifact SHA-256 is missing or invalid.")

    manifest = {
        "format_version": 1,
        "backup_id": backup_id,
        "created_at": created_at,
        "source": {
            "supabase_project_ref": source_project_ref,
            "postgres_major_version": postgres_major_version,
            "scope": "logical-postgresql",
        },
        "artifacts": artifacts,
        "encryption": {
            "algorithm": "AES-GCM",
            "nonce_bytes": AES_GCM_NONCE_BYTES,
        },
        "recovery_boundaries": {
            "postgresql": "included",
            "supabase_auth": "separate-managed-service-boundary",
            "supabase_storage_metadata": "database-dependent; validate separately",
            "supabase_storage_objects": "not included",
            "external_configuration_and_secrets": "not included",
        },
    }

    if migration_state is not None:
        manifest["database"] = {"migration_state": migration_state}

    return manifest


def canonical_json(data: dict) -> bytes:
    return (
        json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        .encode("utf-8")
    )


def encrypted_object_key(backup_id: str, filename: str) -> str:
    if not backup_id or "/" in backup_id or "\\" in backup_id:
        raise SafetyError("Invalid backup ID.")
    validate_artifact_name(filename)
    return f"phase4c/backups/{backup_id}/{filename}"


def decode_aes_key(encoded: str) -> bytes:
    """Validate key material without ever printing it."""
    try:
        key = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise SafetyError("Encryption key is not valid base64.") from exc
    if len(key) not in (16, 24, 32):
        raise SafetyError("Encryption key has an invalid AES length.")
    return key


def implementation_stage_must_not_backup() -> None:
    """Hard guard used by implementation-stage tests."""
    raise SafetyError(
        "Implementation stage is stopped before backup creation. "
        "Explicit backup authorization is required."
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Phase 4C tooling-only safety checks")
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Run deterministic safety checks only; no infrastructure access.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.self_check:
        assert_restore_target(
            RestoreTarget(RECOVERY_PROJECT_REF, "recovery-host")
        )
        print("phase-4c tooling self-check: PASS")
        print("backup creation: NOT RUN")
        print("restore: NOT RUN")
        return 0
    print("tooling only: no backup or restore command is exposed by this stage")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
