#!/usr/bin/env node
/**
 * Read-only identity-candidate audit between official e-Stat Japanese parent
 * labels and GeoNames Japan administrative features. Exact matching only.
 * This script never approves or writes GeoNames parent relationships.
 *
 * Usage:
 *   node scripts/geonames-japan-estat-parent-geonames-candidate-audit.mjs
 *     <JP.txt> <spatial-first-estat-details.json> <geonames-source-manifest.json> <output-prefix>
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const EXPECTED_TARGET_COUNT = 126;
const EXPECTED_SPATIAL_AREA_CODE_COUNT = 105;
const EXPECTED_COUNTRY_CODE = "JP";
const PARENT_FEATURE_CODE = /^ADM[1-3]$/;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function normalizeExactJapaneseLabel(value) {
  return String(value ?? "").normalize("NFC").trim();
}

export function parseGeoNamesJapanAdminLine(line) {
  const fields = line.split("\t");
  if (fields.length !== 19 || !fields[0] || !/^\d+$/.test(fields[0])) {
    throw new Error("Expected an exact 19-field GeoNames row with a numeric geonameid.");
  }
  return {
    geonames_id: fields[0],
    name: fields[1],
    ascii_name: fields[2],
    alternate_names: fields[3] ? fields[3].split(",").filter((value) => value.length > 0) : [],
    latitude: fields[4],
    longitude: fields[5],
    feature_class: fields[6],
    feature_code: fields[7],
    country_code: fields[8],
    admin1_code: fields[10],
    admin2_code: fields[11],
    admin3_code: fields[12],
    admin4_code: fields[13],
    modification_date: fields[18],
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

function addUnique(map, key, value) {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

export function buildOfficialParentReferenceIndex(detailReport) {
  if (!detailReport || Number(detailReport.target_count) !== EXPECTED_TARGET_COUNT) {
    throw new Error("Expected the complete spatial-first report for all 126 Japan targets.");
  }
  if (Number(detailReport.distinct_spatial_area_codes) !== EXPECTED_SPATIAL_AREA_CODE_COUNT) {
    throw new Error("Expected the 105-code spatial-first e-Stat history report.");
  }
  if (!Array.isArray(detailReport.area_code_period_history) ||
      detailReport.area_code_period_history.length !== Number(detailReport.detail_periods_reconciled)) {
    throw new Error("e-Stat area-code period history rows do not reconcile to the detail audit report.");
  }

  const references = new Map();
  for (const period of detailReport.area_code_period_history) {
    const childAreaCode = String(period.area_code ?? "").trim();
    const childPeriodUri = String(period.period_uri ?? "").trim();
    if (!/^\d{5}$/.test(childAreaCode) || !childPeriodUri) {
      throw new Error("An e-Stat history row lacks a five-digit child code or exact period URI.");
    }
    if (!Array.isArray(period.parent_references)) {
      throw new Error("An e-Stat period lacks its parent_references array.");
    }
    for (const parent of period.parent_references) {
      const parentAreaCode = String(parent.area_code ?? "").trim();
      const parentUri = String(parent.uri ?? "").trim();
      const labelEn = String(parent.label_en ?? "").trim();
      const labelJa = String(parent.label_ja ?? "").trim();
      if (!parentAreaCode && !parentUri && !labelEn && !labelJa) continue;
      const key = [parentAreaCode, parentUri].join("\u0000");
      const existing = references.get(key) ?? {
        parent_area_code: parentAreaCode,
        parent_uri: parentUri,
        parent_label_en_values: [],
        parent_label_ja_values: [],
        child_area_codes: [],
        child_period_uris: [],
        reference_source_kinds: ["SPATIAL_FIRST_1995_HISTORY"],
        published_parent_reference_rows: 0,
      };
      if (labelEn && !existing.parent_label_en_values.includes(labelEn)) existing.parent_label_en_values.push(labelEn);
      if (labelJa && !existing.parent_label_ja_values.includes(labelJa)) existing.parent_label_ja_values.push(labelJa);
      if (!existing.child_area_codes.includes(childAreaCode)) existing.child_area_codes.push(childAreaCode);
      if (!existing.child_period_uris.includes(childPeriodUri)) existing.child_period_uris.push(childPeriodUri);
      existing.published_parent_reference_rows += 1;
      references.set(key, existing);
    }
  }

  return [...references.values()].map((item) => {
    const parentLabelJaConflict = item.parent_label_ja_values.length > 1;
    const parentLabelEnConflict = item.parent_label_en_values.length > 1;
    return {
      ...item,
      parent_label_en_values: item.parent_label_en_values.sort(),
      parent_label_ja_values: item.parent_label_ja_values.sort(),
      child_area_codes: item.child_area_codes.sort(),
      child_period_uris: item.child_period_uris.sort(),
      parent_label_ja: item.parent_label_ja_values.length === 1 ? item.parent_label_ja_values[0] : "",
      parent_label_en: item.parent_label_en_values.length === 1 ? item.parent_label_en_values[0] : "",
      conflicting_parent_label_values: parentLabelJaConflict || parentLabelEnConflict,
      candidate_matches: [],
      candidate_geonames_ids: [],
      candidate_count: 0,
      candidate_status: parentLabelJaConflict
        ? "BLOCKED_CONFLICTING_OFFICIAL_JAPANESE_PARENT_LABELS"
        : item.parent_label_ja_values.length === 0
          ? "NO_OFFICIAL_JAPANESE_PARENT_LABEL"
          : "PENDING_EXACT_GEONAMES_JAPANESE_LABEL_MATCH",
      operational_parent_link_created: false,
    };
  }).sort((a, b) =>
    a.parent_area_code.localeCompare(b.parent_area_code) ||
    a.parent_uri.localeCompare(b.parent_uri));
}

function parentReferenceKey(areaCode, uri) {
  return [String(areaCode ?? "").trim(), String(uri ?? "").trim()].join("\u0000");
}

function addParentReferenceValues(reference, parent, childAreaCode, childPeriodUri, sourceKind) {
  const areaCode = String(parent.area_code ?? "").trim();
  const uri = String(parent.uri ?? "").trim();
  const labelEn = String(parent.label_en ?? "").trim();
  const labelJa = String(parent.label_ja ?? "").trim();
  if (!/^\d{5}$/.test(areaCode) || !uri) {
    throw new Error("An added e-Stat parent reference lacks a five-digit area code or exact period URI.");
  }
  if (labelEn && !reference.parent_label_en_values.includes(labelEn)) reference.parent_label_en_values.push(labelEn);
  if (labelJa && !reference.parent_label_ja_values.includes(labelJa)) reference.parent_label_ja_values.push(labelJa);
  if (!reference.child_area_codes.includes(childAreaCode)) reference.child_area_codes.push(childAreaCode);
  if (!reference.child_period_uris.includes(childPeriodUri)) reference.child_period_uris.push(childPeriodUri);
  if (!reference.reference_source_kinds.includes(sourceKind)) reference.reference_source_kinds.push(sourceKind);
  reference.published_parent_reference_rows += 1;
  reference.conflicting_parent_label_values =
    reference.parent_label_en_values.length > 1 || reference.parent_label_ja_values.length > 1;
  reference.parent_label_en = reference.parent_label_en_values.length === 1 ? reference.parent_label_en_values[0] : "";
  reference.parent_label_ja = reference.parent_label_ja_values.length === 1 ? reference.parent_label_ja_values[0] : "";
  if (reference.conflicting_parent_label_values) {
    reference.candidate_status = "BLOCKED_CONFLICTING_OFFICIAL_JAPANESE_PARENT_LABELS";
  }
}

export function validateExactLabelTargetCandidateReport(report) {
  if (!report || Number(report.target_count) !== EXPECTED_TARGET_COUNT ||
      Number(report.target_source_identity_and_raw_code_matches) !== EXPECTED_TARGET_COUNT ||
      Number(report.operational_parent_links_created) !== 0 ||
      !Array.isArray(report.target_results) || report.target_results.length !== EXPECTED_TARGET_COUNT ||
      !/^[a-f0-9]{64}$/i.test(String(report.source_snapshot_sha256 ?? ""))) {
    throw new Error("Exact-label target report lacks all 126 source-verified Japan target rows or a SHA-256 source fingerprint.");
  }
  const positiveTargets = report.target_results.filter((target) =>
    Array.isArray(target.candidates) && target.candidates.length > 0);
  const associations = positiveTargets.reduce((sum, target) => sum + target.candidates.length, 0);
  const distinctCodes = new Set(positiveTargets.flatMap((target) => target.candidates.map((candidate) =>
    String(candidate.area_code ?? "").trim())));
  if (positiveTargets.length !== 33 || associations !== 46 || distinctCodes.size !== 35) {
    throw new Error(
      `Unexpected source-derived exact-label candidate coverage: ${positiveTargets.length} targets, ${associations} associations, ${distinctCodes.size} codes.`
    );
  }
  for (const target of positiveTargets) {
    if (target.country_code !== "JP" || target.feature_code !== "ADM4" ||
        target.raw_admin1_code !== "00" || target.source_identity_and_raw_codes_verified !== true) {
      throw new Error(`Target ${target.geonames_id} failed the exact Japan ADM4/raw-admin1-00 source guard.`);
    }
    for (const candidate of target.candidates) {
      if (!/^\d{5}$/.test(String(candidate.area_code ?? "")) || !Array.isArray(candidate.periods)) {
        throw new Error(`Target ${target.geonames_id} has malformed e-Stat candidate code/history.`);
      }
      for (const period of candidate.periods) {
        if (String(period.area_code ?? "") !== String(candidate.area_code) ||
            !String(period.period_uri ?? "").trim() || !Array.isArray(period.parent_references)) {
          throw new Error(`Target ${target.geonames_id} has an unreconciled exact-label period row.`);
        }
      }
    }
  }
  return {
    target_count: report.target_count,
    target_source_identity_and_raw_code_matches: report.target_source_identity_and_raw_code_matches,
    positive_candidate_target_count: positiveTargets.length,
    target_to_candidate_code_associations: associations,
    distinct_candidate_area_code_count: distinctCodes.size,
    exact_name_matched_period_rows: Number(report.total_exact_name_matched_period_rows),
    source_snapshot_sha256: report.source_snapshot_sha256,
    geonames_archive_sha256: report.source?.geoNames?.archive_sha256 ?? "",
    operational_parent_links_created: 0,
  };
}

export function mergeExactLabelTargetCandidateParentReferences(parentReferences, targetCandidateReport) {
  const inputSummary = validateExactLabelTargetCandidateReport(targetCandidateReport);
  const byKey = new Map(parentReferences.map((reference) => [
    parentReferenceKey(reference.parent_area_code, reference.parent_uri),
    reference,
  ]));
  const references = parentReferences;
  const sourceKind = "EXACT_ENGLISH_LABEL_TARGET_CANDIDATE_HISTORY";
  let candidatePeriodCount = 0;
  let parentReferenceOccurrenceCount = 0;

  for (const target of targetCandidateReport.target_results.filter((row) => row.candidates?.length)) {
    for (const candidate of target.candidates) {
      for (const period of candidate.periods.filter((row) => row.matches_target_name === true)) {
        candidatePeriodCount += 1;
        const childAreaCode = String(candidate.area_code);
        const childPeriodUri = String(period.period_uri);
        for (const parent of period.parent_references) {
          const key = parentReferenceKey(parent.area_code, parent.uri);
          let reference = byKey.get(key);
          if (!reference) {
            reference = {
              parent_area_code: String(parent.area_code ?? "").trim(),
              parent_uri: String(parent.uri ?? "").trim(),
              parent_label_en_values: [],
              parent_label_ja_values: [],
              child_area_codes: [],
              child_period_uris: [],
              reference_source_kinds: [],
              published_parent_reference_rows: 0,
              parent_label_en: "",
              parent_label_ja: "",
              conflicting_parent_label_values: false,
              candidate_matches: [],
              candidate_geonames_ids: [],
              candidate_count: 0,
              candidate_status: "PENDING_EXACT_GEONAMES_JAPANESE_LABEL_MATCH",
              operational_parent_link_created: false,
            };
            byKey.set(key, reference);
            references.push(reference);
          }
          addParentReferenceValues(reference, parent, childAreaCode, childPeriodUri, sourceKind);
          parentReferenceOccurrenceCount += 1;
        }
      }
    }
  }
  references.sort((a, b) =>
    a.parent_area_code.localeCompare(b.parent_area_code) || a.parent_uri.localeCompare(b.parent_uri));
  return {
    parentReferences: references,
    inputSummary,
    candidatePeriodCount,
    parentReferenceOccurrenceCount,
    expandedParentReferenceCount: references.length,
  };
}

function snapshotFallsWithinPeriod(snapshotDate, effectiveFrom, effectiveUntil) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom ?? ""))) return false;
  if (snapshotDate < effectiveFrom) return false;
  const until = String(effectiveUntil ?? "").trim();
  return !/^\d{4}-\d{2}-\d{2}$/.test(until) || snapshotDate <= until;
}

export function buildTargetCandidateParentQueue(targetCandidateReport, parentReferences, spatialPolygonReport) {
  const inputSummary = validateExactLabelTargetCandidateReport(targetCandidateReport);
  if (!spatialPolygonReport ||
      spatialPolygonReport.selection_mode !== "ALL_POSITIVE_ESTAT_LABEL_CANDIDATE_TARGETS" ||
      Number(spatialPolygonReport.target_count) !== inputSummary.positive_candidate_target_count ||
      Number(spatialPolygonReport.target_code_associations_tested) !== inputSummary.target_to_candidate_code_associations ||
      Number(spatialPolygonReport.candidate_codes_tested) !== inputSummary.target_to_candidate_code_associations ||
      Number(spatialPolygonReport.operational_parent_links_created) !== 0 ||
      !Array.isArray(spatialPolygonReport.candidate_results)) {
    throw new Error("The expanded spatial report failed selection mode, target/code coverage, or zero-parent-write validation.");
  }
  const parentByKey = new Map(parentReferences.map((reference) => [
    parentReferenceKey(reference.parent_area_code, reference.parent_uri),
    reference,
  ]));
  const spatialByTargetCode = new Map(spatialPolygonReport.candidate_results.map((row) => [
    [String(row.geonames_id), String(row.candidate_code)].join("\u0000"),
    row,
  ]));
  const queue = [];

  for (const target of targetCandidateReport.target_results.filter((row) => row.candidates?.length)) {
    for (const candidate of target.candidates) {
      const spatial = spatialByTargetCode.get([String(target.geonames_id), String(candidate.area_code)].join("\u0000"));
      if (!spatial) throw new Error(`Spatial report lacks target/code association ${target.geonames_id}/${candidate.area_code}.`);
      const pointHitSnapshots = String(spatial.point_inside_candidate_polygon_snapshots ?? "")
        .split(";").map((value) => value.trim()).filter(Boolean);
      const periods = candidate.periods.filter((row) => row.matches_target_name === true);
      for (const period of periods) {
        const alignedSnapshots = pointHitSnapshots.filter((snapshot) =>
          snapshotFallsWithinPeriod(snapshot, period.effective_from, period.effective_until));
        const parentRows = Array.isArray(period.parent_references) && period.parent_references.length
          ? period.parent_references
          : [null];
        for (const parent of parentRows) {
          const parentRef = parent
            ? parentByKey.get(parentReferenceKey(parent.area_code, parent.uri))
            : null;
          const candidateMatches = parentRef?.candidate_matches ?? [];
          const spatialStatus = pointHitSnapshots.length === 0
            ? "NO_POINT_INSIDE_CANDIDATE_POLYGON_IN_SELECTED_SNAPSHOTS"
            : alignedSnapshots.length > 0
              ? "SPATIAL_HIT_ALIGNS_WITH_EXACT_NAME_ESTAT_PERIOD"
              : "SPATIAL_HIT_ONLY_OUTSIDE_THIS_ESTAT_PERIOD";
          queue.push({
            target_geonames_id: String(target.geonames_id),
            target_geonames_name: target.geonames_name,
            target_raw_admin1_code: String(target.raw_admin1_code ?? ""),
            target_candidate_area_code: String(candidate.area_code),
            target_candidate_period_uri: String(period.period_uri),
            target_candidate_label_en: String(period.label_en ?? ""),
            target_candidate_label_ja: String(period.label_ja ?? ""),
            target_period_effective_from: String(period.effective_from ?? ""),
            target_period_effective_until: String(period.effective_until ?? ""),
            target_admin_class_uris: (period.administrative_class_uris ?? []).join(";"),
            exact_target_name_match: "true",
            target_spatial_hit_snapshots: pointHitSnapshots.join(";"),
            period_aligned_spatial_hit_snapshots: alignedSnapshots.join(";"),
            spatial_period_evidence_status: spatialStatus,
            parent_area_code: parent ? String(parent.area_code ?? "") : "",
            parent_period_uri: parent ? String(parent.uri ?? "") : "",
            parent_label_en: parent ? String(parent.label_en ?? "") : "",
            parent_label_ja: parent ? String(parent.label_ja ?? "") : "",
            parent_candidate_source_kinds: (parentRef?.reference_source_kinds ?? []).join(";"),
            candidate_parent_geonames_ids: (parentRef?.candidate_geonames_ids ?? []).join(";"),
            candidate_parent_count: parentRef?.candidate_count ?? 0,
            candidate_parent_feature_codes: [...new Set(candidateMatches.map((row) => row.feature_code))].sort().join(";"),
            candidate_parent_match_fields: [...new Set(candidateMatches.flatMap((row) => row.exact_match_fields))].sort().join(";"),
            parent_identity_candidate_status: parent
              ? (parentRef?.candidate_status ?? "PARENT_REFERENCE_NOT_IN_EXPANDED_AUDIT_INDEX")
              : "NO_OFFICIAL_PARENT_REFERENCE_FOR_TARGET_PERIOD",
            operational_parent_link_created: "false",
          });
        }
      }
    }
  }

  return {
    inputSummary,
    target_candidate_parent_queue_rows: queue,
    queue_row_count: queue.length,
    queue_rows_with_spatial_hit: queue.filter((row) => row.target_spatial_hit_snapshots).length,
    queue_rows_with_period_aligned_spatial_hit: queue.filter((row) => row.period_aligned_spatial_hit_snapshots).length,
    queue_rows_with_one_parent_candidate: queue.filter((row) => Number(row.candidate_parent_count) === 1).length,
    queue_rows_with_multiple_parent_candidates: queue.filter((row) => Number(row.candidate_parent_count) > 1).length,
    queue_rows_with_no_parent_candidate: queue.filter((row) => row.parent_period_uri && Number(row.candidate_parent_count) === 0).length,
    queue_rows_without_official_parent_reference: queue.filter((row) => !row.parent_period_uri).length,
    operational_parent_links_created: 0,
  };
}

export function isEligibleGeoNamesParentFeature(record) {
  return record?.country_code === EXPECTED_COUNTRY_CODE &&
    record?.feature_class === "A" &&
    PARENT_FEATURE_CODE.test(String(record?.feature_code ?? ""));
}

export function exactJapaneseLabelMatchFields(record, targetJapaneseLabel) {
  const target = normalizeExactJapaneseLabel(targetJapaneseLabel);
  if (!target) return [];
  const matches = [];
  if (normalizeExactJapaneseLabel(record.name) === target) matches.push("primary_name");
  if (normalizeExactJapaneseLabel(record.ascii_name) === target) matches.push("ascii_name");
  if ((record.alternate_names ?? []).some((value) => normalizeExactJapaneseLabel(value) === target)) {
    matches.push("exact_alternate_name_entry");
  }
  return matches;
}


export async function runParentIdentityCandidateAudit({
  geonamesJapanTextPath,
  detailReportPath,
  geonamesSourceManifestPath,
  outputPrefix,
  targetCandidateReportPath = null,
  spatialPolygonReportPath = null,
}) {
  const detailBytes = await readFile(detailReportPath);
  const detailReport = JSON.parse(detailBytes.toString("utf8"));
  const sourceManifestBytes = await readFile(geonamesSourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  if (Boolean(targetCandidateReportPath) !== Boolean(spatialPolygonReportPath)) {
    throw new Error("Supplemental mode requires both the exact-label candidate report and expanded spatial report.");
  }
  const targetCandidateReportBytes = targetCandidateReportPath ? await readFile(targetCandidateReportPath) : null;
  const targetCandidateReport = targetCandidateReportBytes
    ? JSON.parse(targetCandidateReportBytes.toString("utf8"))
    : null;
  const spatialPolygonReportBytes = spatialPolygonReportPath ? await readFile(spatialPolygonReportPath) : null;
  const spatialPolygonReport = spatialPolygonReportBytes
    ? JSON.parse(spatialPolygonReportBytes.toString("utf8"))
    : null;
  if (sourceManifest?.country_code !== "JP" ||
      sourceManifest?.archive_filename !== "JP.zip" ||
      sourceManifest?.source_url !== "https://download.geonames.org/export/dump/JP.zip" ||
      Number(sourceManifest?.http_status) !== 200 ||
      !/^[a-f0-9]{64}$/i.test(sourceManifest?.archive_sha256 ?? "")) {
    throw new Error("GeoNames Japan source manifest failed country, URL, status or SHA-256 validation.");
  }

  let parentReferences = buildOfficialParentReferenceIndex(detailReport);
  let targetCandidateExpansion = null;
  let targetCandidateParentQueue = null;
  let targetCandidateQueueInputs = null;
  if (targetCandidateReport) {
    const supplemental = mergeExactLabelTargetCandidateParentReferences(parentReferences, targetCandidateReport);
    parentReferences = supplemental.parentReferences;
    targetCandidateExpansion = {
      ...supplemental.inputSummary,
      candidate_period_count: supplemental.candidatePeriodCount,
      parent_reference_occurrence_count: supplemental.parentReferenceOccurrenceCount,
      expanded_parent_reference_count: supplemental.expandedParentReferenceCount,
      report_sha256: sha256(targetCandidateReportBytes),
    };
    targetCandidateQueueInputs = { targetCandidateReport, spatialPolygonReport };
  }
  const referencesByJapaneseLabel = new Map();
  for (const reference of parentReferences) {
    if (reference.candidate_status === "BLOCKED_CONFLICTING_OFFICIAL_JAPANESE_PARENT_LABELS") continue;
    const key = normalizeExactJapaneseLabel(reference.parent_label_ja);
    if (key) addUnique(referencesByJapaneseLabel, key, reference);
  }

  const geonamesTextHash = createHash("sha256");
  let geonamesSourceRows = 0;
  let malformedRows = 0;
  let duplicateAdministrativeIds = 0;
  const administrativeRowsById = new Map();
  const geonamesStream = createReadStream(geonamesJapanTextPath);
  geonamesStream.on("data", (chunk) => geonamesTextHash.update(chunk));
  const input = createInterface({ input: geonamesStream, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line) continue;
    geonamesSourceRows += 1;
    let record;
    try {
      record = parseGeoNamesJapanAdminLine(line);
    } catch {
      malformedRows += 1;
      continue;
    }
    if (!isEligibleGeoNamesParentFeature(record)) continue;
    if (administrativeRowsById.has(record.geonames_id)) {
      duplicateAdministrativeIds += 1;
      continue;
    }
    administrativeRowsById.set(record.geonames_id, record);

    const recordNames = new Map();
    for (const referenceLabel of referencesByJapaneseLabel.keys()) {
      const matchFields = exactJapaneseLabelMatchFields(record, referenceLabel);
      if (matchFields.length) recordNames.set(referenceLabel, matchFields);
    }
    for (const [matchedLabel, matchFields] of recordNames.entries()) {
      const matchingReferences = referencesByJapaneseLabel.get(matchedLabel) ?? [];
      for (const reference of matchingReferences) {
        reference.candidate_matches.push({
          geonames_id: record.geonames_id,
          geonames_name: record.name,
          geonames_ascii_name: record.ascii_name,
          feature_class: record.feature_class,
          feature_code: record.feature_code,
          country_code: record.country_code,
          raw_admin1_code: record.admin1_code,
          raw_admin2_code: record.admin2_code,
          raw_admin3_code: record.admin3_code,
          raw_admin4_code: record.admin4_code,
          source_modification_date: record.modification_date,
          exact_match_fields: matchFields,
        });
      }
    }
  }

  for (const reference of parentReferences) {
    const candidates = reference.candidate_matches.sort((a, b) =>
      Number(a.geonames_id) - Number(b.geonames_id));
    reference.candidate_geonames_ids = [...new Set(candidates.map((candidate) => candidate.geonames_id))];
    reference.candidate_count = reference.candidate_geonames_ids.length;
    if (reference.conflicting_parent_label_values) {
      reference.candidate_status = "BLOCKED_CONFLICTING_OFFICIAL_JAPANESE_PARENT_LABELS";
    } else if (!reference.parent_label_ja) {
      reference.candidate_status = "NO_OFFICIAL_JAPANESE_PARENT_LABEL";
    } else if (reference.candidate_count === 0) {
      reference.candidate_status = "NO_EXACT_GEONAMES_JAPANESE_ADMIN_LABEL_MATCH";
    } else if (reference.candidate_count === 1) {
      reference.candidate_status = "ONE_EXACT_GEONAMES_ADMIN_LABEL_CANDIDATE_REQUIRES_IDENTITY_REVIEW";
    } else {
      reference.candidate_status = "MULTIPLE_EXACT_GEONAMES_ADMIN_LABEL_CANDIDATES_REQUIRE_DISAMBIGUATION";
    }
  }

  if (targetCandidateQueueInputs) {
    targetCandidateParentQueue = buildTargetCandidateParentQueue(
      targetCandidateQueueInputs.targetCandidateReport,
      parentReferences,
      targetCandidateQueueInputs.spatialPolygonReport,
    );
  }

  const allCandidateMatches = parentReferences.flatMap((reference) =>
    reference.candidate_matches.map((candidate) => ({
      parent_area_code: reference.parent_area_code,
      parent_uri: reference.parent_uri,
      parent_label_en: reference.parent_label_en,
      parent_label_ja: reference.parent_label_ja,
      child_area_codes: reference.child_area_codes.join(";"),
      child_period_uri_count: reference.child_period_uris.length,
      published_parent_reference_rows: reference.published_parent_reference_rows,
      ...candidate,
      parent_identity_crosswalk_status: "NOT_VERIFIED_TO_GEONAMES_ID",
      operational_parent_link_created: "false",
    })));

  const geonamesTextMemberSha256 = geonamesTextHash.digest("hex");
  if (targetCandidateReport) {
    if (targetCandidateReport.input?.geonames_country_text_sha256 !== geonamesTextMemberSha256 ||
        targetCandidateExpansion.geonames_archive_sha256 !== sourceManifest.archive_sha256) {
      throw new Error("Supplemental target-candidate report does not use the same pinned GeoNames JP.zip/JP.txt source bytes.");
    }
    if (Number(spatialPolygonReport.source_snapshot_archive_count) !== 122 ||
        Number(spatialPolygonReport.candidate_codes_tested) !== targetCandidateExpansion.target_to_candidate_code_associations ||
        Number(spatialPolygonReport.operational_parent_links_created) !== 0) {
      throw new Error("Supplemental spatial report does not reconcile to the 122-archive/46-association source-pinned audit.");
    }
    if (Number(targetCandidateExpansion.exact_name_matched_period_rows) !== 156) {
      throw new Error("Unexpected exact-name matched period coverage; requires review before candidate comparison.");
    }
  }

  const summary = {
    report_version: targetCandidateReport ? 2 : 1,
    audit_scope: targetCandidateReport
      ? "SPATIAL_FIRST_1995_HISTORY_PLUS_EXACT_ENGLISH_LABEL_TARGET_CANDIDATE_HISTORY"
      : "SPATIAL_FIRST_1995_HISTORY_ONLY",
    status: "PASS_EXACT_JAPANESE_LABEL_PARENT_ID_CANDIDATE_DISCOVERY; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
    generated_at_utc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    matching_rule: "Exact full Unicode NFC-normalized, outer-trimmed equality between official e-Stat parent label_ja and GeoNames Japan ADM1/ADM2/ADM3 primary name, ASCII name, or a complete comma-delimited alternate-name entry. No substring, transliteration, fuzzy, proximity, or parent inference.",
    geonames_source: {
      archive_filename: sourceManifest.archive_filename,
      source_url: sourceManifest.source_url,
      retrieved_at_utc: sourceManifest.retrieved_at_utc,
      archive_sha256: sourceManifest.archive_sha256,
      archive_size_bytes: sourceManifest.archive_size_bytes,
      text_member_filename: "JP.txt",
      text_member_sha256: geonamesTextMemberSha256,
      text_rows_scanned: geonamesSourceRows,
      malformed_or_wrong_shape_rows: malformedRows,
      duplicate_japan_administrative_ids: duplicateAdministrativeIds,
      eligible_japan_administrative_records: administrativeRowsById.size,
    },
    spatial_first_input: {
      target_count: detailReport.target_count,
      distinct_spatial_area_codes: detailReport.distinct_spatial_area_codes,
      target_to_spatial_area_code_associations: detailReport.target_to_spatial_area_code_associations,
      detail_periods_reconciled: detailReport.detail_periods_reconciled,
      detail_report_sha256: sha256(detailBytes),
    },
    parent_reference_count: parentReferences.length,
    parent_references_with_official_japanese_label: parentReferences.filter((reference) => reference.parent_label_ja).length,
    parent_references_with_conflicting_official_labels: parentReferences.filter((reference) => reference.conflicting_parent_label_values).length,
    parent_references_with_one_candidate: parentReferences.filter((reference) => reference.candidate_count === 1).length,
    parent_references_with_multiple_candidates: parentReferences.filter((reference) => reference.candidate_count > 1).length,
    parent_references_with_no_exact_candidate: parentReferences.filter((reference) => reference.parent_label_ja && reference.candidate_count === 0).length,
    parent_references_without_japanese_label: parentReferences.filter((reference) => !reference.parent_label_ja).length,
    distinct_candidate_geonames_ids: new Set(allCandidateMatches.map((candidate) => candidate.geonames_id)).size,
    candidate_match_rows: allCandidateMatches.length,
    operational_parent_links_created: 0,
    ...(targetCandidateExpansion ? {
      supplemental_target_candidate_input: targetCandidateExpansion,
      supplemental_spatial_input: {
        selection_mode: spatialPolygonReport.selection_mode,
        target_count: spatialPolygonReport.target_count,
        target_code_associations_tested: spatialPolygonReport.target_code_associations_tested,
        distinct_candidate_area_codes_tested: spatialPolygonReport.distinct_candidate_area_codes_tested,
        source_snapshot_archive_count: spatialPolygonReport.source_snapshot_archive_count,
        target_rows_with_polygon_context: spatialPolygonReport.target_rows_with_polygon_context,
        target_rows_without_polygon_context: spatialPolygonReport.target_rows_without_polygon_context,
        report_sha256: sha256(spatialPolygonReportBytes),
      },
      target_candidate_parent_queue_summary: targetCandidateParentQueue,
    } : {}),
    parent_references: parentReferences,
    limitations: [
      "Exact label matches only provide candidate identity evidence. Common Japanese names may refer to multiple places, and exact labels do not prove that the candidate is the administrative parent of any target.",
      "GeoNames alternate-name entries in JP.txt are not language-tagged; exact equality is useful for discovery but does not prove the language or semantic meaning of an entry.",
      "This audit searches only same-country class-A ADM1/ADM2/ADM3 records. A zero result does not prove no appropriate parent exists in another source or level.",
      "e-Stat historical parent references remain tied to their exact period URI; parent labels and codes can change over time.",
      "No candidate ID is automatically selected, and no operational parent relationship is created."
    ],
  };

  const prefix = resolve(outputPrefix);
  const jsonPath = prefix + ".json";
  const parentCsvPath = prefix + ".parent-references.csv";
  const candidateCsvPath = prefix + ".candidate-matches.csv";
  const parentFields = [
    "parent_area_code", "parent_uri", "parent_label_en", "parent_label_ja",
    "parent_label_en_values", "parent_label_ja_values", "child_area_codes",
    "child_period_uri_count", "published_parent_reference_rows", "reference_source_kinds", "candidate_count",
    "candidate_geonames_ids", "candidate_status", "operational_parent_link_created",
  ];
  const parentRows = parentReferences.map((reference) => ({
    parent_area_code: reference.parent_area_code,
    parent_uri: reference.parent_uri,
    parent_label_en: reference.parent_label_en,
    parent_label_ja: reference.parent_label_ja,
    parent_label_en_values: reference.parent_label_en_values.join(";"),
    parent_label_ja_values: reference.parent_label_ja_values.join(";"),
    child_area_codes: reference.child_area_codes.join(";"),
    child_period_uri_count: reference.child_period_uris.length,
    published_parent_reference_rows: reference.published_parent_reference_rows,
    reference_source_kinds: (reference.reference_source_kinds ?? []).join(";"),
    candidate_count: reference.candidate_count,
    candidate_geonames_ids: reference.candidate_geonames_ids.join(";"),
    candidate_status: reference.candidate_status,
    operational_parent_link_created: "false",
  }));
  const candidateFields = [
    "parent_area_code", "parent_uri", "parent_label_en", "parent_label_ja",
    "child_area_codes", "child_period_uri_count", "published_parent_reference_rows",
    "geonames_id", "geonames_name", "geonames_ascii_name", "feature_class", "feature_code",
    "country_code", "raw_admin1_code", "raw_admin2_code", "raw_admin3_code", "raw_admin4_code",
    "source_modification_date", "exact_match_fields", "parent_identity_crosswalk_status",
    "operational_parent_link_created",
  ];
  const candidateRows = allCandidateMatches.map((candidate) => ({
    ...candidate,
    exact_match_fields: candidate.exact_match_fields.join(";"),
  }));
  await mkdir(dirname(jsonPath), { recursive: true });
  const writes = [
    writeFile(jsonPath, JSON.stringify(summary, null, 2) + "\n", "utf8"),
    writeFile(parentCsvPath, renderCsv(parentFields, parentRows), "utf8"),
    writeFile(candidateCsvPath, renderCsv(candidateFields, candidateRows), "utf8"),
  ];
  if (targetCandidateParentQueue) {
    const queuePath = prefix + ".target-candidate-parent-queue.csv";
    const queueFields = [
      "target_geonames_id", "target_geonames_name", "target_raw_admin1_code",
      "target_candidate_area_code", "target_candidate_period_uri", "target_candidate_label_en",
      "target_candidate_label_ja", "target_period_effective_from", "target_period_effective_until",
      "target_admin_class_uris", "exact_target_name_match", "target_spatial_hit_snapshots",
      "period_aligned_spatial_hit_snapshots", "spatial_period_evidence_status",
      "parent_area_code", "parent_period_uri", "parent_label_en", "parent_label_ja",
      "parent_candidate_source_kinds", "candidate_parent_geonames_ids", "candidate_parent_count",
      "candidate_parent_feature_codes", "candidate_parent_match_fields",
      "parent_identity_candidate_status", "operational_parent_link_created",
    ];
    writes.push(writeFile(queuePath, renderCsv(queueFields, targetCandidateParentQueue.target_candidate_parent_queue_rows), "utf8"));
  }
  await Promise.all(writes);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [
    geonamesJapanTextPath,
    detailReportPath,
    geonamesSourceManifestPath,
    outputPrefix,
    targetCandidateReportPath,
    spatialPolygonReportPath,
  ] = process.argv.slice(2);
  if (!geonamesJapanTextPath || !detailReportPath || !geonamesSourceManifestPath || !outputPrefix ||
      (Boolean(targetCandidateReportPath) !== Boolean(spatialPolygonReportPath))) {
    process.stderr.write(
      "Usage: geonames-japan-estat-parent-geonames-candidate-audit.mjs " +
      "<JP.txt> <spatial-first-estat-details.json> <geonames-source-manifest.json> <output-prefix> " +
      "[japan-estat-evidence-audit.json japan-mlit-polygon-audit.json]\n",
    );
    process.exitCode = 2;
  } else {
    runParentIdentityCandidateAudit({
      geonamesJapanTextPath,
      detailReportPath,
      geonamesSourceManifestPath,
      outputPrefix,
      targetCandidateReportPath,
      spatialPolygonReportPath,
    }).then((summary) => {
      process.stdout.write(JSON.stringify({
        status: summary.status,
        parent_reference_count: summary.parent_reference_count,
        parent_references_with_one_candidate: summary.parent_references_with_one_candidate,
        parent_references_with_multiple_candidates: summary.parent_references_with_multiple_candidates,
        parent_references_with_no_exact_candidate: summary.parent_references_with_no_exact_candidate,
        parent_references_without_japanese_label: summary.parent_references_without_japanese_label,
        distinct_candidate_geonames_ids: summary.distinct_candidate_geonames_ids,
        candidate_match_rows: summary.candidate_match_rows,
        ...(summary.target_candidate_parent_queue_summary ? {
          target_candidate_parent_queue_summary: summary.target_candidate_parent_queue_summary,
        } : {}),
        operational_parent_links_created: 0,
      }, null, 2) + "\n");
    }).catch((error) => {
      process.stderr.write("e-Stat/GeoNames parent identity candidate audit failed closed: " + (error.stack ?? error) + "\n");
      process.exitCode = 1;
    });
  }
}
