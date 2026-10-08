import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backup_executor import (
    APPROVED_PRODUCTION_POSTGRES_HOST,
    APPROVED_R2_ENDPOINT_URL,
    ARTIFACT_DUMP,
    ARTIFACT_DUMP_SHA,
    ARTIFACT_MANIFEST,
    ARTIFACT_MANIFEST_SHA,
    BACKUP_BUCKET,
    BackupConfig,
    BackupError,
    BackupExecutor,
    R2Config,
    SourcePostgresConfig,
    _build_dump_command,
)
from phase4c_tooling import PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF, SafetyError
from production_preflight import (
    BackupPreflight,
    PreflightCode,
    PreflightConfig,
    PreflightFailure,
    check_authentication,
    check_client,
    check_database_access,
    check_dns,
    check_encryption,
    check_filesystem,
    check_readability,
    check_r2,
    check_tcp,
    check_tls,
)
from recovery_procedure import (
    RecoveryFailure,
    assert_recovery_credentials,
    assert_recovery_target,
    decrypt_file,
    recovery_runbook,
    validate_recovery,
)


class FakeBody:
    def __init__(self, data):
        self.stream = io.BytesIO(data)
    def read(self, size=-1):
        return self.stream.read(size)
    def close(self):
        self.stream.close()


class FakeR2:
    def __init__(self):
        self.objects = {}
    def head_bucket(self, *, Bucket):
        return {}
    def head_object(self, *, Bucket, Key):
        if Key not in self.objects:
            raise KeyError(Key)
        return {"ContentLength": len(self.objects[Key])}
    def put_object(self, *, Bucket, Key, Body, ContentLength):
        data = Body.read() if hasattr(Body, "read") else Body
        assert len(data) == ContentLength
        self.objects[Key] = data
    def get_object(self, *, Bucket, Key):
        return {"Body": FakeBody(self.objects[Key])}
    def delete_object(self, *, Bucket, Key):
        self.objects.pop(Key, None)


class FakePreflight:
    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []
    def run(self, config):
        self.calls.append("PREFLIGHT")
        if self.failure:
            raise PreflightFailure(self.failure)


class FakeRunner:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail
    def run(self, argv, *, env, output_path):
        self.calls.append((argv, env))
        if self.fail:
            raise RuntimeError("synthetic pg_dump failure")
        output_path.write_bytes(b"synthetic encrypted-source-input")


