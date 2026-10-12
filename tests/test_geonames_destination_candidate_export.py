import csv
import gzip
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "geonames-destination-candidate-export.py"
spec = importlib.util.spec_from_file_location("destination_export", SCRIPT)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def geonames_row(gid, name, feature_class, feature_code, country, admin1="", admin2="", admin3="", admin4="", latitude="0.0", longitude="0.0"):
    fields = [
        str(gid), name, name, "", str(latitude), str(longitude), feature_class, feature_code, country,
        "", admin1, admin2, admin3, admin4, "0", "", "0", "UTC", "20261011"
    ]
    assert len(fields) == 19
    return "\t".join(fields)


def country_info_row(alpha2, alpha3, numeric3, name, gid):
    fields = [alpha2, alpha3, numeric3, "", name, "", "", "", "", "", "", "", "", "", "", "", str(gid), "", ""]
    assert len(fields) == 19
    return "\t".join(fields)


class DestinationCandidateExportTests(unittest.TestCase):
    def test_candidate_export_is_row_complete_and_never_enables_selection(self):
        all_rows = [
            geonames_row(100, "Nairobi Test", "P", "PPL", "KE", "30", "001", "002", "003"),
            geonames_row(101, "Old Place Test", "P", "PPLH", "KE"),
            geonames_row(102, "Kenya Region Test", "A", "ADM1", "KE", "30"),
            geonames_row(103, "Unknown Admin Test", "A", "ADMD", "KE"),
            geonames_row(104, "Kosovo Town Test", "P", "PPLC", "XK"),
            geonames_row(105, "Antilles Old Place Test", "P", "PPL", "AN"),
            geonames_row(200, "Road Test", "R", "RD", "KE"),
            geonames_row(106, "", "P", "PPL", "KE"),
            geonames_row(107, "Bad Coordinate Test", "P", "PPL", "KE", latitude="95.0", longitude="181.0"),
            geonames_row(108, "No Coordinate Test", "P", "PPL", "KE", latitude="", longitude=""),
        ]
        all_text = "\n".join(all_rows) + "\n"
        country_text = "\n".join([
            country_info_row("KE", "KEN", "404", "Kenya", 192950),
            country_info_row("XK", "XKX", "0", "Kosovo", 831053),
            country_info_row("AN", "ANT", "530", "Netherlands Antilles", 8505032),
        ]) + "\n"
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            all_path = tmp / "allCountries.txt"
            country_path = tmp / "countryInfo.txt"
            all_path.write_text(all_text, encoding="utf-8")
            country_path.write_text(country_text, encoding="utf-8")
            all_sha = hashlib.sha256(all_path.read_bytes()).hexdigest()
            country_sha = hashlib.sha256(country_path.read_bytes()).hexdigest()
            country_manifest = tmp / "country-info-manifest.json"
            country_manifest.write_text(json.dumps({
                "manifest_version": 1,
                "remote_sources": [{
                    "source_role": "country-metadata",
                    "source_url": exporter.GEONAMES_URL if hasattr(exporter, "GEONAMES_URL") else "https://download.geonames.org/export/dump/countryInfo.txt",
                    "retrieved_at_utc": "2026-10-12T00:00:00Z",
                    "http_status": 200,
                    "sha256": country_sha,
                    "size_bytes": country_path.stat().st_size
                }]
            }), encoding="utf-8")
            master_report = tmp / "master.json"
            master_report.write_text(json.dumps({
                "status": "PASS_GEO_NAMES_COUNTRY_IDENTITY_WITH_REVIEW_ITEMS",
                "counts": {"all_countries_rows_scanned": len(all_rows)},
                "sources": {"all_countries_archive": {
                    "member_sha256": all_sha,
                    "sha256": "a" * 64,
                    "retrieved_at_utc": "2026-10-12T00:00:00Z"
                }}
            }), encoding="utf-8")
            output = tmp / "out"
            exception_manifest = ROOT / "docs" / "geonames-un-m49-exception-dispositions-2026-10-12.json"
            report, gz_path, report_path = exporter.export_candidates(
                all_path, country_path, country_manifest, master_report, exception_manifest, output
            )
            self.assertEqual(report["status"], "PASS_SOURCE_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED")
            self.assertEqual(report["counts"]["allcountries_source_rows_scanned"], 10)
            self.assertEqual(report["counts"]["destination_scope_rows"], 9)
            self.assertEqual(report["counts"]["candidate_file_rows"], 9)
            self.assertEqual(report["counts"]["operational_selectable_rows"], 0)
            self.assertEqual(report["counts"]["parent_links_created"], 0)
            self.assertEqual(report["counts"]["unique_candidate_source_ids"], 9)
            self.assertTrue(report_path.is_file())
            with gzip.open(gz_path, "rt", encoding="utf-8", newline="") as stream:
                records = list(csv.DictReader(stream))
            self.assertEqual(len(records), 9)
            by_id = {row["geonames_id"]: row for row in records}
            self.assertEqual(by_id["100"]["source_disposition"], "CURRENT_PLACE_CANDIDATE")
            self.assertEqual(by_id["101"]["source_disposition"], "HELD_HISTORICAL_OR_NONCURRENT_PLACE")
            self.assertEqual(by_id["102"]["source_disposition"], "CURRENT_ADMINISTRATIVE_AREA_CANDIDATE")
            self.assertEqual(by_id["103"]["source_disposition"], "HELD_HISTORICAL_OR_UNSPECIFIED_ADMIN_LEVEL")
            self.assertEqual(by_id["104"]["country_assignment_status"], "SOURCE_CODE_MATCHES_SPECIAL_DESTINATION_AREA__REVIEW_CROSSWALK")
            self.assertEqual(by_id["105"]["source_disposition"], "HELD_PARENT_COUNTRY_ENTITY_HISTORICAL")
            self.assertTrue(all(row["operational_selectable"] == "false" for row in records))
            self.assertTrue(all(row["parent_link_created"] == "false" for row in records))
            self.assertEqual(by_id["100"]["raw_admin4_code"], "003")
            self.assertEqual(by_id["100"]["parent_resolution_status"], "UNVERIFIED_RAW_CODES_ONLY")
            self.assertEqual(by_id["106"]["source_disposition"], "HELD_MISSING_CANONICAL_NAME")
            self.assertEqual(by_id["106"]["record_status_proposal"], "review_required")
            self.assertEqual(by_id["106"]["source_record_identity_status"], "BLOCKED_EMPTY_CANONICAL_NAME")
            self.assertEqual(by_id["107"]["source_disposition"], "HELD_INVALID_WGS84_COORDINATES")
            self.assertEqual(by_id["107"]["coordinate_validation_status"], "INVALID_WGS84")
            self.assertEqual(by_id["108"]["source_disposition"], "CURRENT_PLACE_CANDIDATE")
            self.assertEqual(by_id["108"]["coordinate_validation_status"], "MISSING_WGS84")
            self.assertEqual(report["counts"]["empty_canonical_name_rows"], 1)
            self.assertEqual(report["counts"]["invalid_coordinate_rows"], 1)
            self.assertEqual(report["counts"]["missing_coordinate_rows"], 1)
            self.assertEqual(report["counts"]["record_quality_hold_rows"], 2)


if __name__ == "__main__":
    unittest.main()
