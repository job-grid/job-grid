#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const ids=new Set(["1850471","1850496"]);
const expected=new Map([["1850471",{parent:"1852501",target:"29363",parentCode:"29360",grandparent:"29000"}],["1850496",{parent:"1860552",target:"20382",parentCode:"20380",grandparent:"20000"}]]);
const hash=v=>createHash("sha256").update(v).digest("hex"), norm=v=>String(v??"").normalize("NFC").trim();
function need(v,m){if(!v)throw new Error(m);}
function byId(rows,id,label){const a=(rows??[]).filter(r=>String(r.geonames_id??"")===String(id));need(a.length===1,label+" ID "+id+" must occur exactly once.");return a[0];}
function sourceRow(line){const f=line.split("\t");need(f.length===19&&/^\d+$/.test(f[0]??""),"Malformed GeoNames JP.txt row.");return{geonames_id:f[0],name:f[1],alternate_names:(f[3]??"").split(",").filter(Boolean),feature_class:f[6],feature_code:f[7],country_code:f[8],admin1_code:f[10]};}
export function validateOverrideManifest(manifest){
 need(manifest?.status==="TWO_SOURCE_BACKED_CURRENT_JAPAN_PARENT_PATHS__NO_OPERATIONAL_LINKS_CREATED","Japan parent override status invalid.");
 need(Array.isArray(manifest.approved_records)&&manifest.approved_records.length===2,"Exactly two Japan overrides are required.");
 const found=new Set();
 for(const r of manifest.approved_records){const id=String(r.geonames_id),e=expected.get(id);
  need(e&&!found.has(id),"Unexpected/duplicate Japan target "+id+".");found.add(id);
  need(r.country_code==="JP"&&r.feature_code==="ADM4"&&r.raw_admin1_code_preserved==="00","Target identity/raw-code invariant failed for "+id+".");
  need(String(r.parent_geonames_id)===e.parent&&String(r.target_area_code)===e.target&&String(r.parent_area_code)===e.parentCode&&String(r.grandparent_area_code)===e.grandparent,"Pinned target-parent-grandparent tuple changed for "+id+".");
  need(r.target_period_uri==="http://data.e-stat.go.jp/lod/sac/C"+r.target_area_code+"-19700401"&&r.parent_period_uri==="http://data.e-stat.go.jp/lod/sac/C"+r.parent_area_code+"-19700401","e-Stat URI mismatch for "+id+".");
  need(r.current_initial_selector_disposition==="INCLUDE_VIA_SOURCE_BACKED_PARENT_OVERRIDE"&&r.complete_parent_path_verified===true,"Path not explicitly marked verified for "+id+".");
  need(r.raw_admin1_code_changed===false&&r.source_record_modified===false&&r.operational_parent_link_created===false,"No-write boundary violated for "+id+".");
  need((r.official_sources??[]).length>=5&&r.rationale,"Sources or rationale missing for "+id+".");
 }
 need(found.size===ids.size&&[...found].every(id=>ids.has(id)),"Approved IDs are not exactly the two reviewed Japan records.");
 need(manifest.decision_boundary?.operational_parent_links_created===0&&manifest.decision_boundary?.database_or_production_changes===false,"No-write manifest boundary failed.");
 return manifest.approved_records;
}
export function validateJapanParentOverrides({jpText,sourceManifest,targetAudit,spatialReport,eStatDetails,parentExpansion,hierarchyAudit,mlitCodeEvidence,overrideManifest}){
 const records=validateOverrideManifest(overrideManifest);
 need(sourceManifest?.archive_filename==="JP.zip"&&sourceManifest?.source_url==="https://download.geonames.org/export/dump/JP.zip"&&Number(sourceManifest?.http_status)===200&&/^[a-f0-9]{64}$/i.test(sourceManifest?.archive_sha256??""),"Official GeoNames JP source provenance invalid.");
 need(targetAudit?.target_count===126&&targetAudit?.target_source_identity_and_raw_code_matches===126&&targetAudit?.operational_parent_links_created===0&&targetAudit?.target_results?.length===126,"Full Japan target source audit failed.");
 need(spatialReport?.target_count===126&&spatialReport?.target_results?.length===126&&spatialReport?.status?.startsWith("PASS_PINNED_1995_BOUNDARY_SPATIAL_SCAN"),"MLIT spatial audit failed.");
 need(eStatDetails?.target_count===126&&eStatDetails?.status?.startsWith("PASS_SPATIAL_FIRST_ESTAT_PERIOD_HISTORY_RETRIEVED")&&eStatDetails?.operational_parent_links_created===0,"e-Stat history audit failed.");
 need(parentExpansion?.status==="PASS_EXACT_JAPANESE_LABEL_PARENT_ID_CANDIDATE_DISCOVERY; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED"&&parentExpansion?.operational_parent_links_created===0,"Parent identity-candidate audit failed.");
 need(hierarchyAudit?.status==="PASS_ESTAT_PARENT_HIERARCHY_CONTEXT_AUDIT; GEO_NAMES_ADMIN1_CODE_CONSISTENCY_ONLY; NO_PARENT_LINKS_APPROVED"&&hierarchyAudit?.operational_parent_links_created===0,"Parent hierarchy context audit failed.");
 need(mlitCodeEvidence?.status==="PASS_OFFICIAL_MLIT_CODE_SNAPSHOTS_PARSED; KEY_CODE_DESCRIPTIONS_VERIFIED; NO_PARENT_LINKS_APPROVED"&&/^[a-f0-9]{64}$/i.test(mlitCodeEvidence?.mlit_all_snapshot_sha256??""),"MLIT code-list audit failed.");
 const geoLines=String(jpText).split(/\r?\n/).filter(Boolean), geo=geoLines.map(sourceRow), byGeo=new Map();
 for(const r of geo){const a=byGeo.get(r.geonames_id)??[];a.push(r);byGeo.set(r.geonames_id,a);}
 const out=[];
 for(const item of records){const id=String(item.geonames_id);
  const target=byId(byGeo.get(id)??[],id,"GeoNames JP source");
  need(target.name===item.name&&target.country_code==="JP"&&target.feature_code==="ADM4"&&target.admin1_code==="00","Target source name/feature/raw code changed for "+id+".");
  const parent=byId(byGeo.get(String(item.parent_geonames_id))??[],item.parent_geonames_id,"GeoNames parent");
  need(parent.name===item.parent_geonames_name&&parent.country_code==="JP"&&parent.feature_class==="A"&&parent.feature_code==="ADM2","Parent record identity/feature mismatch for "+id+".");
  need(parent.alternate_names.some(x=>norm(x)===norm(item.exact_parent_japanese_alternate_name)),"Parent lacks exact Japanese alternate name for "+id+".");
  const auditTarget=byId(targetAudit.target_results,id,"e-Stat English target audit");
  need(auditTarget.source_identity_and_raw_codes_verified===true&&auditTarget.country_code==="JP"&&auditTarget.feature_code==="ADM4"&&auditTarget.raw_admin1_code==="00"&&auditTarget.exact_name_candidate_count===1,"Target lacks one source-verified exact English area-code candidate: "+id+".");
  const ac=(auditTarget.candidates??[]).filter(x=>String(x.area_code)===String(item.target_area_code));
  need(ac.length===1,"Target area code candidate is not unique for "+id+".");
  const period=(ac[0].periods??[]).find(x=>String(x.period_uri)===item.target_period_uri);
  need(period&&period.label_ja===item.target_area_code_japanese_label&&period.effective_from===item.target_period_effective_from&&String(period.effective_until??"")==="","Target official e-Stat period is not current/open-ended for "+id+".");
  need((period.parent_references??[]).filter(x=>String(x.area_code)===String(item.parent_area_code)&&String(x.uri)===item.parent_period_uri&&norm(x.label_ja)===norm(item.parent_area_code_japanese_label)).length===1,"Target's exact e-Stat period lacks the direct expected parent for "+id+".");
  const detail=(eStatDetails.area_code_period_history??[]).filter(x=>String(x.area_code)===String(item.target_area_code)&&String(x.period_uri)===item.target_period_uri);
  need(detail.length===1&&String(detail[0].effective_until??"")===""&&(detail[0].parent_references??[]).some(x=>String(x.area_code)===String(item.parent_area_code)&&String(x.uri)===item.parent_period_uri&&norm(x.label_ja)===norm(item.parent_area_code_japanese_label)),"Independent spatial-first e-Stat history disagrees for "+id+".");
  const st=byId(spatialReport.target_results,id,"1995 MLIT spatial audit");
  const hits=(st.observations??[]).filter(x=>String(x.containing_area_code)===String(item.target_area_code)&&String(x.snapshot_date)===item.spatial_snapshot_date);
  need(hits.length&&hits.some(x=>[x.containing_prefecture_name,x.containing_district_name,x.containing_municipality_name].filter(Boolean).join(" ").includes(item.target_area_code_japanese_label)),"Same-code 1995 polygon containment not established for "+id+".");
  const parentRefs=(parentExpansion.parent_references??[]).filter(x=>String(x.parent_area_code)===String(item.parent_area_code)&&String(x.parent_uri)===item.parent_period_uri);
  need(parentRefs.length===1&&Number(parentRefs[0].candidate_count)===1,"Direct parent period has ambiguous GeoNames candidate set for "+id+".");
  const pc=(parentRefs[0].candidate_matches??[]).filter(x=>String(x.geonames_id)===String(item.parent_geonames_id));
  need(pc.length===1&&pc[0].geonames_name===item.parent_geonames_name&&pc[0].feature_code==="ADM2"&&(pc[0].exact_match_fields??[]).includes("exact_alternate_name_entry"),"Exact Japanese parent candidate is absent for "+id+".");
  const hc=(hierarchyAudit.candidate_results??[]).find(x=>String(x.parent_area_code)===String(item.parent_area_code)&&String(x.parent_uri)===item.parent_period_uri&&String(x.parent_candidate_geonames_id)===String(item.parent_geonames_id));
  need(hc&&String(hc.parent_candidate_feature_code)==="ADM2"&&String(hc.e_stat_grandparent_area_code)===String(item.grandparent_area_code)&&norm(hc.e_stat_grandparent_label_ja)===norm(item.grandparent_area_code_japanese_label)&&String(hc.parent_hierarchy_consistency_status)==="ADMIN1_CODE_COHERENT_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE"&&String(hc.parent_candidate_admin1_code)===String(parent.admin1_code),"Parent/grandparent administrative namespace does not uniquely reconcile for "+id+".");
  const hd=(hierarchyAudit.parent_reference_dispositions??[]).find(x=>String(x.parent_area_code)===String(item.parent_area_code)&&String(x.parent_uri)===item.parent_period_uri);
  need(hd&&Number(hd.candidate_count)===1&&Number(hd.coherent_candidate_count)===1&&Number(hd.conflicting_candidate_count)===0&&String(hd.coherent_candidate_geonames_ids).split(";").includes(String(item.parent_geonames_id)),"Direct parent remains ambiguous or has a conflicting namesake for "+id+".");
  const code=(mlitCodeEvidence.candidate_code_review??[]).find(x=>String(x.candidate_area_code)===String(item.target_area_code));
  need(code&&(code.official_mlit_descriptions??[]).some(x=>String(x.official_area_description_ja??"").includes(item.current_official_code_label_fragment)),"Current official MLIT description mismatch for "+id+".");
  out.push({geonames_id:id,name:item.name,country_code:"JP",feature_code:"ADM4",raw_admin1_code_preserved:"00",target_area_code:item.target_area_code,target_period_uri:item.target_period_uri,target_area_code_japanese_label:item.target_area_code_japanese_label,immediate_parent_area_code:item.parent_area_code,immediate_parent_period_uri:item.parent_period_uri,immediate_parent_geonames_id:String(item.parent_geonames_id),immediate_parent_geonames_name:item.parent_geonames_name,parent_feature_code:"ADM2",exact_parent_japanese_alternate_name:item.exact_parent_japanese_alternate_name,grandparent_area_code:item.grandparent_area_code,grandparent_area_code_japanese_label:item.grandparent_area_code_japanese_label,parent_hierarchy_consistency_status:hc.parent_hierarchy_consistency_status,spatial_snapshot_date:item.spatial_snapshot_date,spatial_locations:hits.map(x=>[x.containing_prefecture_name,x.containing_district_name,x.containing_municipality_name].filter(Boolean).join(" ")).join("; "),geonames_archive_sha256:sourceManifest.archive_sha256,geonames_jp_text_sha256:hash(jpText),e_stat_snapshot_sha256:targetAudit.source_snapshot_sha256,mlit_code_snapshot_sha256:mlitCodeEvidence.mlit_all_snapshot_sha256,source_backed_parent_path:true,complete_parent_path_verified:true,raw_admin1_code_changed:false,source_record_modified:false,operational_parent_link_created:false});
 }
 return {report_version:1,status:"PASS_TWO_SOURCE_BACKED_CURRENT_JAPAN_PARENT_PATHS__NO_OPERATIONAL_LINKS_CREATED",generated_at_utc:new Date().toISOString(),summary:{source_backed_parent_paths_verified:out.length,remaining_japan_exclusions:124,raw_admin1_codes_changed:0,source_records_modified:0,operational_parent_links_created:0},source:{geonames_archive_sha256:sourceManifest.archive_sha256,geonames_jp_text_sha256:hash(jpText),e_stat_snapshot_sha256:targetAudit.source_snapshot_sha256,mlit_code_snapshot_sha256:mlitCodeEvidence.mlit_all_snapshot_sha256},records:out,operational_parent_links_created:0,database_or_production_changes:false};
}
export function renderOverrideCsv(report){
 const f=["geonames_id","name","country_code","feature_code","raw_admin1_code_preserved","target_area_code","target_area_code_japanese_label","target_period_uri","immediate_parent_area_code","immediate_parent_geonames_id","immediate_parent_geonames_name","parent_feature_code","exact_parent_japanese_alternate_name","grandparent_area_code","grandparent_area_code_japanese_label","parent_hierarchy_consistency_status","spatial_snapshot_date","geonames_archive_sha256","geonames_jp_text_sha256","e_stat_snapshot_sha256","mlit_code_snapshot_sha256","source_backed_parent_path","complete_parent_path_verified","raw_admin1_code_changed","source_record_modified","operational_parent_link_created"];
 const esc=v=>{const s=v==null?"":String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return [f.join(","),...report.records.map(r=>f.map(k=>esc(r[k])).join(","))].join("\n")+"\n";
}
function mlitValid(x){return x?.status==="PASS_OFFICIAL_MLIT_CODE_SNAPSHOTS_PARSED; KEY_CODE_DESCRIPTIONS_VERIFIED; NO_PARENT_LINKS_APPROVED"&&/^[a-f0-9]{64}$/i.test(x?.mlit_all_snapshot_sha256??"")&&Array.isArray(x?.candidate_code_review);}
export function parseValidationArgs(args){
 if(!Array.isArray(args)||args.length!==10)throw new Error("Expected nine source paths and output prefix.");
 return {jpPath:args[0],jsonPaths:args.slice(1,9),outputPrefix:args[9]};
}
async function main(){
 const parsed=parseValidationArgs(process.argv.slice(2));
 const [jp,src,audit,spatial,details,expansion,hierarchy,mlit,manifest]=await Promise.all([readFile(parsed.jpPath,"utf8"),...parsed.jsonPaths.map(p=>readFile(p,"utf8").then(JSON.parse))]);
 const out=parsed.outputPrefix;
 if(!mlitValid(mlit))throw new Error("MLIT code evidence is invalid.");
 const report=validateJapanParentOverrides({jpText:jp,sourceManifest:src,targetAudit:audit,spatialReport:spatial,eStatDetails:details,parentExpansion:expansion,hierarchyAudit:hierarchy,mlitCodeEvidence:mlit,overrideManifest:manifest});
 await Promise.all([writeFile(resolve(out)+".json",JSON.stringify(report,null,2)+"\n"),writeFile(resolve(out)+".csv",renderOverrideCsv(report))]);
 process.stdout.write(JSON.stringify({status:report.status,...report.summary},null,2)+"\n");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write("Japan parent override validation failed closed: "+(e.stack??e)+"\n");process.exitCode=1;});
