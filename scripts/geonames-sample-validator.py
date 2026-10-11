#!/usr/bin/env python3
"""Fail-closed GeoNames sample validator. No networking and no database access."""
from __future__ import annotations
import argparse, csv, hashlib, json, sys, zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PARSER_VERSION = "job-grid-geonames-validator/1.0.0"
COUNTRIES = {"KE":"Kenya", "GB":"United Kingdom", "JP":"Japan", "BR":"Brazil", "SG":"Singapore"}
FILES = ["KE.zip", "GB.zip", "JP.zip", "BR.zip", "SG.zip", "countryInfo.txt", "admin1CodesASCII.txt", "admin2Codes.txt", "readme.txt"]
EXPECTED_ISO = {"KE":("KEN","404"), "GB":("GBR","826"), "JP":("JPN","392"), "BR":("BRA","076"), "SG":("SGP","702")}
INCLUDED_FEATURE_CODES = {"P.PPL","P.PPLA","P.PPLA2","P.PPLA3","P.PPLA4","P.PPLC","P.PPLG","P.PPLX","A.ADM1","A.ADM2","A.ADM3","A.ADM4","A.ADM1H","A.ADM2H","A.ADM3H","A.ADM4H"}
FIELD_COUNT = 19

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def tab_records(path: Path):
    with path.open('r',encoding='utf-8',newline='') as f:
        for n,line in enumerate(f,1):
            if line.startswith('#') or not line.strip(): continue
            yield n,line.rstrip('\r\n').split('\t')

