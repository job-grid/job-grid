import base64
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


def country_info_row(alpha2, alpha3, numeric3, name, gid):
    fields=[alpha2,alpha3,numeric3,"",name,"","","","","","","","","","","",str(gid),"",""]
    return "\t".join(fields)


def write_country_info_sources(tmp, rows):
    path=tmp/"countryInfo.txt"
    path.write_text("\n".join(rows)+"\n",encoding="utf-8")
    raw=path.read_bytes()
    manifest=tmp/"country-manifest.json"
    manifest.write_text(json.dumps({"manifest_version":1,"remote_sources":[{
        "source_role":"country-metadata",
        "source_url":exporter.COUNTRY_INFO_URL,
        "retrieved_at_utc":"2026-10-12T00:00:00Z",
        "http_status":200,
        "sha256":hashlib.sha256(raw).hexdigest(),
        "size_bytes":len(raw)
    }]}),encoding="utf-8")
    return path,manifest


class AlternateNameExporterTests(unittest.TestCase):
    def test_exports_all_aliases_for_candidate_ids_and_counts_language_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            candidates=tmp/"candidates.csv.gz"
            with gzip.open(candidates,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"]); w.writeheader()
                w.writerows([candidate_row(100,"Nairobi","KE"),candidate_row(101,"Kisumu","KE"),candidate_row(102,"Unaliased Place","KE"),candidate_row(200,"London","GB"),candidate_row(300,"Unknown Code Locality","")])
            country_info,country_manifest=write_country_info_sources(tmp,[
                country_info_row("KE","KEN","404","Kenya","192950"),
                country_info_row("XK","XKX","0","Kosovo","831053"),
                country_info_row("AN","ANT","530","Netherlands Antilles","8505032"),
            ])
            aliases=[
                alt_row(1,100,"en","Nairobi"),
                alt_row(2,100,"sw","Nairobi"),
                alt_row(3,101,"en","Kisumu",("1","0","0","0"),"2000",""),
                alt_row(4,831053,"sq","Kosova"),
                alt_row(5,999,"en","not in scope"),
                alt_row(6,200,"en","London"),
                alt_row(7,300,"und","Unknown Code Locality"),
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
            report, out, summary = exporter.export_aliases(candidates,country_info,country_manifest,archive,manifest,tmp/"out")
            self.assertEqual(report["status"],"PASS_ALIAS_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED")
            self.assertEqual(report["counts"]["alternate_names_source_rows_scanned"],7)
            self.assertEqual(report["counts"]["destination_candidate_ids"],5)
            self.assertEqual(report["counts"]["country_area_source_ids"],3)
            self.assertEqual(report["counts"]["source_scope_record_ids"],8)
            self.assertEqual(report["counts"]["candidate_ids_with_aliases"],4)
            self.assertEqual(report["counts"]["candidate_ids_without_aliases"],1)
            self.assertEqual(report["counts"]["country_area_source_ids_with_aliases"],1)
            self.assertEqual(report["counts"]["country_area_source_ids_without_aliases"],2)
            self.assertEqual(report["counts"]["source_scope_ids_with_aliases"],5)
            self.assertEqual(report["counts"]["source_scope_ids_without_aliases"],3)
            self.assertEqual(report["counts"]["matching_alias_rows_exported"],6)
            self.assertEqual(report["counts"]["language_codes_in_export"],4)
            country_coverage={r["source_country_alpha2_raw"]:r for r in report["per_country_area_alpha2"]}
            self.assertEqual(set(country_coverage),{"KE","XK","AN"})
            self.assertEqual(country_coverage["XK"]["source_scope_records_with_aliases"],1)
            self.assertEqual(country_coverage["KE"]["source_scope_records_without_aliases"],1)
            self.assertEqual(country_coverage["AN"]["alias_coverage_ratio"],0.0)
            with gzip.open(out,"rt",encoding="utf-8",newline="") as f:
                rows=list(csv.DictReader(f))
            self.assertEqual(len(rows),6)
            self.assertNotIn("999",{r["geonames_id"] for r in rows})
            sw=next(r for r in rows if r["language_code"]=="sw")
            self.assertEqual(sw["alternate_name"],"Nairobi")
            self.assertEqual(sw["source_snapshot_sha256"],hashlib.sha256(data).hexdigest())
            country_alias=next(r for r in rows if r["geonames_id"]=="831053")
            self.assertEqual(country_alias["record_scope_kind"],"country_area")
            self.assertEqual(country_alias["source_country_code_raw"],"XK")
            blank_code_alias=next(r for r in rows if r["geonames_id"]=="300")
            self.assertEqual(blank_code_alias["record_scope_kind"],"destination_place_or_admin")
            self.assertEqual(blank_code_alias["source_country_code_raw"],"")
            blank_bucket=next(r for r in report["per_source_country_code"] if r["source_country_code_bucket"]=="(blank)")
            self.assertEqual(blank_bucket["source_country_code_raw"],"")
            self.assertEqual(blank_bucket["source_scope_records_with_aliases"],1)
            kisumu=next(r for r in rows if r["geonames_id"]=="101")
            self.assertEqual(kisumu["record_scope_kind"],"destination_place_or_admin")
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

    def test_quarantines_aliases_with_invalid_boolean_flags_instead_of_exporting_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); cand=p/"c.csv.gz"
            with gzip.open(cand,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"]);w.writeheader()
                w.writerows([candidate_row(1,"A","KE"),candidate_row(2,"B","KE")])
            archive=p/"alternateNamesV2.zip"
            payload="\n".join([
                alt_row(1,1,"en","A",("yes","0","0","0")),
                alt_row(2,2,"en","B"),
            ])+"\n"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:z.writestr("alternateNamesV2.txt",payload)
            raw=archive.read_bytes()
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"remote_source":{"source_url":exporter.SOURCE_URL,"retrieved_at_utc":"now","http_status":200,"size_bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"zip_crc_validation":"PASS"}}),encoding="utf-8")
            ci,cm=write_country_info_sources(p,[country_info_row("GB","GBR","826","United Kingdom","99")])
            report,out,summary=exporter.export_aliases(cand,ci,cm,archive,manifest,p/"out")
            self.assertEqual(report["status"],"PASS_ALIAS_SCOPE_RECONCILED_WITH_QUARANTINE__CANDIDATES_ONLY__NOT_IMPORTED")
            self.assertEqual(report["counts"]["invalid_boolean_flag_rows"],1)
            self.assertEqual(report["counts"]["quarantined_source_rows"],1)
            with gzip.open(out,"rt",encoding="utf-8",newline="") as stream:
                exported=list(csv.DictReader(stream))
            self.assertEqual([row["geonames_id"] for row in exported],["2"])
            quarantine=Path(p/"out"/"worldwide-geonames-country-and-destination-alternate-name-quarantine.csv")
            with quarantine.open(encoding="utf-8",newline="") as stream:
                rows=list(csv.DictReader(stream))
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]["reason_code"],"INVALID_BOOLEAN_FLAGS")
            self.assertEqual(rows[0]["geonames_id_candidate"],"1")
            self.assertEqual(base64.b64decode(rows[0]["raw_line_base64"]).decode("utf-8").strip(),alt_row(1,1,"en","A",("yes","0","0","0")))


    def test_quarantines_wrong_width_and_invalid_utf8_rows_with_exact_source_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); cand=p/"c.csv.gz"
            with gzip.open(cand,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"])
                w.writeheader(); w.writerows([candidate_row(1,"Valid","KE")])
            member_bytes = (alt_row(10,1,"en","Valid")+"\n").encode("utf-8") + b"11\t1\ten\n" + bytes([255]) + b"\tbad-row\n"
            archive=p/"alternateNamesV2.zip"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
                z.writestr("alternateNamesV2.txt",member_bytes)
            raw=archive.read_bytes()
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"remote_source":{"source_url":exporter.SOURCE_URL,"retrieved_at_utc":"now",
                "http_status":200,"size_bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"zip_crc_validation":"PASS"}}),encoding="utf-8")
            ci,cm=write_country_info_sources(p,[country_info_row("KE","KEN","404","Kenya","192950")])
            report,out,summary=exporter.export_aliases(cand,ci,cm,archive,manifest,p/"out")
            counts=report["counts"]
            self.assertEqual(report["status"],"PASS_ALIAS_SCOPE_RECONCILED_WITH_QUARANTINE__CANDIDATES_ONLY__NOT_IMPORTED")
            self.assertEqual(counts["alternate_names_source_rows_scanned"],3)
            self.assertEqual(counts["malformed_or_invalid_source_rows"],2)
            self.assertEqual(counts["invalid_boolean_flag_rows"],0)
            self.assertEqual(counts["quarantined_source_rows"],2)
            self.assertEqual(counts["quarantine_rows_by_reason"],{"INVALID_UTF8":1,"WRONG_FIELD_COUNT":1})
            with gzip.open(out,"rt",encoding="utf-8",newline="") as stream:
                exported=list(csv.DictReader(stream))
            self.assertEqual(len(exported),1)
            quarantine_path=p/"out"/"worldwide-geonames-country-and-destination-alternate-name-quarantine.csv"
            with quarantine_path.open(encoding="utf-8",newline="") as stream:
                quarantined=list(csv.DictReader(stream))
            self.assertEqual(len(quarantined),2)
            recovered={base64.b64decode(row["raw_line_base64"]) for row in quarantined}
            self.assertIn(b"11\t1\ten\n",recovered)
            self.assertIn(bytes([255])+b"\tbad-row\n",recovered)
            self.assertEqual(report["sources"]["quarantine_file_sha256"],hashlib.sha256(quarantine_path.read_bytes()).hexdigest())

    def test_rejects_duplicate_alternate_name_ids_in_destination_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); cand=p/"c.csv.gz"
            with gzip.open(cand,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"])
                w.writeheader()
                w.writerows([candidate_row(1,"A","KE")])
            ci,cm=write_country_info_sources(p,[country_info_row("GB","GBR","826","United Kingdom","2")])
            archive=p/"alternateNamesV2.zip"
            payload="\n".join([alt_row(5,1,"en","A"),alt_row(5,1,"sw","A")])+"\n"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
                z.writestr("alternateNamesV2.txt",payload)
            raw=archive.read_bytes()
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"remote_source":{
                "source_url":exporter.SOURCE_URL,"retrieved_at_utc":"now","http_status":200,
                "size_bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"zip_crc_validation":"PASS"}}),encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"Duplicate alternateName IDs"):
                exporter.export_aliases(cand,ci,cm,archive,manifest,p/"out")


    def test_rejects_country_info_duplicate_alpha2_or_geonames_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp); cand=p/"c.csv.gz"
            with gzip.open(cand,"wt",encoding="utf-8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["geonames_id","name","source_country_code_raw"])
                w.writeheader()
                w.writerow(candidate_row(100,"Nairobi","KE"))
            archive=p/"alternateNamesV2.zip"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
                z.writestr("alternateNamesV2.txt",alt_row(1,100,"en","Nairobi")+"\n")
            raw=archive.read_bytes()
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"remote_source":{
                "source_url":exporter.SOURCE_URL,"retrieved_at_utc":"now","http_status":200,
                "size_bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"zip_crc_validation":"PASS"}}),encoding="utf-8")
            ci,cm=write_country_info_sources(p,[
                country_info_row("KE","KEN","404","Kenya","192950"),
                country_info_row("KE","KEX","405","Duplicate alpha 2","192951"),
            ])
            with self.assertRaisesRegex(ValueError,"duplicate source IDs or alpha-2 codes"):
                exporter.export_aliases(cand,ci,cm,archive,manifest,p/"out")


if __name__=="__main__":
    unittest.main()



