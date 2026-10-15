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
    SUPABASE_MANAGED_SCHEMAS,
    RecoveryFailure,
    classify_pg_restore_failure,
    restore_backup,
    validate_schema_counts,
)


class RecoveryManagedSchemaTests(unittest.TestCase):
    def test_supabase_managed_schemas_are_excluded_from_cross_project_restore(self):
        self.assertEqual(
            SUPABASE_MANAGED_SCHEMAS,
            (
                "auth",
                "storage",
                "realtime",
                "extensions",
                "graphql",
                "graphql_public",
                "pgbouncer",
                "vault",
            ),
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


class RecoveryRestoreDiagnosticTests(unittest.TestCase):
    def test_pg_restore_diagnostic_classification_never_returns_raw_error(self):
        cases = (
            (b'pg_restore: error: connection failed: password authentication failed for user "secret-user"', "authentication_failed"),
            (b'could not translate host name "private-host.example"', "dns_resolution_failed"),
            (b'ERROR: permission denied for schema auth', "permission_denied"),
            (b'pg_restore: error: unsupported version in file header', "invalid_dump_format"),
            (b'pg_restore: error: server returned an error', "generic_pg_restore_error"),
            (b'undocumented output', "unknown_pg_restore_error"),
        )
        for stderr, expected in cases:
            with self.subTest(expected=expected):
                category = classify_pg_restore_failure(stderr)
                self.assertEqual(category, expected)
                self.assertNotIn("secret-user", category)
                self.assertNotIn("private-host.example", category)

    def test_restore_failure_emits_only_sanitized_category(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ca_file = root / "recovery-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            dump_file = root / "database.dump"
            dump_file.write_bytes(b"synthetic dump")
            result = type(
                "Completed",
                (),
                {
                    "returncode": 1,
                    "stderr": b'pg_restore: error: connection failed: password authentication failed for user "secret-user"',
                },
            )()
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.subprocess.run", return_value=result):
                    with self.assertRaises(RecoveryFailure) as ctx:
                        restore_backup(
                            dump_path=dump_file,
                            host="recovery-host.invalid",
                            port="5432",
                            database="postgres",
                            username="secret-user",
                            password="synthetic-password",
                        )
            self.assertEqual(str(ctx.exception), "RECOVERY_RESTORE_FAILED[authentication_failed]")
            self.assertNotIn("secret-user", str(ctx.exception))
            self.assertNotIn("synthetic-password", str(ctx.exception))


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
            argv = run.call_args.args[0]
            self.assertEqual(env["PGSSLMODE"], "verify-full")
            self.assertEqual(env["PGSSLROOTCERT"], str(ca_file))
            self.assertNotIn("BACKUP_ENCRYPTION_KEY", env)
            self.assertNotIn("BACKUP_R2_SECRET_ACCESS_KEY", env)
            self.assertIn("--single-transaction", argv)
            self.assertIn("--exit-on-error", argv)
            self.assertNotIn("--clean", argv)
            for schema in SUPABASE_MANAGED_SCHEMAS:
                self.assertIn(f"--exclude-schema={schema}", argv)

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
