import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from recovery_procedure import (
    ARTIFACTS,
    ARTIFACT_DUMP,
    ARTIFACT_DUMP_SHA,
    ARTIFACT_MANIFEST,
    ARTIFACT_MANIFEST_SHA,
    RecoveryFailure,
    restore_backup,
    validate_schema_counts,
)


class RecoveryArtifactNameTests(unittest.TestCase):
    def test_recovery_artifact_constants_match_backup_executor_contract(self):
        self.assertEqual(
            (ARTIFACT_DUMP, ARTIFACT_DUMP_SHA, ARTIFACT_MANIFEST, ARTIFACT_MANIFEST_SHA),
            (
                "database.dump.enc",
                "database.dump.sha256",
                "manifest.json.enc",
                "manifest.json.sha256",
            ),
        )
        self.assertEqual(
            ARTIFACTS,
            (ARTIFACT_DUMP, ARTIFACT_DUMP_SHA, ARTIFACT_MANIFEST, ARTIFACT_MANIFEST_SHA),
        )


class RecoverySchemaCountTests(unittest.TestCase):
    def test_legitimate_empty_object_categories_are_accepted(self):
        counts = validate_schema_counts((0, 0, 0, 0, 0, 0, 0, 0, 1))
        self.assertEqual(counts["tables"], 0)
        self.assertEqual(counts["triggers"], 0)
        self.assertEqual(counts["rls"], 0)
        self.assertEqual(counts["policies"], 0)
        self.assertEqual(counts["migration_table"], 1)

    def test_missing_migration_ledger_is_rejected(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 0, 0, 0, 0, 0, 0, 0, 0))

    def test_negative_count_is_rejected(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 0, -1, 0, 0, 0, 0, 0, 1))

    def test_wrong_number_of_counts_is_rejected(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 1))


    def test_restore_requires_ca_and_passes_verify_full_to_pg_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ca_file = root / "recovery-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            dump_file = root / "database.dump"
            dump_file.write_bytes(b"synthetic dump")
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.subprocess.run", return_value=type("Completed", (), {"returncode": 0})()) as run:
                    restore_backup(
                        dump_path=dump_file,
                        host="recovery-host.invalid",
                        port="5432",
                        database="postgres",
                        username="recovery.synthetic",
                        password="synthetic-password",
                    )
            env = run.call_args.kwargs["env"]
            self.assertEqual(env["PGSSLMODE"], "verify-full")
            self.assertEqual(env["PGSSLROOTCERT"], str(ca_file))
            self.assertNotIn("BACKUP_ENCRYPTION_KEY", env)
            self.assertNotIn("BACKUP_R2_SECRET_ACCESS_KEY", env)

    def test_restore_fails_closed_when_ca_file_is_missing(self):
        with patch.dict(os.environ, {"PGSSLROOTCERT": ""}, clear=False):
            with self.assertRaises(RecoveryFailure) as ctx:
                restore_backup(
                    dump_path=Path("unused.dump"),
                    host="recovery-host.invalid",
                    port="5432",
                    database="postgres",
                    username="recovery.synthetic",
                    password="synthetic-password",
                )
        self.assertEqual(str(ctx.exception), "RECOVERY_TLS_CA_FAILED")


if __name__ == "__main__":
    unittest.main()
