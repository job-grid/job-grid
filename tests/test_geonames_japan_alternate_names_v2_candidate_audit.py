from __future__ import annotations
import csv, json, sys, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from geonames_japan_alternate_names_v2_candidate_audit import SOURCE_URL, build_report, sha256_path

class JapanAlternateNamesV2AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "alternateNamesV2.zip"
        self.targets = self.root / "owner-approved-dispositions.csv"
        self.manifest = self.root / "source-manifest.json"

    def tearDown(self):
        self.temp.cleanup()

    def write_target_csv(self):
        fields = ["geonames_id", "name", "country_code", "feature_code", "raw_admin1_code", "raw_admin2_code", "owner_approved_disposition"]
        with self.targets.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerow({"geonames_id": "1", "name": "Yao-chō", "country_code": "JP", "feature_code": "ADM4",
                             "raw_admin1_code": "00", "raw_admin2_code": "",
                             "owner_approved_disposition": "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED"})
            writer.writerow({"geonames_id": "2", "name": "Not selected", "country_code": "JP", "feature_code": "ADM3",
                             "raw_admin1_code": "00", "raw_admin2_code": "",
                             "owner_approved_disposition": "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED"})

    def write_archive_and_manifest(self, lines):
        source_text = "\n".join(lines) + "\n"
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("alternateNamesV2.txt", source_text)
        self.manifest.write_text(json.dumps({"manifest_version": 1, "remote_source": {
            "source_owner": "GeoNames", "source_url": SOURCE_URL, "retrieved_at_utc": "2026-10-12T00:00:00Z",
            "http_status": 200, "etag": '"fixture"', "archive_sha256": sha256_path(self.archive),
            "archive_size_bytes": self.archive.stat().st_size, "zip_crc_validation": "PASS",
            "member_name": "alternateNamesV2.txt", "member_uncompressed_size_bytes": len(source_text.encode("utf-8")),
        }}, indent=2), encoding="utf-8")

    def test_extracts_exact_id_japanese_aliases_only(self):
        self.write_target_csv()
        self.write_archive_and_manifest([
            "101\t1\tja\t八尾町\t1\t0\t0\t0\t\t",
            "102\t1\ten\tYao\t1\t0\t0\t0\t\t",
            "103\t1\t\t別八尾\t0\t0\t0\t0\t\t",
            "104\t2\tja\t別自治体\t1\t0\t0\t0\t\t",
        ])
        report = build_report(self.archive, self.targets, self.manifest, expected_target_count=1)
        self.assertEqual(report["status"], "PASS_SOURCE_PINNED_MULTILINGUAL_TARGET_ALIAS_EXTRACTION__CANDIDATES_ONLY__NO_PARENT_LINKS_APPROVED")
        self.assertEqual(report["target_count"], 1)
        self.assertEqual(report["summary"]["selected_japanese_alias_rows"], 2)
        self.assertEqual(report["summary"]["targets_with_selected_japanese_aliases"], 1)
        self.assertEqual([item["alternate_name"] for item in report["target_results"][0]["aliases"]], ["八尾町", "別八尾"])
        self.assertEqual(report["target_results"][0]["aliases"][0]["language_code"], "ja")
        self.assertEqual(report["operational_parent_links_created"], 0)
        self.assertFalse(report["database_or_production_changes"])

    def test_malformed_target_alias_fails_closed(self):
        self.write_target_csv()
        self.write_archive_and_manifest(["201\t1\tja\t八尾町\tbad-flag\t0\t0\t0\t\t"])
        with self.assertRaisesRegex(ValueError, "malformed alternate-name source rows attached to target IDs"):
            build_report(self.archive, self.targets, self.manifest, expected_target_count=1)

    def test_archive_manifest_hash_mismatch_fails_closed(self):
        self.write_target_csv()
        self.write_archive_and_manifest(["301\t1\tja\t八尾町\t1\t0\t0\t0\t\t"])
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["remote_source"]["archive_sha256"] = "0" * 64
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "SHA-256 differs"):
            build_report(self.archive, self.targets, self.manifest, expected_target_count=1)

if __name__ == "__main__":
    unittest.main()
