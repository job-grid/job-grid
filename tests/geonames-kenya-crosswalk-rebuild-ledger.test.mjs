import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildKenyaCrosswalkRebuildLedger,
  renderKenyaCrosswalkRebuildLedgerCsv
} from "../scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs";

const auditPath = fileURLToPath(new URL(
  "../docs/geonames-kenya-legacy-admin1-crosswalk-audit-2026-10-11.json",
  import.meta.url
));
const evidencePath = fileURLToPath(new URL(
  "../docs/geonames-kenya-external-ancestor-evidence-2026-10-11.json",
  import.meta.url
));

async function fixtures() {
  const [auditText, evidenceText] = await Promise.all([
    readFile(auditPath, "utf8"),
    readFile(evidencePath, "utf8")
  ]);
  return [JSON.parse(auditText), JSON.parse(evidenceText)];
}

test("rebuild ledger preserves both source identities and reports exact legacy-key gaps", async () => {
  const [audit, evidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence);
  assert.equal(ledger.status, "REBUILD_LEDGER_CREATED__DIRECT_PARENT_PATHS_UNRESOLVED");
  assert.equal(ledger.totals.target_rows, 2);
  assert.equal(ledger.totals.exact_current_legacy_keys_absent, 2);
  assert.equal(ledger.totals.county_ancestor_candidates_recorded, 2);
  assert.equal(ledger.totals.immediate_parent_paths_verified, 0);
  assert.equal(ledger.totals.raw_admin1_codes_changed, 0);
  assert.equal(ledger.totals.operational_parent_links_created, 0);
  assert.equal(ledger.source.current_admin1_crosswalk.retrieval_metadata_verified, true);
});

test("county-level candidate IDs remain separate from immediate parents", async () => {
  const [audit, evidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence);
  const kiambururu = ledger.records.find((row) => row.geonames_id === "192705");
  const imenti = ledger.records.find((row) => row.geonames_id === "7800132");
  assert.ok(kiambururu);
  assert.ok(imenti);
  assert.equal(kiambururu.raw_admin1_code_preserved, "01");
  assert.equal(kiambururu.legacy_composite_key, "KE.01");
  assert.equal(kiambururu.candidate_county_ancestor.geonames_id, "8693007");
  assert.equal(kiambururu.candidate_county_ancestor.feature_code, "ADM2");
  assert.equal(kiambururu.immediate_parent_geonames_id, null);
  assert.equal(imenti.raw_admin1_code_preserved, "03");
  assert.equal(imenti.legacy_composite_key, "KE.03");
  assert.equal(imenti.candidate_county_ancestor.geonames_id, "8693009");
  assert.equal(imenti.candidate_county_ancestor.feature_code, "ADM2");
  assert.equal(imenti.immediate_parent_geonames_id, null);
  for (const row of ledger.records) {
    assert.equal(row.complete_parent_path_verified, false);
    assert.equal(row.raw_admin1_code_changed, false);
    assert.equal(row.operational_parent_link_created, false);
    assert.match(row.active_selector_disposition, /^EXCLUDE_/);
  }
});

test("ledger retains the specific blockers for the two different Kenya records", async () => {
  const [audit, evidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence);
  const kiambururu = ledger.records.find((row) => row.geonames_id === "192705");
  const imenti = ledger.records.find((row) => row.geonames_id === "7800132");
  assert.equal(kiambururu.identity_and_path_review_status, "BLOCKED_LOCATION_VS_SUB_LOCATION_LEVEL_CONFLICT");
  assert.ok(kiambururu.missing_evidence.some((item) => /official unit class/.test(item)));
  assert.ok(kiambururu.missing_evidence.some((item) => /GeoNames ID 192705/.test(item)));
  assert.equal(imenti.identity_and_path_review_status, "BLOCKED_NAME_VARIANT_AND_UNIT_TYPE_CROSSWALK");
  assert.ok(imenti.missing_evidence.some((item) => /administrative unit from an electoral constituency/.test(item)));
  assert.ok(imenti.missing_evidence.some((item) => /GeoNames ID 7800132/.test(item));
});

test("even a newly present legacy key cannot auto-create parentage", async () => {
  const [audit, evidence] = await fixtures();
  audit.targets[0].crosswalk_rows_found = 1;
  audit.targets[0].disposition = "KEY_PRESENT_REQUIRES_INDEPENDENT_PARENT_SOURCE_REVIEW";
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence);
  const row = ledger.records.find((record) => record.geonames_id === "192705");
  assert.equal(row.current_crosswalk_key_row_count, 1);
  assert.equal(row.current_crosswalk_key_status, "KEY_PRESENT__INDEPENDENT_IDENTITY_AND_PARENT_REVIEW_REQUIRED");
  assert.equal(row.immediate_parent_geonames_id, null);
  assert.equal(row.operational_parent_link_created, false);
  assert.equal(ledger.totals.operational_parent_links_created, 0);
});

test("ledger rejects source identity drift or a different county entity", async () => {
  const [audit, evidence] = await fixtures();
  const changedCode = structuredClone(audit);
  changedCode.targets[0].raw_admin1_code_preserved = "22";
  assert.throws(() => buildKenyaCrosswalkRebuildLedger(changedCode, evidence), /Raw admin1 code drift/);
  const changedCounty = structuredClone(evidence);
  changedCounty.records.find((row) => row.geonames_id === "192705").candidate_county_ancestor.geonames_id = "192709";
  assert.throws(() => buildKenyaCrosswalkRebuildLedger(audit, changedCounty), /County candidate identity mismatch/);
});

test("CSV renders exactly one summary header and two records without approving ancestry", async () => {
  const [audit, evidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence);
  const csv = renderKenyaCrosswalkRebuildLedgerCsv(ledger);
  assert.equal(csv.trimEnd().split("\n").length, 3);
  assert.match(csv, /192705/);
  assert.match(csv, /7800132/);
  assert.match(csv, /EXCLUDE_UNTIL_IDENTITY_AND_IMMEDIATE_PARENT_PATH_ARE_VERIFIED/);
});
