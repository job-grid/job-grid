import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOfficialParentReferenceIndex,
  exactJapaneseLabelMatchFields,
  isEligibleGeoNamesParentFeature,
  normalizeExactJapaneseLabel,
  parseGeoNamesJapanAdminLine,
  runParentIdentityCandidateAudit,
} from "../scripts/geonames-japan-estat-parent-geonames-candidate-audit.mjs";

function geoRow({
  id,
  name = "Example",
  ascii = name,
  alternates = "",
  country = "JP",
  featureClass = "A",
  featureCode = "ADM2",
  admin1 = "05",
  admin2 = "10",
  admin3 = "",
  admin4 = "",
} = {}) {
  return [
    id, name, ascii, alternates, "39.0", "140.0", featureClass, featureCode,
    country, "", admin1, admin2, admin3, admin4, "0", "", "", "Asia/Tokyo", "2026-10-10",
  ].join("\t");
}

function spatialDetailReport(parentHistory) {
  return {
    report_version: 1,
    status: "PASS_SPATIAL_FIRST_ESTAT_PERIOD_HISTORY_RETRIEVED; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
    target_count: 126,
    distinct_spatial_area_codes: 105,
    target_to_spatial_area_code_associations: 120,
    detail_periods_reconciled: parentHistory.length,
    area_code_period_history: parentHistory,
    operational_parent_links_created: 0,
  };
}

test("normalizes Japanese labels with NFC and only trims outer whitespace", () => {
  assert.equal(normalizeExactJapaneseLabel("  か\u3099  "), "が");
  assert.equal(normalizeExactJapaneseLabel("行政区"), "行政区");
  assert.notEqual(normalizeExactJapaneseLabel("行政"), normalizeExactJapaneseLabel("行政区"));
});

test("parses exact GeoNames Japan source fields and preserves raw codes", () => {
  const row = parseGeoNamesJapanAdminLine(geoRow({
    id: "9001", name: "岩沼町", ascii: "Iwanuma-machi", alternates: "Iwanuma,Iwanuma-machi,岩沼町",
    admin1: "04", admin2: "04380", admin3: "04381",
  }));
  assert.equal(row.geonames_id, "9001");
  assert.equal(row.country_code, "JP");
  assert.equal(row.feature_code, "ADM2");
  assert.equal(row.admin1_code, "04");
  assert.equal(row.admin2_code, "04380");
  assert.deepEqual(row.alternate_names, ["Iwanuma", "Iwanuma-machi", "岩沼町"]);
});

test("only same-country class-A ADM1 through ADM3 records are eligible", () => {
  assert.equal(isEligibleGeoNamesParentFeature({ country_code: "JP", feature_class: "A", feature_code: "ADM2" }), true);
  assert.equal(isEligibleGeoNamesParentFeature({ country_code: "KE", feature_class: "A", feature_code: "ADM2" }), false);
  assert.equal(isEligibleGeoNamesParentFeature({ country_code: "JP", feature_class: "P", feature_code: "ADM2" }), false);
  assert.equal(isEligibleGeoNamesParentFeature({ country_code: "JP", feature_class: "A", feature_code: "ADM4" }), false);
  assert.equal(isEligibleGeoNamesParentFeature({ country_code: "JP", feature_class: "A", feature_code: "ADM5" }), false);
});

test("matches only complete Japanese primary/ascii/alternate-name entries", () => {
  const record = {
    name: "Iwanuma-machi",
    ascii_name: "Iwanuma-machi",
    alternate_names: ["Iwanuma", "岩沼町", "宮城県 岩沼町"],
  };
  assert.deepEqual(exactJapaneseLabelMatchFields(record, "岩沼町"), ["exact_alternate_name_entry"]);
  assert.deepEqual(exactJapaneseLabelMatchFields(record, "Iwanuma-machi"), ["primary_name", "ascii_name"]);
  assert.deepEqual(exactJapaneseLabelMatchFields(record, "岩沼"), []);
  assert.deepEqual(exactJapaneseLabelMatchFields(record, "宮城県 岩沼町"), ["exact_alternate_name_entry"]);
});

test("official parent-reference index merges repeated period mentions without dropping child-period evidence", () => {
  const repeated = {
    area_code: "29360",
    uri: "http://data.e-stat.go.jp/lod/sac/C29360-19700401",
    label_en: "Shiki-gun",
    label_ja: "磯城郡",
  };
  const detail = spatialDetailReport([
    { area_code: "29363", period_uri: "urn:child-a-1", parent_references: [repeated] },
    { area_code: "29363", period_uri: "urn:child-a-2", parent_references: [repeated] },
    { area_code: "20382", period_uri: "urn:child-b-1", parent_references: [{
      area_code: "20380", uri: "http://data.e-stat.go.jp/lod/sac/C20380-19700401",
      label_en: "Kamiina-gun", label_ja: "上伊那郡",
    }] },
  ]);
  detail.detail_periods_reconciled = 3;
  const index = buildOfficialParentReferenceIndex(detail);
  assert.equal(index.length, 2);
  const shiki = index.find((row) => row.parent_area_code === "29360");
  assert.equal(shiki.published_parent_reference_rows, 2);
  assert.equal(shiki.child_area_codes.length, 1);
  assert.equal(shiki.child_period_uris.length, 2);
  assert.equal(shiki.parent_label_ja, "磯城郡");
  assert.equal(shiki.operational_parent_link_created, false);
});

