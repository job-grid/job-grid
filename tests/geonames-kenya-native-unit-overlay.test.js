import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const overlay = JSON.parse(await readFile(
  new URL("../docs/geonames-kenya-native-unit-overlay-proposal-2026-10-12.json", import.meta.url),
  "utf8"
));

test("Kenya native-unit fixture is explicitly non-operational and not source-pinned", () => {
  assert.equal(overlay.country_code, "KE");
  assert.equal(
    overlay.status,
    "NATIVE_PATH_SOURCE_BACKED__ENTITY_CROSSWALKS_PENDING__NOT_SELECTABLE"
  );
  assert.equal(overlay.source_retrieval_boundary.official_source_snapshot_pinned, false);
  assert.equal(overlay.source_retrieval_boundary.source_bytes_hashes_recorded, false);
  assert.equal(overlay.decision_boundary.operational_parent_links_created, 0);
  assert.equal(overlay.decision_boundary.selectable_records_added, 0);
  assert.equal(overlay.decision_boundary.database_migrations_seeds_imports_or_deployments, false);
});

test("proposal keys are source-scoped reconciliation keys, never official IDs or production UUIDs", () => {
  const keys = overlay.proposal_units.map((unit) => unit.proposal_key);
  assert.equal(new Set(keys).size, keys.length);
  for (const unit of overlay.proposal_units) {
    assert.equal(unit.proposal_key_is_official_identifier, false);
    assert.equal(unit.production_uuid, null);
    assert.equal(unit.country_code, "KE");
  }
});

test("native chain records Kiambu County > Githunguri Sub-County > Kiambururu Location", () => {
  const byKey = new Map(overlay.proposal_units.map((unit) => [unit.proposal_key, unit]));
  const subcounty = byKey.get("ke:national-admin-unit:kiambu:githunguri-sub-county");
  const location = byKey.get("ke:national-admin-unit:kiambu:githunguri:kiambururu-location");

  assert.equal(subcounty.official_name, "Githunguri Sub-County");
  assert.equal(subcounty.unit_level, "sub_county");
  assert.equal(subcounty.parent_proposal_key, "ke:national-admin-unit:kiambu-county");
  assert.equal(location.official_name, "Kiambururu");
  assert.equal(location.unit_level, "location");
  assert.equal(location.parent_proposal_key, subcounty.proposal_key);
  assert.ok(overlay.native_path_edges.some((edge) =>
    edge.child_proposal_key === location.proposal_key &&
    edge.parent_proposal_key === subcounty.proposal_key &&
    edge.status === "SOURCE_BACKED_NATIVE_PATH__NOT_OPERATIONAL"
  ));
});

test("missing Githunguri GeoNames node does not trigger a fabricated ID", () => {
  const subcounty = overlay.proposal_units.find((unit) =>
    unit.unit_level === "sub_county" && unit.official_name === "Githunguri Sub-County"
  );
  assert.equal(subcounty.geonames_crosswalk.status, "NO_EXACT_SUBCOUNTY_FEATURE_FOUND_IN_REVIEWED_GEONAMES_KE_SNAPSHOT");
  assert.equal(subcounty.geonames_crosswalk.approved_geonames_id, null);
  assert.deepEqual(subcounty.geonames_crosswalk.candidate_geonames_ids, []);
});

test("Kiambururu GeoNames candidate remains unresolved and raw legacy key is preserved", () => {
  const location = overlay.proposal_units.find((unit) => unit.official_name === "Kiambururu");
  assert.equal(location.geonames_crosswalk.status, "UNRESOLVED_CANDIDATE_ONLY");
  assert.equal(location.geonames_crosswalk.approved_geonames_id, null);
  assert.equal(location.geonames_crosswalk.candidate_geonames_ids[0].geonames_id, "192705");
  assert.equal(location.geonames_crosswalk.candidate_geonames_ids[0].disposition, "REVIEW_ONLY_LEVEL_AND_IDENTITY_MISMATCH");
  assert.equal(location.raw_geonames_admin1_code_preserved, "01");
  assert.equal(location.raw_geonames_legacy_composite_key_preserved, "KE.01");
  assert.equal(location.selectability, "NOT_SELECTABLE_PENDING_IDENTITY_CROSSWALK_AND_DUPLICATE_REVIEW");
});

test("Githunguri Location GeoNames ID 197219 is explicitly forbidden as the sub-county parent", () => {
  const location = overlay.proposal_units.find((unit) => unit.official_name === "Kiambururu");
  assert.equal(location.geonames_crosswalk.forbidden_parent_candidate.geonames_id, "197219");
  assert.equal(location.geonames_crosswalk.forbidden_parent_candidate.feature_code, "ADMD");
  assert.equal(overlay.decision_boundary.geonames_id_197219_used_as_subcounty_parent, false);
  assert.deepEqual(overlay.decision_boundary.approved_geonames_parent_ids, []);
});

test("every referenced source key exists and official evidence does not imply a hashed snapshot", () => {
  const sourceKeys = new Set(overlay.sources.map((source) => source.source_key));
  for (const edge of overlay.native_path_edges) {
    for (const key of edge.source_keys) assert.ok(sourceKeys.has(key), "missing source " + key);
  }
  assert.ok(overlay.sources.every((source) => /^https:\/\/(www\.interior\.go\.ke|kiambu\.go\.ke|www\.knbs\.or\.ke)\//.test(source.url)));
  assert.ok(overlay.sources.every((source) => source.title && source.authority));
  assert.equal(overlay.source_retrieval_boundary.official_source_snapshot_pinned, false);
});