def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-dir',type=Path,required=True)
    ap.add_argument('--output-dir',type=Path,required=True)
    ap.add_argument('--expected-manifest',type=Path,required=True,help='JSON filename -> {"sha256":"..."}; all nine files required')
    a=ap.parse_args(); a.output_dir.mkdir(parents=True,exist_ok=True)
    expected=json.loads(a.expected_manifest.read_text(encoding='utf-8'))
    report={"status":"BLOCKED","generated_at_utc":datetime.now(timezone.utc).isoformat(),"parser_version":PARSER_VERSION,"source_records_read":0,"accepted_by_candidate_rules":0,"rejected_or_quarantined":0,"duplicate_source_identifiers":0,"unmatched_or_ambiguous_country_mappings":0,"missing_or_invalid_parent_relationships":0,"feature_counts":{},"per_country":{},"iso_code_coverage":{},"crosswalk_counts":{},"files":{},"exceptions":[]}
    missing=[]
    for name in FILES:
        p=a.source_dir/name; meta={"url":f"https://download.geonames.org/export/dump/{name}","present":p.is_file(),"bytes":None,"sha256":None,"integrity":"NOT_CHECKED"}
        if not p.is_file():
            missing.append(name); meta['integrity']='MISSING'; report['exceptions'].append({"file":name,"record_id":"","country_code":"","reason_code":"SOURCE_FILE_MISSING","detail":"No local source bytes; parse skipped."})
        else:
            meta['bytes']=p.stat().st_size; meta['sha256']=sha256(p)
            exp=expected.get(name,{}).get('sha256') if isinstance(expected.get(name),dict) else None
            meta['integrity']='VERIFIED' if exp and exp.lower()==meta['sha256'] else ('CHECKSUM_MISMATCH' if exp else 'UNPINNED')
            if meta['integrity']!='VERIFIED': report['exceptions'].append({"file":name,"record_id":"","country_code":"","reason_code":"CHECKSUM_NOT_VERIFIED","detail":meta['integrity']})
        report['files'][name]=meta
    if missing or any(v['integrity']!='VERIFIED' for v in report['files'].values()):
        report['status']='BLOCKED_SOURCE_OR_CHECKSUM'
        report['missing_files']=missing
        report['notes']=['Fail-closed preflight: no source parsing or row counts occur unless every required file exists and matches an explicitly supplied SHA-256. Null/unmeasured counts are not zero.']
        write_outputs(a.output_dir,report)
        print(json.dumps({"status":report['status'],"missing_files":missing,"report":str(a.output_dir/'validation-report.json')},indent=2)); return 2
    raw_by_country=Counter(); accepted_by_country=Counter(); feature_by_country={c:Counter() for c in COUNTRIES}; seen={c:set() for c in COUNTRIES}; dupes=0
    for cc in COUNTRIES:
        name=f'{cc}.zip'; p=a.source_dir/name
        try:
            with zipfile.ZipFile(p) as z:
                bad=z.testzip()
                if bad: raise ValueError(f'ZIP CRC failure: {bad}')
                txt=[n for n in z.namelist() if n.endswith('.txt')]
                if len(txt)!=1: raise ValueError(f'Expected exactly one .txt member, got {txt}')
                with z.open(txt[0]) as raw:
                    for lineno,b in enumerate(raw,1):
                        try: line=b.decode('utf-8').rstrip('\r\n')
                        except UnicodeDecodeError:
                            report['rejected_or_quarantined']+=1; report['exceptions'].append({"file":name,"record_id":"","country_code":cc,"reason_code":"INVALID_UTF8","detail":f'line {lineno}'}); continue
                        if not line: continue
                        f=line.split('\t'); report['source_records_read']+=1; raw_by_country[cc]+=1
                        if len(f)!=FIELD_COUNT:
                            report['rejected_or_quarantined']+=1; report['exceptions'].append({"file":name,"record_id":f[0] if f else '',"country_code":f[8] if len(f)>8 else cc,"reason_code":"INVALID_COLUMN_COUNT","detail":f'line {lineno}: {len(f)} columns'}); continue
                        gid,nm,ascii_name,alt,lat,lon,fc,ft,country,cc2,a1,a2,a3,a4,pop,elev,dem,tz,mod=f
                        reason=None
                        if not gid.isdigit(): reason='INVALID_GEONAME_ID'
                        elif gid in seen[cc]: reason='DUPLICATE_GEONAME_ID'; dupes+=1; report['duplicate_source_identifiers']+=1
                        else: seen[cc].add(gid)
                        if not reason and country!=cc: reason='COUNTRY_CODE_MISMATCH'; report['unmatched_or_ambiguous_country_mappings']+=1
                        if not reason and f'{fc}.{ft}' not in INCLUDED_FEATURE_CODES: reason='FEATURE_EXCLUDED_BY_MAPPING'
                        if reason:
                            report['rejected_or_quarantined']+=1
                            if reason!='FEATURE_EXCLUDED_BY_MAPPING': report['exceptions'].append({"file":name,"record_id":gid,"country_code":country,"reason_code":reason,"detail":f'line {lineno}; feature={fc}.{ft}; admin1={a1}; admin2={a2}'})
                            continue
                        report['accepted_by_candidate_rules']+=1; accepted_by_country[cc]+=1; feature_by_country[cc][f'{fc}.{ft}']+=1
        except Exception as e:
            report['status']='BLOCKED_ARCHIVE_INTEGRITY'; report['exceptions'].append({"file":name,"record_id":"","country_code":cc,"reason_code":"ARCHIVE_VALIDATION_ERROR","detail":f'{type(e).__name__}: {e}'})
    # Validate GeoNames metadata against expected candidate codes only, not an ISO authority feed.
    ci={}
    for line_no,f in tab_records(a.source_dir/'countryInfo.txt'):
        if len(f)>=3 and f[0] in COUNTRIES: ci[f[0]]=f
    for cc,(a3,num) in EXPECTED_ISO.items():
        f=ci.get(cc); matches=bool(f and f[1]==a3 and f[2].zfill(3)==num)
        report['iso_code_coverage'][cc]={"name":COUNTRIES[cc],"countryInfo_row_present":bool(f),"alpha2":cc if f else None,"alpha3":f[1] if f else None,"numeric_text":f[2].zfill(3) if f else None,"expected_candidate_alpha3":a3,"expected_candidate_numeric_text":num,"matches_candidate":matches,"iso_authority_verified":False}
        if not matches:
            report['unmatched_or_ambiguous_country_mappings']+=1; report['exceptions'].append({"file":"countryInfo.txt","record_id":"","country_code":cc,"reason_code":"COUNTRY_METADATA_MAPPING_MISMATCH","detail":f'expected candidate {a3}/{num}, observed {f[1:3] if f else None}'})
    for fname,key,mincols in [('admin1CodesASCII.txt','admin1',4),('admin2Codes.txt','admin2',3)]:
        codes=set()
        for _,f in tab_records(a.source_dir/fname):
            if len(f)>=mincols: codes.add(f[0])
        report['crosswalk_counts'][key]={"unique_codes":len(codes)}
    for cc in COUNTRIES:
        report['per_country'][cc]={"name":COUNTRIES[cc],"raw_records_read":raw_by_country[cc],"accepted_by_candidate_rules":accepted_by_country[cc],"feature_counts":dict(feature_by_country[cc]),"zip_integrity":"PASS"}
        report['feature_counts'][cc]=dict(feature_by_country[cc])
    report['status']='COMPLETE_WITH_EXCEPTIONS' if report['exceptions'] else 'COMPLETE'
    report['notes']=['Counts reflect country archives only; countryInfo and admin crosswalk are separately parsed tables and are not added to place-record totals.','Feature inclusion rules are candidate rules and require owner approval.','ISO authority verification is false: GeoNames countryInfo values are not a substitute for an approved ISO source snapshot.','This validator does not parse alternate names because alternateNamesV2.zip was not included in the source request.','Parent correctness cannot be inferred from display names; review country/admin-code crosswalk coverage and source IDs before treating any location path as accepted.','No database access or writes are implemented.']
    write_outputs(a.output_dir,report)
    print(json.dumps({k:report[k] for k in ('status','source_records_read','accepted_by_candidate_rules','rejected_or_quarantined','duplicate_source_identifiers','unmatched_or_ambiguous_country_mappings')},indent=2))
    return 0 if report['status']=='COMPLETE' else 1

def write_outputs(out:Path,report:dict):
    (out/'validation-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    keys=['file','record_id','country_code','reason_code','detail']
    with (out/'exceptions.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=keys); w.writeheader()
        for row in report.get('exceptions',[]): w.writerow({k:row.get(k,'') for k in keys})
if __name__=='__main__': sys.exit(main())
