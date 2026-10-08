import base64
import unittest

from phase4c_tooling import (
    PRODUCTION_PROJECT_REF,
    RECOVERY_PROJECT_REF,
    RestoreTarget,
    SafetyError,
    assert_restore_target,
    assert_separate_credential_names,
    build_manifest,
    decode_aes_key,
    canonical_json,
    encrypted_object_key,
    implementation_stage_must_not_backup,
    sha256_bytes,
)


class Phase4CSafetyTests(unittest.TestCase):
    def test_production_is_forbidden_restore_target(self):
        with self.assertRaises(SafetyError):
            assert_restore_target(RestoreTarget(PRODUCTION_PROJECT_REF, "prod-host"))

    def test_unknown_target_is_rejected(self):
        with self.assertRaises(SafetyError):
            assert_restore_target(RestoreTarget("unknown", "host"))

    def test_recovery_target_is_accepted(self):
        assert_restore_target(RestoreTarget(RECOVERY_PROJECT_REF, "recovery-host"))

    def test_missing_host_is_rejected(self):
        with self.assertRaises(SafetyError):
            assert_restore_target(RestoreTarget(RECOVERY_PROJECT_REF, ""))

    def test_recovery_credentials_are_separate(self):
        assert_separate_credential_names(
            {
                "RECOVERY_POSTGRES_HOST",
                "RECOVERY_POSTGRES_PORT",
                "RECOVERY_POSTGRES_DB",
                "RECOVERY_POSTGRES_USER",
                "RECOVERY_POSTGRES_PASSWORD",
            }
        )

    def test_production_credential_name_is_rejected(self):
        with self.assertRaises(SafetyError):
            assert_separate_credential_names(
                {
                    "RECOVERY_POSTGRES_HOST",
                    "RECOVERY_POSTGRES_PORT",
                    "RECOVERY_POSTGRES_DB",
                    "RECOVERY_POSTGRES_USER",
                    "RECOVERY_POSTGRES_PASSWORD",
                    "PRODUCTION_DATABASE_PASSWORD",
                }
            )

    def test_manifest_is_non_secret_and_deterministic(self):
        digest = sha256_bytes(b"encrypted")
        manifest = build_manifest(
            backup_id="20261008T071600Z-abcd",
            created_at="2026-10-08T07:16:00Z",
            source_project_ref=PRODUCTION_PROJECT_REF,
            postgres_major_version="17",
            artifacts=[
                {
                    "name": "database.dump.enc",
                    "size_bytes": 9,
                    "sha256": digest,
                }
            ],
        )
        encoded = canonical_json(manifest)
        self.assertIn(b"supabase_project_ref", encoded)
        self.assertNotIn(b"password", encoded.lower())
        self.assertNotIn(b"access_key", encoded.lower())
        self.assertNotIn(b"authorization", encoded.lower())
        self.assertNotIn(b"key_material", encoded.lower())

    def test_decode_aes_key_accepts_16_bytes(self):
        encoded = base64.b64encode(b"0" * 16).decode("ascii")
        self.assertEqual(len(decode_aes_key(encoded)), 16)

    def test_decode_aes_key_accepts_24_bytes(self):
        encoded = base64.b64encode(b"1" * 24).decode("ascii")
        self.assertEqual(len(decode_aes_key(encoded)), 24)

    def test_decode_aes_key_accepts_32_bytes(self):
        encoded = base64.b64encode(b"2" * 32).decode("ascii")
        self.assertEqual(len(decode_aes_key(encoded)), 32)

    def test_decode_aes_key_rejects_invalid_base64(self):
        with self.assertRaises(SafetyError):
            decode_aes_key("not-valid-base64!!!")

    def test_decode_aes_key_rejects_invalid_length(self):
        encoded = base64.b64encode(b"short").decode("ascii")
        with self.assertRaises(SafetyError):
            decode_aes_key(encoded)

    def test_r2_object_layout(self):
        self.assertEqual(
            encrypted_object_key("backup-1", "database.dump.enc"),
            "phase4c/backups/backup-1/database.dump.enc",
        )

    def test_implementation_stage_cannot_backup(self):
        with self.assertRaises(SafetyError):
            implementation_stage_must_not_backup()

    def test_sha256_is_standard(self):
        self.assertEqual(
            sha256_bytes(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )


if __name__ == "__main__":
    unittest.main()
