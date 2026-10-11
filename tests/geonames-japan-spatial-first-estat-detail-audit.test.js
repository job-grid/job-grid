import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogCodeIndex,
  buildSpatialTargetCodeCandidates,
  codeResultToCsvRow,
  mergeCatalogAndDetailRows,
  periodIncludesDate,
} from "../scripts/geonames-japan-spatial-first-estat-detail-audit.mjs";

function binding(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key.toUpperCase()] = { value: String(value) };
  }
  return out;
}

test("catalog index preserves five-digit codes, Japanese labels and period URIs", () => {
  const source = {
    catalog_pages: [{
      offset: 0,
      row_count: 2,
      source: { response_sha256: "a".repeat(64) },
      response: { results: { bindings: [
        binding({ period: "http://data.e-stat.go.jp/lod/sac/C01000-19700401", identifier: "01000", labelEn: "Hokkaido", labelJa: "北海道" }),
        binding({ period: "http://data.e-stat.go.jp/lod/sac/C01000-20050401", identifier: "01000", labelEn: "Hokkaido", labelJa: "" }),
      ] } },
    }],
  };
  const result = buildCatalogCodeIndex(source, 2);
  assert.equal(result.totalRows, 2);
  assert.equal(result.index.get("01000").length, 2);
  assert.equal(result.index.get("01000")[0].label_ja, "北海道");
  assert.throws(() => buildCatalogCodeIndex({ catalog_pages: [] }, 2), /no catalog pages/);
});

test("spatial target/code selection retains all 126 target IDs and no-context rows", () => {
  const targets = [];
  for (let index = 0; index < 126; index += 1) {
    targets.push({
      geonames_id: String(1000000 + index),
      name: "Target " + index,
      latitude: 35,
      longitude: 139,
      raw_admin1_code: "00",
      raw_admin2_code: "",
      existing_exact_english_candidate_codes: [],
      observations: index === 0 ? [{
        geonames_id: String(1000000 + index),
        containing_area_code: "01000",
        containing_prefecture_name: "Hokkaido",
        containing_district_name: "",
        containing_municipality_name: "",
      }] : [],
    });
  }
  const sourceReport = {
    selection_mode: "ALL_126_SOURCE_VERIFIED_JAPAN_ADM4_ADMIN1_00_TARGETS; SPATIAL_FIRST_1995_ONLY",
    target_count: 126,
    target_results: targets,
    source_snapshot_archive_count: 47,
    source_snapshots: Array.from({ length: 47 }, (_, i) => ({ archive_sha256: String(i).padStart(64, "a") })),
    distinct_containing_area_codes: 1,
    target_rows_without_polygon_context: 125,
  };
  const selected = buildSpatialTargetCodeCandidates(sourceReport, new Map([["01000", []]]));
  assert.equal(selected.targetSummaries.length, 126);
  assert.equal(selected.codeToTargets.size, 1);
  assert.equal(selected.targetSummaries[0].spatial_context_status, "CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT");
  assert.equal(selected.targetSummaries[1].spatial_context_status, "NO_CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT");
  assert.throws(() => buildSpatialTargetCodeCandidates({ ...sourceReport, target_count: 125 }, new Map([["01000", []]])), /all 126/);
});

test("period details are merged by URI and preserve parent history", () => {
  const catalog = [
    { area_code: "01000", period_uri: "http://data.e-stat.go.jp/lod/sac/C01000-19900401", label_en: "Hokkaido", label_ja: "" },
  ];
  const details = [
    { period_uri: catalog[0].period_uri, area_code: "", label_ja: "北海道", effective_from: "1990-04-01", effective_until: "2000-04-01", parent_uri: "http://data.e-stat.go.jp/lod/sac/C00000-19900401", parent_area_code: "00000", parent_label_en: "Japan", parent_label_ja: "日本", previous_period_uri: "", succeeding_period_uri: "", administrative_class_uri: "class1" },
    { period_uri: catalog[0].period_uri, area_code: "", label_ja: "北海道", effective_from: "1990-04-01", effective_until: "2000-04-01", parent_uri: "http://data.e-stat.go.jp/lod/sac/C00001-19900401", parent_area_code: "00001", parent_label_en: "Japan region", parent_label_ja: "日本地域", previous_period_uri: "", succeeding_period_uri: "", administrative_class_uri: "class1" },
  ];
  const merged = mergeCatalogAndDetailRows(catalog, details);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label_ja, "北海道");
  assert.equal(merged[0].parent_references.length, 2);
  assert.deepEqual(merged[0].parent_references.map((row) => row.area_code), ["00000", "00001"]);
  assert.throws(() => mergeCatalogAndDetailRows(catalog, []), /Missing official e-Stat detail response/);
});

test("code CSV projection uses the canonical periods_covering_1995_snapshot array", () => {
  const projected = codeResultToCsvRow({
    area_code: "01000",
    target_count: 1,
    geonames_ids: ["1000001"],
    geonames_names: ["Example"],
    containing_area_names_1995: ["Hokkaido"],
    exact_english_name_candidate_codes_for_associated_targets: ["01000"],
    associated_targets_whose_code_matches_exact_name_candidate: ["1000001"],
    catalog_labels_en: ["Hokkaido"],
    catalog_labels_ja: ["北海道"],
    periods_covering_1995_snapshot: ["http://data.e-stat.go.jp/lod/sac/C01000-19900401"],
    periods_covering_1995_count: 1,
    parent_area_codes_across_history: ["00000"],
    parent_labels_en_across_history: ["Japan"],
    parent_labels_ja_across_history: ["日本"],
    parent_area_codes_at_1995: ["00000"],
    parent_labels_en_at_1995: ["Japan"],
    parent_labels_ja_at_1995: ["日本"],
    administrative_class_uris_at_1995: ["class"],
    review_status: "CANDIDATE_ONLY",
  });
  assert.equal(projected.periods_covering_1995_snapshot, "http://data.e-stat.go.jp/lod/sac/C01000-19900401");
  assert.equal(projected.operational_parent_link_created, "false");
});

test("period-to-snapshot comparison uses published issued/valid dates and fails closed on missing start", () => {
  assert.equal(periodIncludesDate({ effective_from: "1990-04-01", effective_until: "2000-04-01" }, "1995-10-01"), true);
  assert.equal(periodIncludesDate({ effective_from: "2000-04-01", effective_until: "" }, "1995-10-01"), false);
  assert.equal(periodIncludesDate({ effective_from: "", effective_until: "" }, "1995-10-01"), false);
});
