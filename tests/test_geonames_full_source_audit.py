import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "geonames-full-source-audit.py"
SPEC = importlib.util.spec_from_file_location("geonames_full_source_audit", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

def place(gid, name, country, feature_class, feature_code, admin1="", admin2=""):
    fields = [str(gid), name, name, "", "1.0", "2.0", feature_class, feature_code, country, "", admin1, admin2, "", "", "0", "", "0", "UTC", "2026-10-12"]
    assert len(fields) == 19
    return "\t".join(fields) + "\n"

def archive(path, member, content):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as handle:
        handle.writestr(member, content.encode("utf-8"))

class FullGeoNamesAuditTests(unittest.TestCase):
    def test_measures_four_files_and_counts_aliases_without_creating_catalog_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            root, output = Path(temp) / "source", Path(temp) / "out"
            root.mkdir()
            archive(root / "allCountries.zip", "allCountries.txt",
                    place(100, "Kisumu", "KE", "P", "PPLA", "26", "191242")
                    + place(101, "Japan place", "JP", "P", "PPL", "01", "999999")
                    + place(102, "Historical", "JP", "P", "PPLH", "01", "999999"))
            archive(root / "alternateNamesV2.zip", "alternateNamesV2.txt",
                    "1\t100\ten\tKisumu\t1\t0\t0\t0\t\t\n"
                    "2\t101\tja\tSample alias\t0\t0\t0\t0\t\t\n"
                    "3\t999\ten\tUnresolved target\t0\t0\t0\t1\t\t\n")
            (root / "admin1CodesASCII.txt").write_text("KE.26\tKisumu County\tKisumu County\t191242\nJP.01\tExample Region\tExample Region\t200001\n", encoding="utf-8")
            (root / "admin2Codes.txt").write_text("KE.26.191242\tKisumu subunit\tKisumu subunit\t191242\n", encoding="utf-8")
            report = MODULE.audit(root, output, "2026-10-13T00:00:00Z")
            self.assertEqual(report["all_countries"]["physical_rows"], 3)
            self.assertEqual(report["all_countries"]["unique_valid_geoname_ids"], 3)
            self.assertEqual(report["all_countries"]["current_populated_place_candidate_rows"], 2)
            self.assertEqual(report["all_countries"]["kenya"]["all_rows"], 1)
            self.assertEqual(report["all_countries"]["japan"]["all_rows"], 2)
            self.assertEqual(report["alternate_names"]["physical_rows"], 3)
            self.assertEqual(report["alternate_names"]["english_language_rows"], 2)
            self.assertEqual(report["alternate_names"]["target_geoname_id_not_found_in_allCountries_snapshot"], 1)
            self.assertEqual(report["all_countries"]["admin1_reference_keys_not_found"], 0)
            self.assertGreaterEqual(report["all_countries"]["admin2_reference_keys_not_found"], 1)
            self.assertEqual(report["decision_boundary"]["database_writes"], 0)
            self.assertTrue((output / "geonames-full-source-audit.json").is_file())
            self.assertTrue((output / "geonames-full-source-audit.md").is_file())

    def test_missing_source_files_do_not_become_false_zero_counts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            root.mkdir()
            with self.assertRaises(FileNotFoundError):
                MODULE.audit(root, Path(temp) / "out")

    def test_wrong_zip_member_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            root.mkdir()
            archive(root / "allCountries.zip", "wrong.txt", "")
            archive(root / "alternateNamesV2.zip", "alternateNamesV2.txt", "")
            (root / "admin1CodesASCII.txt").write_text("", encoding="utf-8")
            (root / "admin2Codes.txt").write_text("", encoding="utf-8")
            with self.assertRaises(ValueError):
                MODULE.audit(root, Path(temp) / "out")

if __name__ == "__main__":
    unittest.main()
