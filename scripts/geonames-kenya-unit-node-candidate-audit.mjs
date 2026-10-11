#!/usr/bin/env node
/**
 * Source-pinned, read-only name-candidate inventory for the Kenya exception.
 * Names and aliases discover review candidates only; they never approve parent links.
 *
 * Usage:
 *   node scripts/geonames-kenya-unit-node-candidate-audit.mjs <KE.txt> <output-prefix> <remote-source-manifest.json>
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const COUNTRY_ARCHIVE_URL = "https://download.geonames.org/export/dump/KE.zip";
const SEARCH_LABELS = [
  "Githunguri",
  "Githunguri Location",
  "Githunguri Sub-County",
  "Githunguri Sub County",
  "Githunguri Subcounty",
  "Kiambururu",
  "Kiambururu Location",
  "Kiambururu Sub-Location",
  "Kiambururu Sub Location",
  "Kiambururu Sublocation",
];
const SEARCH_TERMS = new Set(SEARCH_LABELS.map(normalizeLabel));
const SUBCOUNTY_TERMS = new Set([
  normalizeLabel("Githunguri Sub-County"),
  normalizeLabel("Githunguri Sub County"),
  normalizeLabel("Githunguri Subcounty"),
]);
const GITHUNGURI_TERMS = new Set(SEARCH_LABELS.slice(0, 5).map(normalizeLabel));
const KIAMBURURU_TERMS = new Set(SEARCH_LABELS.slice(5).map(normalizeLabel));
const CSV_FIELDS = [
  "geonames_id", "name", "ascii_name", "feature_class", "feature_code", "country_code",
  "latitude", "longitude", "admin1_code", "admin2_code", "admin3_code", "admin4_code",
  "modification_date", "matched_source_fields", "matched_normalized_labels",
  "exact_githunguri_subcounty_label_match", "candidate_disposition",
];

function need(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseGeoNamesLine(line) {
  const fields = line.split("\t");
  need(fields.length >= 19 && fields[0], "Invalid GeoNames row: expected 19 tab-separated fields and an ID.");
  return {
    geonames_id: fields[0],
    name: fields[1],
    ascii_name: fields[2],
    alternate_names: fields[3] ?? "",
    latitude: fields[4] ?? "",
    longitude: fields[5] ?? "",
    feature_class: fields[6] ?? "",
    feature_code: fields[7] ?? "",
    country_code: fields[8] ?? "",
    admin1_code: fields[10] ?? "",
    admin2_code: fields[11] ?? "",
    admin3_code: fields[12] ?? "",
    admin4_code: fields[13] ?? "",
    modification_date: fields[18] ?? "",
  };
}

function getSourceMetadata(manifest) {
  const record = (manifest?.remote_sources ?? []).find((item) => item.country_code === "KE");
  need(record, "Official KE.zip source metadata is missing from the retrieval manifest.");
  need(record.archive_filename === "KE.zip" && record.source_url === COUNTRY_ARCHIVE_URL,
    "Unexpected Kenya archive filename or source URL.");
  need(Number(record.http_status) === 200, "The current Kenya archive retrieval did not return HTTP 200.");
  need(/^[a-f0-9]{64}$/i.test(record.archive_sha256 ?? ""), "The Kenya archive SHA-256 is missing or invalid.");
  need(Number.isSafeInteger(record.archive_size_bytes) && record.archive_size_bytes > 0,
    "The Kenya archive size is missing or invalid.");
  need(Number.isFinite(Date.parse(record.retrieved_at_utc ?? "")), "The Kenya archive retrieval timestamp is invalid.");
  return {
    owner: "GeoNames",
    archive_filename: record.archive_filename,
    archive_url: record.source_url,
    retrieved_at_utc: record.retrieved_at_utc,
    http_status: Number(record.http_status),
    archive_sha256: record.archive_sha256,
    archive_size_bytes: record.archive_size_bytes,
    zip_crc_validation: record.zip_crc_validation ?? "NOT_RECORDED",
  };
}

function isAdministrativeFeature(record) {
  return record.feature_class === "A" && /^(ADMD|ADM[1-4]H?|ADM[1-4])$/.test(record.feature_code);
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function renderCandidateAuditCsv(report) {
  const rows = report.candidates.map((record) => ({
    ...record,
    matched_source_fields: record.matched_source_fields.join("; "),
    matched_normalized_labels: record.matched_normalized_labels.join("; "),
    exact_githunguri_subcounty_label_match: record.exact_githunguri_subcounty_label_match,
  }));
  return [CSV_FIELDS.join(","), ...rows.map((record) =>
    CSV_FIELDS.map((field) => csvEscape(record[field])).join(","))].join("\n") + "\n";
}

export function buildCandidateAudit(countryText, sourceManifest) {
  const source = getSourceMetadata(sourceManifest);
  const lines = String(countryText).split(/\r?\n/).filter((line) => line.length > 0);
  need(lines.length > 0, "The current GeoNames Kenya country dump is empty.");
  const records = lines.map(parseGeoNamesLine);
  const ids = new Set();
  for (const record of records) {
    need(record.country_code === "KE", "KE.txt contains a row whose country code is not KE.");
    need(!ids.has(record.geonames_id), "The GeoNames Kenya country dump has a duplicate ID: " + record.geonames_id);
    ids.add(record.geonames_id);
  }

  const targets = records.filter((record) => record.geonames_id === "192705");
  need(targets.length === 1, "The source snapshot must contain GeoNames target ID 192705 exactly once.");
  need(targets[0].feature_class === "A" && targets[0].feature_code === "ADM3" && targets[0].admin1_code === "01",
    "Kiambururu target identity or raw admin1 code differs from the reviewed exception.");

  const candidates = [];
  for (const record of records) {
    const labels = [
      { field: "name", label: record.name },
      { field: "ascii_name", label: record.ascii_name },
      ...record.alternate_names.split(",").filter(Boolean).map((label) => ({ field: "alternate_name", label })),
    ];
    const matched = labels.filter((entry) => SEARCH_TERMS.has(normalizeLabel(entry.label)));
    if (matched.length === 0) continue;

    const matchedNormalized = [...new Set(matched.map((entry) => normalizeLabel(entry.label)))].sort();
    const administrative = isAdministrativeFeature(record);
    const exactSubcounty = administrative && matchedNormalized.some((label) => SUBCOUNTY_TERMS.has(label));
    const matchesGithunguri = matchedNormalized.some((label) => GITHUNGURI_TERMS.has(label));
    const matchesKiambururu = matchedNormalized.some((label) => KIAMBURURU_TERMS.has(label));
    let disposition = "NON_ADMIN_OR_CONTEXT_NAME_CANDIDATE_ONLY";
    if (exactSubcounty) disposition = "EXACT_LABEL_CANDIDATE_REQUIRES_MANUAL_IDENTITY_CROSSWALK";
    else if (matchesGithunguri && administrative) disposition = "GITHUNGURI_ADMIN_NAME_CANDIDATE_LEVEL_UNVERIFIED";
    else if (matchesKiambururu && administrative) disposition = "KIAMBURURU_CHILD_IDENTITY_CANDIDATE_ONLY";
    else if (matchesGithunguri) disposition = "GITHUNGURI_NON_ADMIN_PLACE_NOT_A_PARENT";
    else if (matchesKiambururu) disposition = "KIAMBURURU_NON_ADMIN_PLACE_NOT_A_PARENT";

    candidates.push({
      geonames_id: record.geonames_id,
      name: record.name,
      ascii_name: record.ascii_name,
      feature_class: record.feature_class,
      feature_code: record.feature_code,
      country_code: record.country_code,
      latitude: record.latitude,
      longitude: record.longitude,
      admin1_code: record.admin1_code,
      admin2_code: record.admin2_code,
      admin3_code: record.admin3_code,
      admin4_code: record.admin4_code,
      modification_date: record.modification_date,
      matched_source_fields: [...new Set(matched.map((entry) => entry.field + ": " + entry.label))].sort(),
      matched_normalized_labels: matchedNormalized,
      exact_githunguri_subcounty_label_match: exactSubcounty,
      is_administrative_feature: administrative,
      candidate_disposition: disposition,
    });
  }

  candidates.sort((a, b) =>
    Number(a.geonames_id) - Number(b.geonames_id) || a.name.localeCompare(b.name));

  const exactCandidates = candidates.filter((record) => record.exact_githunguri_subcounty_label_match);
  const githunguriAdmin = candidates.filter((record) =>
    record.is_administrative_feature &&
    record.matched_normalized_labels.some((label) => GITHUNGURI_TERMS.has(label)));
  const kiambururuAdmin = candidates.filter((record) =>
    record.is_administrative_feature &&
    record.matched_normalized_labels.some((label) => KIAMBURURU_TERMS.has(label)));

  return {
    report_version: "1.0",
    status: exactCandidates.length > 0
      ? "EXACT_SUBCOUNTY_LABEL_CANDIDATES_FOUND__MANUAL_IDENTITY_REVIEW_REQUIRED"
      : "NO_EXACT_SUBCOUNTY_LABEL_CANDIDATE_FOUND__PARENT_REMAINS_UNRESOLVED",
    source: {
      ...source,
      country_text_filename: "KE.txt",
      country_text_sha256: createHash("sha256").update(Buffer.from(String(countryText), "utf8")).digest("hex"),
      country_text_size_bytes: Buffer.byteLength(String(countryText), "utf8"),
      country_records_scanned: records.length,
    },
    search_labels: SEARCH_LABELS,
    summary: {
      candidate_records: candidates.length,
      exact_githunguri_subcounty_admin_candidate_count: exactCandidates.length,
      githunguri_administrative_name_candidate_count: githunguriAdmin.length,
      kiambururu_administrative_name_candidate_count: kiambururuAdmin.length,
      target_192705_present_once: true,
    },
    candidates,
    decision_boundary: {
      candidate_names_are_discovery_only: true,
      approved_parent_ids: [],
      operational_parent_links_created: 0,
      database_or_production_changes: false,
    },
  };
}

async function main() {
  const [sourcePath, outputPrefix, manifestPath] = process.argv.slice(2);
  if (!sourcePath || !outputPrefix || !manifestPath) {
    console.error("Usage: node scripts/geonames-kenya-unit-node-candidate-audit.mjs <KE.txt> <output-prefix> <remote-source-manifest.json>");
    process.exitCode = 2;
    return;
  }
  const [text, manifestText] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const report = buildCandidateAudit(text, JSON.parse(manifestText));
  await Promise.all([
    writeFile(outputPrefix + ".json", JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(outputPrefix + ".csv", renderCandidateAuditCsv(report), "utf8"),
  ]);
  console.log(JSON.stringify({
    status: report.status,
    ...report.summary,
    source_archive_sha256: report.source.archive_sha256,
    country_text_sha256: report.source.country_text_sha256,
    operational_parent_links_created: report.decision_boundary.operational_parent_links_created,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
