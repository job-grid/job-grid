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
}) {
  const detailBytes = await readFile(detailReportPath);
  const detailReport = JSON.parse(detailBytes.toString("utf8"));
  const sourceManifestBytes = await readFile(geonamesSourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  if (sourceManifest?.country_code !== "JP" ||
      sourceManifest?.archive_filename !== "JP.zip" ||
      sourceManifest?.source_url !== "https://download.geonames.org/export/dump/JP.zip" ||
      Number(sourceManifest?.http_status) !== 200 ||
      !/^[a-f0-9]{64}$/i.test(sourceManifest?.archive_sha256 ?? "")) {
    throw new Error("GeoNames Japan source manifest failed country, URL, status or SHA-256 validation.");
  }

  const parentReferences = buildOfficialParentReferenceIndex(detailReport);
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

  const summary = {
    report_version: 1,
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
      text_member_sha256: geonamesTextHash.digest("hex"),
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
    "child_period_uri_count", "published_parent_reference_rows", "candidate_count",
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
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(summary, null, 2) + "\n", "utf8"),
    writeFile(parentCsvPath, renderCsv(parentFields, parentRows), "utf8"),
    writeFile(candidateCsvPath, renderCsv(candidateFields, candidateRows), "utf8"),
  ]);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [geonamesJapanTextPath, detailReportPath, geonamesSourceManifestPath, outputPrefix] = process.argv.slice(2);
  if (!geonamesJapanTextPath || !detailReportPath || !geonamesSourceManifestPath || !outputPrefix) {
    process.stderr.write(
      "Usage: geonames-japan-estat-parent-geonames-candidate-audit.mjs " +
      "<JP.txt> <spatial-first-estat-details.json> <geonames-source-manifest.json> <output-prefix>\n",
    );
    process.exitCode = 2;
  } else {
    runParentIdentityCandidateAudit({
      geonamesJapanTextPath,
      detailReportPath,
      geonamesSourceManifestPath,
      outputPrefix,
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
        operational_parent_links_created: 0,
      }, null, 2) + "\n");
    }).catch((error) => {
      process.stderr.write("e-Stat/GeoNames parent identity candidate audit failed closed: " + (error.stack ?? error) + "\n");
      process.exitCode = 1;
    });
  }
}
