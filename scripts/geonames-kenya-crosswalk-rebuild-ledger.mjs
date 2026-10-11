#!/usr/bin/env node
/** Rebuild the two Kenya legacy-key exceptions without rewriting raw codes. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function need(condition, message) { if (!condition) throw new Error(message); }
function meta(audit) {
  const wrapper = audit.source ?? {};
  const source = wrapper.manifest?.remote_source ?? wrapper.manifest ?? wrapper.remote_source ?? wrapper;
  const url = source.url ?? source.source_url;
  const hash = source.sha256 ?? wrapper.crosswalk_sha256;
  const status = Number(source.http_status ?? 0);
  const retrieved = source.retrieved_at_utc ?? wrapper.retrieved_at_utc;
  const rows = Number(audit.crosswalk_row_count ?? source.rows ?? 0);
  const malformed = Number(audit.malformed_rows ?? source.malformed_rows ?? 0);
  const duplicateValue = audit.duplicate_crosswalk_keys ?? source.duplicate_composite_keys ?? 0;
  const duplicates = Array.isArray(duplicateValue) ? duplicateValue.length : Number(duplicateValue ?? 0);
  need(url === "https://download.geonames.org/export/dump/admin1CodesASCII.txt", "Unexpected current source URL.");
  need(status === 200 && Number.isFinite(Date.parse(retrieved ?? "")), "Current crosswalk retrieval metadata is invalid.");
  need(/^[a-f0-9]{64}$/i.test(hash ?? ""), "Current crosswalk hash is invalid.");
  need(Number.isSafeInteger(rows) && rows > 0 && malformed === 0 && duplicates === 0, "Current crosswalk shape or uniqueness gate failed.");
  return { owner:"GeoNames", url, retrieved_at_utc:retrieved, http_status:status, sha256:hash, row_count:rows, malformed_rows:malformed, duplicate_key_count:duplicates };
}
export function parseCsvRecords(text, label = "CSV") {
  const rows=[]; let row=[]; let field=""; let quoted=false;
  for(let i=0;i<text.length;i+=1) {
    const ch=text[i];
    if(quoted) {
      if(ch === '"' && text[i+1] === '"') { field+='"'; i+=1; }
      else if(ch === '"') quoted=false;
      else field+=ch;
    } else if(ch === '"' && field.length===0) quoted=true;
    else if(ch === ",") { row.push(field); field=""; }
    else if(ch === "\n" || ch === "\r") {
      if(ch==="\r" && text[i+1]==="\n") i+=1;
      row.push(field); rows.push(row); row=[]; field="";
    } else field+=ch;
  }
  if(quoted) throw new Error(label+" contains an unterminated quote.");
  if(field.length || row.length) { row.push(field); rows.push(row); }
  need(rows.length>0,label+" is empty.");
  const headers=rows[0], values=rows.slice(1).filter(r=>r.some(v=>v!==""));
  need(new Set(headers).size===headers.length,label+" has duplicate headers.");
  values.forEach(r=>need(r.length===headers.length,label+" has a row-width mismatch."));
  return values.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])));
}
function csvEscape(value) {
  const s=value==null?"":String(value);
  return /[",\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function renderCsv(headers, rows) {
  return [headers.join(","),...rows.map(row=>headers.map(key=>csvEscape(row[key])).join(","))].join("\n")+"\n";
}
function getCurrentKeyInventory(audit) {
  const items=audit.current_ke_admin1_keys ?? audit.present_current_keys_used_only_as_examples_not_assignments ?? [];
  return new Map(items.map(row=>[String(row.composite_key),row]));
}
export function buildKenyaCrosswalkRebuildLedger(audit, ancestorEvidence, unitEvidence, overrideEvidence) {
  need(Array.isArray(audit?.targets),"Current audit has no target rows.");
  need(Array.isArray(ancestorEvidence?.records),"County ancestor evidence has no records.");
  need(Array.isArray(unitEvidence?.records) && unitEvidence.status==="OFFICIAL_NATIVE_UNIT_PATHS_DOCUMENTED__GEONAMES_CROSSWALK_PENDING","Official unit evidence status is unexpected.");
  need(overrideEvidence?.status==="ONE_SOURCE_BACKED_ADMIN1_PARENT_OVERRIDE__ONE_DIRECT_PARENT_UNRESOLVED","Override evidence status is unexpected.");
  need(overrideEvidence.approved_records?.length===1 && String(overrideEvidence.approved_records[0].geonames_id)==="7800132","Only Imenti Central may have an approved override.");
  need(overrideEvidence.unresolved_target_ids?.some(row=>String(row.geonames_id)==="192705"),"Kiambururu must remain unresolved.");
  const source=meta(audit);
  const audits=new Map(audit.targets.map(row=>[String(row.geonames_id),row]));
  const ancestors=new Map(ancestorEvidence.records.map(row=>[String(row.geonames_id),row]));
  const units=new Map(unitEvidence.records.map(row=>[String(row.geonames_id),row]));
  need(audits.size===2 && audits.has("192705") && audits.has("7800132"),"Expected the two source-verified Kenya target IDs.");
  need(ancestors.size===2 && units.size===2,"Expected two records in each Kenya evidence source.");
  const keys=getCurrentKeyInventory(audit);
  need(keys.has("KE.35") && String(keys.get("KE.35").geonames_id)==="186824","Current KE.35 no longer maps to parent ID 186824; fail closed.");

  const records=["192705","7800132"].map(id=>{
    const target=audits.get(id), ancestor=ancestors.get(id), native=units.get(id);
    need(target && ancestor && native,"Missing evidence for target "+id+".");
    const expectedRaw=id==="192705"?"01":"03";
    const expectedKey="KE."+expectedRaw;
    const raw=String(target.source_raw_admin1_code ?? target.raw_admin1_code_preserved ?? "");
    const key=String(target.expected_composite_key ?? target.composite_key_checked ?? "");
    need(raw===expectedRaw,"Raw admin1 code drift for target "+id+".");
    need(key===expectedKey,"Legacy key drift for target "+id+".");
    need(target.country_code==="KE" && target.feature_code==="ADM3" && native.country_code==="KE" && native.feature_code==="ADM3","Target identity mismatch for "+id+".");
    need((target.crosswalk_row_count_for_key ?? target.crosswalk_rows_found)===0,"Legacy key row count changed for "+id+"; re-review the override.");
    need(native.raw_admin1_code_preserved===expectedRaw && native.legacy_composite_key===expectedKey,"Native evidence raw key mismatch for "+id+".");
    const unit=native.current_official_unit, cross=native.geonames_crosswalk;
    need(unit?.path_evidence_status==="OFFICIAL_CURRENT_NATIVE_PATH_DOCUMENTED" && unit.verified_official_path?.length>=3,"Official path not verified for "+id+".");
    need(cross?.status==="CURRENT_NATIVE_UNIT_PATH_KNOWN__GEONAMES_ID_CROSSWALK_PENDING" && cross.immediate_parent_geonames_id===null && cross.approved_parent_ids?.length===0,"Keep discovery dossier immutable; the override must remain a separate versioned decision.");
    const expectedCounty=id==="192705"?"8693007":"8693009";
    need(String(ancestor.candidate_county_ancestor?.geonames_id)===expectedCounty && ancestor.candidate_county_ancestor.feature_code==="ADM2","Historic county candidate changed for "+id+".");
    let parent=null, parentName=null, parentKey=null, mapping="CURRENT_NATIVE_UNIT_PATH_KNOWN__DIRECT_PARENT_CROSSWALK_PENDING";
    let verified=false, disposition="EXCLUDE_UNTIL_DIRECT_PARENT_CROSSWALK_VERIFIED", missing=[];
    if(id==="192705") {
      need(unit.official_name==="Kiambururu" && unit.official_unit_level==="Location" && unit.immediate_parent_official_name==="Githunguri Sub-County","Kiambururu official path changed.");
      need(cross.candidate_geonames_nodes_for_separate_review.some(n=>String(n.geonames_id)==="197219" && n.role==="NOT_AN_APPROVED_PARENT"),"Disallowed Githunguri Location ID 197219 must remain labelled as not a parent.");
      missing=[
        "A stable GeoNames or catalog identifier for Githunguri Sub-County; GeoNames ID 197219 is Githunguri Location (ADMD) and cannot be substituted.",
        "A source-backed identity crosswalk linking Kiambururu Location in the 2024 Gazette to GeoNames ID 192705 while retaining the dated 2011 Sub-Location and 2024 Location observations.",
        "A complete parent path through the verified Githunguri Sub-County node rather than skipping to a county ancestor."
      ];
    } else {
      const decision=overrideEvidence.approved_records[0];
      need(decision.raw_admin1_code_preserved==="03" && decision.legacy_composite_key==="KE.03" && decision.legacy_key_present_in_current_crosswalk===false,"Imenti override raw-code decision mismatch.");
      need(String(decision.parent_geonames_id)==="186824" && decision.parent_current_composite_key==="KE.35" && decision.parent_feature_code==="ADM1","Override parent is not canonical current ADM1 ID 186824.");
      need(String(decision.history_record_id)==="186824" && decision.history_observation.includes("adm1:03>35") && decision.history_observation.includes("featureCode:ADM2>ADM1"),"Exact parent record history transition is missing.");
      need(decision.parent_record_url==="https://www.geonames.org/186824/meru.html" && decision.official_unit_url==="https://meru.go.ke/assets/file/05b8937c-county-annual-development-plan-cadp-.pdf","Parent override source URLs drifted.");
      need(unit.official_name==="Imenti Central" && unit.official_unit_level==="Sub-County" && unit.parent_county_official_name==="Meru County","Official unit type/path does not support this mapping.");
      need(String(target.name)==="Imenti Central","Target identity changed; override must fail closed.");
      parent="186824"; parentName="Meru County"; parentKey="KE.35";
      mapping="VERIFIED_SOURCE_BACKED_ADMIN1_PARENT_OVERRIDE";
      verified=true;
      disposition="INCLUDE_IN_EFFECTIVE_INITIAL_ADMIN_CATALOG_VIA_SOURCE_BACKED_PARENT_OVERRIDE";
      missing=[];
    }
    const decision=id==="7800132"?overrideEvidence.approved_records[0]:null;
    return {
      geonames_id:id,name:target.name,country_code:"KE",feature_code:"ADM3",
      raw_admin1_code_preserved:expectedRaw,legacy_composite_key:expectedKey,
      current_crosswalk_key_row_count:0,
      current_crosswalk_key_status:id==="7800132"?"KEY_ABSENT__RESOLVED_BY_RECORD_SPECIFIC_OVERRIDE":"KEY_ABSENT__GITHUNGURI_SUBCOUNTY_PARENT_UNRESOLVED",
      native_official_unit_path:{
        official_name:unit.official_name,unit_level:unit.official_unit_level,
        immediate_parent_official_name:unit.immediate_parent_official_name,
        parent_county_official_name:unit.parent_county_official_name,
        verified_path:unit.verified_official_path,path_evidence_status:unit.path_evidence_status,
        official_subcounty_statistics:unit.official_subcounty_statistics ?? null,
        temporal_context:native.temporal_context ?? []
      },
      geonames_entity_crosswalk_status:mapping,
      candidate_geonames_parent_nodes_for_review:cross.candidate_geonames_nodes_for_separate_review,
      candidate_county_ancestor:{
        geonames_id:String(ancestor.candidate_county_ancestor.geonames_id),
        name:ancestor.candidate_county_ancestor.name,
        feature_code:ancestor.candidate_county_ancestor.feature_code
      },
      immediate_parent_geonames_id:parent,immediate_parent_geonames_name:parentName,
      immediate_parent_current_composite_key:parentKey,
      parent_mapping_evidence:decision?{
        decision_date_utc:overrideEvidence.decision_date_utc,
        parent_record_id:decision.parent_geonames_id,
        current_parent_key:decision.parent_current_composite_key,
        history_observation:decision.history_observation,
        history_record_url:decision.parent_record_url,
        official_unit_url:decision.official_unit_url,
        mapping_rationale:decision.mapping_rationale
      }:null,
      complete_parent_path_verified:verified,
      raw_admin1_code_changed:false,source_record_modified:false,operational_parent_link_created:false,
      active_selector_disposition:disposition,missing_evidence:missing
    };
  });

  return {
    report_version:"1.1",report_date_utc:overrideEvidence.decision_date_utc,
    status:"ONE_PARENT_PATH_VERIFIED__ONE_PARENT_PATH_BLOCKED",
    source:{current_admin1_crosswalk:source,county_ancestor_evidence_status:ancestorEvidence.status,current_unit_evidence_status:unitEvidence.status,override_evidence_status:overrideEvidence.status},
    decision_boundary:{current_legacy_key_absence_is_not_a_generic_replacement_mapping:true,one_record_specific_parent_override_verified:true,raw_source_codes_modified:false,source_records_rewritten:false,historic_exclusion_snapshot_mutated:false,operational_parent_links_created:0,database_or_production_changes:false},
    totals:{
      target_rows:records.length,
      exact_current_legacy_keys_absent:records.filter(row=>row.current_crosswalk_key_row_count===0).length,
      official_native_parent_paths_documented:records.filter(row=>row.native_official_unit_path.path_evidence_status==="OFFICIAL_CURRENT_NATIVE_PATH_DOCUMENTED").length,
      source_backed_parent_overrides_approved:records.filter(row=>row.parent_mapping_evidence!==null).length,
      immediate_parent_paths_verified:records.filter(row=>row.complete_parent_path_verified).length,
      eligible_from_kenya_exception_set:records.filter(row=>row.active_selector_disposition.startsWith("INCLUDE_")).length,
      excluded_pending_parent_crosswalk:records.filter(row=>row.active_selector_disposition.startsWith("EXCLUDE_")).length,
      raw_admin1_codes_changed:records.filter(row=>row.raw_admin1_code_changed).length,
      operational_parent_links_created:records.filter(row=>row.operational_parent_link_created).length
    },
    records
  };
}
const LEDGER_FIELDS=[
"geonames_id","name","country_code","feature_code","raw_admin1_code_preserved","legacy_composite_key",
"current_crosswalk_key_row_count","current_crosswalk_key_status","official_current_unit_name","official_current_unit_level",
"official_immediate_parent_official_name","official_parent_county_name","official_native_path","geonames_entity_crosswalk_status",
"immediate_parent_geonames_id","immediate_parent_geonames_name","immediate_parent_current_composite_key","complete_parent_path_verified",
"raw_admin1_code_changed","source_record_modified","operational_parent_link_created","active_selector_disposition","parent_mapping_history","parent_mapping_sources","missing_evidence"
];
export function renderKenyaCrosswalkRebuildLedgerCsv(ledger) {
  const rows=ledger.records.map(record=>({
    ...record,
    official_current_unit_name:record.native_official_unit_path.official_name,
    official_current_unit_level:record.native_official_unit_path.unit_level,
    official_immediate_parent_official_name:record.native_official_unit_path.immediate_parent_official_name,
    official_parent_county_name:record.native_official_unit_path.parent_county_official_name,
    official_native_path:record.native_official_unit_path.verified_path.join(" > "),
    parent_mapping_history:record.parent_mapping_evidence?.history_observation ?? "",
    parent_mapping_sources:record.parent_mapping_evidence ? record.parent_mapping_evidence.history_record_url+"; "+record.parent_mapping_evidence.official_unit_url : "",
    missing_evidence:record.missing_evidence.join("; ")
  }));
  return renderCsv(LEDGER_FIELDS,rows);
}
export function buildEffectiveExclusionOverlayCsv(ledger, originalCsv) {
  const rows=parseCsvRecords(originalCsv,"Historic initial admin catalog exclusions");
  need(rows.length===128,"Historic exclusion manifest must have exactly 128 rows.");
  const ids=new Set(rows.map(row=>String(row.geonames_id)));
  need(ids.size===rows.length && ids.has("192705") && ids.has("7800132"),"Historic exclusion IDs are incomplete or duplicated.");
  const include=new Set(ledger.records.filter(row=>row.active_selector_disposition.startsWith("INCLUDE_")).map(row=>String(row.geonames_id)));
  need(include.size===1 && include.has("7800132"),"Only Imenti may be removed from the effective exclusions.");
  const effective=rows.filter(row=>!include.has(String(row.geonames_id)));
  need(effective.length===127 && effective.filter(row=>row.country_code==="JP").length===126,"Effective exclusion count or Japan count is wrong.");
  need(effective.filter(row=>row.country_code==="KE").length===1 && effective.some(row=>String(row.geonames_id)==="192705"),"Kiambururu must remain excluded.");
  return renderCsv(Object.keys(rows[0]),effective);
}
async function main() {
  const [auditPath,ancestorPath,unitPath,overridePath,exclusionsPath,prefix]=process.argv.slice(2);
  if(!auditPath||!ancestorPath||!unitPath||!overridePath||!exclusionsPath||!prefix) {
    console.error("Usage: node scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs <admin1-audit.json> <ancestor.json> <unit-evidence.json> <override.json> <historic-exclusions.csv> <output-prefix>");
    process.exitCode=2; return;
  }
  const inputs=await Promise.all([auditPath,ancestorPath,unitPath,overridePath,exclusionsPath].map(path=>readFile(path,"utf8")));
  const ledger=buildKenyaCrosswalkRebuildLedger(JSON.parse(inputs[0]),JSON.parse(inputs[1]),JSON.parse(inputs[2]),JSON.parse(inputs[3]));
  await Promise.all([
    writeFile(prefix+".json",JSON.stringify(ledger,null,2)+"\n","utf8"),
    writeFile(prefix+".csv",renderKenyaCrosswalkRebuildLedgerCsv(ledger),"utf8"),
    writeFile(prefix+".effective-initial-admin-catalog-exclusions.csv",buildEffectiveExclusionOverlayCsv(ledger,inputs[4]),"utf8")
  ]);
  console.log(JSON.stringify({status:ledger.status,...ledger.totals},null,2));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) await main();
