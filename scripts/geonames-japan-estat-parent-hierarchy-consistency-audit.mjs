#!/usr/bin/env node
/**
 * Follow official e-Stat parent-period URIs one level upward and compare that
 * prefecture context with the GeoNames ADM1 namespace of exact-label ADM2
 * candidates. This is a structural consistency audit only; it never approves
 * a crosswalk or writes an operational parent relationship.
 *
 * Usage:
 *   node scripts/geonames-japan-estat-parent-hierarchy-consistency-audit.mjs
 *     <JP.txt> <geonames-source-manifest.json>
 *     <parent-candidate-expansion.json> <output-prefix>
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DETAIL_QUERY_BATCH_SIZE, buildDetailsQuery, parseEstatBindings, requestEstatQuery } from "./geonames-japan-estat-evidence-audit.mjs";

const EXPECTED_PARENT_REFERENCES = 117;
const EXPECTED_CANDIDATE_ROWS = 91;
const EXPECTED_COUNTRY = "JP";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeJapanese = (value) => String(value ?? "").normalize("NFC").trim();

function exactJapaneseMatchFields(record, label) {
  const key = normalizeJapanese(label);
  if (!key) return [];
  const fields = [];
  if (normalizeJapanese(record.name) === key) fields.push("primary_name");
  if (normalizeJapanese(record.ascii_name) === key) fields.push("ascii_name");
  if ((record.alternate_names ?? []).some((value) => normalizeJapanese(value) === key)) {
    fields.push("exact_alternate_name_entry");
  }
  return fields;
}

function parseGeoNamesRow(line) {
  const fields = line.split("\t");
  if (fields.length !== 19 || !/^\d+$/.test(fields[0] ?? "")) {
    throw new Error("GeoNames JP.txt contains a malformed/wrong-shape source row.");
  }
  return {
    geonames_id: fields[0],
    name: fields[1],
    ascii_name: fields[2],
    alternate_names: fields[3] ? fields[3].split(",").filter((value) => value.length > 0) : [],
    feature_class: fields[6],
    feature_code: fields[7],
    country_code: fields[8],
    admin1_code: fields[10],
    admin2_code: fields[11],
    admin3_code: fields[12],
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function renderCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) =>
    headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function distinctGrandparentReferences(detailRows) {
  const bySignature = new Map();
  for (const row of detailRows) {
    if (!(row.parent_area_code || row.parent_uri || row.parent_label_en || row.parent_label_ja)) continue;
    const reference = {
      area_code: String(row.parent_area_code ?? "").trim(),
      uri: String(row.parent_uri ?? "").trim(),
      label_en: String(row.parent_label_en ?? "").trim(),
      label_ja: normalizeJapanese(row.parent_label_ja ?? ""),
    };
    const signature = JSON.stringify(reference);
    bySignature.set(signature, reference);
  }
  return [...bySignature.values()].sort((a, b) =>
    a.area_code.localeCompare(b.area_code) || a.uri.localeCompare(b.uri));
}

function selectStatus({ featureCode, admin1Code, grandparentReferences, adm1Matches }) {
  if (featureCode !== "ADM2") return {
    status: featureCode === "ADM1"
      ? "NOT_APPLICABLE_ADM1_CANDIDATE_NO_PARENT_NAMESPACE_CHECK"
      : "OUT_OF_SCOPE_PARENT_FEATURE_CODE",
    coherentIds: [],
  };
  if (!admin1Code) return { status: "CANDIDATE_ADMIN1_CODE_MISSING", coherentIds: [] };
  if (grandparentReferences.length === 0) return {
    status: "NO_ESTAT_GRANDPARENT_REFERENCE_FOR_PERIOD",
    coherentIds: [],
  };
  if (grandparentReferences.length !== 1) return {
    status: "MULTIPLE_ESTAT_GRANDPARENT_REFERENCES_REQUIRE_REVIEW",
    coherentIds: [],
  };
  const grandparent = grandparentReferences[0];
  if (!grandparent.label_ja) return {
    status: "ESTAT_GRANDPARENT_HAS_NO_JAPANESE_LABEL",
    coherentIds: [],
  };
  if (!adm1Matches.length) return {
    status: "NO_EXACT_GEONAMES_ADM1_CANDIDATE_FOR_ESTAT_GRANDPARENT_LABEL",
    coherentIds: [],
  }
  const coherent = adm1Matches.filter((record) => record.admin1_code === admin1Code);
  if (coherent.length && adm1Matches.length === 1) return {
    status: "ADMIN1_CODE_COHERENT_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE",
    coherentIds: coherent.map((record) => record.geonames_id),
  };
  if (coherent.length && adm1Matches.length > 1) return {
    status: "ADMIN1_CODE_COHERENT_WITH_ONE_OF_MULTIPLE_ESTAT_GRANDPARENT_LABEL_CANDIDATES",
    coherentIds: coherent.map((record) => record.geonames_id),
  };
  if (adm1Matches.length === 1) return {
    status: "ADMIN1_CODE_CONFLICTS_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE",
    coherentIds: [],
  };
  return {
    status: "ADMIN1_CODE_CONFLICTS_WITH_ALL_ESTAT_GRANDPARENT_LABEL_CANDIDATES",
    coherentIds: [],
  };
}

export async function runParentHierarchyConsistencyAudit({
  geonamesJapanTextPath,
  geonamesSourceManifestPath,
  parentCandidateExpansionPath,
  outputPrefix,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const sourceBytes = await readFile(geonamesJapanTextPath);
  const sourceManifest = JSON.parse(await readFile(geonamesSourceManifestPath, "utf8"));
  const candidateBytes = await readFile(parentCandidateExpansionPath);
  const candidateReport = JSON.parse(candidateBytes.toString("utf8"));

  if (candidateReport.report_version !== 2 ||
      candidateReport.status !== "PASS_EXACT_JAPANESE_LABEL_PARENT_ID_CANDIDATE_DISCOVERY; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED" ||
      candidateReport.parent_reference_count !== EXPECTED_PARENT_REFERENCES ||
      candidateReport.candidate_match_rows !== EXPECTED_CANDIDATE_ROWS ||
      candidateReport.operational_parent_links_created !== 0 ||
      !Array.isArray(candidateReport.parent_references)) {
    throw new Error("Parent candidate expansion failed source-scope/count/no-write validation.");
  }
  if (sourceManifest.archive_sha256 !== candidateReport.geonames_source?.archive_sha256 ||
      sourceManifest.text_member_sha256 !== candidateReport.geonames_source?.text_member_sha256 ||
      sha256(sourceBytes) !== candidateReport.geonames_source?.text_member_sha256) {
    throw new Error("JP.txt bytes and the parent expansion report do not share the same source fingerprints.");
  }

  const references = candidateReport.parent_references;
  const expectedUriToReference = new Map();
  for (const reference of references) {
    const uri = String(reference.parent_uri ?? "").trim();
    const code = String(reference.parent_area_code ?? "").trim();
    if (!/^\d{5}$/.test(code) || !uri) {
      throw new Error("A candidate parent reference lacks a five-digit code or exact period URI.");
    }
    const prior = expectedUriToReference.get(uri);
    if (prior && (prior.parent_area_code !== code || prior.parent_label_ja !== reference.parent_label_ja)) {
      throw new Error("Conflicting area-code/Japanese-label mapping for an exact e-Stat parent period URI.");
    }
    expectedUriToReference.set(uri, {
      parent_area_code: code,
      parent_uri: uri,
      parent_label_en: String(reference.parent_label_en ?? "").trim(),
      parent_label_ja: normalizeJapanese(reference.parent_label_ja ?? ""),
    });
  }
  const requestedUris = [...expectedUriToReference.keys()].sort();
  if (requestedUris.length !== EXPECTED_PARENT_REFERENCES) {
    throw new Error("Exact e-Stat parent-period URI count does not equal the expected 117-reference universe.");
  }

  const detailRowsByUri = new Map();
  const queryBatches = [];
  for (let offset = 0; offset < requestedUris.length; offset += DETAIL_QUERY_BATCH_SIZE) {
    const uris = requestedUris.slice(offset, offset + DETAIL_QUERY_BATCH_SIZE);
    const query = buildDetailsQuery(uris);
    const result = await requestEstatQuery(query, fetchImpl, now);
    const rows = parseEstatBindings(result.bindings);
    const requested = new Set(uris);
    const unexpected = uniqueStrings(rows.map((row) => row.period_uri).filter((uri) => !requested.has(uri)));
    if (unexpected.length) throw new Error("e-Stat returned unrequested parent period URI(s): " + unexpected.join("; "));
    for (const uri of uris) {
      const matching = rows.filter((row) => row.period_uri === uri);
      if (!matching.length) throw new Error("e-Stat omitted exact parent period URI: " + uri);
      const expected = expectedUriToReference.get(uri);
      const labels = uniqueStrings(matching.map((row) => normalizeJapanese(row.label_ja)));
      if (labels.length > 1 || (expected.parent_label_ja && labels.length === 1 && labels[0] !== expected.parent_label_ja)) {
        throw new Error("Official e-Stat label for " + uri + " does not reconcile with the pinned parent-reference record.");
      }
      detailRowsByUri.set(uri, matching);
    }
    queryBatches.push({
      target_offset: offset,
      requested_period_count: uris.length,
      requested_period_uris: uris,
      query_sha256: result.manifest.query_sha256,
      captured_at_utc: result.manifest.captured_at_utc,
      http_status: result.manifest.http_status,
      response_bytes: result.manifest.response_bytes,
      response_sha256: result.manifest.response_sha256,
      result_row_count: rows.length,
      response: result.parsed,
      query,
    });
  }

  const sourceLines = sourceBytes.toString("utf8").split(/\r?\n/).filter((line) => line.length > 0);
  const eligibleAdminIds = new Set();
  const geonamesAdm1 = [];
  let malformedRows = 0;
  for (const line of sourceLines) {
    let record;
    try {
      record = parseGeoNamesRow(line);
    } catch {
      malformedRows += 1;
      continue;
    }
    if (record.country_code !== EXPECTED_COUNTRY || record.feature_class !== "A" ||
        !/^ADM[1-3]$/.test(record.feature_code)) continue;
    if (eligibleAdminIds.has(record.geonames_id)) throw new Error("Duplicate eligible GeoNames administrative ID: " + record.geonames_id);
    eligibleAdminIds.add(record.geonames_id);
    if (record.feature_code === "ADM1") geonamesAdm1.push(record);
  }
  if (malformedRows !== 0 || sourceLines.length !== candidateReport.geonames_source.text_rows_scanned ||
      eligibleAdminIds.size !== candidateReport.geonames_source.eligible_japan_administrative_records) {
    throw new Error("GeoNames JP.txt rows/eligible administrative records do not reconcile to the pinned source report.");
  }

  const adm1MatchesForLabel = (label) => geonamesAdm1.map((record) => ({
    ...record,
    exact_match_fields: exactJapaneseMatchFields(record, label),
  })).filter((record) => record.exact_match_fields.length)
    .sort((a, b) => Number(a.geonames_id) - Number(b.geonames_id));

  const contextRows = [];
  const candidateRows = [];
  for (const reference of references) {
    const detailRows = detailRowsByUri.get(reference.parent_uri) ?? [];
    const grandparents = distinctGrandparentReferences(detailRows);
    const grandparentCandidates = grandparents.map((grandparent) => ({
      ...grandparent,
      geonames_adm1_candidates: grandparent.label_ja
        ? adm1MatchesForLabel(grandparent.label_ja).map((record) => ({
            geonames_id: record.geonames_id,
            name: record.name,
            ascii_name: record.ascii_name,
            admin1_code: record.admin1_code,
            exact_match_fields: record.exact_match_fields,
          }))
        : [],
    }));
    const context = {
      parent_area_code: reference.parent_area_code,
      parent_uri: reference.parent_uri,
      parent_label_en: reference.parent_label_en,
      parent_label_ja: reference.parent_label_ja,
      parent_period_detail_row_count: detailRows.length,
      e_stat_grandparent_reference_count: grandparents.length,
      e_stat_grandparent_references: grandparentCandidates,
      operational_parent_link_created: false,
    };
    contextRows.push(context);

    for (const candidate of reference.candidate_matches ?? []) {
      const statuses = [];
      const evidence = grandparentCandidates;
      const decision = selectStatus({
        featureCode: candidate.feature_code,
        admin1Code: String(candidate.raw_admin1_code ?? "").trim(),
        grandparentReferences: evidence,
        adm1Matches: evidence.length === 1 ? evidence[0].geonames_adm1_candidates : [],
      });
      candidateRows.push({
        parent_area_code: reference.parent_area_code,
        parent_uri: reference.parent_uri,
        parent_label_en: reference.parent_label_en,
        parent_label_ja: reference.parent_label_ja,
        parent_candidate_count: reference.candidate_count,
        parent_candidate_geonames_id: candidate.geonames_id,
        parent_candidate_name: candidate.geonames_name,
        parent_candidate_feature_code: candidate.feature_code,
        parent_candidate_admin1_code: candidate.raw_admin1_code,
        parent_candidate_match_fields: (candidate.exact_match_fields ?? []).join(";"),
        e_stat_grandparent_area_code: evidence.length === 1 ? evidence[0].area_code : "",
        e_stat_grandparent_period_uri: evidence.length === 1 ? evidence[0].uri : "",
        e_stat_grandparent_label_en: evidence.length === 1 ? evidence[0].label_en : "",
        e_stat_grandparent_label_ja: evidence.length === 1 ? evidence[0].label_ja : "",
        e_stat_grandparent_geonames_adm1_candidate_ids: evidence.length === 1
          ? evidence[0].geonames_adm1_candidates.map((row) => row.geonames_id).join(";")
          : "",
        e_stat_grandparent_geonames_adm1_candidate_codes: evidence.length === 1
          ? evidence[0].geonames_adm1_candidates.map((row) => row.admin1_code).join(";")
          : "",
        e_stat_grandparent_geonames_adm1_match_fields: evidence.length === 1
          ? evidence[0].geonames_adm1_candidates.map((row) => row.exact_match_fields.join("+")).join(";")
          : "",
        coherent_adm1_candidate_ids: decision.coherentIds.join(";"),
        parent_hierarchy_consistency_status: decision.status,
        parent_identity_crosswalk_status: "NOT_VERIFIED_TO_GEONAMES_ID",
        operational_parent_link_created: false,
      });
    }
  }

  const referenceStatusGroups = [];
  const candidateRowsByReference = new Map();
  for (const row of candidateRows) {
    const key = JSON.stringify([row.parent_area_code, row.parent_uri]);
    const rows = candidateRowsByReference.get(key) ?? [];
    rows.push(row);
    candidateRowsByReference.set(key, rows);
  }
  for (const reference of references) {
    const key = JSON.stringify([reference.parent_area_code, reference.parent_uri]);
    const rows = candidateRowsByReference.get(key) ?? [];
    const coherent = rows.filter((row) =>
      row.parent_hierarchy_consistency_status.startsWith("ADMIN1_CODE_COHERENT_"));
    const conflicts = rows.filter((row) =>
      row.parent_hierarchy_consistency_status.startsWith("ADMIN1_CODE_CONFLICTS_"));
    referenceStatusGroups.push({
      parent_area_code: reference.parent_area_code,
      parent_uri: reference.parent_uri,
      parent_label_en: reference.parent_label_en,
      parent_label_ja: reference.parent_label_ja,
      candidate_count: rows.length,
      coherent_candidate_count: coherent.length,
      conflicting_candidate_count: conflicts.length,
      coherent_candidate_geonames_ids: coherent.map((row) => row.parent_candidate_geonames_id).join(";"),
      conflicting_candidate_geonames_ids: conflicts.map((row) => row.parent_candidate_geonames_id).join(";"),
      review_status: rows.length > 1 && coherent.length === 1 && conflicts.length === rows.length - 1
        ? "ONE_ADMIN1_CODE_COHERENT_CANDIDATE_FOR_REVIEW; NOT_APPROVED"
        : rows.length > 1 && coherent.length > 0
          ? "MULTIPLE_OR_NONEXCLUSIVE_CODE_COHERENCE_RESULTS; REVIEW"
          : rows.length > 1 && conflicts.length === rows.length
            ? "ALL_EXACT_LABEL_CANDIDATES_CONFLICT_WITH_ESTAT_GRANDPARENT_CONTEXT"
            : rows.length === 1 && coherent.length === 1
              ? "SINGLE_CANDIDATE_HAS_ADMIN1_CODE_COHERENCE; STILL_REQUIRES_IDENTITY_REVIEW"
              : rows.length === 1 && conflicts.length === 1
                ? "SINGLE_CANDIDATE_CONFLICTS_WITH_ESTAT_GRANDPARENT_CONTEXT"
                : rows.length === 0
                  ? "NO_EXACT_LABEL_CANDIDATE_TO_TEST"
                  : "UNRESOLVED_BY_PARENT_HIERARCHY_CONSISTENCY_CHECK",
      operational_parent_link_created: false,
    });
  }

  const statusCounts = {};
  for (const row of candidateRows) {
    statusCounts[row.parent_hierarchy_consistency_status] =
      (statusCounts[row.parent_hierarchy_consistency_status] ?? 0) + 1;
  }
  const summary = {
    report_version: 1,
    status: "PASS_ESTAT_PARENT_HIERARCHY_CONTEXT_AUDIT; GEO_NAMES_ADMIN1_CODE_CONSISTENCY_ONLY; NO_PARENT_LINKS_APPROVED",
    generated_at_utc: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
    input: {
      parent_expansion_sha256: sha256(candidateBytes),
      parent_reference_count: references.length,
      parent_references_with_candidates: references.filter((reference) => (reference.candidate_matches ?? []).length > 0).length,
      parent_candidate_match_rows: candidateRows.length,
      geonames_archive_sha256: sourceManifest.archive_sha256,
      geonames_text_member_sha256: sha256(sourceBytes),
      geonames_text_rows_scanned: sourceLines.length,
      malformed_or_wrong_shape_rows: malformedRows,
      eligible_japan_administrative_ids: eligibleAdminIds.size,
      eligible_japan_adm1_candidates: geonamesAdm1.length,
    },
    official_e_stat_parent_period_query: {
      endpoint: "https://data.e-stat.go.jp/lod/sparql/alldata/query",
      requested_parent_period_uri_count: requestedUris.length,
      detail_row_count: [...detailRowsByUri.values()].reduce((sum, rows) => sum + rows.length, 0),
      query_batch_count: queryBatches.length,
      query_batches: queryBatches.map((batch) => ({
        target_offset: batch.target_offset,
        requested_period_count: batch.requested_period_count,
        query_sha256: batch.query_sha256,
        captured_at_utc: batch.captured_at_utc,
        http_status: batch.http_status,
        response_bytes: batch.response_bytes,
        response_sha256: batch.response_sha256,
        result_row_count: batch.result_row_count,
      })),
      requested_period_uris_sha256: sha256(requestedUris.join("\n")),
    },
    parent_reference_context_count: contextRows.length,
    candidate_count_by_hierarchy_consistency_status: statusCounts,
    parent_references_with_one_coherent_candidate_and_other_conflicts: referenceStatusGroups.filter((row) => row.review_status === "ONE_ADMIN1_CODE_COHERENT_CANDIDATE_FOR_REVIEW; NOT_APPROVED").length,
    ambiguous_reference_review_rows: referenceStatusGroups.filter((row) => row.candidate_count > 1),
    parent_references: contextRows,
    candidate_results: candidateRows,
    parent_reference_dispositions: referenceStatusGroups,
    operational_parent_links_created: 0,
    limitations: [
      "A shared GeoNames admin1_code is an internal GeoNames namespace consistency signal. It is not by itself an externally verified parent-entity ID crosswalk.",
      "The GeoNames ADM1 grandparent label match can itself depend on untagged alternate names; coherent codes therefore prioritize review but do not prove identity.",
      "Conflicting GeoNames admin1_code values are evidence against a candidate under the exact e-Stat hierarchy context; they do not prove the GeoNames record is globally invalid.",
      "No candidate ID is selected or approved, and no operational parent link is created.",
    ],
  };

  const prefix = resolve(outputPrefix);
  await mkdir(dirname(prefix), { recursive: true });
  const contextFields = [
    "parent_area_code", "parent_uri", "parent_label_en", "parent_label_ja",
    "parent_period_detail_row_count", "e_stat_grandparent_reference_count",
    "e_stat_grandparent_area_codes", "e_stat_grandparent_labels_en", "e_stat_grandparent_labels_ja",
    "e_stat_grandparent_geonames_adm1_candidate_ids", "e_stat_grandparent_geonames_adm1_candidate_codes",
    "operational_parent_link_created",
  ];
  const contextCsvRows = contextRows.map((row) => ({
    parent_area_code: row.parent_area_code,
    parent_uri: row.parent_uri,
    parent_label_en: row.parent_label_en,
    parent_label_ja: row.parent_label_ja,
    parent_period_detail_row_count: row.parent_period_detail_row_count,
    e_stat_grandparent_reference_count: row.e_stat_grandparent_reference_count,
    e_stat_grandparent_area_codes: row.e_stat_grandparent_references.map((parent) => parent.area_code).join(";"),
    e_stat_grandparent_labels_en: row.e_stat_grandparent_references.map((parent) => parent.label_en).join(";"),
    e_stat_grandparent_labels_ja: row.e_stat_grandparent_references.map((parent) => parent.label_ja).join(";"),
    e_stat_grandparent_geonames_adm1_candidate_ids: row.e_stat_grandparent_references
      .flatMap((parent) => parent.geonames_adm1_candidates.map((candidate) => candidate.geonames_id)).join(";"),
    e_stat_grandparent_geonames_adm1_candidate_codes: row.e_stat_grandparent_references
      .flatMap((parent) => parent.geonames_adm1_candidates.map((candidate) => candidate.admin1_code)).join(";"),
    operational_parent_link_created: "false",
  }));
  const candidateFields = [
    "parent_area_code", "parent_uri", "parent_label_en", "parent_label_ja", "parent_candidate_count",
    "parent_candidate_geonames_id", "parent_candidate_name", "parent_candidate_feature_code",
    "parent_candidate_admin1_code", "parent_candidate_match_fields",
    "e_stat_grandparent_area_code", "e_stat_grandparent_period_uri", "e_stat_grandparent_label_en",
    "e_stat_grandparent_label_ja", "e_stat_grandparent_geonames_adm1_candidate_ids",
    "e_stat_grandparent_geonames_adm1_candidate_codes", "e_stat_grandparent_geonames_adm1_match_fields",
    "coherent_adm1_candidate_ids", "parent_hierarchy_consistency_status",
    "parent_identity_crosswalk_status", "operational_parent_link_created",
  ];
  const dispositionFields = [
    "parent_area_code", "parent_uri", "parent_label_en", "parent_label_ja", "candidate_count",
    "coherent_candidate_count", "conflicting_candidate_count", "coherent_candidate_geonames_ids",
    "conflicting_candidate_geonames_ids", "review_status", "operational_parent_link_created",
  ];
  const writes = [
    writeFile(prefix + ".json", JSON.stringify(summary, null, 2) + "\n", "utf8"),
    writeFile(prefix + ".parent-reference-context.csv", renderCsv(contextFields, contextCsvRows), "utf8"),
    writeFile(prefix + ".candidate-results.csv", renderCsv(candidateFields, candidateRows), "utf8"),
    writeFile(prefix + ".parent-reference-dispositions.csv", renderCsv(dispositionFields, referenceStatusGroups), "utf8"),
    writeFile(prefix + ".source-response.json", JSON.stringify({
      source: "official e-Stat SPARQL endpoint",
      endpoint: "https://data.e-stat.go.jp/lod/sparql/alldata/query",
      parent_expansion_sha256: sha256(candidateBytes),
      requested_parent_period_uris: requestedUris,
      query_batches: queryBatches,
    }, null, 2) + "\n", "utf8"),
  ];
  await Promise.all(writes);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [geonamesJapanTextPath, geonamesSourceManifestPath, parentCandidateExpansionPath, outputPrefix] = process.argv.slice(2);
  if (!geonamesJapanTextPath || !geonamesSourceManifestPath || !parentCandidateExpansionPath || !outputPrefix) {
    process.stderr.write(
      "Usage: node scripts/geonames-japan-estat-parent-hierarchy-consistency-audit.mjs " +
      "<JP.txt> <geonames-source-manifest.json> <parent-candidate-expansion.json> <output-prefix>\n",
    );
    process.exitCode = 2;
  } else {
    runParentHierarchyConsistencyAudit({
      geonamesJapanTextPath,
      geonamesSourceManifestPath,
      parentCandidateExpansionPath,
      outputPrefix,
    }).then((summary) => {
      process.stdout.write(JSON.stringify({
        status: summary.status,
        parent_reference_context_count: summary.parent_reference_context_count,
        parent_candidate_match_rows: summary.input.parent_candidate_match_rows,
        parent_references_with_one_coherent_candidate_and_other_conflicts:
          summary.parent_references_with_one_coherent_candidate_and_other_conflicts,
        candidate_count_by_hierarchy_consistency_status: summary.candidate_count_by_hierarchy_consistency_status,
        operational_parent_links_created: 0,
      }, null, 2) + "\n");
    }).catch((error) => {
      process.stderr.write("e-Stat/GeoNames parent hierarchy consistency audit failed closed: " + (error.stack ?? error) + "\n");
      process.exitCode = 1;
    });
  }
}
