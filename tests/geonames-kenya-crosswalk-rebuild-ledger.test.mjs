import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildEffectiveExclusionOverlayCsv,
  buildKenyaCrosswalkRebuildLedger,
  parseCsvRecords,
  renderKenyaCrosswalkRebuildLedgerCsv
} from "../scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs";

const docs=new URL("../docs/",import.meta.url);
const exclusionsDir=new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",import.meta.url);
async function fixtures() {
  const urls=[
    new URL("geonames-kenya-legacy-admin1-crosswalk-audit-2026-10-11.json",docs),
    new URL("geonames-kenya-external-ancestor-evidence-2026-10-11.json",docs),
    new URL("geonames-kenya-current-unit-evidence-2026-10-12.json",docs),
    new URL("geonames-kenya-admin1-parent-override-2026-10-12.json",docs),
    new URL("initial-operational-admin-catalog-exclusions.csv",exclusionsDir),
    new URL("../geonames-japan-parent-overrides-2026-10-12.json",docs)
  ];
  const [a,b,c,d,e,f]=await Promise.all(urls.map(url=>readFile(url,"utf8")));
  return [JSON.parse(a),JSON.parse(b),JSON.parse(c),JSON.parse(d),e,JSON.parse(f)];
}
test("ledger verifies one parent override and retains one unresolved target",async()=>{
  const [a,b,c,d]=await fixtures(), ledger=buildKenyaCrosswalkRebuildLedger(a,b,c,d);
  assert.equal(ledger.status,"ONE_PARENT_PATH_VERIFIED__ONE_PARENT_PATH_BLOCKED");
  assert.deepEqual(ledger.totals,{
    target_rows:2,exact_current_legacy_keys_absent:2,official_native_parent_paths_documented:2,
    source_backed_parent_overrides_approved:1,immediate_parent_paths_verified:1,
    eligible_from_kenya_exception_set:1,excluded_pending_parent_crosswalk:1,
    raw_admin1_codes_changed:0,operational_parent_links_created:0
  });
});
test("Imenti crosswalk uses current parent ID 186824 based on exact 03-to-35 history",async()=>{
  const [a,b,c,d]=await fixtures(), row=buildKenyaCrosswalkRebuildLedger(a,b,c,d).records.find(r=>r.geonames_id==="7800132");
  assert.equal(row.raw_admin1_code_preserved,"03");
  assert.equal(row.legacy_composite_key,"KE.03");
  assert.equal(row.current_crosswalk_key_row_count,0);
  assert.equal(row.immediate_parent_geonames_id,"186824");
  assert.equal(row.immediate_parent_current_composite_key,"KE.35");
  assert.equal(row.complete_parent_path_verified,true);
  assert.equal(row.geonames_entity_crosswalk_status,"VERIFIED_SOURCE_BACKED_ADMIN1_PARENT_OVERRIDE");
  assert.equal(row.raw_admin1_code_changed,false);
  assert.equal(row.source_record_modified,false);
  assert.equal(row.operational_parent_link_created,false);
  assert.equal(row.parent_mapping_evidence.history_observation,"name:Meru Central District>Meru,adm1:03>35,featureCode:ADM2>ADM1");
  assert.notEqual(row.immediate_parent_geonames_id,"8693009");
});
test("parent override fails closed if current KE.35 no longer resolves to ID 186824",async()=>{
  const [a,b,c,d]=await fixtures(), changed=structuredClone(a);
  const keys=changed.current_ke_admin1_keys??changed.present_current_keys_used_only_as_examples_not_assignments;
  keys.find(row=>row.composite_key==="KE.35").geonames_id="8693009";
  assert.throws(()=>buildKenyaCrosswalkRebuildLedger(changed,b,c,d),/Current KE\.35 no longer maps to parent ID 186824/);
});
test("Kiambururu stays excluded because Githunguri Sub-County lacks a verified GeoNames node",async()=>{
  const [a,b,c,d]=await fixtures(), row=buildKenyaCrosswalkRebuildLedger(a,b,c,d).records.find(r=>r.geonames_id==="192705");
  assert.equal(row.raw_admin1_code_preserved,"01");
  assert.equal(row.legacy_composite_key,"KE.01");
  assert.equal(row.immediate_parent_geonames_id,null);
  assert.equal(row.complete_parent_path_verified,false);
  assert.equal(row.active_selector_disposition,"EXCLUDE_UNTIL_DIRECT_PARENT_CROSSWALK_VERIFIED");
  assert.ok(row.missing_evidence.some(item=>item.includes("Githunguri Sub-County")));
  assert.ok(row.candidate_geonames_parent_nodes_for_review.some(node=>node.geonames_id==="197219"&&node.role==="NOT_AN_APPROVED_PARENT"));
});
test("source code drift, wrong parent ID, or wrong historic lineage fail closed",async()=>{
  const [a,b,c,d]=await fixtures();
  const code=structuredClone(a); code.targets.find(row=>row.geonames_id==="7800132").source_raw_admin1_code="35";
  assert.throws(()=>buildKenyaCrosswalkRebuildLedger(code,b,c,d),/Raw admin1 code drift/);
  const parent=structuredClone(d); parent.approved_records[0].parent_geonames_id="8693009";
  assert.throws(()=>buildKenyaCrosswalkRebuildLedger(a,b,c,parent),/Override parent is not canonical/);
  const history=structuredClone(d); history.approved_records[0].history_observation="no transition";
  assert.throws(()=>buildKenyaCrosswalkRebuildLedger(a,b,c,history),/Exact parent record history transition is missing/);
});
test("combined effective overlay re-admits only the three separately source-backed records",async()=>{
  const [a,b,c,d,original,japan]=await fixtures(), ledger=buildKenyaCrosswalkRebuildLedger(a,b,c,d);
  const overlay=buildEffectiveExclusionOverlayCsv(ledger,original,japan);
  const before=parseCsvRecords(original), after=parseCsvRecords(overlay);
  const oldIds=before.map(row=>row.geonames_id), newIds=after.map(row=>row.geonames_id);
  assert.equal(before.length,128); assert.equal(after.length,125);
  assert.deepEqual(oldIds.filter(id=>!newIds.includes(id)),["1850471","1850496","7800132"]);
  assert.ok(newIds.includes("192705"));
  assert.equal(after.filter(row=>row.country_code==="JP").length,124);
  assert.equal(after.filter(row=>row.country_code==="KE").length,1);
});
test("ledger CSV lists exact source-backed parent for Imenti and unresolved status for Kiambururu",async()=>{
  const [a,b,c,d]=await fixtures(), ledger=buildKenyaCrosswalkRebuildLedger(a,b,c,d);
  const csv=renderKenyaCrosswalkRebuildLedgerCsv(ledger);
  assert.equal(csv.trimEnd().split("\n").length,3);
  assert.match(csv,/7800132/); assert.match(csv,/186824/);
  assert.match(csv,/INCLUDE_IN_EFFECTIVE_INITIAL_ADMIN_CATALOG_VIA_SOURCE_BACKED_PARENT_OVERRIDE/);
  assert.match(csv,/EXCLUDE_UNTIL_DIRECT_PARENT_CROSSWALK_VERIFIED/);
});
