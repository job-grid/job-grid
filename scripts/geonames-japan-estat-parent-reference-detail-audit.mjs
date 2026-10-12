#!/usr/bin/env node
/**
 * Fetch exact official e-Stat details for parent-only period URIs discovered
 * by the Japan-native period graph. Evidence only: no GeoNames identity,
 * selector, or operational parent relationship is inferred.
 *
 * Usage:
 *   node scripts/geonames-japan-estat-parent-reference-detail-audit.mjs <graph.json> <output-prefix>
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DETAIL_QUERY_BATCH_SIZE,
  buildDetailsQuery,
  parseEstatBindings,
  requestEstatQuery,
} from "./geonames-japan-estat-evidence-audit.mjs";

const PERIOD_URI = /^https?:\/\/data\.e-stat\.go\.jp\/lod\/sac\/C(\d{5})-(\d{8})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const unique = (values) => [...new Set(values.filter((value) => typeof value === "string" && value.length))].sort();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toUriParts(uri) {
  const match = String(uri ?? "").match(PERIOD_URI);
  return match ? { area_code: match[1], effective_from_compact: match[2] } : null;
}

export function collectParentOnlyTargets(graph) {
  assert(graph?.status === "PASS_JAPAN_ESTAT_NATIVE_PERIOD_GRAPH_PROPOSED__REVIEW_ONLY__NO_SELECTABLE_RECORDS",
    "Unexpected Japan-native graph status.");
  assert(graph?.decision_boundary?.operational_parent_links_created === 0,
    "Input graph violates zero-operational-parent-write boundary.");
  assert(graph?.decision_boundary?.selectable_records_added === 0,
    "Input graph violates zero-selectability boundary.");
  const detailedUris = new Set((graph.source_period_nodes ?? []).map((node) => node.period_uri));
  const stubs = graph.parent_reference_only_nodes;
  assert(Array.isArray(stubs), "Input graph has no parent-reference-only stub list.");
  const targets = [];
  const seen = new Set();
  for (const stub of stubs) {
    const uri = String(stub.period_uri ?? "");
    const code = String(stub.area_code ?? "");
    const parts = toUriParts(uri);
    assert(parts, "Invalid parent-only e-Stat period URI: " + uri);
    assert(parts.area_code === code, "Parent-only e-Stat URI/code mismatch: " + uri);
    assert(!detailedUris.has(uri), "A parent-only stub duplicates an already-detailed period URI: " + uri);
    assert(!seen.has(uri), "Duplicate parent-only period URI: " + uri);
    seen.add(uri);
    targets.push({
      period_uri: uri,
      area_code: code,
      labels_en: unique(stub.labels_en ?? []),
      labels_ja: unique(stub.labels_ja ?? []),
      source_status: String(stub.status ?? ""),
    });
  }
  return targets.sort((a, b) => a.period_uri.localeCompare(b.period_uri));
}

function mergeRowsForTarget(target, rows) {
  const ownRows = rows.filter((row) => row.period_uri === target.period_uri);
  if (!ownRows.length) {
    return {
      ...target,
      detail_status: "PARENT_URI_DETAIL_NOT_FOUND_AT_RETRIEVAL__REVIEW_REQUIRED",
      detail_row_count: 0,
      effective_from_values: [],
      effective_until_values: [],
      japanese_labels_from_detail: [],
      previous_period_uris: [],
      succeeding_period_uris: [],
      administrative_class_uris: [],
      parent_references: [],
      detail_validation_issues: ["The exact requested period URI returned no detail bindings."],
      selectable: false,
      operational_parent_link_created: false,
    };
  }

  const effectiveFrom = unique(ownRows.map((row) => String(row.effective_from ?? "").trim()));
  const effectiveUntil = unique(ownRows.map((row) => String(row.effective_until ?? "").trim()));
  const japaneseLabels = unique(ownRows.map((row) => String(row.label_ja ?? "").trim()));
  const previous = unique(ownRows.map((row) => String(row.previous_period_uri ?? "").trim()));
  const succeeding = unique(ownRows.map((row) => String(row.succeeding_period_uri ?? "").trim()));
  const classes = unique(ownRows.map((row) => String(row.administrative_class_uri ?? "").trim()));
  const parentsBySignature = new Map();
  for (const row of ownRows) {
    if (![row.parent_uri, row.parent_area_code, row.parent_label_en, row.parent_label_ja].some((v) => String(v ?? "").trim())) continue;
    const parent = {
      period_uri: String(row.parent_uri ?? "").trim(),
      area_code: String(row.parent_area_code ?? "").trim(),
      label_en: String(row.parent_label_en ?? "").trim(),
      label_ja: String(row.parent_label_ja ?? "").trim(),
    };
    const signature = JSON.stringify(parent);
    parentsBySignature.set(signature, parent);
  }
  const parents = [...parentsBySignature.values()].sort((a, b) => a.period_uri.localeCompare(b.period_uri));
  const issues = [];
  if (effectiveFrom.filter(Boolean).length !== 1) issues.push("Expected exactly one non-empty effective-from value for this period URI.");
  if (effectiveUntil.filter(Boolean).length > 1) issues.push("Conflicting effective-until values were returned for this period URI.");
  for (const parent of parents) {
    const parts = toUriParts(parent.period_uri);
    if (!parts || parts.area_code !== parent.area_code) {
      issues.push("A parent reference has a missing/malformed URI or an area-code/URI mismatch.");
    }
  }
  if (parents.length > 1) issues.push("Multiple distinct parent references were returned and require review.");
  const detailStatus = issues.length
    ? "DETAIL_FOUND_WITH_PERIOD_OR_PARENT_VALIDATION_ISSUE__REVIEW_REQUIRED"
    : parents.length
      ? "PARENT_PERIOD_DETAIL_RETRIEVED__PARENT_REFERENCE_RETAINED__NON_OPERATIONAL"
      : "PARENT_PERIOD_DETAIL_RETRIEVED__NO_PARENT_REFERENCE_RETURNED__NON_OPERATIONAL";
  return {
    ...target,
    detail_status: detailStatus,
    detail_row_count: ownRows.length,
    effective_from_values: effectiveFrom,
    effective_until_values: effectiveUntil,
    japanese_labels_from_detail: japaneseLabels,
    previous_period_uris: previous,
    succeeding_period_uris: succeeding,
    administrative_class_uris: classes,
    parent_references: parents.map((parent) => ({
      ...parent,
      review_status: !toUriParts(parent.period_uri) || toUriParts(parent.period_uri)?.area_code !== parent.area_code
        ? "INVALID_PARENT_REFERENCE_FIELDS__REVIEW_REQUIRED"
        : parents.length > 1
          ? "MULTIPLE_PARENT_REFERENCES__AMBIGUOUS_REVIEW_REQUIRED"
          : "SOURCE_DECLARED_PARENT_REFERENCE__NOT_OPERATIONAL",
      selectable: false,
      operational_parent_link_created: false,
    })),
    detail_validation_issues: issues,
    selectable: false,
    operational_parent_link_created: false,
  };
}

export function buildParentDetailSupplement(graph, batches, options = {}) {
  const targets = collectParentOnlyTargets(graph);
  const expectedTargetCount = options.expectedTargetCount;
  if (Number.isInteger(expectedTargetCount)) {
    assert(targets.length === expectedTargetCount, "Parent-only target count mismatch.");
  }
  const allRequested = [];
  const rows = [];
  const batchManifests = [];
  for (const batch of batches) {
    assert(Array.isArray(batch.requested_period_uris), "A detail batch lacks its requested URI list.");
    assert(Array.isArray(batch.rows), "A detail batch lacks parsed detail rows.");
    assert(batch.manifest?.http_status === 200, "Parent detail response did not return HTTP 200.");
    assert(SHA256.test(String(batch.manifest?.query_sha256 ?? "")), "Parent detail query hash is invalid.");
    assert(SHA256.test(String(batch.manifest?.response_sha256 ?? "")), "Parent detail response hash is invalid.");
    assert(Number(batch.manifest.result_row_count) === batch.rows.length, "Parent detail batch result count mismatch.");
    allRequested.push(...batch.requested_period_uris);
    rows.push(...batch.rows);
    batchManifests.push({
      requested_period_uris: [...batch.requested_period_uris],
      requested_period_count: batch.requested_period_uris.length,
      response_row_count: batch.rows.length,
      query_sha256: batch.manifest.query_sha256,
      response_sha256: batch.manifest.response_sha256,
      captured_at_utc: batch.manifest.captured_at_utc,
      http_status: batch.manifest.http_status,
      response_bytes: batch.manifest.response_bytes,
      endpoint_url: batch.manifest.endpoint_url,
    });
  }
  assert(allRequested.length === new Set(allRequested).size, "A parent period URI was requested more than once.");
  const targetUris = targets.map((target) => target.period_uri).sort();
  assert(JSON.stringify([...allRequested].sort()) === JSON.stringify(targetUris),
    "Requested parent URIs do not exactly reconcile to the parent-only stub list.");
  const targetSet = new Set(targetUris);
  for (const row of rows) {
    assert(row.period_uri && targetSet.has(row.period_uri),
      "The e-Stat detail response contains an unrequested period URI: " + row.period_uri);
  }
  const details = targets.map((target) => mergeRowsForTarget(target, rows));
  const edges = details.flatMap((detail) => detail.parent_references.map((parent) => ({
    child_period_uri: detail.period_uri,
    child_area_code: detail.area_code,
    parent_period_uri: parent.period_uri,
    parent_area_code: parent.area_code,
    parent_label_en: parent.label_en,
    parent_label_ja: parent.label_ja,
    review_status: parent.review_status,
    selectable: false,
    operational_parent_link_created: false,
  })));
  const unresolved = details.filter((detail) => detail.detail_status.includes("REVIEW_REQUIRED") ||
    detail.detail_status.includes("NOT_FOUND"));
  return {
    report_version: 1,
    status: "PASS_JAPAN_ESTAT_PARENT_REFERENCE_DETAIL_AUDIT__SOURCE_EVIDENCE_ONLY__NO_SELECTABLE_RECORDS",
    source_authority: "Japan Statistical LOD — e-Stat Standard Area Code List",
    source_endpoint_url: "https://data.e-stat.go.jp/lod/sparql/alldata/query",
    input_graph_sha256: options.inputGraphSha256 ?? "",
    input_graph_source_fingerprints: graph.source_fingerprints ?? {},
    counts: {
      parent_only_stubs_requested: targets.length,
      parent_period_details_found: details.filter((row) => row.detail_row_count > 0).length,
      parent_period_details_not_found: details.filter((row) => row.detail_row_count === 0).length,
      detail_validation_issues: details.filter((row) => row.detail_validation_issues.length > 0).length,
      source_parent_edges_retained_from_detail_rows: edges.length,
      parents_with_multiple_source_declared_parents: details.filter((row) => row.parent_references.length > 1).length,
      selectable_records: 0,
      verified_geonames_crosswalks: 0,
      operational_parent_links_created: 0,
    },
    parent_period_details: details,
    parent_period_declared_edges: edges,
    unresolved_period_details: unresolved,
    detail_batches: batchManifests,
    decision_boundary: {
      every_input_stub_is_accounted_for: true,
      source_parent_references_are_preserved_not_promoted: true,
      no_geo_names_identity_inferred: true,
      selectable_records_added: 0,
      operational_parent_links_created: 0,
      database_migrations_seeds_imports_or_deployments: false,
    },
    limitations: [
      "This supplements the exact parent-period references from the bounded 1995 spatial-first graph only.",
      "The audit does not recursively expand the newly returned parent references; any new parent URIs remain a subsequent review queue.",
      "An official source-period detail is not a GeoNames entity-identity crosswalk.",
      "Multiple, invalid or absent parent details remain review-held and never create operational parent links.",
      "No selector, database, seed, migration or deployment changes are authorized.",
    ],
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function renderCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n") + "\n";
}

export async function runParentDetailAudit({
  graphPath, outputPrefix, fetchImpl = fetch, now = () => new Date(),
}) {
  const graphBytes = await readFile(graphPath);
  const graph = JSON.parse(graphBytes.toString("utf8"));
  const targets = collectParentOnlyTargets(graph);
  const batches = [];
  for (let offset = 0; offset < targets.length; offset += DETAIL_QUERY_BATCH_SIZE) {
    const uris = targets.slice(offset, offset + DETAIL_QUERY_BATCH_SIZE).map((target) => target.period_uri);
    const query = buildDetailsQuery(uris);
    const response = await requestEstatQuery(query, fetchImpl, now, { allowEmpty: true });
    const rows = parseEstatBindings(response.bindings);
    const requested = new Set(uris);
    const unexpected = rows.find((row) => row.period_uri && !requested.has(row.period_uri));
    if (unexpected) throw new Error("e-Stat returned unrequested parent period URI: " + unexpected.period_uri);
    batches.push({ requested_period_uris: uris, rows, manifest: response.manifest });
  }
  const report = buildParentDetailSupplement(graph, batches, { inputGraphSha256: sha256(graphBytes) });
  const output = resolve(outputPrefix);
  await mkdir(dirname(output), { recursive: true });
  const files = [
    [output + ".json", JSON.stringify(report, null, 2) + "\n"],
    [output + ".period-details.csv", renderCsv(
      ["period_uri","area_code","labels_en","labels_ja_from_parent_reference","effective_from_values","effective_until_values","detail_row_count","detail_status","detail_validation_issues","selectable","operational_parent_link_created"],
      report.parent_period_details.map((row) => ({
        period_uri: row.period_uri, area_code: row.area_code,
        labels_en: row.labels_en.join("; "), labels_ja_from_parent_reference: row.japanese_labels_from_detail.join("; "),
        effective_from_values: row.effective_from_values.join("; "), effective_until_values: row.effective_until_values.join("; "),
        detail_row_count: row.detail_row_count, detail_status: row.detail_status,
        detail_validation_issues: row.detail_validation_issues.join("; "),
        selectable: String(row.selectable), operational_parent_link_created: String(row.operational_parent_link_created),
      })))],
    [output + ".parent-edges.csv", renderCsv(
      ["child_period_uri","child_area_code","parent_period_uri","parent_area_code","parent_label_en","parent_label_ja","review_status","selectable","operational_parent_link_created"],
      report.parent_period_declared_edges)],
    [output + ".unresolved.csv", renderCsv(
      ["period_uri","area_code","detail_status","detail_validation_issues","selectable","operational_parent_link_created"],
      report.unresolved_period_details.map((row) => ({
        period_uri: row.period_uri, area_code: row.area_code, detail_status: row.detail_status,
        detail_validation_issues: row.detail_validation_issues.join("; "),
        selectable: String(row.selectable), operational_parent_link_created: String(row.operational_parent_link_created),
      })))],
  ];
  await Promise.all(files.map(([path, content]) => writeFile(path, content, "utf8")));
  return report;
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) {
  const [, , graphPath, outputPrefix] = process.argv;
  if (!graphPath || !outputPrefix) {
    console.error("Usage: node scripts/geonames-japan-estat-parent-reference-detail-audit.mjs <graph.json> <output-prefix>");
    process.exitCode = 2;
  } else {
    runParentDetailAudit({ graphPath, outputPrefix })
      .then((report) => {
        console.log("Japan e-Stat parent detail audit complete.");
        console.log(JSON.stringify(report.counts, null, 2));
      })
      .catch((error) => {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
      });
  }
}
