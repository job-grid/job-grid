import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDispositionRows,
  buildDispositionSummary,
  toCsv,
} from "../scripts/geonames-approved-exception-dispositions.mjs";

const directory = new URL(
  "../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",
  import.meta.url,
);

async function json(name) {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

test("approved exception dispositions reproduce the committed row-level CSV exactly", async () => {
  const [admin1, admin2, originalSummary, committedCsv, committedSummary] = await Promise.all([
    json("unmatched_admin1_references.json"),
    json("unmatched_admin2_references.json"),
    json("summary.json"),
    readFile(new URL("owner-approved-dispositions.csv", directory), "utf8"),
    json("owner-approved-disposition-summary.json"),
  ]);

  const rows = buildDispositionRows(admin1, admin2);
  const summary = buildDispositionSummary(rows, originalSummary);

  assert.equal(rows.length, 2573);
  assert.equal(new Set(rows.map((row) => row.geonames_id)).size, 2416);
  assert.equal(toCsv(rows), committedCsv);
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
  assert.equal(summary.unique_record_dispositions.PRESERVE_HISTORICAL_NOT_CURRENT_ADMIN_SELECTOR, 1030);
  assert.equal(summary.unique_record_dispositions.PRESERVE_UNDIFFERENTIATED_NOT_CURRENT_ADMIN_SELECTOR, 1109);
  assert.equal(summary.non_country_references_still_needing_hierarchy_or_association_review, 2568);
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
