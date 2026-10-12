import test from "node:test";
import assert from "node:assert/strict";
import {
  buildParentDetailSupplement,
  collectParentOnlyTargets,
} from "../scripts/geonames-japan-estat-parent-reference-detail-audit.mjs";

const digest = (n) => String(n).repeat(64);
const uri = (code, date = "19700401") => "http://data.e-stat.go.jp/lod/sac/C" + code + "-" + date;
function fixture() {
  const graph = {
    status: "PASS_JAPAN_ESTAT_NATIVE_PERIOD_GRAPH_PROPOSED__REVIEW_ONLY__NO_SELECTABLE_RECORDS",
    source_fingerprints: { catalog: digest(1) },
    decision_boundary: { operational_parent_links_created: 0, selectable_records_added: 0 },
    source_period_nodes: [{ period_uri: uri("29363"), area_code: "29363" }],
    parent_reference_only_nodes: [
      { period_uri: uri("29360"), area_code: "29360", labels_en: ["Shiki-gun"], labels_ja: ["磯城郡"], status: "PARENT_REFERENCE_ONLY_STUB" },
      { period_uri: uri("20380"), area_code: "20380", labels_en: ["Kamiina-gun"], labels_ja: ["上伊那郡"], status: "PARENT_REFERENCE_ONLY_STUB" },
    ],
  };
  const bindings = [
    { period_uri: uri("29360"), area_code: "", label_en: "", label_ja: "磯城郡", effective_from: "1970-04-01", effective_until: "", parent_uri: uri("29000"), parent_area_code: "29000", parent_label_en: "Nara", parent_label_ja: "奈良県", previous_period_uri: "", succeeding_period_uri: "", administrative_class_uri: "" },
    { period_uri: uri("20380"), area_code: "", label_en: "", label_ja: "上伊那郡", effective_from: "1970-04-01", effective_until: "", parent_uri: uri("20000"), parent_area_code: "20000", parent_label_en: "Nagano", parent_label_ja: "長野県", previous_period_uri: "", succeeding_period_uri: "", administrative_class_uri: "" },
  ];
  const batches = [{
    requested_period_uris: [uri("29360"), uri("20380")],
    rows: bindings,
    manifest: {
      endpoint_url: "https://data.e-stat.go.jp/lod/sparql/alldata/query",
      http_status: 200, query_sha256: digest(2), response_sha256: digest(3),
      captured_at_utc: "2026-10-12T16:00:00Z", response_bytes: 1234, result_row_count: 2,
    },
  }];
  return { graph, batches };
}

test("collects only valid, unique parent-only URIs outside the detailed node set", () => {
  const { graph } = fixture();
  const targets = collectParentOnlyTargets(graph);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map((row) => row.area_code), ["20380", "29360"]);
  const bad = structuredClone(graph);
  bad.parent_reference_only_nodes[0].area_code = "29999";
  assert.throws(() => collectParentOnlyTargets(bad), /URI\/code mismatch/);
});

test("supplement retrieves dates and next parent references without promoting hierarchy", () => {
  const { graph, batches } = fixture();
  const result = buildParentDetailSupplement(graph, batches, { expectedTargetCount: 2 });
  assert.equal(result.status, "PASS_JAPAN_ESTAT_PARENT_REFERENCE_DETAIL_AUDIT__SOURCE_EVIDENCE_ONLY__NO_SELECTABLE_RECORDS");
  assert.equal(result.counts.parent_only_stubs_requested, 2);
  assert.equal(result.counts.parent_period_details_found, 2);
  assert.equal(result.counts.parent_period_details_not_found, 0);
  assert.equal(result.parent_period_details.find((row) => row.area_code === "29360").effective_from_values[0], "1970-04-01");
  assert.equal(result.parent_period_declared_edges.length, 2);
  assert.equal(result.counts.operational_parent_links_created, 0);
  assert.equal(result.counts.selectable_records, 0);
  assert.equal(result.parent_period_declared_edges[0].operational_parent_link_created, false);
});

test("unreturned period URI is explicitly recorded for review rather than silently dropped", () => {
  const { graph, batches } = fixture();
  batches[0].rows = batches[0].rows.filter((row) => row.period_uri !== uri("20380"));
  batches[0].manifest.result_row_count = 1;
  const result = buildParentDetailSupplement(graph, batches);
  assert.equal(result.counts.parent_period_details_not_found, 1);
  const missing = result.unresolved_period_details.find((row) => row.area_code === "20380");
  assert.equal(missing.detail_status, "PARENT_URI_DETAIL_NOT_FOUND_AT_RETRIEVAL__REVIEW_REQUIRED");
  assert.equal(result.counts.operational_parent_links_created, 0);
});

test("retains multiple parent references as ambiguity and checks parent URI/code agreement", () => {
  const { graph, batches } = fixture();
  batches[0].rows.push({
    ...batches[0].rows[0],
    parent_uri: uri("29999"),
    parent_area_code: "29999",
    parent_label_en: "Alternative parent",
    parent_label_ja: "別の親",
  });
  batches[0].manifest.result_row_count = 3;
  const result = buildParentDetailSupplement(graph, batches);
  const period = result.parent_period_details.find((row) => row.area_code === "29360");
  assert.equal(period.parent_references.length, 2);
  assert.ok(period.detail_validation_issues.some((issue) => issue.includes("Multiple distinct parent references")));
  assert.equal(result.parent_period_declared_edges.filter((edge) => edge.child_area_code === "29360").length, 2);
  assert.ok(result.parent_period_declared_edges.every((edge) => edge.selectable === false && edge.operational_parent_link_created === false));
});

test("rejects unexpected URIs, duplicate or omitted URI requests, and unsafe graph states", () => {
  const { graph, batches } = fixture();
  batches[0].rows[0].period_uri = uri("99999");
  assert.throws(() => buildParentDetailSupplement(graph, batches), /unrequested period URI/);
  const { graph: other, batches: noBatch } = fixture();
  assert.throws(() => buildParentDetailSupplement(other, noBatch.slice(0, 0)), /do not exactly reconcile/);
  const unsafe = structuredClone(other);
  unsafe.decision_boundary.operational_parent_links_created = 1;
  assert.throws(() => collectParentOnlyTargets(unsafe), /zero-operational-parent-write/);
});

test("source response manifests are required and each input stub must be uniquely requested", () => {
  const { graph, batches } = fixture();
  batches[0].manifest.response_sha256 = "not-hash";
  assert.throws(() => buildParentDetailSupplement(graph, batches), /response hash is invalid/);
  const second = fixture();
  second.batches[0].requested_period_uris.push(uri("29360"));
  assert.throws(() => buildParentDetailSupplement(second.graph, second.batches), /requested more than once/);
});
