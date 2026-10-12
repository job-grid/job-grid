#!/usr/bin/env node
/**
 * Build a non-operational Japan-native e-Stat period graph from the official,
 * source-pinned 1995 spatial-first period-history audit.
 * The output keeps e-Stat periods/parents separate from GeoNames identity.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED = Object.freeze({
  targetCount: 126, spatialCodeCount: 105, associationCount: 120,
  historyPeriodCount: 557, catalogRows: 14741, spatialSnapshotDate: "1995-10-01",
});
const PERIOD_URI = /^https?:\/\/data\.e-stat\.go\.jp\/lod\/sac\/C(\d{5})-(\d{8})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uniqueStrings = (values) => [...new Set(values.filter((value) => typeof value === "string" && value.length))].sort();
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
const includesDate = (period, date) => {
  if (!validDate(date) || !validDate(period.effective_from)) return false;
  const end = String(period.effective_until ?? "");
  return period.effective_from <= date && (!end || !validDate(end) || end >= date);
};
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function checkHash(value, label) {
  assert(SHA256.test(String(value ?? "")), label + " must be a lowercase SHA-256 hex digest.");
}
function validateInputs(report, manifest, expected = EXPECTED) {
  assert(report?.status === "PASS_SPATIAL_FIRST_ESTAT_PERIOD_HISTORY_RETRIEVED; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
    "Unexpected spatial-first e-Stat period-history report status.");
  assert(Number(report.target_count) === expected.targetCount, "Target coverage mismatch.");
  assert(Number(report.distinct_spatial_area_codes) === expected.spatialCodeCount, "Spatial area-code coverage mismatch.");
  assert(Number(report.target_to_spatial_area_code_associations) === expected.associationCount, "Target/code association coverage mismatch.");
  assert(Number(report.detail_periods_reconciled) === expected.historyPeriodCount, "Reconciled period-history coverage mismatch.");
  assert(Number(report.e_stat_catalog_row_count) === expected.catalogRows, "Official e-Stat catalog row count mismatch.");
  assert(report.operational_parent_links_created === 0, "Input report violates zero-parent-write boundary.");
  assert(Array.isArray(report.area_code_period_history) && report.area_code_period_history.length === expected.historyPeriodCount,
    "Area-code period-history rows do not reconcile.");
  assert(Array.isArray(report.code_results) && report.code_results.length === expected.spatialCodeCount,
    "Area-code candidate list does not reconcile.");
  assert(Array.isArray(report.target_code_results) && report.target_code_results.length === expected.associationCount,
    "Target/code associations do not reconcile.");
  assert(manifest?.status === report.status, "Detail manifest status differs from report.");
  assert(Number(manifest.detail_periods_reconciled) === Number(report.detail_periods_reconciled), "Manifest period count differs from report.");
  assert(Number(manifest.requested_area_code_count) === Number(report.distinct_spatial_area_codes), "Manifest area-code count differs from report.");
  assert(Number(manifest.e_stat_catalog_result_row_count) === Number(report.e_stat_catalog_row_count), "Manifest catalog row count differs from report.");
  assert(manifest.e_stat_catalog_source_snapshot_sha256 === report.e_stat_catalog_source_snapshot_sha256, "Manifest/catalog snapshot fingerprints differ.");
  assert(manifest.detail_response_fingerprint === report.detail_source_fingerprint, "Manifest/detail response fingerprints differ.");
  checkHash(manifest.e_stat_catalog_source_snapshot_sha256, "Official e-Stat catalog source snapshot hash");
  checkHash(manifest.input_spatial_first_report_sha256, "Spatial-first report input hash");
  checkHash(manifest.input_e_stat_audit_report_sha256, "e-Stat audit report input hash");
  checkHash(manifest.input_e_stat_raw_source_response_sha256, "Raw e-Stat response input hash");
  checkHash(manifest.detail_response_fingerprint, "e-Stat detail response fingerprint");
  assert(Array.isArray(manifest.source_catalog_page_response_fingerprints) && manifest.source_catalog_page_response_fingerprints.length > 0,
    "Catalog page fingerprints are missing.");
  for (const item of manifest.source_catalog_page_response_fingerprints) checkHash(item.response_sha256, "Catalog page response hash");
  assert(Array.isArray(manifest.detail_batches) && manifest.detail_batches.length > 0, "Detail response batches are missing.");
  for (const item of manifest.detail_batches) checkHash(item.response_sha256, "Detail response batch hash");
}

function normalizeParentReferences(period, index, parentOnlyNodes, unresolved) {
  const refs = Array.isArray(period.parent_references) ? period.parent_references : [];
  const output = [];
  for (const ref of refs) {
    const code = String(ref.area_code ?? "").trim();
    const uri = String(ref.uri ?? "").trim();
    const match = uri.match(PERIOD_URI);
    const valid = /^\d{5}$/.test(code) && Boolean(match) && match[1] === code;
    const selfReference = uri === period.period_uri;
    let status = "SOURCE_DECLARED_PARENT_REFERENCE__NOT_OPERATIONAL";
    if (!valid) status = "INVALID_PARENT_REFERENCE_FIELDS__REVIEW_REQUIRED";
    else if (selfReference) status = "SELF_PARENT_REFERENCE_BLOCKED";
    else if (refs.length > 1) status = "MULTIPLE_PARENT_REFERENCES__AMBIGUOUS_REVIEW_REQUIRED";
    const edge = {
      child_period_uri: period.period_uri,
      child_area_code: period.area_code,
      parent_period_uri: uri,
      parent_area_code: code,
      parent_label_en: String(ref.label_en ?? ""),
      parent_label_ja: String(ref.label_ja ?? ""),
      child_effective_from: String(period.effective_from ?? ""),
      child_effective_until: String(period.effective_until ?? ""),
      child_parent_reference_count: refs.length,
      source_authority: "Japan Statistical LOD — e-Stat Standard Area Code List",
      relationship_type: "source_declared_administrative_parent_reference",
      review_status: status,
      operational_parent_link_created: false,
      selectable: false,
    };
    output.push(edge);
    if (!valid || selfReference) {
      unresolved.push({
        ...edge,
        unresolved_reason: !valid
          ? "Parent area code and period URI are missing, malformed, or inconsistent."
          : "A period cannot be its own parent.",
      });
      continue;
    }
    if (!index.has(uri)) {
      const known = parentOnlyNodes.get(uri);
      const labelsEn = uniqueStrings([...(known?.labels_en ?? []), String(ref.label_en ?? "")]);
      const labelsJa = uniqueStrings([...(known?.labels_ja ?? []), String(ref.label_ja ?? "")]);
      if (known && known.area_code !== code) throw new Error("Conflicting area codes for exact e-Stat parent period URI " + uri + ".");
      parentOnlyNodes.set(uri, {
        period_uri: uri,
        area_code: code,
        labels_en: labelsEn,
        labels_ja: labelsJa,
        record_kind: "PARENT_REFERENCE_ONLY_STUB",
        status: "OFFICIAL_PARENT_URI_REFERENCED__DETAIL_PERIOD_NOT_IN_SELECTED_105_CODE_HISTORY",
        source_authority: "Japan Statistical LOD — e-Stat Standard Area Code List",
        fully_detailed_in_selected_history: false,
        selectable: false,
        operational_parent_link_created: false,
      });
    }
  }
  return output;
}
function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function renderCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n") + "\n";
}

export function buildJapanNativePeriodGraph(report, manifest, options = {}) {
  const expected = { ...EXPECTED, ...options.expected };
  validateInputs(report, manifest, expected);
  const periodUris = new Set();
  const areaCodes = new Set();
  const nodes = [];
  const nodesByUri = new Map();
  const parentOnlyNodes = new Map();
  const edges = [];
  const unresolvedParentReferences = [];

  for (const period of report.area_code_period_history) {
    const areaCode = String(period.area_code ?? "");
    const uri = String(period.period_uri ?? "");
    const match = uri.match(PERIOD_URI);
    assert(/^\d{5}$/.test(areaCode), "Invalid five-digit e-Stat area code: " + areaCode);
    assert(match && match[1] === areaCode, "Area-code/period-URI conflict: " + areaCode + " / " + uri);
    assert(!periodUris.has(uri), "Duplicate e-Stat period URI: " + uri);
    assert(!period.effective_from || validDate(period.effective_from), "Malformed effective-from date for " + uri);
    assert(!period.effective_until || validDate(period.effective_until), "Malformed effective-until date for " + uri);
    assert(String(period.label_en ?? "").trim().length > 0, "Missing official e-Stat English label for " + uri);
    periodUris.add(uri);
    areaCodes.add(areaCode);
    const refs = Array.isArray(period.parent_references) ? period.parent_references : [];
    const node = {
      record_kind: "SOURCE_PERIOD_NODE",
      source_namespace: "e-stat-sac",
      period_uri: uri,
      area_code: areaCode,
      label_en: String(period.label_en ?? ""),
      label_ja: String(period.label_ja ?? ""),
      effective_from: String(period.effective_from ?? ""),
      effective_until: String(period.effective_until ?? ""),
      includes_1995_snapshot_by_published_dates: includesDate(period, expected.spatialSnapshotDate),
      parent_reference_count: refs.length,
      previous_period_uris: uniqueStrings(period.previous_period_uris ?? []),
      succeeding_period_uris: uniqueStrings(period.succeeding_period_uris ?? []),
      administrative_class_uris: uniqueStrings(period.administrative_class_uris ?? []),
      detail_record_count: Number(period.detail_record_count ?? 0),
      identity_status: "OFFICIAL_ESTAT_PERIOD_RECORD__NO_GEONAMES_IDENTITY_CROSSWALK_APPROVED",
      selectable: false,
      operational_parent_link_created: false,
    };
    nodes.push(node);
    nodesByUri.set(uri, node);
  }
  assert(areaCodes.size === expected.spatialCodeCount, "Period history code set does not reconcile to expected area-code count.");
  for (const period of report.area_code_period_history) {
    edges.push(...normalizeParentReferences(period, nodesByUri, parentOnlyNodes, unresolvedParentReferences));
  }

  const seenAssociations = new Set();
  const associations = report.target_code_results.map((row) => {
    const geonamesId = String(row.geonames_id ?? "");
    const code = String(row.containing_area_code_1995 ?? "");
    assert(/^\d+$/.test(geonamesId), "Invalid GeoNames target ID in spatial association.");
    assert(/^\d{5}$/.test(code) && areaCodes.has(code), "Invalid or unindexed spatial e-Stat code in target association.");
    assert(row.raw_admin1_code === "00", "Japan source raw admin1 code must remain exactly 00.");
    assert(row.parent_identity_crosswalk_status === "NOT_VERIFIED_TO_GEONAMES_ID",
      "Spatial association must not be labeled a verified GeoNames crosswalk.");
    assert(row.operational_parent_link_created === "false" || row.operational_parent_link_created === false,
      "Spatial association violates the zero-parent-write boundary.");
    const key = geonamesId + ":" + code;
    assert(!seenAssociations.has(key), "Duplicate target/code spatial association: " + key);
    seenAssociations.add(key);
    return {
      source_geonames_id: geonamesId,
      source_geonames_name: String(row.geonames_name ?? ""),
      raw_admin1_code_preserved: "00",
      spatial_snapshot_date: expected.spatialSnapshotDate,
      e_stat_area_code_candidate: code,
      e_stat_period_uris_covering_spatial_snapshot: uniqueStrings(String(row.e_stat_period_uris_covering_1995 ?? "").split(";")),
      association_status: "SPATIAL_CONTEXT_CANDIDATE_ONLY__NOT_ENTITY_IDENTITY",
      geonames_to_estat_crosswalk_verified: false,
      selectable: false,
      operational_relationship_created: false,
    };
  });
  const targetIdsWithoutContext = uniqueStrings(report.target_ids_without_spatial_context ?? []);
  assert(targetIdsWithoutContext.length === Number(report.targets_without_spatial_context), "Target IDs without spatial context do not reconcile.");
  const periodNodesAtDate = nodes.filter((node) => node.includes_1995_snapshot_by_published_dates).length;

  return {
    report_version: 1,
    status: "PASS_JAPAN_ESTAT_NATIVE_PERIOD_GRAPH_PROPOSED__REVIEW_ONLY__NO_SELECTABLE_RECORDS",
    generated_at_utc: String(report.generated_at_utc ?? ""),
    source_authority: "Japan Statistical LOD — e-Stat Standard Area Code List",
    source_endpoint_url: "https://data.e-stat.go.jp/lod/sparql/alldata/query",
    catalog_scope: "Bounded source-native history for area codes observed in official MLIT 1995 polygons for the 126 Japan GeoNames review targets. This is not a current nationwide selector catalog.",
    spatial_snapshot_date: expected.spatialSnapshotDate,
    source_fingerprints: {
      detail_report_sha256: options.inputReportSha256 ?? "",
      detail_manifest_sha256: options.inputManifestSha256 ?? "",
      e_stat_catalog_source_snapshot_sha256: report.e_stat_catalog_source_snapshot_sha256,
      input_spatial_first_report_sha256: manifest.input_spatial_first_report_sha256,
      input_e_stat_audit_report_sha256: manifest.input_e_stat_audit_report_sha256,
      input_e_stat_raw_source_response_sha256: manifest.input_e_stat_raw_source_response_sha256,
      detail_response_fingerprint: report.detail_source_fingerprint,
      detail_batch_manifest_sha256: sha256(JSON.stringify(manifest.detail_batches)),
      catalog_page_manifest_sha256: sha256(JSON.stringify(manifest.source_catalog_page_response_fingerprints)),
    },
    counts: {
      source_geonames_targets_reviewed: report.target_count,
      target_ids_without_spatial_context: targetIdsWithoutContext.length,
      distinct_e_stat_area_codes: areaCodes.size,
      source_period_nodes: nodes.length,
      source_period_nodes_covering_1995_by_published_dates: periodNodesAtDate,
      parent_reference_only_stub_nodes: parentOnlyNodes.size,
      parent_reference_edges_retained: edges.length,
      source_parent_references_with_invalid_or_self_reference: unresolvedParentReferences.length,
      source_periods_with_multiple_parent_references: nodes.filter((node) => node.parent_reference_count > 1).length,
      spatial_target_to_area_code_candidate_associations: associations.length,
      verified_geonames_to_estat_crosswalks: 0,
      approved_operational_parent_links: 0,
      selectable_records: 0,
    },
    source_period_nodes: nodes,
    parent_reference_only_nodes: [...parentOnlyNodes.values()].sort((a, b) => a.period_uri.localeCompare(b.period_uri)),
    source_declared_parent_edges: edges,
    unresolved_parent_references: unresolvedParentReferences,
    spatial_target_area_code_candidates: associations,
    decision_boundary: {
      source_declared_parent_references_are_preserved: true,
      source_periods_are_never_collapsed_across_dates: true,
      parent_reference_only_stubs_are_not_fully_detailed_nodes: true,
      geonames_to_estat_identity_crosswalks_verified: 0,
      operational_parent_links_created: 0,
      selectable_records_added: 0,
      database_migrations_seeds_imports_deployments: false,
      current_hierarchy_approved: false,
      nationwide_japan_selector_completeness_claimed: false,
    },
    limitations: [
      "The output models official e-Stat period records and parent references in the e-Stat namespace only.",
      "A GeoNames point contained in an MLIT polygon is a spatial location candidate, not proof that the GeoNames feature is identical to the e-Stat administrative unit.",
      "Parent URIs outside the 105-code history are emitted as reference-only stubs; their own period detail is not included in this graph.",
      "Periods with multiple parent references or malformed parent fields remain explicitly review-held.",
      "The 1995 boundary snapshot is historical context, not evidence of current nationwide catalog completeness.",
      "No operational hierarchy edge, entity crosswalk, database write, or selector change is authorized.",
    ],
  };
}
function nodeCsvRow(node) {
  return {
    record_kind: node.record_kind, source_namespace: node.source_namespace ?? "e-stat-sac",
    period_uri: node.period_uri, area_code: node.area_code,
    label_en: node.label_en ?? (node.labels_en ?? []).join("; "),
    label_ja: node.label_ja ?? (node.labels_ja ?? []).join("; "),
    effective_from: node.effective_from ?? "", effective_until: node.effective_until ?? "",
    includes_1995_snapshot_by_published_dates: String(node.includes_1995_snapshot_by_published_dates ?? "").toLowerCase(),
    parent_reference_count: node.parent_reference_count ?? "",
    identity_status: node.identity_status ?? node.status,
    fully_detailed_in_selected_history: String(node.fully_detailed_in_selected_history ?? (node.record_kind === "SOURCE_PERIOD_NODE")).toLowerCase(),
    selectable: String(node.selectable).toLowerCase(),
    operational_parent_link_created: String(node.operational_parent_link_created).toLowerCase(),
  };
}
function edgeCsvRow(edge) {
  return {
    child_period_uri: edge.child_period_uri, child_area_code: edge.child_area_code,
    parent_period_uri: edge.parent_period_uri, parent_area_code: edge.parent_area_code,
    parent_label_en: edge.parent_label_en, parent_label_ja: edge.parent_label_ja,
    child_effective_from: edge.child_effective_from, child_effective_until: edge.child_effective_until,
    child_parent_reference_count: edge.child_parent_reference_count, review_status: edge.review_status,
    operational_parent_link_created: String(edge.operational_parent_link_created).toLowerCase(),
    selectable: String(edge.selectable).toLowerCase(),
  };
}
function associationCsvRow(row) {
  return {
    source_geonames_id: row.source_geonames_id, source_geonames_name: row.source_geonames_name,
    raw_admin1_code_preserved: row.raw_admin1_code_preserved, spatial_snapshot_date: row.spatial_snapshot_date,
    e_stat_area_code_candidate: row.e_stat_area_code_candidate,
    e_stat_period_uris_covering_spatial_snapshot: row.e_stat_period_uris_covering_spatial_snapshot.join(";"),
    association_status: row.association_status,
    geonames_to_estat_crosswalk_verified: String(row.geonames_to_estat_crosswalk_verified).toLowerCase(),
    selectable: String(row.selectable).toLowerCase(),
    operational_relationship_created: String(row.operational_relationship_created).toLowerCase(),
  };
}
export async function runProposal({ reportPath, manifestPath, outputPrefix }) {
  const reportBytes = await readFile(reportPath);
  const report = JSON.parse(reportBytes.toString("utf8"));
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const result = buildJapanNativePeriodGraph(report, manifest, {
    inputReportSha256: sha256(reportBytes), inputManifestSha256: sha256(manifestBytes),
  });
  const out = resolve(outputPrefix);
  await mkdir(dirname(out), { recursive: true });
  const allNodes = [...result.source_period_nodes, ...result.parent_reference_only_nodes];
  const files = [
    [out + ".json", JSON.stringify(result, null, 2) + "\n"],
    [out + ".period-nodes.csv", renderCsv(
      ["record_kind","source_namespace","period_uri","area_code","label_en","label_ja","effective_from","effective_until","includes_1995_snapshot_by_published_dates","parent_reference_count","identity_status","fully_detailed_in_selected_history","selectable","operational_parent_link_created"],
      allNodes.map(nodeCsvRow))],
    [out + ".parent-edges.csv", renderCsv(
      ["child_period_uri","child_area_code","parent_period_uri","parent_area_code","parent_label_en","parent_label_ja","child_effective_from","child_effective_until","child_parent_reference_count","review_status","operational_parent_link_created","selectable"],
      result.source_declared_parent_edges.map(edgeCsvRow))],
    [out + ".target-area-candidates.csv", renderCsv(
      ["source_geonames_id","source_geonames_name","raw_admin1_code_preserved","spatial_snapshot_date","e_stat_area_code_candidate","e_stat_period_uris_covering_spatial_snapshot","association_status","geonames_to_estat_crosswalk_verified","selectable","operational_relationship_created"],
      result.spatial_target_area_code_candidates.map(associationCsvRow))],
    [out + ".unresolved-parent-references.csv", renderCsv(
      ["child_period_uri","child_area_code","parent_period_uri","parent_area_code","parent_label_en","parent_label_ja","review_status","unresolved_reason","operational_parent_link_created"],
      result.unresolved_parent_references.map((row) => ({ ...row, operational_parent_link_created: "false" })))],
  ];
  await Promise.all(files.map(([path, content]) => writeFile(path, content, "utf8")));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [reportPath, manifestPath, outputPrefix] = process.argv.slice(2);
  if (!reportPath || !manifestPath || !outputPrefix) {
    process.stderr.write("Usage: geonames-japan-native-estat-period-graph-proposal.mjs <detail-report.json> <detail-manifest.json> <output-prefix>\n");
    process.exitCode = 2;
  } else {
    runProposal({ reportPath, manifestPath, outputPrefix })
      .then((result) => process.stdout.write(JSON.stringify({ status: result.status, counts: result.counts, source_fingerprints: result.source_fingerprints }, null, 2) + "\n"))
      .catch((error) => {
        process.stderr.write("Japan native e-Stat period graph proposal failed closed: " + (error.stack ?? error) + "\n");
        process.exitCode = 1;
      });
  }
}
