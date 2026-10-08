import base64
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from backup_executor import (
    BACKUP_BUCKET,
    BackupConfig,
    BackupError,
    BackupExecutor,
    R2Config,
    SourcePostgresConfig,
    _build_dump_command,
    _encrypt_file,
    _upload_and_verify,
    assert_no_restore_target,
)
from phase4c_tooling import PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF, SafetyError


KEY = base64.b64encode(b"0" * 32).decode("ascii")


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


class BackupExecutorTests(unittest.TestCase):
    def make_config(self, root):
        return BackupConfig(
            source=SourcePostgresConfig(
                project_ref=PRODUCTION_PROJECT_REF,
                host="synthetic-source",
                port="5432",
                database="postgres",
                username="backup_user",
                password="synthetic-password",
                major_version="17",
            ),
            r2=R2Config(
                endpoint_url="https://r2.example.invalid",
                access_key_id="synthetic-access",
                secret_access_key="synthetic-secret",
            ),
            encryption_key=b"0" * 32,
            work_dir=root,
        )

    def test_end_to_end_uses_synthetic_runner_and_mock_r2_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = FakeRunner()
            r2 = FakeR2()
            result = BackupExecutor(
                self.make_config(root),
                command_runner=runner,
                r2_client=r2,
                clock=lambda: __import__("datetime").datetime(2026, 10, 8, tzinfo=__import__("datetime").timezone.utc),
            ).create_backup()

            self.assertEqual(len(runner.calls), 1)
            argv, env, output_path = runner.calls[0]
            self.assertEqual(argv[0], "pg_dump")
            self.assertEqual(env["PGPASSWORD"], "synthetic-password")
            self.assertNotIn("synthetic-password", " ".join(argv))
            self.assertEqual(set(r2.objects), {
                result.database_object_key,
                result.manifest_object_key,
            })
            self.assertTrue(all(key.startswith("phase4c/backups/") for key in r2.objects))
            self.assertTrue(all(data.startswith(b"JG4C") for data in r2.objects.values()))

    def test_production_cannot_be_restore_target(self):
        with self.assertRaises(SafetyError):
            assert_no_restore_target(PRODUCTION_PROJECT_REF)

    def test_unknown_restore_target_rejected(self):
        with self.assertRaises(SafetyError):
            assert_no_restore_target("unknown")

    def test_recovery_is_the_only_restore_target(self):
        assert_no_restore_target(RECOVERY_PROJECT_REF)

    def test_source_must_be_production(self):
        config = self.make_config(Path(tempfile.gettempdir()))
        bad = SourcePostgresConfig(
            project_ref=RECOVERY_PROJECT_REF,
            host=config.source.host,
            port=config.source.port,
            database=config.source.database,
            username=config.source.username,
            password=config.source.password,
        )
        with self.assertRaises(SafetyError):
            bad.validate()

    def test_r2_bucket_is_pinned(self):
        with self.assertRaises(SafetyError):
            R2Config(
                endpoint_url="https://r2.example.invalid",
                access_key_id="a",
                secret_access_key="b",
                bucket="other-bucket",
            ).validate()

    def test_generic_aws_credentials_are_rejected(self):
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "x", "AWS_SECRET_ACCESS_KEY": "y"}, clear=False):
            with self.assertRaises(SafetyError):
                self.make_config(Path(tempfile.gettempdir())).r2.validate()

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
            decryptor = Cipher(algorithms.AES(b"0" * 32), modes.GCM(nonce, tag)).decryptor()
            self.assertEqual(decryptor.update(ciphertext) + decryptor.finalize(), plain.read_bytes())

    def test_r2_readback_detects_tampering(self):
        class TamperingR2(FakeR2):
            def get_object(self, *, Bucket, Key):
                data = bytearray(self.objects[Key])
                data[-1] ^= 1
                return {"Body": FakeBody(bytes(data))}

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "encrypted"
            path.write_bytes(b"encrypted synthetic")
            with self.assertRaises(BackupError):
                _upload_and_verify(
                    TamperingR2(),
                    bucket=BACKUP_BUCKET,
                    object_key="phase4c/backups/test/database.dump.enc",
                    path=path,
                    expected_sha256="0" * 64,
                )

    def test_no_restore_method_exists(self):
        self.assertFalse(hasattr(BackupExecutor, "restore"))

    def test_executor_source_has_no_restore_or_scheduler(self):
        source = Path(__file__).with_name("backup_executor.py").read_text(encoding="utf-8")
        self.assertNotIn("pg_restore", source)
        self.assertNotIn("supabase db restore", source)
        self.assertNotIn("apscheduler", source.lower())
        self.assertNotIn("schedule.every", source.lower())
        self.assertNotIn("cron", source.lower())

    def test_ci_contains_no_secret_references_or_backup_invocation(self):
        workflow = Path(__file__).parents[2] / ".github" / "workflows" / "phase-4c-backup-executor.yml"
        content = workflow.read_text(encoding="utf-8")
        self.assertNotIn("secrets.", content)
        self.assertNotIn("python -m backup_executor --backup", content)

    def test_plaintext_cleanup_after_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = FakeRunner()
            r2 = FakeR2()
            executor = BackupExecutor(self.make_config(root), command_runner=runner, r2_client=r2)
            executor.create_backup()
            self.assertEqual(list(root.iterdir()), [])

    def test_plaintext_not_uploaded(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = FakeRunner()
            r2 = FakeR2()
            BackupExecutor(self.make_config(root), command_runner=runner, r2_client=r2).create_backup()
            self.assertTrue(all(b"synthetic database contents" not in value for value in r2.objects.values()))


if __name__ == "__main__":
    unittest.main()
