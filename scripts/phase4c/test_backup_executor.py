import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from backup_executor import (
    APPROVED_PRODUCTION_POSTGRES_HOST,
    APPROVED_R2_ENDPOINT_URL,
    ARTIFACT_DUMP,
    ARTIFACT_DUMP_SHA,
    ARTIFACT_MANIFEST,
    ARTIFACT_MANIFEST_SHA,
    BACKUP_BUCKET,
    PROTECTED_AUTHORIZATION_ENV,
    PROTECTED_EXECUTION_ENVIRONMENT,
    BackupConfig,
    BackupError,
    BotoR2Client,
    BackupExecutor,
    R2Config,
    SourcePostgresConfig,
    _build_dump_command,
    _child_env,
    _encrypt_file,
    _upload_and_verify,
    assert_backup_authorized,
    assert_pg_dump_major_version,
    assert_no_restore_target,
    main,
)
from phase4c_tooling import PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF, SafetyError
from backup_preflight import (
    PreflightCode, PreflightFailure, PreflightRunner,
    check_authentication, check_backup_readability, check_database_access,
    check_dns, check_encryption, check_filesystem, check_r2, check_tcp, check_tls,
)


class FakeRunner:
    def __init__(self):
        self.calls = []

    def run(self, argv, *, env, output_path):
        self.calls.append((argv, env, output_path))
        output_path.write_bytes(b"synthetic database contents")


class FakeBody:
    def __init__(self, data):
        self._stream = io.BytesIO(data)

    def read(self, size=-1):
        return self._stream.read(size)

    def close(self):
        self._stream.close()


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
        data = Body.read()
        if ContentLength != len(data):
            raise AssertionError("length mismatch")
        self.objects[Key] = data

    def get_object(self, *, Bucket, Key):
        return {"Body": FakeBody(self.objects[Key])}

    def delete_object(self, *, Bucket, Key):
        self.objects.pop(Key, None)


class FailingR2(FakeR2):
    def __init__(self, *, fail_on_put=None, fail_on_get=None):
        super().__init__()
        self.fail_on_put = fail_on_put
        self.fail_on_get = fail_on_get
        self.put_count = 0
        self.get_count = 0

    def put_object(self, *, Bucket, Key, Body, ContentLength):
        self.put_count += 1
        if self.fail_on_put == self.put_count:
            raise BackupError("synthetic upload failure")
        return super().put_object(Bucket=Bucket, Key=Key, Body=Body, ContentLength=ContentLength)

    def get_object(self, *, Bucket, Key):
        self.get_count += 1
        if self.fail_on_get == self.get_count:
            raise BackupError("synthetic read-back failure")
        return super().get_object(Bucket=Bucket, Key=Key)


class FakePreflight:
    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []

    def run(self, config):
        self.calls.append("PREFLIGHT")
        if self.failure is not None:
            raise PreflightFailure(self.failure)


