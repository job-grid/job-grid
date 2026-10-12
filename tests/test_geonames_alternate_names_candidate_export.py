import csv
import gzip
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "geonames-alternate-names-candidate-export.py"
spec = importlib.util.spec_from_file_location("alternate_names_export", SCRIPT)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def alt_row(aid, gid, lang, name, flags=("0","0","0","0"), start="", end=""):
    return "\t".join([str(aid),str(gid),lang,name,*flags,start,end])


def candidate_row(gid, name, country):
    fields = ["geonames_id","name","source_country_code_raw"]
    return {"geonames_id":str(gid),"name":name,"source_country_code_raw":country}


class AlternateNameExporterTests(unittest.TestCase):
    def test_exports_all_aliases_for_candidate_ids_and_counts_language_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            candidates=tmp/"candidates.csv.gz"
            with gzip.open(candidates,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"]); w.writeheader()
                w.writerows([candidate_row(100,"Nairobi","KE"),candidate_row(101,"Kisumu","KE"),candidate_row(200,"London","GB")])
            aliases=[
                alt_row(1,100,"en","Nairobi"),
                alt_row(2,100,"sw","Nairobi"),
                alt_row(3,101,"en","Kisumu",("1","0","0","0"),"2000",""),
                alt_row(4,999,"en","not in scope"),
                alt_row(5,200,"en","London"),
            ]
            archive=tmp/"alternateNamesV2.zip"
            member="\n".join(aliases)+"\n"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
                z.writestr("alternateNamesV2.txt",member)
            data=archive.read_bytes()
            manifest=tmp/"manifest.json"
            manifest.write_text(json.dumps({"remote_source":{
                "source_url":exporter.SOURCE_URL,"retrieved_at_utc":"2026-10-12T00:00:00Z",
                "http_status":200,"size_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),
                "zip_crc_validation":"PASS","http_last_modified_header":"test","etag":"test"
            }}),encoding="utf-8")
            report, out, summary = exporter.export_aliases(candidates,archive,manifest,tmp/"out")
            self.assertEqual(report["status"],"PASS_ALIAS_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED")
            self.assertEqual(report["counts"]["alternate_names_source_rows_scanned"],5)
            self.assertEqual(report["counts"]["candidate_ids_with_aliases"],3)
            self.assertEqual(report["counts"]["candidate_ids_without_aliases"],0)
            self.assertEqual(report["counts"]["matching_alias_rows_exported"],4)
            self.assertEqual(report["counts"]["language_codes_in_export"],2)
            with gzip.open(out,"rt",encoding="utf-8",newline="") as f:
                rows=list(csv.DictReader(f))
            self.assertEqual(len(rows),4)
            self.assertNotIn("999",{r["geonames_id"] for r in rows})
            sw=next(r for r in rows if r["language_code"]=="sw")
            self.assertEqual(sw["alternate_name"],"Nairobi")
            self.assertEqual(sw["source_snapshot_sha256"],hashlib.sha256(data).hexdigest())
            kisumu=next(r for r in rows if r["geonames_id"]=="101")
            self.assertEqual(kisumu["valid_from"],"2000")
            self.assertEqual(kisumu["valid_to"],"")

    def test_rejects_candidate_export_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); cand=p/"c.csv.gz"
            with gzip.open(cand,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"]);w.writeheader()
                w.writerows([candidate_row(1,"A","KE"),candidate_row(1,"Again","KE")])
            with self.assertRaisesRegex(ValueError,"duplicate GeoNames ID"):
                exporter.read_candidate_scope(cand)

    def test_rejects_aliases_with_invalid_boolean_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); cand=p/"c.csv.gz"
            with gzip.open(cand,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"]);w.writeheader();w.writerow(candidate_row(1,"A","KE"))
            archive=p/"alternateNamesV2.zip"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:z.writestr("alternateNamesV2.txt",alt_row(1,1,"en","A",("yes","0","0","0"))+"\n")
            raw=archive.read_bytes()
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"remote_source":{"source_url":exporter.SOURCE_URL,"retrieved_at_utc":"now","http_status":200,"size_bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"zip_crc_validation":"PASS"}}),encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"boolean flags invalid"):
                exporter.export_aliases(cand,archive,manifest,p/"out")


if __name__=="__main__":
    unittest.main()