class FoundationTests(unittest.TestCase):
    def config(self, root):
        return BackupConfig(
            source=SourcePostgresConfig(
                project_ref=PRODUCTION_PROJECT_REF,
                host=APPROVED_PRODUCTION_POSTGRES_HOST,
                port="5432",
                database="postgres",
                username="backup_user",
                password="synthetic-password",
                major_version="17",
            ),
            r2=R2Config(
                endpoint_url=APPROVED_R2_ENDPOINT_URL,
                access_key_id="synthetic-access",
                secret_access_key="synthetic-secret",
            ),
            encryption_key=b"0" * 32,
            work_dir=root,
        )

    def test_exact_pg_dump_command_preserves_grants_and_excludes_unsafe_options(self):
        argv = _build_dump_command(self.config(Path("/tmp")).source, Path("/tmp/database.dump"))
        self.assertEqual(argv[0], "/usr/lib/postgresql/17/bin/pg_dump")
        self.assertIn("--format=custom", argv)
        self.assertIn("--no-owner", argv)
        self.assertIn("--no-subscriptions", argv)
        self.assertNotIn("--no-privileges", argv)
        self.assertNotIn("--password", argv)
        self.assertNotIn("postgresql://", " ".join(argv))

    def test_preflight_stage_order(self):
        import production_preflight
        names = [
            "check_client", "check_dns", "check_tcp", "check_tls",
            "check_authentication", "check_database_access", "check_readability",
            "check_filesystem", "check_r2", "check_encryption",
        ]
        calls = []
        config = PreflightConfig(
            APPROVED_PRODUCTION_POSTGRES_HOST, 5432, "postgres", "backup_user",
            "synthetic-password", "17", Path(tempfile.gettempdir()), b"0" * 32
        )
        patches = [
            patch.object(production_preflight, name, side_effect=lambda *a, _name=name, **k: calls.append(_name))
            for name in names
        ]
        for p in patches: p.start()
        try:
            BackupPreflight(r2_client=FakeR2(), bucket=BACKUP_BUCKET).run(config)
        finally:
            for p in reversed(patches): p.stop()
        self.assertEqual(calls, names)

    def test_each_preflight_failure_is_fixed_and_blocks_pipeline(self):
        stages = [
            PreflightCode.CLIENT_FAILED,
            PreflightCode.DNS_FAILED,
            PreflightCode.TCP_FAILED,
            PreflightCode.TLS_FAILED,
            PreflightCode.AUTH_FAILED,
            PreflightCode.DATABASE_ACCESS_FAILED,
            PreflightCode.READABILITY_FAILED,
            PreflightCode.FILESYSTEM_FAILED,
            PreflightCode.R2_FAILED,
            PreflightCode.ENCRYPTION_FAILED,
        ]
        for failure in stages:
            with self.subTest(failure=failure.value), tempfile.TemporaryDirectory() as temp:
                runner = FakeRunner()
                r2 = FakeR2()
                with self.assertRaises(PreflightFailure):
                    BackupExecutor(
                        self.config(Path(temp)),
                        command_runner=runner,
                        r2_client=r2,
                        preflight=FakePreflight(failure.value),
                    ).create_backup()
                self.assertEqual(runner.calls, [])
                self.assertEqual(r2.objects, {})

    def test_backup_encrypt_integrity_and_readback_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            r2 = FakeR2()
            result = BackupExecutor(
                self.config(root),
                command_runner=FakeRunner(),
                r2_client=r2,
                preflight=FakePreflight(),
                clock=lambda: __import__("datetime").datetime(2026, 10, 8, tzinfo=__import__("datetime").timezone.utc),
            ).create_backup()
            prefix = f"phase4c/backups/{result.backup_id}/"
            self.assertEqual(
                set(r2.objects),
                {
                    prefix + ARTIFACT_DUMP,
                    prefix + ARTIFACT_DUMP_SHA,
                    prefix + ARTIFACT_MANIFEST,
                    prefix + ARTIFACT_MANIFEST_SHA,
                },
            )
            self.assertTrue(r2.objects[prefix + ARTIFACT_DUMP].startswith(b"JG4C"))
            self.assertNotIn(b"synthetic encrypted-source-input", r2.objects[prefix + ARTIFACT_DUMP])

    def test_duplicate_object_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            r2 = FakeR2()
            existing = "phase4c/backups/20261008T000000Z-fixed/database.dump.enc"
            r2.objects[existing] = b"existing"
            with patch("backup_executor._new_backup_id", return_value="20261008T000000Z-fixed"):
                with self.assertRaises(BackupError) as ctx:
                    BackupExecutor(
                        self.config(root),
                        command_runner=FakeRunner(),
                        r2_client=r2,
                        preflight=FakePreflight(),
                    ).create_backup()
            self.assertEqual(str(ctx.exception), "R2_UPLOAD_FAILED")
            self.assertEqual(r2.objects[existing], b"existing")

    def test_invalid_encryption_key_is_rejected_before_dump(self):
        config = self.config(Path(tempfile.gettempdir()))
        bad = BackupConfig(config.source, config.r2, b"0" * 16, config.work_dir)
        with self.assertRaises(SafetyError):
            BackupExecutor(bad, command_runner=FakeRunner(), r2_client=FakeR2(), preflight=FakePreflight())

    def test_pg_dump_failure_is_fixed_and_secret_free(self):
        with tempfile.TemporaryDirectory() as temp:
            runner = FakeRunner(fail=True)
            with self.assertRaises(BackupError) as ctx:
                BackupExecutor(
                    self.config(Path(temp)),
                    command_runner=runner,
                    r2_client=FakeR2(),
                    preflight=FakePreflight(),
                ).create_backup()
            self.assertEqual(str(ctx.exception), "PG_DUMP_FAILED")
            self.assertNotIn("synthetic-password", str(ctx.exception))

    def test_recovery_target_cannot_be_production(self):
        with self.assertRaises(SafetyError):
            assert_recovery_target(PRODUCTION_PROJECT_REF, "production.example.invalid")
        assert_recovery_target(RECOVERY_PROJECT_REF, "recovery.example.invalid")

    def test_recovery_credentials_are_separate(self):
        env = {
            "RECOVERY_POSTGRES_HOST": "recovery.example.invalid",
            "RECOVERY_POSTGRES_PORT": "5432",
            "RECOVERY_POSTGRES_DB": "postgres",
            "RECOVERY_POSTGRES_USER": "recovery_user",
            "RECOVERY_POSTGRES_PASSWORD": "synthetic-recovery-password",
            "RECOVERY_PROJECT_REF": RECOVERY_PROJECT_REF,
            "BACKUP_R2_ENDPOINT_URL": APPROVED_R2_ENDPOINT_URL,
            "BACKUP_R2_BUCKET": BACKUP_BUCKET,
            "BACKUP_R2_ACCESS_KEY_ID": "recovery-access",
            "BACKUP_R2_SECRET_ACCESS_KEY": "recovery-secret",
            "BACKUP_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        }
        assert_recovery_credentials(env)
        with self.assertRaises(RecoveryFailure):
            assert_recovery_credentials({**env, "BACKUP_SOURCE_POSTGRES_PASSWORD": "forbidden"})

    def test_recovery_decrypt_round_trip_and_no_secret_in_error(self):
        from backup_executor import _encrypt_file
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plain = root / "plain"
            encrypted = root / "encrypted"
            restored = root / "restored"
            plain.write_bytes(b"recovery synthetic payload")
            _encrypt_file(plain, encrypted, b"0" * 32)
            decrypt_file(encrypted, restored, b"0" * 32)
            self.assertEqual(restored.read_bytes(), plain.read_bytes())

    def test_recovery_runbook_is_explicit(self):
        steps = recovery_runbook()
        self.assertEqual(len(steps), 10)
        self.assertTrue(all(step.startswith(tuple(str(i) + "." for i in range(1, 11))) for step in steps))

    def test_recovery_validator_defines_required_security_checks(self):
        import recovery_procedure
        sql = recovery_procedure.VALIDATION_SQL
        for term in ("pg_constraint", "pg_proc", "pg_trigger", "relrowsecurity", "pg_policy", "relacl", "schema_migrations"):
            self.assertIn(term, sql)

    def test_recovery_validation_is_fail_closed_on_connection_failure(self):
        with patch("recovery_procedure.psycopg.connect", side_effect=RuntimeError("secret=DO_NOT_LEAK")):
            with self.assertRaises(RecoveryFailure) as ctx:
                validate_recovery(
                    host="recovery.example.invalid",
                    port="5432",
                    database="postgres",
                    username="recovery",
                    password="synthetic",
                    expected_migration_state="",
                )
        self.assertEqual(str(ctx.exception), "RECOVERY_VALIDATION_FAILED")
        self.assertNotIn("DO_NOT_LEAK", str(ctx.exception))

    def test_recovery_workflow_has_no_production_credentials(self):
        source = Path(".github/workflows/phase4c-isolated-recovery-test.yml").read_text(encoding="utf-8")
        self.assertNotIn("BACKUP_SOURCE_POSTGRES_PASSWORD", source)
        self.assertNotIn("PRODUCTION_POSTGRES_PASSWORD", source)
        self.assertIn("RECOVERY_POSTGRES_PASSWORD", source)


if __name__ == "__main__":
    unittest.main()
