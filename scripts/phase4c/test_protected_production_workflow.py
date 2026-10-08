import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).parents[2] / ".github" / "workflows" / "phase4c-protected-production-backup.yml"


class ProtectedProductionWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_manual_dispatch_only(self):
        self.assertIn("on:\n  workflow_dispatch:", self.workflow)
        for trigger in ("  push:", "  pull_request:", "  schedule:"):
            self.assertNotIn(trigger, self.workflow)

    def test_protected_environment(self):
        self.assertIn("name: phase4c-production-approved", self.workflow)
        self.assertIn("deployment: false", self.workflow)

    def test_expected_environment_secrets_only(self):
        expected = {
            "BACKUP_SOURCE_POSTGRES_PROJECT_REF",
            "BACKUP_SOURCE_POSTGRES_HOST",
            "BACKUP_SOURCE_POSTGRES_PORT",
            "BACKUP_SOURCE_POSTGRES_DB",
            "BACKUP_SOURCE_POSTGRES_USER",
            "BACKUP_SOURCE_POSTGRES_PASSWORD",
            "BACKUP_SOURCE_POSTGRES_MAJOR_VERSION",
            "BACKUP_R2_ACCESS_KEY_ID",
            "BACKUP_R2_SECRET_ACCESS_KEY",
            "BACKUP_ENCRYPTION_KEY",
        }
        self.assertEqual(set(re.findall(r"secrets\.([A-Z0-9_]+)", self.workflow)), expected)
        self.assertNotIn("AWS_ACCESS_KEY_ID", self.workflow)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", self.workflow)

    def test_executor_authorization_boundary(self):
        for line in (
            'GITHUB_ACTIONS: "true"',
            "GITHUB_ENVIRONMENT: phase4c-production-approved",
            "GITHUB_EVENT_NAME: workflow_dispatch",
            'PHASE4C_BACKUP_AUTHORIZED: "true"',
        ):
            self.assertIn(line, self.workflow)

    def test_pinned_destination_and_single_dump_job(self):
        self.assertIn("BACKUP_R2_ENDPOINT_URL: https://6952ddf46cc39605326ecf0583cde02e.r2.cloudflarestorage.com", self.workflow)
        self.assertIn("BACKUP_R2_BUCKET: job-grid-backups", self.workflow)
        self.assertIn('BACKUP_DUMP_JOBS: "1"', self.workflow)

    def test_exactly_one_backup_invocation_and_no_retry(self):
        self.assertEqual(self.workflow.count("python -m backup_executor --backup"), 1)
        self.assertNotIn("retry", self.workflow.lower())
        self.assertNotIn("rerun", self.workflow.lower())

    def test_no_restore_schedule_or_deployment(self):
        lower = self.workflow.lower()
        for forbidden in ("pg_restore", "supabase db", "wrangler deploy", "npm run deploy"):
            self.assertNotIn(forbidden, lower)

    def test_only_encrypted_r2_artifacts_no_github_artifact_upload(self):
        self.assertNotIn("actions/upload-artifact", self.workflow)
        self.assertNotIn("upload-artifact", self.workflow)

    def test_failure_cannot_be_marked_success(self):
        self.assertIn("if: success()", self.workflow)
        self.assertIn("if: failure()", self.workflow)
        self.assertIn("exit 1", self.workflow)

    def test_sensitive_values_are_not_printed(self):
        for forbidden in ("env |", "printenv", "echo BACKUP_SOURCE_POSTGRES_PASSWORD", "echo BACKUP_ENCRYPTION_KEY"):
            self.assertNotIn(forbidden, self.workflow)


if __name__ == "__main__":
    unittest.main()
