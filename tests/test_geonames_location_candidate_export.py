import csv
import gzip
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "geonames-location-candidate-export.py"
SPEC = importlib.util.spec_from_file_location("geonames_location_candidate_export", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

def row(gid, name, country, fclass, fcode, a1="", a2="", lat="1.0", lon="2.0"):
    fields = [str(gid), name, name, "", lat, lon, fclass, fcode, country, "", a1, a2, "", "", "42", "", "0", "UTC", "2026-10-12"]
    assert len(fields) == 19
    return "\t".join(fields) + "\n"

def make_zip(path, member, text):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(member, text.encode("utf-8"))

class LocationCandidateExportTests(unittest.TestCase):
    def fixture(self, root):
        make_zip(root / "allCountries.zip", "allCountries.txt",
                 row(10, "Kisumu", "KE", "P", "PPLA", "26", "191242")
                 + row(11, "Kyoto", "JP", "P", "PPL", "26", "191242")
                 + row(12, "Old place", "JP", "P", "PPLH", "26", "191242")
                 + row(13, "Non-place", "KE", "A", "ADM1", "26", "191242")
                 + row(14, "Missing coordinate place", "KE", "P", "PPL", "99", "999999", "", ""))
        make_zip(root / "alternateNamesV2.zip", "alternateNamesV2.txt",
                 "100\t10\ten\tKisumu City\t1\t0\t0\t0\t\t\n"
                 "101\t11\tja\tKyoto alias\t0\t0\t0\t0\t\t\n"
                 "102\t12\ten\tHistorical alias\t0\t0\t0\t1\t\t\n"
                 "103\t999\ten\tUnknown target\t0\t0\t0\t0\t\t\n")
        (root / "admin1CodesASCII.txt").write_text("KE.26\tKisumu County\tKisumu County\t191242\nJP.26\tSample Prefecture\tSample Prefecture\t200001\n",encoding="utf-8")
        (root / "admin2Codes.txt").write_text("KE.26.191242\tSubunit\tSubunit\t191242\nJP.26.191242\tSubunit JP\tSubunit JP\t200002\n",encoding="utf-8")

    def test_candidate_export_scopes_by_country_and_feature_code_and_keeps_unknown_parents_optional(self):
        with tempfile.TemporaryDirectory() as temp:
            root, out = Path(temp)/"in", Path(temp)/"out"
            root.mkdir()
            self.fixture(root)
            report = MODULE.build(root, out)
            with gzip.open(out/"location-candidates.csv.gz","rt",encoding="utf-8",newline="") as stream:
                candidates = list(csv.DictReader(stream))
            self.assertEqual([x["geoname_id"] for x in candidates], ["10","11","14"])
            self.assertEqual(candidates[0]["country_code"], "KE")
            self.assertEqual(candidates[0]["admin1_name"], "Kisumu County")
            self.assertEqual(candidates[2]["admin1_name"], "")
            self.assertEqual(candidates[2]["latitude"], "")
            self.assertEqual(candidates[2]["longitude"], "")
            self.assertEqual(report["candidate_export"]["candidate_rows_written"], 3)
            self.assertEqual(report["release_boundary"]["live_database_writes"], 0)
            self.assertEqual(report["release_boundary"]["parent_links_approved"], 0)

    def test_aliases_only_attach_to_candidate_place_ids_and_preserve_historic_flag(self):
        with tempfile.TemporaryDirectory() as temp:
            root, out = Path(temp)/"in", Path(temp)/"out"
            root.mkdir()
            self.fixture(root)
            report = MODULE.build(root, out)
            with gzip.open(out/"location-alternate-names.csv.gz","rt",encoding="utf-8",newline="") as stream:
                aliases = list(csv.DictReader(stream))
            self.assertEqual([x["geoname_id"] for x in aliases], ["10","11"])
            self.assertEqual(aliases[0]["is_preferred"], "true")
            self.assertEqual(aliases[1]["language"], "ja")
            self.assertEqual(report["alternate_name_export"]["rows_skipped_because_target_not_in_place_candidates"], 2)

    def test_missing_source_blocks_and_does_not_claim_zero_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            root, out = Path(temp)/"in", Path(temp)/"out"
            root.mkdir()
            with self.assertRaises(FileNotFoundError):
                MODULE.build(root,out)

if __name__ == "__main__":
    unittest.main()
