import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDispositionRows,
  buildDispositionSummary,
  toCsv,
  toInitialAdminCatalogExclusionCsv,
} from "../scripts/geonames-approved-exception-dispositions.mjs";

const directory = new URL(
  "../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",
  import.meta.url,
);

async function json(name) {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

test("approved exception dispositions reproduce the committed row-level CSV exactly", async () => {
  const [admin1, admin2, originalSummary, committedCsv, committedSummary, committedExclusions] = await Promise.all([
    json("unmatched_admin1_references.json"),
    json("unmatched_admin2_references.json"),
    json("summary.json"),
    readFile(new URL("owner-approved-dispositions.csv", directory), "utf8"),
    json("owner-approved-disposition-summary.json"),
    readFile(new URL("initial-operational-admin-catalog-exclusions.csv", directory), "utf8"),
  ]);

  const rows = buildDispositionRows(admin1, admin2);
  const summary = buildDispositionSummary(rows, originalSummary);

  assert.equal(rows.length, 2573);
  assert.equal(new Set(rows.map((row) => row.geonames_id)).size, 2416);
  assert.equal(toCsv(rows), committedCsv);
  assert.equal(toInitialAdminCatalogExclusionCsv(rows), committedExclusions);
  assert.deepEqual(summary, committedSummary);
  assert.equal(summary.reconciliation.overlap_ids_between_levels, 157);
  assert.equal(summary.reconciliation.original_summary_matches, true);
  assert.equal(summary.parent_ids_or_links_assigned, 0);
  assert.equal(summary.source_exception_exports_unchanged, true);
  assert.equal(summary.source_raw_codes_preserved, true);
});

test("approved dispositions separate current hierarchy blockers from other entity types", async () => {
  const [admin1, admin2, originalSummary] = await Promise.all([
    json("unmatched_admin1_references.json"),
    json("unmatched_admin2_references.json"),
    json("summary.json"),
  ]);
  const rows = buildDispositionRows(admin1, admin2);
  const summary = buildDispositionSummary(rows, originalSummary);

  assert.equal(summary.country_level_records_no_admin_parent_required, 5);
  assert.equal(summary.current_admin_features_requiring_country_specific_parent_path, 128);
  assert.equal(summary.unique_record_dispositions.COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED, 5);
  assert.equal(summary.unique_record_dispositions.PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED, 128);
  assert.equal(summary.initial_operational_admin_catalog.current_admin_records_excluded_for_unresolved_parent_path, 128);
  assert.equal(summary.initial_operational_admin_catalog.current_admin_records_eligible_from_this_exception_set, 0);
  const currentAdminRows = rows.filter((row) => /^ADM[1-4]$/.test(row.feature_code));
  assert.equal(new Set(currentAdminRows.map((row) => row.geonames_id)).size, 128);
  const exclusionCsv = toInitialAdminCatalogExclusionCsv(rows);
  assert.equal(exclusionCsv.trim().split("\n").length - 1, 128);
  assert.equal(
    (exclusionCsv.match(/EXCLUDE_FROM_INITIAL_OPERATIONAL_CATALOG_UNRESOLVED_PARENT_PATH/g) || []).length,
    128,
  );
  assert.equal(
    (exclusionCsv.match(/RAW_ADMIN1_00_GENERAL_FEATURE_ANCESTOR_UNRESOLVED/g) || []).length,
    126,
  );
  assert.equal(
    (exclusionCsv.match(/EXACT_COUNTRY_ADMIN_PARENT_KEY_NOT_FOUND/g) || []).length,
    2,
  );
  assert.equal(summary.unique_record_dispositions.PRESERVE_HISTORICAL_NOT_CURRENT_ADMIN_SELECTOR, 1030);
  assert.equal(summary.unique_record_dispositions.PRESERVE_UNDIFFERENTIATED_NOT_CURRENT_ADMIN_SELECTOR, 1109);
  assert.equal(summary.non_country_references_still_needing_hierarchy_or_association_review, 2568);

  const destinationReview = summary.country_scoped_destination_review;
  assert.equal(destinationReview.scope, "five-country crosswalk-exception union only; not a worldwide catalogue total");
  assert.equal(destinationReview.current_populated_place_candidate_unique_ids, 58);
  assert.deepEqual(destinationReview.current_populated_place_candidate_ids_by_feature_code, { PPL: 54, PPLL: 4 });
  assert.deepEqual(destinationReview.current_populated_place_candidate_ids_by_source_country_code, { SG: 58 });
  assert.equal(destinationReview.other_populated_place_family_unique_ids_held_for_review, 81);
  assert.equal(destinationReview.historical_or_noncurrent_place_unique_ids_held, 2);
  assert.equal(destinationReview.country_area_entities_not_place_destinations, 5);
  assert.equal(destinationReview.administrative_parent_required_for_country_only_search, false);
  assert.equal(destinationReview.source_country_to_internal_country_mapping_approved, false);
  assert.equal(destinationReview.current_place_candidates_waiting_for_country_mapping_review, 58);
  assert.equal(destinationReview.operational_selectable_rows, 0);
  assert.equal(destinationReview.parent_links_created, 0);

  const countryOnlyCandidate = rows.find((row) => row.country_code === "SG" && row.feature_code === "PPL");
  assert.ok(countryOnlyCandidate);
  assert.equal(countryOnlyCandidate.current_admin_selector_treatment, "PLACE_ENTITY_NOT_ADMINISTRATIVE_SELECTOR");
  assert.equal(
    countryOnlyCandidate.country_scoped_destination_treatment,
    "CURRENT_POPULATED_PLACE_CANDIDATE__ADMIN_PARENT_NOT_REQUIRED_FOR_COUNTRY_ONLY_SEARCH",
  );
  assert.equal(countryOnlyCandidate.country_scoped_destination_operational_selectable, false);
  assert.equal(countryOnlyCandidate.parent_link_created, false);

  const heldOtherPlace = rows.find((row) => row.country_code === "SG" && row.feature_code === "PPLX");
  assert.equal(heldOtherPlace.country_scoped_destination_treatment, "OTHER_POPULATED_PLACE_FAMILY_TYPE_REQUIRES_REVIEW");
  const historicalPlace = rows.find((row) => row.country_code === "SG" && row.feature_code === "PPLH");
  assert.equal(historicalPlace.country_scoped_destination_treatment, "HISTORICAL_OR_NONCURRENT_POPULATED_PLACE_HELD_OUT");
});

test("raw codes and entity identities stay intact; no exception row creates a parent link", async () => {
  const [admin1, admin2, originalSummary] = await Promise.all([
    json("unmatched_admin1_references.json"),
    json("unmatched_admin2_references.json"),
    json("summary.json"),
  ]);
  const rows = buildDispositionRows(admin1, admin2);
  const summary = buildDispositionSummary(rows, originalSummary);

  assert.deepEqual(
    rows.map(({ geonames_id, country_code, feature_code, raw_admin1_code, raw_admin2_code }) =>
      ({ geonames_id, country_code, feature_code, raw_admin1_code, raw_admin2_code })),
    [...admin1.map((row) => ({ ...row, reference_level: "admin1" })),
      ...admin2.map((row) => ({ ...row, reference_level: "admin2" }))]
      .map(({ geonames_id, country_code, feature_code, raw_admin1_code, raw_admin2_code }) =>
        ({ geonames_id, country_code, feature_code, raw_admin1_code, raw_admin2_code })),
  );
  assert.ok(rows.every((row) => row.parent_link_created === false));
  assert.equal(summary.parent_ids_or_links_assigned, 0);
});