class BackupExecutorTests(unittest.TestCase):
    def make_config(
        self,
        root,
        *,
        host=APPROVED_PRODUCTION_POSTGRES_HOST,
        endpoint=APPROVED_R2_ENDPOINT_URL,
    ):
        return BackupConfig(
            source=SourcePostgresConfig(
                project_ref=PRODUCTION_PROJECT_REF,
                host=host,
                port="5432",
                database="postgres",
                username="backup_user",
                password="synthetic-password",
                major_version="17",
            ),
            r2=R2Config(
                endpoint_url=endpoint,
                access_key_id="synthetic-access",
                secret_access_key="synthetic-secret",
            ),
            encryption_key=b"0" * 32,
            work_dir=root,
        )

    def run_synthetic_backup(self, root, r2):
        return BackupExecutor(
            self.make_config(root),
            command_runner=FakeRunner(),
            r2_client=r2,
            preflight_runner=FakePreflight(),
            clock=lambda: __import__("datetime").datetime(
                2026, 10, 8, tzinfo=__import__("datetime").timezone.utc
            ),
        ).create_backup()


    def test_preflight_runs_before_pg_dump_and_r2_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            preflight = FakePreflight()
            runner = FakeRunner()
            r2 = FakeR2()
            BackupExecutor(self.make_config(Path(temp)), command_runner=runner, r2_client=r2, preflight_runner=preflight).create_backup()
            self.assertEqual(preflight.calls, ["PREFLIGHT"])
            self.assertEqual(len(runner.calls), 1)
            self.assertEqual(len(r2.objects), 4)

    def test_each_preflight_failure_blocks_pg_dump_and_r2(self):
        for failure in [code.value for code in PreflightCode]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                runner = FakeRunner()
                r2 = FakeR2()
                preflight = FakePreflight(failure)
                with self.assertRaises(PreflightFailure) as ctx:
                    BackupExecutor(self.make_config(Path(temp)), command_runner=runner, r2_client=r2, preflight_runner=preflight).create_backup()
                self.assertEqual(str(ctx.exception), failure)
                self.assertEqual(runner.calls, [])
                self.assertEqual(r2.objects, {})

    def test_preflight_stage_order_is_fixed(self):
        import backup_preflight
        calls = []
        functions = ["check_postgres_client", "check_dns", "check_tcp", "check_tls", "check_authentication", "check_database_access", "check_backup_readability", "check_filesystem", "check_r2", "check_encryption"]
        with tempfile.TemporaryDirectory() as temp:
            config = backup_preflight.PreflightConfig(
                project_ref=PRODUCTION_PROJECT_REF, host=APPROVED_PRODUCTION_POSTGRES_HOST, port="5432",
                database="postgres", username="backup_user", password="synthetic-password", major_version="17",
                r2_endpoint=APPROVED_R2_ENDPOINT_URL, r2_bucket=BACKUP_BUCKET, r2_access_key="a", r2_secret_key="b",
                encryption_key=b"0" * 32, work_dir=Path(temp),
            )
            patches = [patch.object(backup_preflight, name, side_effect=lambda *args, _name=name, **kwargs: calls.append(_name)) for name in functions]
            for item in patches: item.start()
            try:
                PreflightRunner(r2_client=FakeR2()).run(config)
            finally:
                for item in reversed(patches): item.stop()
        self.assertEqual(calls, functions)

    def test_network_timeouts_have_fixed_codes(self):
        import subprocess as subprocess_module
        with patch("backup_preflight.subprocess.run", side_effect=subprocess_module.TimeoutExpired(["getent"], 5)):
            with self.assertRaises(PreflightFailure) as ctx: check_dns(APPROVED_PRODUCTION_POSTGRES_HOST)
        self.assertEqual(str(ctx.exception), PreflightCode.DNS_FAILED.value)
        with patch("backup_preflight.socket.create_connection", side_effect=TimeoutError()):
            with self.assertRaises(PreflightFailure) as ctx: check_tcp(APPROVED_PRODUCTION_POSTGRES_HOST, "5432")
        self.assertEqual(str(ctx.exception), PreflightCode.TCP_FAILED.value)
        with patch("backup_preflight.socket.create_connection", side_effect=TimeoutError()):
            with self.assertRaises(PreflightFailure) as ctx: check_tls(APPROVED_PRODUCTION_POSTGRES_HOST, "5432")
        self.assertEqual(str(ctx.exception), PreflightCode.TLS_FAILED.value)

    def test_database_stage_failures_are_fixed_codes(self):
        import backup_preflight
        config = backup_preflight.PreflightConfig(
            project_ref=PRODUCTION_PROJECT_REF, host=APPROVED_PRODUCTION_POSTGRES_HOST, port="5432",
            database="postgres", username="backup_user", password="synthetic-password", major_version="17",
            r2_endpoint=APPROVED_R2_ENDPOINT_URL, r2_bucket=BACKUP_BUCKET, r2_access_key="a", r2_secret_key="b",
            encryption_key=b"0" * 32, work_dir=Path(tempfile.gettempdir()),
        )
        for function, code in ((check_authentication, PreflightCode.AUTH_FAILED), (check_database_access, PreflightCode.DATABASE_ACCESS_FAILED), (check_backup_readability, PreflightCode.READABILITY_FAILED)):
            with self.subTest(code=code.value), patch("backup_preflight._connect_postgres", side_effect=PreflightFailure(code)):
                with self.assertRaises(PreflightFailure) as ctx: function(config)
                self.assertEqual(str(ctx.exception), code.value)

    def test_filesystem_insufficient_space_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp, patch("backup_preflight.MIN_FREE_SPACE_BYTES", 10**30):
            with self.assertRaises(PreflightFailure) as ctx: check_filesystem(Path(temp))
        self.assertEqual(str(ctx.exception), PreflightCode.FILESYSTEM_FAILED.value)

    def test_r2_preflight_failure_is_fixed_and_controlled(self):
        class DeniedR2(FakeR2):
            def head_bucket(self, *, Bucket): raise RuntimeError("SECRET-R2-DIAGNOSTIC")
        with self.assertRaises(PreflightFailure) as ctx: check_r2(DeniedR2(), bucket=BACKUP_BUCKET)
        self.assertEqual(str(ctx.exception), PreflightCode.R2_FAILED.value)
        self.assertNotIn("SECRET-R2-DIAGNOSTIC", str(ctx.exception))

    def test_encryption_invalid_key_is_fixed(self):
        with self.assertRaises(PreflightFailure) as ctx: check_encryption(b"bad")
        self.assertEqual(str(ctx.exception), PreflightCode.ENCRYPTION_FAILED.value)

    def test_preflight_does_not_put_credentials_in_dump_argv(self):
        config = self.make_config(Path(tempfile.gettempdir()))
        argv = _build_dump_command(config.source, Path("/tmp/synthetic.dump"))
        self.assertNotIn(config.source.password, argv)
        self.assertNotIn("postgresql://", " ".join(argv))

    def test_end_to_end_has_complete_four_object_artifact_set(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            r2 = FakeR2()
            result = self.run_synthetic_backup(root, r2)
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
            self.assertEqual(
                r2.objects[prefix + ARTIFACT_DUMP_SHA].decode(),
                f"{result.database_artifact_sha256}  {ARTIFACT_DUMP}\n",
            )
            self.assertEqual(
                r2.objects[prefix + ARTIFACT_MANIFEST_SHA].decode(),
                f"{result.manifest_artifact_sha256}  {ARTIFACT_MANIFEST}\n",
            )
            self.assertTrue(r2.objects[prefix + ARTIFACT_DUMP].startswith(b"JG4C"))
            self.assertTrue(r2.objects[prefix + ARTIFACT_MANIFEST].startswith(b"JG4C"))

    def test_production_source_requires_exact_project_and_host_pair(self):
        with self.assertRaises(SafetyError):
            self.make_config(Path(tempfile.gettempdir()), host="wrong.example.invalid").source.validate()

        recovery_with_production_host = SourcePostgresConfig(
            project_ref=RECOVERY_PROJECT_REF,
            host=APPROVED_PRODUCTION_POSTGRES_HOST,
            port="5432",
            database="postgres",
            username="backup_user",
            password="synthetic-password",
        )
        with self.assertRaises(SafetyError):
            recovery_with_production_host.validate()

    def test_concrete_r2_client_supports_reconciliation_delete(self):
        self.assertTrue(callable(getattr(BotoR2Client, "delete_object", None)))

    def test_r2_endpoint_and_bucket_are_pinned(self):
        with self.assertRaises(SafetyError):
            R2Config("https://r2.example.invalid", "a", "b").validate()
        with self.assertRaises(SafetyError):
            R2Config(APPROVED_R2_ENDPOINT_URL, "a", "b", "other-bucket").validate()

    def test_generic_aws_credentials_are_rejected(self):
        with patch.dict(
            os.environ,
            {"AWS_ACCESS_KEY_ID": "x", "AWS_SECRET_ACCESS_KEY": "y"},
            clear=False,
        ):
            with self.assertRaises(SafetyError):
                self.make_config(Path(tempfile.gettempdir())).r2.validate()

    def test_child_environment_excludes_unrelated_secrets(self):
        with patch.dict(
            os.environ,
            {
                "UNRELATED_PROTECTED_SECRET": "must-not-cross-boundary",
                "ANOTHER_SECRET": "also-must-not-cross-boundary",
                "AWS_SECRET_ACCESS_KEY": "must-not-cross-boundary",
            },
            clear=False,
        ):
            env = _child_env(self.make_config(Path(tempfile.gettempdir())).source)
        self.assertEqual(env["PGPASSWORD"], "synthetic-password")
        self.assertIn("PATH", env)
        self.assertNotIn("UNRELATED_PROTECTED_SECRET", env)
        self.assertNotIn("ANOTHER_SECRET", env)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", env)

    def test_database_upload_then_manifest_upload_failure_reconciles_all_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            r2 = FailingR2(fail_on_put=3)
            with self.assertRaises(BackupError):
                self.run_synthetic_backup(Path(temp), r2)
            self.assertEqual(r2.objects, {})

    def test_database_readback_failure_reconciles_created_object(self):
        with tempfile.TemporaryDirectory() as temp:
            r2 = FailingR2(fail_on_get=1)
            with self.assertRaises(BackupError):
                self.run_synthetic_backup(Path(temp), r2)
            self.assertEqual(r2.objects, {})

    def test_manifest_readback_failure_reconciles_all_created_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            r2 = FailingR2(fail_on_get=3)
            with self.assertRaises(BackupError):
                self.run_synthetic_backup(Path(temp), r2)
            self.assertEqual(r2.objects, {})

    def test_pg_dump_client_major_version_accepts_approved_major(self):
        assert_pg_dump_major_version("17", "pg_dump (PostgreSQL) 17.6")

    def test_pg_dump_client_major_version_accepts_normal_postgresql_output(self):
        assert_pg_dump_major_version("17", "pg_dump (PostgreSQL) 17.6")

    def test_pg_dump_client_major_version_accepts_package_build_suffix(self):
        assert_pg_dump_major_version(
            "17",
            "pg_dump (PostgreSQL) 17.6-1.pgdg24.04+1",
        )
        assert_pg_dump_major_version(
            "17",
            "pg_dump (PostgreSQL) 17.6 (Ubuntu 17.6-1.pgdg24.04+1)",
        )

    def test_pg_dump_client_major_version_rejects_malformed_output(self):
        with self.assertRaises(BackupError):
            assert_pg_dump_major_version("17", "pg_dump PostgreSQL 17.6")

    def test_pg_dump_client_major_version_rejects_missing_version(self):
        with self.assertRaises(BackupError):
            assert_pg_dump_major_version("17", "")

    def test_pg_dump_client_major_version_rejects_mismatch(self):
        with self.assertRaises(SafetyError):
            assert_pg_dump_major_version("17", "pg_dump (PostgreSQL) 16.10")

    def test_pg_dump_client_major_version_rejects_invalid_expected_major(self):
        with self.assertRaises(SafetyError):
            assert_pg_dump_major_version("17.x", "pg_dump (PostgreSQL) 17.6")

    def test_pg_dump_client_major_version_rejects_unparseable_version(self):
        with self.assertRaises(BackupError):
            assert_pg_dump_major_version("17", "pg_dump version unavailable")

    def test_backup_authorization_requires_protected_cloud_state(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SafetyError):
                assert_backup_authorized()

        with patch.dict(
            os.environ,
            {
                "GITHUB_ACTIONS": "true",
                "GITHUB_ENVIRONMENT": PROTECTED_EXECUTION_ENVIRONMENT,
                "GITHUB_EVENT_NAME": "workflow_dispatch",
                PROTECTED_AUTHORIZATION_ENV: "false",
            },
            clear=True,
        ):
            with self.assertRaises(SafetyError):
                assert_backup_authorized()

        with patch.dict(
            os.environ,
            {
                "GITHUB_ACTIONS": "true",
                "GITHUB_ENVIRONMENT": PROTECTED_EXECUTION_ENVIRONMENT,
                "GITHUB_EVENT_NAME": "workflow_dispatch",
                PROTECTED_AUTHORIZATION_ENV: "true",
            },
            clear=True,
        ):
            assert_backup_authorized()

        with patch.dict(
            os.environ,
            {
                "GITHUB_ACTIONS": "true",
                "GITHUB_ENVIRONMENT": PROTECTED_EXECUTION_ENVIRONMENT,
                "GITHUB_EVENT_NAME": "pull_request",
                PROTECTED_AUTHORIZATION_ENV: "true",
            },
            clear=True,
        ):
            with self.assertRaises(SafetyError):
                assert_backup_authorized()

    def test_cli_backup_requires_protected_authorization(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", ["backup_executor.py", "--backup"]):
            with self.assertRaises(SafetyError):
                main()

    def test_production_cannot_be_restore_target(self):
        with self.assertRaises(SafetyError):
            assert_no_restore_target(PRODUCTION_PROJECT_REF)

    def test_unknown_restore_target_rejected(self):
        with self.assertRaises(SafetyError):
            assert_no_restore_target("unknown")

    def test_recovery_is_the_only_restore_target(self):
        assert_no_restore_target(RECOVERY_PROJECT_REF)

    def test_aes_gcm_round_trip_for_synthetic_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plain = root / "plain"
            enc = root / "encrypted"
            plain.write_bytes(b"synthetic database contents")
            _encrypt_file(plain, enc, b"0" * 32)
            payload = enc.read_bytes()
            self.assertEqual(payload[:4], b"JG4C")
            nonce = payload[4:16]
            ciphertext = payload[16:-16]
            tag = payload[-16:]
            decryptor = Cipher(
                algorithms.AES(b"0" * 32),
                modes.GCM(nonce, tag),
            ).decryptor()
            self.assertEqual(
                decryptor.update(ciphertext) + decryptor.finalize(),
                plain.read_bytes(),
            )

    def test_r2_readback_detects_tampering(self):
        class TamperingR2(FakeR2):
            def get_object(self, *, Bucket, Key):
                data = bytearray(self.objects[Key])
                data[-1] ^= 1
                return {"Body": FakeBody(bytes(data))}

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "encrypted"
            path.write_bytes(b"encrypted synthetic")
            with self.assertRaises(BackupError):
                _upload_and_verify(
                    TamperingR2(),
                    bucket=BACKUP_BUCKET,
                    object_key="phase4c/backups/test/database.dump.enc",
                    path=path,
                    expected_sha256="0" * 64,
                )

    def test_pg_dump_password_not_in_argv(self):
        config = self.make_config(Path(tempfile.gettempdir()))
        argv = _build_dump_command(config.source, Path("/tmp/synthetic.dump"))
        self.assertNotIn(config.source.password, argv)

    def test_no_restore_method_exists(self):
        self.assertFalse(hasattr(BackupExecutor, "restore"))

    def test_executor_source_has_no_restore_or_scheduler(self):
        source = Path(__file__).with_name("backup_executor.py").read_text(encoding="utf-8")
        self.assertNotIn("pg_restore", source)
        self.assertNotIn("supabase db restore", source)
        self.assertNotIn("apscheduler", source.lower())
        self.assertNotIn("schedule.every", source.lower())
        self.assertNotIn("cron", source.lower())

    def test_protected_workflow_selects_postgresql_17_deterministically(self):
        workflow = (
            Path(__file__).parents[2]
            / ".github"
            / "workflows"
            / "phase4c-protected-production-backup.yml"
        )
        content = workflow.read_text(encoding="utf-8")
        self.assertIn('sudo apt-get install --no-install-recommends -y postgresql-client-17', content)
        self.assertIn('export PATH="/usr/lib/postgresql/17/bin:$PATH"', content)
        self.assertIn('resolved_pg_dump="$(command -v pg_dump)"', content)
        self.assertIn('test "$resolved_pg_dump" = "/usr/lib/postgresql/17/bin/pg_dump"', content)
        self.assertIn('echo "pg_dump version: $(pg_dump --version)"', content)
        self.assertIn(
            'PYTHONPATH=scripts/phase4c python -m backup_executor --check-pg-dump-version',
            content,
        )


    def test_protected_workflow_persists_postgresql_17_path_for_later_steps(self):
        workflow = (
            Path(__file__).parents[2]
            / ".github"
            / "workflows"
            / "phase4c-protected-production-backup.yml"
        )
        content = workflow.read_text(encoding="utf-8")
        path_marker = 'echo "/usr/lib/postgresql/17/bin" >> "$GITHUB_PATH"'
        exact_path_marker = 'test "$resolved_pg_dump" = "/usr/lib/postgresql/17/bin/pg_dump"'
        version_marker = 'echo "pg_dump version: $(pg_dump --version)"'
        check_marker = 'PYTHONPATH=scripts/phase4c python -m backup_executor --check-pg-dump-version'
        backup_marker = 'PYTHONPATH=scripts/phase4c python -m backup_executor --backup'

        self.assertIn(path_marker, content)
        self.assertIn(exact_path_marker, content)
        self.assertIn(version_marker, content)
        self.assertIn(check_marker, content)
        self.assertIn(backup_marker, content)

        path_index = content.index(path_marker)
        exact_path_index = content.index(exact_path_marker)
        version_index = content.index(version_marker)
        check_index = content.index(check_marker)
        backup_index = content.index(backup_marker)

        self.assertLess(path_index, exact_path_index)
        self.assertLess(path_index, version_index)
        self.assertLess(path_index, check_index)
        self.assertLess(check_index, backup_index)

    def test_protected_workflow_keeps_executor_major_version_gate(self):
        workflow = (
            Path(__file__).parents[2]
            / ".github"
            / "workflows"
            / "phase4c-protected-production-backup.yml"
        )
        content = workflow.read_text(encoding="utf-8")
        self.assertIn(
            'PYTHONPATH=scripts/phase4c python -m backup_executor --check-pg-dump-version',
            content,
        )

        executor = Path(__file__).with_name("backup_executor.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("[PG_DUMP, PG_DUMP_VERSION_ARGUMENT]", executor)
        self.assertIn("assert_pg_dump_major_version(expected_major, completed.stdout)", executor)
        self.assertIn(
            'verify_pg_dump_major_version(expected_major)',
            executor,
        )

    def test_ci_contains_no_secret_references_or_real_backup_invocation(self):
        workflow = (
            Path(__file__).parents[2]
            / ".github"
            / "workflows"
            / "phase-4c-backup-executor.yml"
        )
        content = workflow.read_text(encoding="utf-8")
        self.assertNotIn("secrets.", content)
        self.assertNotIn("python -m backup_executor --backup", content)
        self.assertIn("R2 upload: NOT PERFORMED", content)

    def test_plaintext_cleanup_after_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.run_synthetic_backup(root, FakeR2())
            self.assertEqual(list(root.iterdir()), [])

    def test_plaintext_not_uploaded(self):
        with tempfile.TemporaryDirectory() as temp:
            r2 = FakeR2()
            self.run_synthetic_backup(Path(temp), r2)
            self.assertTrue(
                all(b"synthetic database contents" not in value for value in r2.objects.values())
            )


if __name__ == "__main__":
    unittest.main()
