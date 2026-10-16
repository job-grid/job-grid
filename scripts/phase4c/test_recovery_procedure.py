import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from schema_inventory import sha256_json
from recovery_procedure import (
    ARTIFACTS,
    ARTIFACT_DUMP,
    ARTIFACT_DUMP_SHA,
    ARTIFACT_MANIFEST,
    ARTIFACT_MANIFEST_SHA,
    SUPABASE_MANAGED_SCHEMAS,
    RecoveryFailure,
    assert_application_restore_target_empty,
    assert_migration_history_matches,
    assert_publications_unchanged,
    assert_schema_inventory_matches,
    classify_pg_restore_failure,
    restore_backup,
    validate_manifest_migration_state,
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
            (b'pg_restore: error: relation "app_data" does not exist', "restore_dependency_missing_relation"),
            (b'pg_restore: error: schema "auth" does not exist', "restore_dependency_missing_schema_auth"),
            (b'pg_restore: error: schema "supabase_migrations" does not exist', "restore_dependency_missing_schema_supabase_migrations"),
            (b'pg_restore: error: schema "private_schema" does not exist', "restore_dependency_missing_schema_other"),
            (b'pg_restore: error: function "private_fn" does not exist', "restore_dependency_missing_routine"),
            (b'pg_restore: error: type "private_type" does not exist', "restore_dependency_missing_type"),
            (b'pg_restore: error: extension "private_extension" does not exist', "restore_dependency_missing_extension"),
            (b'pg_restore: error: operator "private_operator" does not exist', "restore_dependency_missing_operator"),
            (b'pg_restore: error: language "private_language" does not exist', "restore_dependency_missing_language"),
            (b'pg_restore: error: schema "public" already exists', "restore_schema_already_exists_public"),
            (b'pg_restore: error: schema "supabase_migrations" already exists', "restore_schema_already_exists_supabase_migrations"),
            (b'pg_restore: error: schema "auth" already exists', "restore_schema_already_exists_auth"),
            (b'pg_restore: error: schema "sensitive_schema_name" already exists', "restore_schema_already_exists_other"),
            (b'pg_restore: error: extension "pgcrypto" already exists', "restore_extension_already_exists"),
            (b'pg_restore: error: relation "jobs" already exists', "restore_relation_already_exists"),
            (b'pg_restore: error: function "touch_updated_at" already exists', "restore_routine_conflict"),
            (b'pg_restore: error: trigger "jobs_touch" already exists', "restore_trigger_conflict"),
            (b'pg_restore: error: policy "jobs_read" already exists', "restore_policy_conflict"),
            (b'pg_restore: error: type "job_status" already exists', "restore_type_conflict"),
            (b'pg_restore: error: object already exists', "restore_object_conflict_unclassified"),
            (b'pg_restore: error: duplicate key value violates unique constraint "jobs_pkey"', "restore_constraint_conflict"),
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
                    "stdout": (
                        b"; archive header\n"
                        b"1; 2615 2200 SCHEMA - public postgres\n"
                        b"2; 1259 30000 TABLE public jobs postgres\n"
                        b"3; 1259 30001 INDEX public jobs_pkey postgres\n"
                        b"4; 2606 30002 CONSTRAINT public jobs jobs_pkey postgres\n"
                        b"5; 1255 30003 FUNCTION public rls_auto_enable() postgres\n"
                        b"6; 1255 30004 FUNCTION public app_function() postgres\n"
                        b"7; 2620 30005 TRIGGER public jobs ensure_job_policy postgres\n"
                        b"8; 3256 30006 POLICY public jobs public_jobs_select postgres\n"
                        b"9; 1259 30007 SEQUENCE public jobs_id_seq postgres\n"
                        b"10; 1247 30008 TYPE public job_status postgres\n"
                        b"11; 0 0 ACL public FUNCTION rls_auto_enable() postgres\n"
                        b"12; 0 0 ACL public TABLE jobs postgres\n"
                        b"13; 2615 4000 SCHEMA - supabase_migrations postgres\n"
                        b"14; 1259 4001 TABLE supabase_migrations.schema_migrations postgres\n"
                    ),
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


class RecoveryManifestInventoryTests(unittest.TestCase):
    def _state(self, items=None):
        if items is None:
            items = [
                {"kind": "relation", "schema_name": "public", "object_name": "job_categories", "relkind": "r"},
                {"kind": "relation", "schema_name": "supabase_migrations", "object_name": "schema_migrations", "relkind": "r"},
            ]
        versions = [{"version": "20261014120000", "name": "job_catalog_baseline"}]
        history = {
            "present": True,
            "row_count": 1,
            "versions": versions,
            "latest_migration": versions[-1],
            "rows_sha256": "a" * 64,
        }
        return {
            "latest_migration": versions[-1],
            "migration_history": history,
            "schema_inventory": {
                "items": items,
                "item_count": len(items),
                "counts_by_kind": {"relation": len(items)},
                "sha256": sha256_json(items),
            },
        }

    def test_complete_manifest_inventory_is_accepted(self):
        state = self._state()
        validated = validate_manifest_migration_state(json.dumps(state))
        self.assertEqual(validated["schema_inventory"]["item_count"], 2)
        self.assertTrue(validated["migration_history"]["present"])

    def test_legacy_or_missing_inventory_is_rejected(self):
        with self.assertRaises(RecoveryFailure) as ctx:
            validate_manifest_migration_state(json.dumps({"latest_migration": None}))
        self.assertEqual(str(ctx.exception), "RECOVERY_MANIFEST_INVENTORY_MISSING")

    def test_tampered_inventory_digest_is_rejected(self):
        state = self._state()
        state["schema_inventory"]["sha256"] = "0" * 64
        with self.assertRaises(RecoveryFailure) as ctx:
            validate_manifest_migration_state(json.dumps(state))
        self.assertEqual(str(ctx.exception), "RECOVERY_MANIFEST_INVENTORY_FAILED")

    def test_inventory_without_application_tables_is_rejected(self):
        state = self._state([
            {"kind": "relation", "schema_name": "supabase_migrations", "object_name": "schema_migrations", "relkind": "r"}
        ])
        state["schema_inventory"]["counts_by_kind"] = {"relation": 1}
        state["schema_inventory"]["item_count"] = 1
        state["schema_inventory"]["sha256"] = sha256_json(state["schema_inventory"]["items"])
        with self.assertRaises(RecoveryFailure) as ctx:
            validate_manifest_migration_state(json.dumps(state))
        self.assertEqual(str(ctx.exception), "RECOVERY_MANIFEST_INVENTORY_INCOMPLETE")

    def test_schema_definition_or_grant_inventory_mismatch_fails(self):
        expected = {
            "items": [{"kind": "grant", "schema_name": "public", "grantee": "authenticated", "privilege_type": "SELECT"}],
            "item_count": 1,
            "counts_by_kind": {"grant": 1},
            "sha256": sha256_json([{"kind": "grant", "schema_name": "public", "grantee": "authenticated", "privilege_type": "SELECT"}]),
        }
        assert_schema_inventory_matches(expected, dict(expected))
        changed_items = [{"kind": "grant", "schema_name": "public", "grantee": "authenticated", "privilege_type": "INSERT"}]
        changed = {
            "items": changed_items,
            "item_count": 1,
            "counts_by_kind": {"grant": 1},
            "sha256": sha256_json(changed_items),
        }
        with self.assertRaises(RecoveryFailure) as ctx:
            assert_schema_inventory_matches(expected, changed)
        self.assertEqual(str(ctx.exception), "RECOVERY_SCHEMA_INVENTORY_MISMATCH")

    def test_any_migration_ledger_row_change_fails(self):
        expected = {
            "present": True,
            "row_count": 2,
            "versions": [{"version": "001", "name": "a"}, {"version": "002", "name": "b"}],
            "latest_migration": {"version": "002", "name": "b"},
            "rows_sha256": "a" * 64,
        }
        assert_migration_history_matches(expected, dict(expected))
        changed = dict(expected, rows_sha256="b" * 64)
        with self.assertRaises(RecoveryFailure) as ctx:
            assert_migration_history_matches(expected, changed)
        self.assertEqual(str(ctx.exception), "RECOVERY_MIGRATION_HISTORY_MISMATCH")

    def test_publications_must_remain_unchanged(self):
        original = [{"pubname": "supabase_realtime", "puballtables": False, "tables": []}]
        assert_publications_unchanged(original, list(original))
        changed = [{"pubname": "supabase_realtime", "puballtables": True, "tables": []}]
        with self.assertRaises(RecoveryFailure) as ctx:
            assert_publications_unchanged(original, changed)
        self.assertEqual(str(ctx.exception), "RECOVERY_PUBLICATION_STATE_CHANGED")


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
            self.assertGreaterEqual(cursor.execute.call_count, 1)
            query = cursor.execute.call_args_list[0].args[0].lower()
            self.assertIn("select", query)
            self.assertNotIn("delete", query)
            self.assertNotIn("truncate", query)

    def test_public_app_function_custom_type_and_unknown_schema_are_rejected(self):
        for row in (
            (False, True, False, False),
            (False, False, True, False),
            (False, False, False, True),
        ):
            with self.subTest(row=row), tempfile.TemporaryDirectory() as temp:
                ca_file = Path(temp) / "recovery-root-ca.crt"
                ca_file.write_text("synthetic CA fixture", encoding="utf-8")
                connection = self._connection(row)
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

    def test_existing_migration_ledger_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            ca_file = Path(temp) / "recovery-root-ca.crt"
            ca_file.write_text("synthetic CA fixture", encoding="utf-8")
            connection = self._connection((False, False, False, True))
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
    def test_optional_object_types_can_be_zero_when_required_tables_exist(self):
        counts = validate_schema_counts((1, 0, 0, 0, 0, 0, 0, 0, 1))
        self.assertEqual(counts["tables"], 1)
        self.assertEqual(counts["triggers"], 0)
        self.assertEqual(counts["rls"], 0)
        self.assertEqual(counts["policies"], 0)
        self.assertEqual(counts["migration_table"], 1)

    def test_migration_ledger_alone_cannot_pass_without_application_tables(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 0, 0, 0, 0, 0, 0, 0, 1))

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
                b"5; 1259 30002 INDEX public jobs_pkey postgres\n"
                b"6; 2606 30003 CONSTRAINT public jobs jobs_pkey postgres\n"
                b"7; 1255 30004 FUNCTION public rls_auto_enable() postgres\n"
                b"8; 1255 30005 FUNCTION public app_function() postgres\n"
                b"9; 2620 30006 TRIGGER public jobs ensure_job_policy postgres\n"
                b"10; 3256 30007 POLICY public jobs public_jobs_select postgres\n"
                b"11; 1259 30008 SEQUENCE public jobs_id_seq postgres\n"
                b"12; 1247 30009 TYPE public job_status postgres\n"
                b"13; 0 0 ACL public FUNCTION rls_auto_enable() postgres\n"
                b"14; 0 0 ACL public TABLE jobs postgres\n"
                b"4; 2615 4000 SCHEMA - supabase_migrations postgres\n"
                b"15; 1259 4001 TABLE supabase_migrations.schema_migrations postgres\n"
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
            self.assertNotIn("SCHEMA - supabase_migrations", toc_text)
            for managed_schema in ("auth", "storage", "realtime", "extensions", "graphql", "graphql_public", "pgbouncer", "vault"):
                self.assertNotIn(f"SCHEMA - {managed_schema}", toc_text)
            self.assertIn("TABLE supabase_migrations.schema_migrations", toc_text)
            self.assertNotIn("FUNCTION public rls_auto_enable()", toc_text)
            self.assertNotIn("ACL public FUNCTION rls_auto_enable()", toc_text)
            self.assertIn("TABLE public job_categories", toc_text)
            self.assertIn("TABLE public country_options", toc_text)
            self.assertIn("INDEX public jobs_pkey", toc_text)
            self.assertIn("CONSTRAINT public jobs jobs_pkey", toc_text)
            self.assertIn("FUNCTION public app_function()", toc_text)
            self.assertIn("TRIGGER public jobs ensure_job_policy", toc_text)
            self.assertIn("POLICY public jobs public_jobs_select", toc_text)
            self.assertIn("SEQUENCE public jobs_id_seq", toc_text)
            self.assertIn("TYPE public job_status", toc_text)
            self.assertIn("ACL public TABLE jobs", toc_text)
            self.assertNotIn("SCHEMA - supabase_migrations", toc_text)
            self.assertIn("TABLE supabase_migrations.schema_migrations", toc_text)
            self.assertEqual(env["PGSSLMODE"], "verify-full")
            self.assertEqual(env["PGSSLROOTCERT"], str(ca_file))
            self.assertNotIn("BACKUP_ENCRYPTION_KEY", env)
            self.assertNotIn("BACKUP_R2_SECRET_ACCESS_KEY", env)
            self.assertIn("--single-transaction", argv)
            self.assertIn("--exit-on-error", argv)
            self.assertIn("--no-publications", argv)
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
