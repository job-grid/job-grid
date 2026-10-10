import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const directory = new URL(
  "../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",
  import.meta.url
);

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

async function readCsvRecords(name) {
  const source = await readFile(new URL(name, directory), "utf8");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  assert.equal(quoted, false, name + " has an unterminated quoted CSV field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  assert.ok(rows.length > 0, name + " must contain a header row");
  const [headers, ...values] = rows;
  assert.equal(new Set(headers).size, headers.length, name + " has duplicate headers");
  for (const valuesRow of values) {
    assert.equal(valuesRow.length, headers.length, name + " has a row/header width mismatch");
  }

  return values.map((valuesRow) => Object.fromEntries(
    headers.map((header, index) => [header, valuesRow[index]])
  ));
}

async function loadExceptionSet(level, expectedCount) {
  const jsonName = `unmatched_${level}_references.json`;
  const csvName = `unmatched_${level}_references.csv`;
  const jsonRows = await readJson(jsonName);
  const csvRows = await readCsvRecords(csvName);

  assert.equal(jsonRows.length, expectedCount, jsonName + " count changed");
  assert.equal(csvRows.length, expectedCount, csvName + " count changed");
  assert.equal(new Set(jsonRows.map((row) => row.geonames_id)).size, expectedCount,
    jsonName + " contains duplicate GeoNames IDs");

  const normalizedCsvRows = csvRows.map((row) => ({
    ...row,
    crosswalk_lookup_key: row.crosswalk_lookup_key || null
  }));
  assert.deepEqual(normalizedCsvRows, jsonRows,
    csvName + " and " + jsonName + " must carry the same row-level evidence");

  return jsonRows;
}

test("crosswalk exception exports remain row-complete and CSV/JSON-equivalent", async () => {
  const summary = await readJson("summary.json");
  const admin1 = await loadExceptionSet("admin1", summary.unmatched_admin1_references);
  const admin2 = await loadExceptionSet("admin2", summary.unmatched_admin2_references);

  assert.equal(admin1.length, summary.unmatched_admin1_unique_records);
  assert.equal(admin2.length, summary.unmatched_admin2_unique_records);
  assert.equal(summary.admin1_crosswalk_keys, 3865);
  assert.equal(summary.admin2_crosswalk_keys, 47642);
  assert.equal(summary.repository_exports.row_level_exports_persisted, true);
});

test("proposed exception classifications preserve raw codes and distinguish missing context", async () => {
  const [admin1, admin2] = await Promise.all([
    readJson("unmatched_admin1_references.json"),
    readJson("unmatched_admin2_references.json")
  ]);

  for (const row of admin1) {
    assert.ok(row.geonames_id && row.country_code && row.feature_code);
    assert.ok(row.raw_admin1_code, "admin1 exception must preserve its non-empty raw code");
    assert.equal(row.raw_missing_code, row.raw_admin1_code);
    if (row.raw_admin1_code === "00") {
      assert.equal(row.missing_reference_category, "PLACEHOLDER_NONSTANDARD_CODE_CANDIDATE");
      assert.equal(row.proposed_review_classification, "UNRESOLVED_PLACEHOLDER_CODE");
      assert.equal(row.crosswalk_lookup_key, row.country_code + ".00");
    } else {
      assert.equal(row.missing_reference_category, "MISSING_CROSSWALK_REFERENCE");
      assert.equal(row.proposed_review_classification,
        "UNRESOLVED_MISSING_OR_VERSION_DEPENDENT_REFERENCE");
      assert.equal(row.crosswalk_lookup_key, row.country_code + "." + row.raw_admin1_code);
    }
  }

  const missingContext = [];
  for (const row of admin2) {
    assert.ok(row.geonames_id && row.country_code && row.feature_code);
    assert.ok(row.raw_admin2_code, "admin2 exception must preserve its non-empty raw code");
    assert.equal(row.raw_missing_code, row.raw_admin2_code);

    if (!row.raw_admin1_code) {
      missingContext.push(row);
      assert.equal(row.missing_reference_category, "ADMIN2_LOOKUP_UNCHECKABLE_MISSING_ADMIN1_CONTEXT");
      assert.equal(row.proposed_review_classification, "UNRESOLVED_MISSING_ADMIN1_CONTEXT");
      assert.equal(row.crosswalk_lookup_key, null);
    } else if (row.raw_admin2_code === "00") {
      assert.equal(row.missing_reference_category, "PLACEHOLDER_NONSTANDARD_CODE_CANDIDATE");
      assert.equal(row.proposed_review_classification, "UNRESOLVED_PLACEHOLDER_CODE");
      assert.equal(row.crosswalk_lookup_key,
        row.country_code + "." + row.raw_admin1_code + ".00");
    } else {
      assert.equal(row.missing_reference_category, "MISSING_CROSSWALK_REFERENCE");
      assert.equal(row.proposed_review_classification,
        "UNRESOLVED_MISSING_OR_VERSION_DEPENDENT_REFERENCE");
      assert.equal(row.crosswalk_lookup_key,
        row.country_code + "." + row.raw_admin1_code + "." + row.raw_admin2_code);
    }
  }

  assert.equal(missingContext.length, 1,
    "only one admin2 exception lacks the admin1 context needed for a composite key");
});

test("crosswalk exception sets reconcile their overlap, union, and Singapore ID lists", async () => {
  const summary = await readJson("summary.json");
  const admin1 = await readJson("unmatched_admin1_references.json");
  const admin2 = await readJson("unmatched_admin2_references.json");
  const admin1Ids = new Set(admin1.map((row) => row.geonames_id));
  const admin2Ids = new Set(admin2.map((row) => row.geonames_id));
  const overlap = [...admin1Ids].filter((id) => admin2Ids.has(id));
  const union = new Set([...admin1Ids, ...admin2Ids]);

  assert.equal(overlap.length, summary.admin1_admin2_record_overlap);
  assert.equal(overlap.length, 157);
  assert.equal(union.size, summary.union_unique_affected_records);
  assert.equal(union.size, 2416);
  assert.equal(admin1.length + admin2.length, 2573,
    "reference counts must not be reported as unique affected records");

  const singaporeIds = new Set(
    admin1.filter((row) => row.country_code === "SG").map((row) => row.geonames_id)
  );
  const exactOverlapIds = new Set(summary.sg_exact_overlap_ids);
  const broaderOnlyIds = new Set(summary.sg_broader_only_ids);
  assert.equal(singaporeIds.size, summary.broader_sg_admin1_misses);
  assert.equal(singaporeIds.size, 142);
  assert.equal(exactOverlapIds.size, summary.prior_sg_exception_ids);
  assert.equal(exactOverlapIds.size, 24);
  assert.equal(broaderOnlyIds.size, 118);
  assert.equal([...exactOverlapIds].filter((id) => broaderOnlyIds.has(id)).length, 0);
  assert.deepEqual(new Set([...exactOverlapIds, ...broaderOnlyIds]), singaporeIds);
  assert.equal(summary.sg_prior_only_ids.length, 0);
  assert.equal(summary.sg_prior_exception_ids_overlap, 24);
});