test("conflicting parent Japanese labels are blocked instead of choosing one", () => {
  const detail = spatialDetailReport([
    { area_code: "29363", period_uri: "urn:child-1", parent_references: [{
      area_code: "29360", uri: "urn:parent", label_en: "Shiki-gun", label_ja: "磯城郡",
    }] },
    { area_code: "20382", period_uri: "urn:child-2", parent_references: [{
      area_code: "29360", uri: "urn:parent", label_en: "Shiki-gun", label_ja: "磯城郡（異表記）",
    }] },
  ]);
  detail.detail_periods_reconciled = 2;
  const [row] = buildOfficialParentReferenceIndex(detail);
  assert.equal(row.conflicting_parent_label_values, true);
  assert.equal(row.candidate_status, "BLOCKED_CONFLICTING_OFFICIAL_JAPANESE_PARENT_LABELS");
});

test("integration audit retains no/one/multiple exact-name candidates and never writes parents", async () => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-japan-parent-candidate-"));
  try {
    const jpText = join(root, "JP.txt");
    const detailPath = join(root, "details.json");
    const manifestPath = join(root, "manifest.json");
    const prefix = join(root, "out", "parent-audit");
    const history = [
      { area_code: "29363", period_uri: "urn:child-a1", parent_references: [{
        area_code: "29360", uri: "urn:parent-a", label_en: "Shiki-gun", label_ja: "磯城郡",
      }] },
      { area_code: "29363", period_uri: "urn:child-a2", parent_references: [{
        area_code: "29360", uri: "urn:parent-a", label_en: "Shiki-gun", label_ja: "磯城郡",
      }] },
      { area_code: "20382", period_uri: "urn:child-b", parent_references: [{
        area_code: "20380", uri: "urn:parent-b", label_en: "Kamiina-gun", label_ja: "上伊那郡",
      }] },
      { area_code: "39404", period_uri: "urn:child-c", parent_references: [{
        area_code: "39400", uri: "urn:parent-c", label_en: "Takaoka-gun", label_ja: "存在しない郡名",
      }] },
    ];
    const rows = [
      geoRow({ id: "9001", name: "Shiki-gun", alternates: "磯城郡", featureCode: "ADM2" }),
      geoRow({ id: "9002", name: "Shiki-district", alternates: "磯城郡", featureCode: "ADM2" }),
      geoRow({ id: "9003", name: "Kamiina-gun", alternates: "上伊那郡", featureCode: "ADM2" }),
      geoRow({ id: "9004", name: "Wrong country", alternates: "磯城郡", country: "KE", featureCode: "ADM2" }),
      geoRow({ id: "9005", name: "Wrong class", alternates: "磯城郡", featureClass: "P", featureCode: "ADM2" }),
      geoRow({ id: "9006", name: "Wrong level", alternates: "磯城郡", featureCode: "ADM4" }),
    ];
    await writeFile(jpText, rows.join("\n") + "\n", "utf8");
    await writeFile(detailPath, JSON.stringify(spatialDetailReport(history)), "utf8");
    await writeFile(manifestPath, JSON.stringify({
      country_code: "JP",
      archive_filename: "JP.zip",
      source_url: "https://download.geonames.org/export/dump/JP.zip",
      http_status: 200,
      archive_sha256: "a".repeat(64),
      archive_size_bytes: 1000,
      retrieved_at_utc: "2026-10-11T10:00:00Z",
    }), "utf8");

    const report = await runParentIdentityCandidateAudit({
      geonamesJapanTextPath: jpText,
      detailReportPath: detailPath,
      geonamesSourceManifestPath: manifestPath,
      outputPrefix: prefix,
    });
    assert.equal(report.parent_reference_count, 3);
    assert.equal(report.parent_references_with_multiple_candidates, 1);
    assert.equal(report.parent_references_with_one_candidate, 1);
    assert.equal(report.parent_references_with_no_exact_candidate, 1);
    assert.equal(report.operational_parent_links_created, 0);
    const shiki = report.parent_references.find((row) => row.parent_area_code === "29360");
    assert.deepEqual(shiki.candidate_geonames_ids, ["9001", "9002"]);
    assert.equal(shiki.candidate_status, "MULTIPLE_EXACT_GEONAMES_ADMIN_LABEL_CANDIDATES_REQUIRE_DISAMBIGUATION");
    const kamiina = report.parent_references.find((row) => row.parent_area_code === "20380");
    assert.deepEqual(kamiina.candidate_geonames_ids, ["9003"]);
    const writtenSummary = JSON.parse(await readFile(prefix + ".json", "utf8"));
    assert.equal(writtenSummary.operational_parent_links_created, 0);
    const parentCsv = await readFile(prefix + ".parent-references.csv", "utf8");
    const candidateCsv = await readFile(prefix + ".candidate-matches.csv", "utf8");
    assert.match(parentCsv, /MULTIPLE_EXACT_GEONAMES_ADMIN_LABEL_CANDIDATES_REQUIRE_DISAMBIGUATION/);
    assert.match(candidateCsv, /NOT_VERIFIED_TO_GEONAMES_ID/);
    assert.match(candidateCsv, /false/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
