import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from recovery_procedure import (
    ARTIFACTS,
    ARTIFACT_DUMP,
    ARTIFACT_DUMP_SHA,
    ARTIFACT_MANIFEST,
    ARTIFACT_MANIFEST_SHA,
    SUPABASE_MANAGED_SCHEMAS,
    RecoveryFailure,
    assert_application_restore_target_empty,
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
            list_result = type(
                "Completed",
                (),
                {
                    "returncode": 0,
                    "stdout": b"; archive header\\n1; 2615 2200 SCHEMA - public postgres\\n2; 1259 30000 TABLE public jobs postgres\\n",
                    "stderr": b"",
                },
            )()
            result = type(
                "Completed",
                (),
                {
                    "returncode": 1,
                    "stderr": b'pg_restore: error: connection failed: password authentication failed for user "secret-user"',
                },
            )()
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.subprocess.run", side_effect=[list_result, result]):
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


class RecoveryTargetEmptyGuardTests(unittest.TestCase):
    def _connection(self, row):
        connection = MagicMock()
        cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = row
        return connection

    def test_empty_app_owned_target_is_accepted_using_verified_tls(self):
        with tempfile.TemporaryDirectory() as temp:
            ca_file = Path(temp) / "recovery-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            connection = self._connection((False, False))
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.psycopg.connect", return_value=connection) as connect:
                    assert_application_restore_target_empty(
                        host="recovery-host.invalid",
                        port="5432",
                        database="postgres",
                        username="recovery.synthetic",
                        password="synthetic-password",
                    )
            self.assertEqual(connect.call_args.kwargs["sslmode"], "verify-full")
            self.assertEqual(connect.call_args.kwargs["sslrootcert"], str(ca_file))

    def test_nonempty_public_schema_is_rejected_without_deleting_anything(self):
        with tempfile.TemporaryDirectory() as temp:
            ca_file = Path(temp) / "recovery-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            connection = self._connection((True, False))
            cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.psycopg.connect", return_value=connection):
                    with self.assertRaises(RecoveryFailure) as ctx:
                        assert_application_restore_target_empty(
                            host="recovery-host.invalid",
                            port="5432",
                            database="postgres",
                            username="recovery.synthetic",
                            password="synthetic-password",
                        )
            self.assertEqual(str(ctx.exception), "RECOVERY_TARGET_NOT_EMPTY")
            self.assertEqual(cursor.execute.call_count, 1)
            query = cursor.execute.call_args.args[0].lower()
            self.assertIn("select", query)
            self.assertNotIn("delete", query)
            self.assertNotIn("truncate", query)

    def test_existing_migration_ledger_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            ca_file = Path(temp) / "recovery-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            connection = self._connection((False, True))
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.psycopg.connect", return_value=connection):
                    with self.assertRaises(RecoveryFailure) as ctx:
                        assert_application_restore_target_empty(
                            host="recovery-host.invalid",
                            port="5432",
                            database="postgres",
                            username="recovery.synthetic",
                            password="synthetic-password",
                        )
            self.assertEqual(str(ctx.exception), "RECOVERY_TARGET_NOT_EMPTY")


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
            toc_output = (
                b"; Archive created at test time\n"
                b"1; 2615 2200 SCHEMA - public postgres\n"
                b"2; 1259 30000 TABLE public job_categories postgres\n"
                b"3; 1259 30001 TABLE public country_options postgres\n"
                b"4; 2615 4000 SCHEMA - supabase_migrations postgres\n"
            )
            list_result = type(
                "Completed", (), {"returncode": 0, "stdout": toc_output, "stderr": b""}
            )()
            restore_result = type(
                "Completed", (), {"returncode": 0, "stdout": b"", "stderr": b""}
            )()
            with patch.dict(os.environ, {"PGSSLROOTCERT": str(ca_file)}, clear=False):
                with patch("recovery_procedure.subprocess.run", side_effect=[list_result, restore_result]) as run:
                    restore_backup(
                        dump_path=dump_file,
                        host="recovery-host.invalid",
                        port="5432",
                        database="postgres",
                        username="recovery.synthetic",
                        password="synthetic-password",
                    )
            env = run.call_args_list[1].kwargs["env"]
            argv = run.call_args_list[1].args[0]
            toc_path = Path(argv[argv.index("--use-list") + 1])
            toc_text = toc_path.read_text(encoding="utf-8")
            self.assertNotIn("SCHEMA - public", toc_text)
            self.assertIn("TABLE public job_categories", toc_text)
            self.assertIn("TABLE public country_options", toc_text)
            self.assertIn("SCHEMA - supabase_migrations", toc_text)
            self.assertEqual(env["PGSSLMODE"], "verify-full")
            self.assertEqual(env["PGSSLROOTCERT"], str(ca_file))
            self.assertNotIn("BACKUP_ENCRYPTION_KEY", env)
            self.assertNotIn("BACKUP_R2_SECRET_ACCESS_KEY", env)
            self.assertIn("--single-transaction", argv)
            self.assertIn("--exit-on-error", argv)
            self.assertIn("--use-list", argv)
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
