import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const evidencePath = fileURLToPath(new URL(
  "../docs/geonames-kenya-external-ancestor-evidence-2026-10-11.json",
  import.meta.url,
));

test("external Kenya evidence only records county-level candidates, never approved parent links", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(evidence.decision_boundary.owner_approval_required, true);
  assert.equal(evidence.decision_boundary.parent_path_complete, false);
  assert.equal(evidence.decision_boundary.operational_parent_links_created, 0);
  assert.equal(evidence.records.length, 2);
  for (const row of evidence.records) {
    assert.equal(row.parent_link_created, false);
    assert.equal(row.country_code, "KE");
    assert.equal(row.status, "COUNTY_ANCESTOR_EVIDENCE_FOUND__IMMEDIATE_PARENT_PATH_UNRESOLVED");
    assert.equal(row.candidate_county_ancestor.feature_code, "ADM2");
    assert.match(row.candidate_county_ancestor.geonames_id, /^\d+$/);
    assert.ok(row.candidate_county_ancestor.evidence_sources.length >= 1);
    assert.ok(row.candidate_county_ancestor.unresolved_points.length >= 1);
  }
});

test("Kiambururu evidence preserves code 01 and flags the official administrative-level conflict", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const row = evidence.records.find((candidate) => candidate.geonames_id === "192705");
  assert.ok(row);
  assert.equal(row.raw_admin1_code_preserved, "01");
  assert.equal(row.candidate_county_ancestor.geonames_id, "8693007");
  assert.match(row.candidate_county_ancestor.disposition, /ADMIN_LEVEL_CONFLICT/);
  assert.ok(row.candidate_county_ancestor.evidence_sources.some((source) =>
    source.url.includes("kenyalaw.org") && /Kiambururu sub-locations/.test(source.specific_finding)));
  assert.ok(row.candidate_county_ancestor.evidence_sources.some((source) =>
    source.url.includes("interior.go.ke") && /Kiambururu as a Location/.test(source.specific_finding)));
});

test("Imenti Central evidence preserves code 03 and treats Meru County as ancestor candidate only", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const row = evidence.records.find((candidate) => candidate.geonames_id === "7800132");
  assert.ok(row);
  assert.equal(row.raw_admin1_code_preserved, "03");
  assert.equal(row.candidate_county_ancestor.geonames_id, "8693009");
  assert.match(row.candidate_county_ancestor.disposition, /IMMEDIATE_PATH_UNVERIFIED/);
  assert.ok(row.candidate_county_ancestor.evidence_sources.some((source) =>
    source.url === "https://meru.go.ke/sub-counties/" && /Central Imenti/.test(source.specific_finding)));
});

test("candidate county IDs are current ADM2 records distinct from the former/current ADM1 records", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.match(evidence.important_note, /ADM2 entities distinct from.*ADM1/);
  assert.match(evidence.important_note, /Kiambu ID 192709 and Meru ID 186824/);
  assert.equal(evidence.records.find((row) => row.geonames_id === "192705").candidate_county_ancestor.geonames_id, "8693007");
  assert.equal(evidence.records.find((row) => row.geonames_id === "7800132").candidate_county_ancestor.geonames_id, "8693009");
});
