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
const currentUnitEvidencePath = fileURLToPath(new URL(
  "../docs/geonames-kenya-current-unit-evidence-2026-10-12.json",
  import.meta.url
));

async function fixtures() {
  const [auditText, evidenceText, currentUnitEvidenceText] = await Promise.all([
    readFile(auditPath, "utf8"),
    readFile(evidencePath, "utf8"),
    readFile(currentUnitEvidencePath, "utf8")
  ]);
  return [JSON.parse(auditText), JSON.parse(evidenceText), JSON.parse(currentUnitEvidenceText)];
}

test("rebuild ledger preserves both source identities and reports exact legacy-key gaps", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
  assert.equal(ledger.status, "OFFICIAL_ADMIN_PATHS_DOCUMENTED__GEONAMES_CROSSWALK_PENDING");
  assert.equal(ledger.totals.target_rows, 2);
  assert.equal(ledger.totals.exact_current_legacy_keys_absent, 2);
  assert.equal(ledger.totals.county_ancestor_candidates_recorded, 2);
  assert.equal(ledger.totals.official_native_parent_paths_documented, 2);
  assert.equal(ledger.totals.geonames_entity_crosswalks_verified, 0);
  assert.equal(ledger.totals.immediate_parent_paths_verified, 0);
  assert.equal(ledger.totals.raw_admin1_codes_changed, 0);
  assert.equal(ledger.totals.operational_parent_links_created, 0);
  assert.equal(ledger.source.current_admin1_crosswalk.retrieval_metadata_verified, true);
  assert.equal(ledger.source.current_unit_evidence_status, "OFFICIAL_NATIVE_UNIT_PATHS_DOCUMENTED__GEONAMES_CROSSWALK_PENDING");
});

test("county-level candidate IDs remain separate from immediate parents", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
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
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
  const kiambururu = ledger.records.find((row) => row.geonames_id === "192705");
  const imenti = ledger.records.find((row) => row.geonames_id === "7800132");
  assert.equal(kiambururu.identity_and_path_review_status, "BLOCKED_LOCATION_VS_SUB_LOCATION_LEVEL_CONFLICT");
  assert.ok(kiambururu.missing_evidence.some((item) => /official unit class/.test(item)));
  assert.ok(kiambururu.missing_evidence.some((item) => /GeoNames ID 192705/.test(item)));
  assert.equal(imenti.identity_and_path_review_status, "BLOCKED_NAME_VARIANT_AND_UNIT_TYPE_CROSSWALK");
  assert.ok(imenti.missing_evidence.some((item) => /administrative unit from an electoral constituency/.test(item)));
  assert.ok(imenti.missing_evidence.some((item) => /GeoNames ID 7800132/.test(item)));
});

test("even a newly present legacy key cannot auto-create parentage", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  audit.targets[0].crosswalk_rows_found = 1;
  audit.targets[0].disposition = "KEY_PRESENT_REQUIRES_INDEPENDENT_PARENT_SOURCE_REVIEW";
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
  const row = ledger.records.find((record) => record.geonames_id === "192705");
  assert.equal(row.current_crosswalk_key_row_count, 1);
  assert.equal(row.current_crosswalk_key_status, "KEY_PRESENT__INDEPENDENT_IDENTITY_AND_PARENT_REVIEW_REQUIRED");
  assert.equal(row.immediate_parent_geonames_id, null);
  assert.equal(row.operational_parent_link_created, false);
  assert.equal(ledger.totals.operational_parent_links_created, 0);
});

test("ledger rejects source identity drift or a different county entity", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const changedCode = structuredClone(audit);
  changedCode.targets[0].raw_admin1_code_preserved = "22";
  assert.throws(() => buildKenyaCrosswalkRebuildLedger(changedCode, evidence), /Raw admin1 code drift/);
  const changedCounty = structuredClone(evidence);
  changedCounty.records.find((row) => row.geonames_id === "192705").candidate_county_ancestor.geonames_id = "192709";
  assert.throws(() => buildKenyaCrosswalkRebuildLedger(audit, changedCounty), /County candidate identity mismatch/);
});

