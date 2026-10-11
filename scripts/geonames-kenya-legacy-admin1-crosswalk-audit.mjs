#!/usr/bin/env node
/**
 * Read-only audit of the two Kenya legacy admin1 codes against GeoNames'
 * current official admin1CodesASCII.txt dump.
 * Does not infer geography or create parent links.
 *
 * Usage: node scripts/geonames-kenya-legacy-admin1-crosswalk-audit.mjs
 *   <admin1CodesASCII.txt> [output-prefix] [source-manifest.json]
 */
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = [
  {
    geonames_id: "192705",
    name: "Kiambururu Sub-Location",
    country_code: "KE",
    feature_code: "ADM3",
    source_raw_admin1_code: "01",
    expected_composite_key: "KE.01",
  },
  {
    geonames_id: "7800132",
    name: "Imenti Central",
    country_code: "KE",
    feature_code: "ADM3",
    source_raw_admin1_code: "03",
    expected_composite_key: "KE.03",
  },
];

export function parseAdmin1Crosswalk(text) {
  const records = [];
  const byCode = new Map();
  const duplicateCodes = new Set();
  let malformedRows = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields.length !== 4 || !fields[0] || !/^\d+$/.test(fields[3])) {
      malformedRows += 1;
      continue;
    }
    const [code, name, asciiName, geonamesId] = fields;
    const record = { composite_key: code, name, ascii_name: asciiName, geonames_id: geonamesId };
    records.push(record);
    if (byCode.has(code)) duplicateCodes.add(code);
    else byCode.set(code, record);
  }
  return { records, byCode, malformedRows, duplicateCodes: [...duplicateCodes].sort() };
}

export function validateCrosswalkManifest(manifest) {
  const source = manifest?.remote_source;
  return source?.filename === "admin1CodesASCII.txt" &&
    source?.url === "https://download.geonames.org/export/dump/admin1CodesASCII.txt" &&
    Number(source?.http_status) === 200 &&
    Number.isFinite(Date.parse(source?.retrieved_at_utc ?? "")) &&
    /^[a-f0-9]{64}$/i.test(source?.sha256 ?? "") &&
    Number.isSafeInteger(source?.size_bytes) && source.size_bytes > 0;
}

export function auditKenyaLegacyAdmin1Codes(crosswalkText, manifest = null) {
  const parsed = parseAdmin1Crosswalk(crosswalkText);
  const rows = TARGETS.map((target) => {
    const matches = parsed.records.filter((record) => record.composite_key === target.expected_composite_key);
    let status;
    if (matches.length === 0) status = "KEY_ABSENT_FROM_CURRENT_ADMIN1_CROSSWALK_PARENT_UNRESOLVED";
    else if (matches.length > 1) status = "BLOCKED_DUPLICATE_CROSSWALK_KEY";
    else status = "KEY_PRESENT_REQUIRES_INDEPENDENT_PARENT_SOURCE_REVIEW";
    return {
      ...target,
      source_raw_admin1_code_preserved: target.source_raw_admin1_code,
      crosswalk_row_count_for_key: matches.length,
      current_crosswalk_name: matches[0]?.name ?? "",
      current_crosswalk_geonames_id: matches[0]?.geonames_id ?? "",
      status,
      parent_link_created: false,
      parent_linking_authorized: false,
    };
  });
  const currentKenyaKeys = parsed.records
    .filter((record) => record.composite_key.startsWith("KE."))
    .map((record) => ({
      composite_key: record.composite_key,
      name: record.name,
      geonames_id: record.geonames_id,
    }))
    .sort((a, b) => a.composite_key.localeCompare(b.composite_key));
  return {
    report_version: "1.0",
    audit_type: "READ_ONLY_KENYA_LEGACY_ADMIN1_KEYS_VS_OFFICIAL_GEONAMES_CROSSWALK",
    generated_at_utc: new Date().toISOString(),
    crosswalk_row_count: parsed.records.length,
    malformed_rows: parsed.malformedRows,
    duplicate_crosswalk_keys: parsed.duplicateCodes,
    target_count: rows.length,
    target_status_counts: rows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {}),
    targets: rows,
    current_ke_admin1_keys: currentKenyaKeys,
    source: {
      manifest: manifest?.remote_source ?? null,
      retrieval_metadata_verified: validateCrosswalkManifest(manifest),
      crosswalk_sha256: createHash("sha256").update(crosswalkText).digest("hex"),
    },
    raw_codes_normalized: false,
    candidate_parent_ids_assigned: 0,
    operational_parent_links_created: 0,
    limitations: [
      "The absence of KE.01 or KE.03 from the current GeoNames admin1 crosswalk proves those exact composite keys cannot resolve in this snapshot; it does not identify replacement county or administrative parent IDs.",
      "GeoNames historical forum guidance for these legacy KE codes is contextual evidence only, not a current authoritative replacement mapping.",
      "No match was attempted by name, proximity, feature code, or assumed historical-province mapping.",
      "The audit does not independently prove Kenya administrative boundaries or approve any parent link.",
    ],
  };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function renderKenyaAuditCsv(report) {
  const fields = [
    "geonames_id", "name", "country_code", "feature_code",
    "source_raw_admin1_code", "expected_composite_key",
    "crosswalk_row_count_for_key", "current_crosswalk_name",
    "current_crosswalk_geonames_id", "status",
    "source_raw_admin1_code_preserved", "parent_link_created",
    "parent_linking_authorized",
  ];
  return [fields.join(","), ...report.targets.map((row) =>
    fields.map((field) => csvEscape(row[field])).join(","))].join("\n") + "\n";
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/geonames-kenya-legacy-admin1-crosswalk-audit.mjs <admin1CodesASCII.txt> [output-prefix] [source-manifest.json]");
    process.exitCode = 2;
    return;
  }
  const outputPrefix = process.argv[3] ?? join(dirname(inputPath), "kenya-legacy-admin1-crosswalk-audit");
  const manifestPath = process.argv[4] ?? null;
  const [inputText, inputStat, manifestText] = await Promise.all([
    readFile(inputPath, "utf8"),
    stat(inputPath),
    manifestPath ? readFile(manifestPath, "utf8") : Promise.resolve(null),
  ]);
  const manifest = manifestText ? JSON.parse(manifestText) : null;
  const report = auditKenyaLegacyAdmin1Codes(inputText, manifest);
  report.source.filename = basename(inputPath);
  report.source.size_bytes = inputStat.size;
  report.source.local_mtime_utc = inputStat.mtime.toISOString();
  report.source.manifest_filename = manifestPath ? basename(manifestPath) : null;
  await Promise.all([
    writeFile(`${outputPrefix}.json`, JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(`${outputPrefix}.csv`, renderKenyaAuditCsv(report), "utf8"),
  ]);
  console.log(JSON.stringify({
    status: "READ_ONLY_KENYA_LEGACY_CROSSWALK_AUDIT_COMPLETE",
    crosswalk_rows: report.crosswalk_row_count,
    malformed_rows: report.malformed_rows,
    targets: report.targets.map((target) => ({
      geonames_id: target.geonames_id,
      expected_composite_key: target.expected_composite_key,
      status: target.status,
    })),
    remote_retrieval_metadata_verified: report.source.retrieval_metadata_verified,
    candidate_parent_ids_assigned: 0,
    operational_parent_links_created: 0,
    outputs: [`${outputPrefix}.csv`, `${outputPrefix}.json`],
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
