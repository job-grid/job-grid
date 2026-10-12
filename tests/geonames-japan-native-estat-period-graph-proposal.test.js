import test from "node:test";
import assert from "node:assert/strict";
import { buildJapanNativePeriodGraph } from "../scripts/geonames-japan-native-estat-period-graph-proposal.mjs";

const hash = (char) => char.repeat(64);
const uri = (code, date = "19900401") => "http://data.e-stat.go.jp/lod/sac/C" + code + "-" + date;
function fixtures() {
  const first = {
    area_code: "29363", period_uri: uri("29363", "19700401"),
    label_en: "Tawaramoto-cho", label_ja: "田原本町",
    effective_from: "1970-04-01", effective_until: "",
    parent_references: [{ area_code: "29360", uri: uri("29360", "19700401"), label_en: "Shiki-gun", label_ja: "磯城郡" }],
    previous_period_uris: [], succeeding_period_uris: [],
    administrative_class_uris: ["class://municipality"], detail_record_count: 1,
  };
  const second = {
    area_code: "20382", period_uri: uri("20382", "19700401"),
    label_en: "Tatsuno-machi", label_ja: "辰野町",
    effective_from: "1970-04-01", effective_until: "",
    parent_references: [
      { area_code: "20380", uri: uri("20380", "19700401"), label_en: "Kamiina-gun", label_ja: "上伊那郡" },
      { area_code: "20000", uri: uri("20000", "19700401"), label_en: "Nagano-ken", label_ja: "長野県" },
    ],
    previous_period_uris: [], succeeding_period_uris: [],
    administrative_class_uris: ["class://municipality"], detail_record_count: 1,
  };
  const report = {
    status: "PASS_SPATIAL_FIRST_ESTAT_PERIOD_HISTORY_RETRIEVED; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
    generated_at_utc: "2026-10-12T00:00:00Z", target_count: 2, targets_without_spatial_context: 0,
    target_ids_without_spatial_context: [], distinct_spatial_area_codes: 2,
    target_to_spatial_area_code_associations: 2, detail_periods_reconciled: 2,
    e_stat_catalog_row_count: 14741, e_stat_catalog_source_snapshot_sha256: hash("a"),
    detail_source_fingerprint: hash("b"), operational_parent_links_created: 0,
    code_results: [{ area_code: "29363" }, { area_code: "20382" }],
    target_code_results: [
      { geonames_id: "1850471", geonames_name: "Tawaramoto-chō", raw_admin1_code: "00",
        containing_area_code_1995: "29363", e_stat_period_uris_covering_1995: uri("29363", "19700401"),
        parent_identity_crosswalk_status: "NOT_VERIFIED_TO_GEONAMES_ID", operational_parent_link_created: "false" },
      { geonames_id: "1850496", geonames_name: "Tatsuno-machi", raw_admin1_code: "00",
        containing_area_code_1995: "20382", e_stat_period_uris_covering_1995: uri("20382", "19700401"),
        parent_identity_crosswalk_status: "NOT_VERIFIED_TO_GEONAMES_ID", operational_parent_link_created: "false" },
    ],
    area_code_period_history: [first, second],
  };
  const manifest = {
    status: report.status, detail_periods_reconciled: 2, requested_area_code_count: 2,
    e_stat_catalog_result_row_count: 14741,
    e_stat_catalog_source_snapshot_sha256: report.e_stat_catalog_source_snapshot_sha256,
    detail_response_fingerprint: report.detail_source_fingerprint,
    input_spatial_first_report_sha256: hash("c"), input_e_stat_audit_report_sha256: hash("d"),
    input_e_stat_raw_source_response_sha256: hash("e"),
    source_catalog_page_response_fingerprints: [{ response_sha256: hash("f") }],
    detail_batches: [{ response_sha256: hash("g") }],
  };
  return { report, manifest };
}
const expected = { targetCount: 2, spatialCodeCount: 2, associationCount: 2, historyPeriodCount: 2, catalogRows: 14741, spatialSnapshotDate: "1995-10-01" };

