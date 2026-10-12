import csv
import gzip
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "geonames-destination-parent-code-index.py"
spec = importlib.util.spec_from_file_location("destination_parent_code_index", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def candidate(gid, name, feature_class, feature_code, country="KE",
              admin1="", admin2="", admin3="", admin4="", country_id="192950",
              assignment="COUNTRYINFO_ALPHA2_MATCH_ONLY__NOT_AN_APPROVED_INTERNAL_LINK",
              record_status="candidate", disposition="CURRENT_PLACE_CANDIDATE",
              coordinate_status="VALID_WGS84", identity_status="SOURCE_ID_SHAPE_VALID__IDENTITY_REVIEW_PENDING"):
    return {
        "geonames_id": str(gid),
        "name": name,
        "feature_class": feature_class,
        "feature_code": feature_code,
        "source_country_code_raw": country,
        "country_info_geonames_id": country_id,
        "country_assignment_status": assignment,
        "raw_admin1_code": admin1,
        "raw_admin2_code": admin2,
        "raw_admin3_code": admin3,
        "raw_admin4_code": admin4,
        "source_disposition": disposition,
        "record_status_proposal": record_status,
        "coordinate_validation_status": coordinate_status,
        "source_record_identity_status": identity_status,
    }


def write_candidate_package(tmp, records):
    candidate_path = tmp / "worldwide-geonames-destination-candidates.csv.gz"
    fields = list(mod.REQUIRED_FIELDS)
    with gzip.open(candidate_path, "wt", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(records)
    size = candidate_path.stat().st_size
    digest = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
    summary = {
        "status": "PASS_SOURCE_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED",
        "sources": {
            "candidate_export_filename": candidate_path.name,
            "candidate_export_size_bytes": size,
            "candidate_export_sha256": digest,
            "geonames_allcountries_text_sha256": "a" * 64,
            "geonames_allcountries_archive_sha256": "b" * 64,
            "geonames_allcountries_retrieved_at_utc": "2026-10-12T00:00:00Z",
            "country_info_sha256": "c" * 64,
        },
        "counts": {
            "candidate_file_rows": len(records),
            "unique_candidate_source_ids": len(records),
            "duplicate_candidate_geonames_ids": 0,
            "invalid_candidate_ids": 0,
        },
    }
    summary_path = tmp / "candidate-summary.json"
    summary_path.write_text(json.dumps(summary), encoding="utf-8")
    return candidate_path, summary_path


class DestinationParentCodeIndexTests(unittest.TestCase):
    def test_exact_code_parent_candidates_are_country_scoped_and_review_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            rows = [
                candidate(10, "County A", "A", "ADM1", admin1="30"),
                candidate(20, "District A1", "A", "ADM2", admin1="30", admin2="001"),
                candidate(21, "District Alias 1", "A", "ADM2", admin1="30", admin2="999"),
                candidate(22, "District Alias 2", "A", "ADM2", admin1="30", admin2="999"),
                candidate(30, "District A2", "A", "ADM2", admin1="30", admin2="002"),
                candidate(100, "Nairobi Example", "P", "PPL", admin1="30", admin2="001"),
                candidate(101, "Missing Parent Example", "P", "PPL", admin1="30", admin2="888"),
                candidate(102, "Sentinel Example", "P", "PPL", admin1="00"),
                candidate(103, "No Admin Codes", "P", "PPL"),
                candidate(104, "Cross Country Namesake", "P", "PPL", country="GB", admin1="30", admin2="001",
                          country_id="2635167"),
                candidate(105, "Ambiguous Parent Example", "P", "PPL", admin1="30", admin2="999"),
                candidate(106, "Whitespace Admin Code", "P", "PPL", admin1=" "),
                candidate(107, "Whitespace Country Code", "P", "PPL", country=" ", admin1="30", admin2="001"),
            ]
            candidate_path, summary_path = write_candidate_package(tmp, rows)
            report, index_path, resolution_path, summary_out = mod.build_parent_code_index(
                candidate_path, summary_path, tmp / "out")
            self.assertEqual(report["status"], mod.CANDIDATE_STATUS)
            self.assertEqual(report["counts"]["candidate_source_rows"], len(rows))
            self.assertEqual(report["counts"]["parent_resolution_rows_written"], len(rows))
            self.assertEqual(report["counts"]["rows_not_accounted_for"], 0)
            self.assertEqual(report["counts"]["ambiguous_index_key_groups_by_level"]["2"], 1)
            self.assertEqual(report["counts"]["operational_parent_links_created"], 0)
            self.assertIs(report["counts"]["database_or_production_changes"], False)
            self.assertTrue(index_path.is_file())
            self.assertTrue(resolution_path.is_file())
            self.assertTrue(summary_out.is_file())

            with gzip.open(resolution_path, "rt", encoding="utf-8", newline="") as stream:
                resolved = {row["geonames_id"]: row for row in csv.DictReader(stream)}
            self.assertEqual(resolved["100"]["direct_parent_candidate_geonames_id"], "20")
            self.assertEqual(resolved["100"]["direct_parent_resolution_status"],
                             "UNIQUE_EXACT_SOURCE_CODE_PARENT_CANDIDATE__REVIEW_ONLY")
            self.assertEqual(json.loads(resolved["100"]["candidate_parent_path_geonames_ids_json"]),
                             ["192950", "10", "20"])
            self.assertEqual(resolved["100"]["candidate_parent_path_code_chain_complete"], "True")
            self.assertIn("COUNTRY_IDENTITY_REVIEW_REQUIRED", resolved["100"]["candidate_parent_path_status"])
            self.assertEqual(resolved["30"]["direct_parent_candidate_geonames_id"], "10")
            self.assertEqual(resolved["101"]["direct_parent_resolution_status"], "NO_EXACT_ADMIN_PARENT_KEY")
            self.assertIn("INCOMPLETE_NO_EXACT_ADMIN_PARENT_KEY_AT_ADMIN_LEVEL_2",
                          resolved["101"]["candidate_parent_path_status"])
            self.assertEqual(resolved["102"]["direct_parent_resolution_status"], "BLOCKED_RAW_ADMIN_CODE_00_SENTINEL")
            self.assertEqual(resolved["103"]["direct_parent_resolution_status"], "NO_SOURCE_ADMIN_CODE_ASSOCIATION")
            self.assertEqual(resolved["104"]["direct_parent_resolution_status"], "NO_EXACT_ADMIN_PARENT_KEY")
            self.assertEqual(resolved["105"]["direct_parent_resolution_status"], "AMBIGUOUS_EXACT_ADMIN_PARENT_KEY")
            self.assertEqual(json.loads(resolved["105"]["candidate_ids_for_direct_key_json"]), ["21", "22"])
            self.assertEqual(resolved["106"]["direct_parent_resolution_status"], "BLOCKED_RAW_ADMIN_CODE_GAP")
            self.assertEqual(resolved["107"]["direct_parent_resolution_status"], "BLOCKED_COUNTRY_CODE_MISSING")
            self.assertTrue(all(row["parent_link_created"] == "False" for row in resolved.values()))
            self.assertTrue(all(row["operational_selectable"] == "False" for row in resolved.values()))

    def test_rejects_candidate_export_sha_or_row_count_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            candidate_path, summary_path = write_candidate_package(
                tmp, [candidate(1, "City", "P", "PPL", admin1="01")])
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["sources"]["candidate_export_sha256"] = "0" * 64
            summary_path.write_text(json.dumps(summary), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "size/SHA-256"):
                mod.build_parent_code_index(candidate_path, summary_path, tmp / "out")

    def test_admin_key_index_never_uses_name_as_matching_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            rows = [
                candidate(10, "Same Name", "A", "ADM1", admin1="01"),
                candidate(11, "Same Name", "A", "ADM1", admin1="02"),
                candidate(20, "Different Name", "P", "PPL", admin1="01"),
            ]
            candidate_path, summary_path = write_candidate_package(tmp, rows)
            report, _, resolution_path, _ = mod.build_parent_code_index(candidate_path, summary_path, tmp / "out")
            with gzip.open(resolution_path, "rt", encoding="utf-8", newline="") as stream:
                resolved = {row["geonames_id"]: row for row in csv.DictReader(stream)}
            self.assertEqual(resolved["20"]["direct_parent_candidate_geonames_id"], "10")
            self.assertNotEqual(resolved["20"]["direct_parent_candidate_geonames_id"], "11")
            self.assertEqual(report["counts"]["operational_parent_links_created"], 0)


if __name__ == "__main__":
    unittest.main()
