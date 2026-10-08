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
    assert_no_restore_target,
    main,
)
from phase4c_tooling import PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF, SafetyError


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
            clock=lambda: __import__("datetime").datetime(
                2026, 10, 8, tzinfo=__import__("datetime").timezone.utc
            ),
        ).create_backup()

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
