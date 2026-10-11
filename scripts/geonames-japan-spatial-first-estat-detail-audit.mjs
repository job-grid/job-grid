#!/usr/bin/env node
/**
 * Read-only historical/parent-reference audit for 1995 MLIT spatial-first
 * area-code candidates. Spatial location discovers codes only; it never
 * establishes a GeoNames identity crosswalk or writes parent links.
 *
 * Usage:
 *   node scripts/geonames-japan-spatial-first-estat-detail-audit.mjs
 *     <spatial-first-report.json> <estat-source-response.json>
 *     <estat-audit-report.json> <output-prefix>
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

const SPATIAL_SNAPSHOT_DATE = "1995-10-01";
const EXPECTED_TARGET_COUNT = 126;
const EXPECTED_SPATIAL_ARCHIVE_COUNT = 47;
const EXPECTED_ESTAT_CATALOG_ROWS = 14741;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function canonicalJson(value) {
  return JSON.stringify(value);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function bindingValueCaseInsensitive(binding, key) {
  const entry = Object.entries(binding ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return entry?.[1]?.value ?? "";
}

export function buildCatalogCodeIndex(sourceResponse, expectedCatalogRows = EXPECTED_ESTAT_CATALOG_ROWS) {
  const pages = sourceResponse?.catalog_pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("e-Stat source-response payload contains no catalog pages.");
  }
  const index = new Map();
  let totalRows = 0;
  const normalizedPageManifest = [];
  for (const page of pages) {
    const bindings = page?.response?.results?.bindings;
    if (!Array.isArray(bindings)) {
      throw new Error("e-Stat catalog page has no results.bindings array.");
    }
    if (Number(page.row_count) !== bindings.length) {
      throw new Error("e-Stat catalog page row count mismatch at offset " + page.offset + ".");
    }
    const sourceSha = page?.source?.response_sha256 ?? "";
    if (!/^[a-f0-9]{64}$/.test(sourceSha)) {
      throw new Error("e-Stat catalog page has no valid SHA-256 response fingerprint.");
    }
    normalizedPageManifest.push({
      offset: Number(page.offset),
      row_count: bindings.length,
      response_sha256: sourceSha,
    });
    for (const binding of bindings) {
      const areaCode = String(bindingValueCaseInsensitive(binding, "identifier")).trim();
      const periodUri = String(bindingValueCaseInsensitive(binding, "period")).trim();
      const labelEn = String(bindingValueCaseInsensitive(binding, "labelEn")).trim();
      const labelJa = String(bindingValueCaseInsensitive(binding, "labelJa")).trim();
      if (!/^\d{5}$/.test(areaCode) || !periodUri || !labelEn) {
        throw new Error("e-Stat catalog binding lacks a five-digit code, period URI or English label.");
      }
      const records = index.get(areaCode) ?? [];
      records.push({ area_code: areaCode, period_uri: periodUri, label_en: labelEn, label_ja: labelJa });
      index.set(areaCode, records);
      totalRows += 1;
    }
  }
  if (totalRows !== expectedCatalogRows) {
    throw new Error("Expected " + expectedCatalogRows + " official e-Stat catalog rows; got " + totalRows + ".");
  }
  for (const [areaCode, records] of index.entries()) {
    records.sort((a, b) => a.period_uri.localeCompare(b.period_uri));
    const uniquePeriods = new Set(records.map((record) => record.period_uri));
    if (uniquePeriods.size !== records.length) {
      throw new Error("Duplicate area-code/period catalog record for code " + areaCode + ".");
    }
  }
  return { index, totalRows, pageManifest: normalizedPageManifest.sort((a, b) => a.offset - b.offset) };
}

export function buildSpatialTargetCodeCandidates(spatialReport, catalogIndex) {
  if (spatialReport?.selection_mode !== "ALL_126_SOURCE_VERIFIED_JAPAN_ADM4_ADMIN1_00_TARGETS; SPATIAL_FIRST_1995_ONLY") {
    throw new Error("Unexpected spatial-first report selection mode.");
  }
  if (Number(spatialReport.target_count) !== EXPECTED_TARGET_COUNT ||
      !Array.isArray(spatialReport.target_results) ||
      spatialReport.target_results.length !== EXPECTED_TARGET_COUNT) {
    throw new Error("Spatial-first report must contain all 126 source-verified Japan targets.");
  }
  if (Number(spatialReport.source_snapshot_archive_count) !== EXPECTED_SPATIAL_ARCHIVE_COUNT ||
      !Array.isArray(spatialReport.source_snapshots) ||
      spatialReport.source_snapshots.length !== EXPECTED_SPATIAL_ARCHIVE_COUNT) {
    throw new Error("Spatial-first report must include all 47 nationwide 1995 MLIT archives.");
  }
  const targetIds = new Set();
  const codeToTargets = new Map();
  const targetSummaries = [];
  for (const target of spatialReport.target_results) {
    const id = String(target.geonames_id ?? "");
    if (!/^\d+$/.test(id) || targetIds.has(id)) {
      throw new Error("Missing or duplicate GeoNames ID in spatial-first report: " + id);
    }
    targetIds.add(id);
    if (target.raw_admin1_code !== "00") {
      throw new Error("Unexpected raw admin1 value in spatial-first target: " + id);
    }
    const observations = target.observations ?? [];
    const codes = uniqueStrings(observations.map((observation) => String(observation.containing_area_code ?? "")));
    const candidateCodes = uniqueStrings(target.existing_exact_english_candidate_codes ?? []);
    const areaNames = uniqueStrings(observations.map((observation) =>
      [observation.containing_prefecture_name, observation.containing_district_name, observation.containing_municipality_name]
        .filter(Boolean).join(" ")));
    for (const code of codes) {
      if (!/^\d{5}$/.test(code)) {
        throw new Error("Invalid containing area code for GeoNames ID " + id + ": " + code);
      }
      if (!catalogIndex.has(code)) {
        throw new Error("Containing area code " + code + " for GeoNames ID " + id + " is absent from official e-Stat catalog.");
      }
      const codeObservations = observations.filter((observation) => String(observation.containing_area_code) === code);
      const prior = codeToTargets.get(code) ?? [];
      prior.push({
        geonames_id: id,
        geonames_name: target.name,
        latitude: target.latitude,
        longitude: target.longitude,
        raw_admin1_code: target.raw_admin1_code,
        raw_admin2_code: target.raw_admin2_code ?? "",
        existing_exact_english_candidate_codes: candidateCodes,
        code_matches_existing_exact_name_candidate: candidateCodes.includes(code),
        containing_area_names_1995: uniqueStrings(codeObservations.map((observation) =>
          [observation.containing_prefecture_name, observation.containing_district_name, observation.containing_municipality_name]
            .filter(Boolean).join(" "))),
        observation_count: codeObservations.length,
      });
      codeToTargets.set(code, prior);
    }
    targetSummaries.push({
      geonames_id: id,
      geonames_name: target.name,
      latitude: target.latitude,
      longitude: target.longitude,
      raw_admin1_code: target.raw_admin1_code,
      raw_admin2_code: target.raw_admin2_code ?? "",
      spatial_context_status: observations.length
        ? "CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT"
        : "NO_CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT",
      containing_area_codes_1995: codes,
      containing_area_names_1995: areaNames,
      existing_exact_english_candidate_codes: candidateCodes,
      observed_candidate_code_match: codes.some((code) => candidateCodes.includes(code)),
      operational_parent_link_created: false,
    });
  }
  if (targetIds.size !== EXPECTED_TARGET_COUNT) {
    throw new Error("Source target identity set did not reconcile to 126 rows.");
  }
  if (codeToTargets.size !== Number(spatialReport.distinct_containing_area_codes)) {
    throw new Error("Distinct containing area codes do not reconcile to the spatial-first source report.");
  }
  if (targetSummaries.filter((row) => row.spatial_context_status.startsWith("NO_")).length !==
      Number(spatialReport.target_rows_without_polygon_context)) {
    throw new Error("Unresolved target spatial-context count does not reconcile to the source report.");
  }
  return {
    targetSummaries: targetSummaries.sort((a, b) => Number(a.geonames_id) - Number(b.geonames_id)),
    codeToTargets,
  };
}

function strictSingleValue(values, field, periodUri) {
  const distinct = uniqueStrings(values);
  if (distinct.length > 1) {
    throw new Error("Conflicting " + field + " values for e-Stat period " + periodUri + ": " + distinct.join("; "));
  }
  return distinct[0] ?? "";
}

export function mergeCatalogAndDetailRows(catalogRecords, detailRows) {
  const detailByUri = new Map();
  for (const row of detailRows) {
    if (!row.period_uri) throw new Error("e-Stat detail row omitted the bound period URI.");
    const records = detailByUri.get(row.period_uri) ?? [];
    records.push(row);
    detailByUri.set(row.period_uri, records);
  }
  const catalogByUri = new Map();
  for (const record of catalogRecords) {
    const records = catalogByUri.get(record.period_uri) ?? [];
    records.push(record);
    catalogByUri.set(record.period_uri, records);
  }
  const merged = [];
  for (const [periodUri, catalogRows] of catalogByUri.entries()) {
    const detailed = detailByUri.get(periodUri) ?? [];
    if (detailed.length === 0) {
      throw new Error("Missing official e-Stat detail response for catalog period " + periodUri + ".");
    }
    const areaCodes = uniqueStrings(catalogRows.map((row) => row.area_code));
    if (areaCodes.length !== 1) {
      throw new Error("Conflicting area codes in catalog for period " + periodUri + ".");
    }
    const labelsEn = uniqueStrings(catalogRows.map((row) => row.label_en));
    const labelsJaCatalog = uniqueStrings(catalogRows.map((row) => row.label_ja));
    const labelsJaDetail = uniqueStrings(detailed.map((row) => row.label_ja));
    const effectiveFrom = strictSingleValue(detailed.map((row) => row.effective_from), "issued/effective-from", periodUri);
    const effectiveUntil = strictSingleValue(detailed.map((row) => row.effective_until), "valid/effective-until", periodUri);
    const parentMap = new Map();
    for (const row of detailed) {
      if (!(row.parent_uri || row.parent_area_code || row.parent_label_en || row.parent_label_ja)) continue;
      const parent = {
        area_code: String(row.parent_area_code ?? "").trim(),
        uri: String(row.parent_uri ?? "").trim(),
        label_en: String(row.parent_label_en ?? "").trim(),
        label_ja: String(row.parent_label_ja ?? "").trim(),
      };
      const signature = canonicalJson(parent);
      parentMap.set(signature, parent);
    }
    const previous = uniqueStrings(detailed.map((row) => row.previous_period_uri));
    const succeeding = uniqueStrings(detailed.map((row) => row.succeeding_period_uri));
    const classes = uniqueStrings(detailed.map((row) => row.administrative_class_uri));
    merged.push({
      period_uri: periodUri,
      area_code: areaCodes[0],
      label_en: labelsEn[0] ?? "",
      label_en_history_values: labelsEn,
      label_ja: labelsJaDetail[0] ?? labelsJaCatalog[0] ?? "",
      label_ja_history_values: uniqueStrings([...labelsJaDetail, ...labelsJaCatalog]),
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
      parent_references: [...parentMap.values()].sort((a, b) =>
        a.area_code.localeCompare(b.area_code) || a.uri.localeCompare(b.uri)),
      previous_period_uris: previous,
      succeeding_period_uris: succeeding,
      administrative_class_uris: classes,
      detail_record_count: detailed.length,
    });
  }
  const catalogUris = new Set(catalogByUri.keys());
  const missingDetailUris = [...catalogUris].filter((uri) => !detailByUri.has(uri)).sort();
  if (missingDetailUris.length) {
    throw new Error("e-Stat detail query omitted " + missingDetailUris.length + " requested period URIs.");
  }
  return merged.sort((a, b) =>
    a.area_code.localeCompare(b.area_code) ||
    a.effective_from.localeCompare(b.effective_from) ||
    a.period_uri.localeCompare(b.period_uri));
}

export function periodIncludesDate(period, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return false;
  const start = String(period.effective_from ?? "");
  const end = String(period.effective_until ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  return start <= date && (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end >= date);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function renderCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

export async function runSpatialFirstDetailAudit({
  spatialReportPath,
  estatResponsePath,
  estatAuditPath,
  outputPrefix,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const spatialBytes = await readFile(spatialReportPath);
  const spatialReport = JSON.parse(spatialBytes.toString("utf8"));
  const estatResponseBytes = await readFile(estatResponsePath);
  const estatSourceResponse = JSON.parse(estatResponseBytes.toString("utf8"));
  const estatAuditBytes = await readFile(estatAuditPath);
  const estatAudit = JSON.parse(estatAuditBytes.toString("utf8"));
  const catalog = buildCatalogCodeIndex(estatSourceResponse);
  const auditedCatalog = estatAudit?.source?.eStat;
  if (!auditedCatalog || Number(auditedCatalog.catalog_result_row_count) !== catalog.totalRows) {
    throw new Error("e-Stat audit summary and saved raw catalog response do not agree on catalog row count.");
  }
  if (Number(auditedCatalog.source_snapshot_sha256?.length ?? 0) !== 64) {
    throw new Error("e-Stat audit summary has no source snapshot SHA-256.");
  }
  const pageSourceChecks = catalog.pageManifest.map((page) => {
    const auditPage = (auditedCatalog.catalog_pages ?? []).find((item) => Number(item.offset) === page.offset);
    if (!auditPage || auditPage.response_sha256 !== page.response_sha256 || Number(auditPage.row_count) !== page.row_count) {
      throw new Error("Saved e-Stat catalog page fingerprint does not match the main audit report at offset " + page.offset + ".");
    }
    return page;
  });
  const { targetSummaries, codeToTargets } = buildSpatialTargetCodeCandidates(spatialReport, catalog.index);
  const codes = [...codeToTargets.keys()].sort();
  const catalogRecordsForCodes = [];
  for (const code of codes) {
    const records = catalog.index.get(code);
    if (!records?.length) throw new Error("Spatial containing-area code missing from catalog index: " + code);
    catalogRecordsForCodes.push(...records);
  }
  const catalogRecordsByUri = new Map();
  for (const row of catalogRecordsForCodes) {
    const prior = catalogRecordsByUri.get(row.period_uri) ?? [];
    prior.push(row);
    catalogRecordsByUri.set(row.period_uri, prior);
  }
  const requestedUris = [...catalogRecordsByUri.keys()].sort();
  if (new Set(requestedUris).size !== requestedUris.length || requestedUris.length === 0) {
    throw new Error("Spatially observed catalog period URI set is empty or duplicated.");
  }

  const detailBatches = [];
  const detailRows = [];
  for (let offset = 0; offset < requestedUris.length; offset += DETAIL_QUERY_BATCH_SIZE) {
    const uris = requestedUris.slice(offset, offset + DETAIL_QUERY_BATCH_SIZE);
    const query = buildDetailsQuery(uris);
    const result = await requestEstatQuery(query, fetchImpl, now);
    const rows = parseEstatBindings(result.bindings);
    if (rows.some((row) => !row.period_uri)) {
      throw new Error("e-Stat detail batch at offset " + offset + " contains an unbound period URI.");
    }
    const requestedSet = new Set(uris);
    const unexpectedUris = uniqueStrings(rows.map((row) => row.period_uri).filter((uri) => !requestedSet.has(uri)));
    if (unexpectedUris.length) {
      throw new Error("e-Stat detail response returned unrequested period URI(s): " + unexpectedUris.join("; "));
    }
    detailBatches.push({
      target_offset: offset,
      requested_period_count: uris.length,
      requested_period_uris: uris,
      query,
      source: result.manifest,
      response: result.parsed,
      response_text_sha256: sha256(result.text),
      result_row_count: rows.length,
    });
    detailRows.push(...rows);
  }
  const mergedPeriods = mergeCatalogAndDetailRows(catalogRecordsForCodes, detailRows);
  const periodsByCode = new Map();
  for (const period of mergedPeriods) {
    const entries = periodsByCode.get(period.area_code) ?? [];
    entries.push(period);
    periodsByCode.set(period.area_code, entries);
  }

  const codeResults = [];
  for (const code of codes) {
    const codePeriods = periodsByCode.get(code) ?? [];
    const at1995 = codePeriods.filter((period) => periodIncludesDate(period, SPATIAL_SNAPSHOT_DATE));
    const targets = codeToTargets.get(code);
    codeResults.push({
      area_code: code,
      target_count: new Set(targets.map((target) => target.geonames_id)).size,
      geonames_ids: uniqueStrings(targets.map((target) => target.geonames_id)),
      geonames_names: uniqueStrings(targets.map((target) => target.geonames_name)),
      containing_area_names_1995: uniqueStrings(targets.flatMap((target) => target.containing_area_names_1995)),
      exact_english_name_candidate_codes_for_associated_targets: uniqueStrings(
        targets.flatMap((target) => target.existing_exact_english_candidate_codes),
      ),
      associated_targets_whose_code_matches_exact_name_candidate: uniqueStrings(
        targets.filter((target) => target.code_matches_existing_exact_name_candidate).map((target) => target.geonames_id),
      ),
      catalog_period_count: codePeriods.length,
      catalog_labels_en: uniqueStrings(codePeriods.flatMap((period) => period.label_en_history_values)),
      catalog_labels_ja: uniqueStrings(codePeriods.flatMap((period) => period.label_ja_history_values)),
      periods_covering_1995_snapshot: at1995.map((period) => period.period_uri),
      periods_covering_1995_count: at1995.length,
      parent_area_codes_across_history: uniqueStrings(codePeriods.flatMap((period) =>
        period.parent_references.map((parent) => parent.area_code))),
      parent_labels_en_across_history: uniqueStrings(codePeriods.flatMap((period) =>
        period.parent_references.map((parent) => parent.label_en))),
      parent_labels_ja_across_history: uniqueStrings(codePeriods.flatMap((period) =>
        period.parent_references.map((parent) => parent.label_ja))),
      parent_area_codes_at_1995: uniqueStrings(at1995.flatMap((period) =>
        period.parent_references.map((parent) => parent.area_code))),
      parent_labels_en_at_1995: uniqueStrings(at1995.flatMap((period) =>
        period.parent_references.map((parent) => parent.label_en))),
      parent_labels_ja_at_1995: uniqueStrings(at1995.flatMap((period) =>
        period.parent_references.map((parent) => parent.label_ja))),
      administrative_class_uris_at_1995: uniqueStrings(at1995.flatMap((period) => period.administrative_class_uris)),
      review_status: at1995.length
        ? "SPATIAL_AREA_CODE_HISTORY_AND_1995_PARENT_REFERENCE_RETRIEVED_CANDIDATE_ONLY"
        : "SPATIAL_AREA_CODE_FOUND_BUT_NO_RECORDED_ESTAT_PERIOD_COVERS_1995_DATE",
      operational_parent_link_created: false,
    });
  }

  const targetCodeResults = [];
  for (const [code, targets] of codeToTargets.entries()) {
    const periods = periodsByCode.get(code) ?? [];
    const at1995 = periods.filter((period) => periodIncludesDate(period, SPATIAL_SNAPSHOT_DATE));
    for (const target of targets) {
      targetCodeResults.push({
        geonames_id: target.geonames_id,
        geonames_name: target.geonames_name,
        latitude: target.latitude,
        longitude: target.longitude,
        raw_admin1_code: target.raw_admin1_code,
        raw_admin2_code: target.raw_admin2_code,
        containing_area_code_1995: code,
        containing_area_names_1995: target.containing_area_names_1995.join("; "),
        spatial_observation_count: target.observation_count,
        existing_exact_english_candidate_codes: target.existing_exact_english_candidate_codes.join(";"),
        containing_code_matches_existing_exact_name_candidate: String(target.code_matches_existing_exact_name_candidate).toLowerCase(),
        e_stat_catalog_english_labels: uniqueStrings(periods.map((period) => period.label_en)).join("; "),
        e_stat_catalog_japanese_labels: uniqueStrings(periods.map((period) => period.label_ja)).join("; "),
        e_stat_catalog_period_count: periods.length,
        e_stat_period_uris_covering_1995: at1995.map((period) => period.period_uri).join(";"),
        e_stat_parent_codes_at_1995: uniqueStrings(at1995.flatMap((period) => period.parent_references.map((parent) => parent.area_code))).join(";"),
        e_stat_parent_labels_en_at_1995: uniqueStrings(at1995.flatMap((period) => period.parent_references.map((parent) => parent.label_en))).join(";"),
        e_stat_parent_labels_ja_at_1995: uniqueStrings(at1995.flatMap((period) => period.parent_references.map((parent) => parent.label_ja))).join(";"),
        e_stat_admin_class_uris_at_1995: uniqueStrings(at1995.flatMap((period) => period.administrative_class_uris)).join(";"),
        parent_identity_crosswalk_status: "NOT_VERIFIED_TO_GEONAMES_ID",
        operational_parent_link_created: "false",
      });
    }
  }
  targetCodeResults.sort((a, b) =>
    Number(a.geonames_id) - Number(b.geonames_id) ||
    a.containing_area_code_1995.localeCompare(b.containing_area_code_1995));

  const targetSummary = targetSummaries.map((target) => {
    const relevant = targetCodeResults.filter((row) => row.geonames_id === target.geonames_id);
    return {
      geonames_id: target.geonames_id,
      geonames_name: target.geonames_name,
      latitude: target.latitude,
      longitude: target.longitude,
      raw_admin1_code: target.raw_admin1_code,
      raw_admin2_code: target.raw_admin2_code,
      spatial_context_status: target.spatial_context_status,
      containing_area_codes_1995: target.containing_area_codes_1995.join(";"),
      containing_area_names_1995: target.containing_area_names_1995.join("; "),
      candidate_code_count: relevant.length,
      e_stat_periods_covering_1995_count: relevant.reduce((sum, row) =>
        sum + (row.e_stat_period_uris_covering_1995 ? row.e_stat_period_uris_covering_1995.split(";").filter(Boolean).length : 0), 0),
      e_stat_parent_codes_at_1995: uniqueStrings(relevant.flatMap((row) =>
        String(row.e_stat_parent_codes_at_1995).split(";").filter(Boolean))).join(";"),
      existing_exact_english_candidate_codes: target.existing_exact_english_candidate_codes.join(";"),
      containing_code_matches_existing_exact_name_candidate: String(target.observed_candidate_code_match).toLowerCase(),
      parent_identity_crosswalk_status: "NOT_VERIFIED_TO_GEONAMES_ID",
      operational_parent_link_created: "false",
    };
  });

  const historyCsvRows = [];
  for (const period of mergedPeriods) {
    historyCsvRows.push({
      area_code: period.area_code,
      period_uri: period.period_uri,
      label_en: period.label_en,
      label_ja: period.label_ja,
      effective_from: period.effective_from,
      effective_until: period.effective_until,
      includes_1995_snapshot_by_published_issued_valid: String(periodIncludesDate(period, SPATIAL_SNAPSHOT_DATE)).toLowerCase(),
      parent_references: period.parent_references.map((parent) =>
        [parent.area_code, parent.label_en, parent.label_ja, parent.uri].join(" | ")).join(" ; "),
      parent_area_codes: uniqueStrings(period.parent_references.map((parent) => parent.area_code)).join(";"),
      previous_period_uris: period.previous_period_uris.join(";"),
      succeeding_period_uris: period.succeeding_period_uris.join(";"),
      administrative_class_uris: period.administrative_class_uris.join(";"),
      detail_record_count: period.detail_record_count,
      operational_parent_link_created: "false",
    });
  }

  const outputPrefix = resolve(outputPrefixPath(outputPrefix));
  await mkdir(dirname(outputPrefix), { recursive: true });
  const pageManifest = catalog.pageManifest;
  const detailBatchManifest = detailBatches.map((batch) => ({
    target_offset: batch.target_offset,
    requested_period_count: batch.requested_period_count,
    result_row_count: batch.result_row_count,
    query_sha256: batch.source.query_sha256,
    response_sha256: batch.source.response_sha256,
    response_bytes: batch.source.response_bytes,
  }));
  const detailFingerprint = sha256(detailBatchManifest
    .map((batch) => String(batch.target_offset) + ":" + batch.response_sha256)
    .join("\n"));
  const detailSourceResponse = {
    source_name: "Japan Statistical LOD — spatial-first area-code period detail query",
    endpoint_url: auditedCatalog.endpoint_url,
    generated_at_utc: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
    input_source_snapshot_sha256: auditedCatalog.source_snapshot_sha256,
    spatial_first_report_sha256: sha256(spatialBytes),
    spatial_manifest_archive_fingerprint: spatialReport.source_catalog?.archive_manifest_fingerprint ?? "",
    requested_area_code_count: codes.length,
    requested_catalog_period_count: requestedUris.length,
    requested_period_uris_sha256: sha256(requestedUris.join("\n")),
    detail_batch_count: detailBatches.length,
    detail_response_fingerprint: detailFingerprint,
    detail_batches: detailBatches.map((batch) => ({
      target_offset: batch.target_offset,
      requested_period_count: batch.requested_period_count,
      requested_period_uris: batch.requested_period_uris,
      query: batch.query,
      source: batch.source,
      response: batch.response,
    })),
  };
  const result = {
    report_version: 1,
    status: "PASS_SPATIAL_FIRST_ESTAT_PERIOD_HISTORY_RETRIEVED; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
    generated_at_utc: detailSourceResponse.generated_at_utc,
    spatial_snapshot_date: SPATIAL_SNAPSHOT_DATE,
    target_count: targetSummaries.length,
    targets_with_spatial_context: targetSummaries.filter((target) =>
      target.spatial_context_status === "CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT").length,
    targets_without_spatial_context: targetSummaries.filter((target) =>
      target.spatial_context_status !== "CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT").length,
    target_ids_without_spatial_context: targetSummaries.filter((target) =>
      target.spatial_context_status !== "CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT")
      .map((target) => target.geonames_id),
    distinct_spatial_area_codes: codes.length,
    target_to_spatial_area_code_associations: targetCodeResults.length,
    catalog_period_uris_requested: requestedUris.length,
    detail_periods_reconciled: mergedPeriods.length,
    detail_rows_received: detailRows.length,
    detail_batches: detailBatches.length,
    detail_source_fingerprint: detailFingerprint,
    e_stat_catalog_row_count: catalog.totalRows,
    e_stat_catalog_source_snapshot_sha256: auditedCatalog.source_snapshot_sha256,
    source_catalog_page_response_fingerprints: pageManifest,
    spatial_targets_with_at_least_one_spatial_code_matching_prior_exact_name_candidate: targetSummaries.filter((target) => target.observed_candidate_code_match).length,
    spatial_area_codes_with_period_covering_1995: codeResults.filter((row) => row.periods_covering_1995_count > 0).length,
    spatial_area_codes_without_period_covering_1995: codeResults.filter((row) => row.periods_covering_1995_count === 0).length,
    parent_references_at_1995_with_area_code: codeResults.filter((row) =>
      row.periods_covering_1995_count > 0 &&
      row.parent_area_codes_at_1995.length > 0).length,
    code_results: codeResults,
    target_code_results: targetCodeResults,
    target_summary: targetSummary,
    area_code_period_history: mergedPeriods,
    operational_parent_links_created: 0,
    limitations: [
      "A point inside a 1995 administrative polygon is a location-derived candidate only; it does not prove that the GeoNames feature is that administrative entity.",
      "An e-Stat parent reference is official hierarchy evidence for the stated period, but is not yet crosswalked to a GeoNames parent ID.",
      "The published issued/valid dates are reported as a period signal. A code period covering 1995 does not itself establish GeoNames entity identity or the correct immediate parent.",
      "A GeoNames reference point may be historically located or reflect a feature type different from the containing polygon's administrative level; no context is not proof of invalidity.",
      "The 1995 selected snapshot does not resolve records whose correct location or entity period lies before or after the snapshot.",
      "All raw admin1=00 values are preserved and no operational parent link is created.",
    ],
  };

  const jsonPath = outputPrefix + ".json";
  const codePath = outputPrefix + ".area-code-candidates.csv";
  const targetCodePath = outputPrefix + ".target-code-details.csv";
  const targetSummaryPath = outputPrefix + ".target-summary.csv";
  const historyPath = outputPrefix + ".area-code-period-history.csv";
  const responsePath = outputPrefix + ".source-response.json";
  const manifestPath = outputPrefix + ".manifest.json";

  const codeFields = [
    "area_code", "target_count", "geonames_ids", "geonames_names", "containing_area_names_1995",
    "exact_english_name_candidate_codes_for_associated_targets", "associated_targets_whose_code_matches_exact_name_candidate",
    "catalog_period_count", "catalog_labels_en", "catalog_labels_ja", "periods_covering_1995_count",
    "periods_covering_1995_snapshot", "parent_area_codes_across_history", "parent_labels_en_across_history",
    "parent_labels_ja_across_history", "parent_area_codes_at_1995", "parent_labels_en_at_1995",
    "parent_labels_ja_at_1995", "administrative_class_uris_at_1995", "review_status",
    "operational_parent_link_created",
  ];
  const targetCodeFields = [
    "geonames_id", "geonames_name", "latitude", "longitude", "raw_admin1_code", "raw_admin2_code",
    "containing_area_code_1995", "containing_area_names_1995", "spatial_observation_count",
    "existing_exact_english_candidate_codes", "containing_code_matches_existing_exact_name_candidate",
    "e_stat_catalog_english_labels", "e_stat_catalog_japanese_labels", "e_stat_catalog_period_count",
    "e_stat_period_uris_covering_1995", "e_stat_parent_codes_at_1995", "e_stat_parent_labels_en_at_1995",
    "e_stat_parent_labels_ja_at_1995", "e_stat_admin_class_uris_at_1995", "parent_identity_crosswalk_status",
    "operational_parent_link_created",
  ];
  const targetSummaryFields = [
    "geonames_id", "geonames_name", "latitude", "longitude", "raw_admin1_code", "raw_admin2_code",
    "spatial_context_status", "containing_area_codes_1995", "containing_area_names_1995",
    "candidate_code_count", "e_stat_periods_covering_1995_count", "e_stat_parent_codes_at_1995",
    "existing_exact_english_candidate_codes", "containing_code_matches_existing_exact_name_candidate",
    "parent_identity_crosswalk_status", "operational_parent_link_created",
  ];
  const historyFields = [
    "area_code", "period_uri", "label_en", "label_ja", "effective_from", "effective_until",
    "includes_1995_snapshot_by_published_issued_valid", "parent_references", "parent_area_codes",
    "previous_period_uris", "succeeding_period_uris", "administrative_class_uris", "detail_record_count",
    "operational_parent_link_created",
  ];
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(result, null, 2) + "\n", "utf8"),
    writeFile(codePath, renderCsv(codeFields, codeResults.map((row) => ({
      ...row,
      geonames_ids: row.geonames_ids.join(";"),
      geonames_names: row.geonames_names.join(";"),
      containing_area_names_1995: row.containing_area_names_1995.join("; "),
      exact_english_name_candidate_codes_for_associated_targets: row.exact_english_name_candidate_codes_for_associated_targets.join(";"),
      associated_targets_whose_code_matches_exact_name_candidate: row.associated_targets_whose_code_matches_exact_name_candidate.join(";"),
      catalog_labels_en: row.catalog_labels_en.join(";"),
      catalog_labels_ja: row.catalog_labels_ja.join(";"),
      periods_covering_1995_snapshot: row.periods_covering_1995.join(";"),
      parent_area_codes_across_history: row.parent_area_codes_across_history.join(";"),
      parent_labels_en_across_history: row.parent_labels_en_across_history.join(";"),
      parent_labels_ja_across_history: row.parent_labels_ja_across_history.join(";"),
      parent_area_codes_at_1995: row.parent_area_codes_at_1995.join(";"),
      parent_labels_en_at_1995: row.parent_labels_en_at_1995.join(";"),
      parent_labels_ja_at_1995: row.parent_labels_ja_at_1995.join(";"),
      administrative_class_uris_at_1995: row.administrative_class_uris_at_1995.join(";"),
      review_status: row.review_status,
      operational_parent_link_created: "false",
    }))), "utf8"),
    writeFile(targetCodePath, renderCsv(targetCodeFields, targetCodeResults), "utf8"),
    writeFile(targetSummaryPath, renderCsv(targetSummaryFields, targetSummary), "utf8"),
    writeFile(historyPath, renderCsv(historyFields, historyCsvRows), "utf8"),
    writeFile(responsePath, JSON.stringify(detailSourceResponse, null, 2) + "\n", "utf8"),
    writeFile(manifestPath, JSON.stringify({
      status: result.status,
      generated_at_utc: result.generated_at_utc,
      input_spatial_first_report_sha256: sha256(spatialBytes),
      input_e_stat_audit_report_sha256: sha256(estatAuditBytes),
      input_e_stat_raw_source_response_sha256: sha256(estatResponseBytes),
      e_stat_catalog_source_snapshot_sha256: auditedCatalog.source_snapshot_sha256,
      e_stat_catalog_result_row_count: catalog.totalRows,
      source_catalog_page_response_fingerprints: pageManifest,
      requested_area_code_count: codes.length,
      requested_catalog_period_count: requestedUris.length,
      detail_rows_received: detailRows.length,
      detail_periods_reconciled: mergedPeriods.length,
      detail_batches: detailBatchManifest,
      detail_response_fingerprint: detailFingerprint,
      operational_parent_links_created: 0,
    }, null, 2) + "\n", "utf8"),
  ]);
  return result;
}

function outputPrefixPath(value) {
  if (!value) throw new Error("Output prefix is required.");
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [spatialReportPath, estatResponsePath, estatAuditPath, outputPrefix] = process.argv.slice(2);
  if (!spatialReportPath || !estatResponsePath || !estatAuditPath || !outputPrefix) {
    process.stderr.write(
      "Usage: geonames-japan-spatial-first-estat-detail-audit.mjs " +
      "<spatial-first-report.json> <estat-source-response.json> <estat-audit-report.json> <output-prefix>\n",
    );
    process.exitCode = 2;
  } else {
    runSpatialFirstDetailAudit({ spatialReportPath, estatResponsePath, estatAuditPath, outputPrefix })
      .then((report) => {
        process.stdout.write(JSON.stringify({
          status: report.status,
          target_count: report.target_count,
          targets_with_spatial_context: report.targets_with_spatial_context,
          targets_without_spatial_context: report.targets_without_spatial_context,
          distinct_spatial_area_codes: report.distinct_spatial_area_codes,
          target_to_spatial_area_code_associations: report.target_to_spatial_area_code_associations,
          catalog_period_uris_requested: report.catalog_period_uris_requested,
          detail_periods_reconciled: report.detail_periods_reconciled,
          detail_rows_received: report.detail_rows_received,
          detail_batches: report.detail_batches,
          spatial_area_codes_with_period_covering_1995: report.spatial_area_codes_with_period_covering_1995,
          spatial_area_codes_without_period_covering_1995: report.spatial_area_codes_without_period_covering_1995,
          parent_references_at_1995_with_area_code: report.parent_references_at_1995_with_area_code,
          spatial_targets_with_at_least_one_spatial_code_matching_prior_exact_name_candidate:
            report.spatial_targets_with_at_least_one_spatial_code_matching_prior_exact_name_candidate,
          operational_parent_links_created: 0,
        }, null, 2) + "\n");
      })
      .catch((error) => {
        process.stderr.write("Spatial-first e-Stat detail audit failed closed: " + (error.stack ?? error) + "\n");
        process.exitCode = 1;
      });
  }
}