test("builds e-Stat-native historical nodes without requiring GeoNames identity crosswalks", () => {
  const { report, manifest } = fixtures();
  const result = buildJapanNativePeriodGraph(report, manifest, { expected });
  assert.equal(result.status, "PASS_JAPAN_ESTAT_NATIVE_PERIOD_GRAPH_PROPOSED__REVIEW_ONLY__NO_SELECTABLE_RECORDS");
  assert.equal(result.counts.source_period_nodes, 2);
  assert.equal(result.counts.distinct_e_stat_area_codes, 2);
  assert.equal(result.counts.verified_geonames_to_estat_crosswalks, 0);
  assert.equal(result.counts.approved_operational_parent_links, 0);
  assert.equal(result.counts.selectable_records, 0);
  assert.equal(result.spatial_target_area_code_candidates[0].association_status, "SPATIAL_CONTEXT_CANDIDATE_ONLY__NOT_ENTITY_IDENTITY");
});

test("retains parent references in e-Stat namespace and creates only non-selectable parent stubs", () => {
  const { report, manifest } = fixtures();
  const result = buildJapanNativePeriodGraph(report, manifest, { expected });
  const edge = result.source_declared_parent_edges.find((row) => row.child_area_code === "29363");
  assert.equal(edge.parent_area_code, "29360");
  assert.equal(edge.review_status, "SOURCE_DECLARED_PARENT_REFERENCE__NOT_OPERATIONAL");
  assert.equal(result.parent_reference_only_nodes.some((row) => row.area_code === "29360"), true);
  assert.equal(result.parent_reference_only_nodes.find((row) => row.area_code === "29360").selectable, false);
});

test("multiple parent references are retained but explicitly held for review", () => {
  const { report, manifest } = fixtures();
  const result = buildJapanNativePeriodGraph(report, manifest, { expected });
  const rows = result.source_declared_parent_edges.filter((row) => row.child_area_code === "20382");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.review_status === "MULTIPLE_PARENT_REFERENCES__AMBIGUOUS_REVIEW_REQUIRED"));
  assert.equal(result.counts.source_periods_with_multiple_parent_references, 1);
});

test("an inconsistent parent code/URI stays unresolved and is not promoted to a stub", () => {
  const { report, manifest } = fixtures();
  report.area_code_period_history[0].parent_references[0].uri = uri("99999", "19700401");
  const result = buildJapanNativePeriodGraph(report, manifest, { expected });
  assert.equal(result.unresolved_parent_references.length, 1);
  assert.equal(result.unresolved_parent_references[0].review_status, "INVALID_PARENT_REFERENCE_FIELDS__REVIEW_REQUIRED");
  assert.equal(result.parent_reference_only_nodes.some((row) => row.area_code === "29360"), false);
  assert.equal(result.counts.approved_operational_parent_links, 0);
});

test("fails closed on stale report counts or invalid source fingerprints", () => {
  const one = fixtures();
  one.report.detail_periods_reconciled = 3;
  assert.throws(() => buildJapanNativePeriodGraph(one.report, one.manifest, { expected }), /period-history coverage mismatch|period count differs/i);
  const two = fixtures();
  two.manifest.input_spatial_first_report_sha256 = "not-a-sha";
  assert.throws(() => buildJapanNativePeriodGraph(two.report, two.manifest, { expected }), /SHA-256/);
});

test("rejects raw admin1 rewrites or verified GeoNames crosswalks on spatial-only associations", () => {
  const one = fixtures();
  one.report.target_code_results[0].raw_admin1_code = "35";
  assert.throws(() => buildJapanNativePeriodGraph(one.report, one.manifest, { expected }), /raw admin1 code/);
  const two = fixtures();
  two.report.target_code_results[0].parent_identity_crosswalk_status = "VERIFIED";
  assert.throws(() => buildJapanNativePeriodGraph(two.report, two.manifest, { expected }), /verified GeoNames crosswalk/);
});

test("validates each period URI against its five-digit code and preserves dates", () => {
  const one = fixtures();
  one.report.area_code_period_history[1].period_uri = uri("99999", "19700401");
  assert.throws(() => buildJapanNativePeriodGraph(one.report, one.manifest, { expected }), /Area-code\/period-URI conflict/);
  const two = fixtures();
  const result = buildJapanNativePeriodGraph(two.report, two.manifest, { expected });
  assert.equal(result.source_period_nodes.find((row) => row.area_code === "29363").effective_from, "1970-04-01");
  assert.equal(result.source_period_nodes.find((row) => row.area_code === "29363").includes_1995_snapshot_by_published_dates, true);
});