test("CSV renders exactly one summary header and two records without approving ancestry", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
  const csv = renderKenyaCrosswalkRebuildLedgerCsv(ledger);
  assert.equal(csv.trimEnd().split("\n").length, 3);
  assert.match(csv, /192705/);
  assert.match(csv, /7800132/);
  assert.match(csv, /EXCLUDE_UNTIL_IDENTITY_AND_IMMEDIATE_PARENT_PATH_ARE_VERIFIED/);
  assert.match(csv, /OFFICIAL_CURRENT_NATIVE_PATH_DOCUMENTED/);
});


test("current official native paths are recorded without claiming GeoNames IDs are crosswalked", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
  const kiambururu = ledger.records.find((row) => row.geonames_id === "192705");
  const imenti = ledger.records.find((row) => row.geonames_id === "7800132");
  assert.deepEqual(kiambururu.native_official_unit_path.verified_path, [
    "Kenya", "Kiambu County", "Githunguri Sub-County", "Kiambururu (Location)"
  ]);
  assert.equal(kiambururu.native_official_unit_path.unit_level, "Location");
  assert.equal(kiambururu.native_official_unit_path.immediate_parent_official_name, "Githunguri Sub-County");
  assert.deepEqual(imenti.native_official_unit_path.verified_path, [
    "Kenya", "Meru County", "Imenti Central (Sub-County)"
  ]);
  assert.equal(imenti.native_official_unit_path.unit_level, "Sub-County");
  assert.deepEqual(imenti.native_official_unit_path.official_subcounty_statistics, {
    divisions: 4, locations: 22, sub_locations: 57, area_km2: 333.10
  });
  for (const row of ledger.records) {
    assert.equal(row.geonames_entity_crosswalk_status, "CURRENT_NATIVE_UNIT_PATH_KNOWN__GEONAMES_ID_CROSSWALK_PENDING");
    assert.equal(row.immediate_parent_geonames_id, null);
    assert.equal(row.operational_parent_link_created, false);
  }
});

test("same-name GeoNames nodes with different feature codes remain distinct review candidates", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const ledger = buildKenyaCrosswalkRebuildLedger(audit, evidence, currentUnitEvidence);
  const kiambururu = ledger.records.find((row) => row.geonames_id === "192705");
  const imenti = ledger.records.find((row) => row.geonames_id === "7800132");
  assert.ok(kiambururu.candidate_geonames_parent_nodes_for_review.some((node) =>
    node.geonames_id === "197219" && node.role === "NOT_AN_APPROVED_PARENT"));
  assert.ok(kiambururu.candidate_geonames_parent_nodes_for_review.some((node) =>
    node.geonames_id === "192709" && node.feature_code === "ADM1"));
  assert.ok(kiambururu.candidate_geonames_parent_nodes_for_review.some((node) =>
    node.geonames_id === "8693007" && node.feature_code === "ADM2"));
  assert.ok(imenti.candidate_geonames_parent_nodes_for_review.some((node) =>
    node.geonames_id === "186824" && node.feature_code === "ADM1"));
  assert.ok(imenti.candidate_geonames_parent_nodes_for_review.some((node) =>
    node.geonames_id === "8693009" && node.feature_code === "ADM2"));
  for (const row of ledger.records) {
    assert.equal(row.immediate_parent_geonames_id, null);
  }
});

test("generator fails closed if official native path evidence has a different raw code or prematurely approves a GeoNames parent", async () => {
  const [audit, evidence, currentUnitEvidence] = await fixtures();
  const changedCode = structuredClone(currentUnitEvidence);
  changedCode.records.find((row) => row.geonames_id === "192705").raw_admin1_code_preserved = "22";
  assert.throws(() => buildKenyaCrosswalkRebuildLedger(audit, evidence, changedCode), /Current official-unit evidence raw code mismatch/);
  const approvedTooEarly = structuredClone(currentUnitEvidence);
  approvedTooEarly.records.find((row) => row.geonames_id === "7800132").geonames_crosswalk.immediate_parent_geonames_id = "186824";
  assert.throws(() => buildKenyaCrosswalkRebuildLedger(audit, evidence, approvedTooEarly), /must remain explicitly pending/);
});
