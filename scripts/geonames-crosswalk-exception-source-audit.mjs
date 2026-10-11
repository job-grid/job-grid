#!/usr/bin/env node
/**
 * Verify all unique unresolved GeoNames crosswalk-exception IDs against a
 * freshly retrieved official allCountries.txt source snapshot.
 *
 * Read-only: preserves source and exception exports, performs no parent
 * inference/linking, and never writes to a database.
 *
 * Usage:
 *   node scripts/geonames-crosswalk-exception-source-audit.mjs <allCountries.txt>
 *     [owner-approved-dispositions.csv] [output-prefix] [source-manifest.json]
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { parseCsv, parseGeoNamesLine } from "./geonames-current-admin-parent-path-audit.mjs";

const DATA_DIR = new URL(
  "../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",
  import.meta.url,
);
const DEFAULT_EXCEPTIONS = fileURLToPath(new URL("owner-approved-dispositions.csv", DATA_DIR));
const IDENTITY_FIELDS = ["name", "country_code", "feature_code"];
const RAW_CODE_FIELDS = [
  ["raw_admin1_code", "admin1_code"],
  ["raw_admin2_code", "admin2_code"],
];

export function buildUniqueExceptionTargets(exceptionRows) {
  const byId = new Map();
  for (const input of exceptionRows) {
    const id = String(input.geonames_id ?? "").trim();
    if (!id || !input.country_code || !input.feature_code) {
      throw new Error("Exception row is missing GeoNames ID, country, or feature code.");
    }
    const normalized = {
      geonames_id: id,
      name: input.name ?? "",
      country_code: input.country_code,
      feature_code: input.feature_code,
      raw_admin1_code: input.raw_admin1_code ?? "",
      raw_admin2_code: input.raw_admin2_code ?? "",
      reference_levels: new Set([input.reference_level ?? "unknown"]),
      reference_rows: 1,
    };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, normalized);
      continue;
    }
    const identityKeys = [
      "name", "country_code", "feature_code", "raw_admin1_code", "raw_admin2_code",
    ];
    const conflicts = identityKeys.filter((key) => existing[key] !== normalized[key]);
    if (conflicts.length > 0) {
      throw new Error(
        "Conflicting exception exports for GeoNames ID " + id + ": " + conflicts.join(", "),
      );
    }
    existing.reference_rows += 1;
    existing.reference_levels.add(input.reference_level ?? "unknown");
  }
  return [...byId.values()]
    .map((row) => ({ ...row, reference_levels: [...row.reference_levels].sort() }))
    .sort((a, b) => a.country_code.localeCompare(b.country_code) ||
      Number(a.geonames_id) - Number(b.geonames_id));
}

export function validateAllCountriesManifest(metadata) {
  const sources = metadata?.remote_sources;
  if (!Array.isArray(sources) || sources.length !== 1) return false;
  const source = sources[0];
  return source?.country_code === "WORLD" &&
    source?.archive_filename === "allCountries.zip" &&
    source?.source_url === "https://download.geonames.org/export/dump/allCountries.zip" &&
    Number(source?.http_status) === 200 &&
    Number.isFinite(Date.parse(source?.retrieved_at_utc ?? "")) &&
    /^[a-f0-9]{64}$/i.test(source?.archive_sha256 ?? "") &&
    Number.isSafeInteger(source?.archive_size_bytes) &&
    source.archive_size_bytes > 0 &&
    source?.zip_crc_validation === "PASS";
}

export function compareExceptionTarget(target, matches) {
  const base = {
    geonames_id: target.geonames_id,
    name: target.name,
    country_code: target.country_code,
    feature_code: target.feature_code,
    raw_admin1_code: target.raw_admin1_code,
    raw_admin2_code: target.raw_admin2_code,
    exception_reference_rows: target.reference_rows,
    exception_reference_levels: target.reference_levels.join(";"),
    source_record_count_for_id: matches.length,
    source_name: "",
    source_country_code: "",
    source_feature_code: "",
    source_admin1_code: "",
    source_admin2_code: "",
    source_admin3_code: "",
    source_admin4_code: "",
    mismatched_fields: "",
    source_match_status: "",
  };

  if (matches.length === 0) {
    return {
      ...base,
      source_match_status: "BLOCKED_SOURCE_ID_NOT_FOUND",
      mismatched_fields: "geonames_id",
    };
  }
  if (matches.length > 1) {
    return {
      ...base,
      source_match_status: "BLOCKED_DUPLICATE_SOURCE_ID",
      mismatched_fields: "geonames_id",
    };
  }

  const source = matches[0];
  base.source_name = source.name;
  base.source_country_code = source.country_code;
  base.source_feature_code = source.feature_code;
  base.source_admin1_code = source.admin1_code ?? "";
  base.source_admin2_code = source.admin2_code ?? "";
  base.source_admin3_code = source.admin3_code ?? "";
  base.source_admin4_code = source.admin4_code ?? "";

  const mismatches = [];
  for (const field of IDENTITY_FIELDS) {
    if ((target[field] ?? "") !== (source[field] ?? "")) mismatches.push(field);
  }
  for (const [inputField, sourceField] of RAW_CODE_FIELDS) {
    if ((target[inputField] ?? "") !== (source[sourceField] ?? "")) mismatches.push(inputField);
  }

  base.mismatched_fields = mismatches.join(";");
  base.source_match_status = mismatches.length === 0
    ? "SOURCE_IDENTITY_AND_RAW_CODES_MATCH"
    : (mismatches.some((field) => RAW_CODE_FIELDS.some(([inputField]) => inputField === field))
      ? "BLOCKED_SOURCE_RAW_CODE_OR_IDENTITY_MISMATCH"
      : "BLOCKED_SOURCE_IDENTITY_MISMATCH");
  return base;
}

const OUTPUT_FIELDS = [
  "geonames_id", "name", "country_code", "feature_code",
  "raw_admin1_code", "raw_admin2_code", "exception_reference_rows",
  "exception_reference_levels", "source_record_count_for_id",
  "source_name", "source_country_code", "source_feature_code",
  "source_admin1_code", "source_admin2_code", "source_admin3_code",
  "source_admin4_code", "mismatched_fields", "source_match_status",
];

function csvValue(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function renderExceptionSourceAuditCsv(rows) {
  return [OUTPUT_FIELDS.join(","), ...rows.map((row) =>
    OUTPUT_FIELDS.map((field) => csvValue(row[field])).join(","))].join("\n") + "\n";
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) counts[row[field]] = (counts[row[field]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildExceptionSourceAuditSummary(rows, metadata) {
  const matches = rows.filter((row) =>
    row.source_match_status === "SOURCE_IDENTITY_AND_RAW_CODES_MATCH").length;
  const statusCounts = countBy(rows, "source_match_status");
  const perCountry = {};
  for (const country of [...new Set(rows.map((row) => row.country_code))].sort()) {
    const countryRows = rows.filter((row) => row.country_code === country);
    perCountry[country] = {
      unique_ids: countryRows.length,
      status_counts: countBy(countryRows, "source_match_status"),
    };
  }
  return {
    report_version: "1.0",
    audit_type: "READ_ONLY_CROSSWALK_EXCEPTION_IDENTITY_VS_OFFICIAL_ALLCOUNTRIES",
    generated_at_utc: new Date().toISOString(),
    input: metadata,
    unique_exception_ids: rows.length,
    source_identity_and_raw_codes_match: matches,
    blocked_or_drifted_ids: rows.length - matches,
    status_counts: statusCounts,
    per_country: perCountry,
    raw_codes_normalized: false,
    parent_ids_or_links_assigned: 0,
    migrations_or_database_operations: false,
    production_changes: false,
    source_provenance_notes: [
      "The archive URL, retrieval timestamp, HTTP headers and hashes pin the bytes fetched during this run; they do not establish an immutable publisher release ID.",
      "A source match establishes ID/name/country/feature/raw-admin-code consistency only. It does not resolve a missing crosswalk key or approve parentage.",
      "A mismatch is emitted for owner review; the audit does not change exception classifications, discard rows, or create parent links.",
    ],
  };
}

async function auditSource(sourcePath, targets) {
  const targetIds = new Set(targets.map((row) => row.geonames_id));
  const stream = createReadStream(sourcePath);
  const hash = createHash("sha256");
  stream.on("data", (chunk) => hash.update(chunk));
  const input = createInterface({ input: stream, crlfDelay: Infinity });
  const sourceRowsById = new Map();
  const countryCodeCounts = new Map();
  const featureClassCounts = new Map();
  let sourceLineCount = 0;
  let sourceRowsWithValidFieldCountAndId = 0;
  let blankCountryCodeRows = 0;
  let nonstandardCountryCodeRows = 0;
  let malformedRows = 0;

  for await (const line of input) {
    if (!line) continue;
    sourceLineCount += 1;
    const fields = line.split("\t");
    if (fields.length !== 19 || !fields[0]) {
      malformedRows += 1;
      continue;
    }

    // This is a GeoNames source-footprint metric, not ISO validation or a
    // claim that every country code is selectable in Job Grid.
    sourceRowsWithValidFieldCountAndId += 1;
    const countryCode = String(fields[8] ?? "").trim();
    if (!countryCode) blankCountryCodeRows += 1;
    else if (!/^[A-Z]{2}$/.test(countryCode)) nonstandardCountryCodeRows += 1;
    const countryBucket = countryCode || "(blank)";
    countryCodeCounts.set(countryBucket, (countryCodeCounts.get(countryBucket) ?? 0) + 1);

    const featureClass = String(fields[6] ?? "").trim() || "(blank)";
    featureClassCounts.set(featureClass, (featureClassCounts.get(featureClass) ?? 0) + 1);

    if (!targetIds.has(fields[0])) continue;
    let record;
    try {
      record = parseGeoNamesLine(line);
    } catch {
      malformedRows += 1;
      continue;
    }
    const matches = sourceRowsById.get(record.geonames_id) ?? [];
    matches.push(record);
    sourceRowsById.set(record.geonames_id, matches);
  }

  const sortedCounts = (counts) => Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  const countryCodeCountsSorted = sortedCounts(countryCodeCounts);
  const featureClassCountsSorted = sortedCounts(featureClassCounts);
  const totalCounts = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0);
  const countryCodeBucketRecordTotal = totalCounts(countryCodeCountsSorted);
  const featureClassRecordTotal = totalCounts(featureClassCountsSorted);

  return {
    sourceRowsById,
    sourceLineCount,
    sourceRowsWithValidFieldCountAndId,
    countryCodeRecordCounts: countryCodeCountsSorted,
    countryCodeBucketRecordTotal,
    featureClassRecordCounts: featureClassCountsSorted,
    featureClassRecordTotal,
    aggregateTotalsMatchSourceRowCount:
      countryCodeBucketRecordTotal === sourceRowsWithValidFieldCountAndId &&
      featureClassRecordTotal === sourceRowsWithValidFieldCountAndId,
    blankCountryCodeRows,
    nonstandardCountryCodeRows,
    malformedRows,
    sha256: hash.digest("hex"),
  };
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error(
      "Usage: node scripts/geonames-crosswalk-exception-source-audit.mjs <allCountries.txt> [dispositions.csv] [output-prefix] [source-manifest.json]",
    );
    process.exitCode = 2;
    return;
  }
  const targetPath = process.argv[3] ?? DEFAULT_EXCEPTIONS;
  const outputPrefix = process.argv[4] ??
    join(dirname(targetPath), "allcountries-exception-source-audit");
  const manifestPath = process.argv[5] ?? null;

  const [targetText, sourceStat, manifestText] = await Promise.all([
    readFile(targetPath, "utf8"),
    stat(sourcePath),
    manifestPath ? readFile(manifestPath, "utf8") : Promise.resolve(null),
  ]);
  const exceptionRows = parseCsv(targetText);
  const targets = buildUniqueExceptionTargets(exceptionRows);
  const audit = await auditSource(sourcePath, targets);
  const rows = targets.map((target) =>
    compareExceptionTarget(target, audit.sourceRowsById.get(target.geonames_id) ?? []));
  const sourceManifest = manifestText ? JSON.parse(manifestText) : null;
  const remoteVerified = validateAllCountriesManifest(sourceManifest);
  const input = {
    source_filename: basename(sourcePath),
    source_file_size_bytes: sourceStat.size,
    source_file_modified_at_utc: sourceStat.mtime.toISOString(),
    source_text_sha256: audit.sha256,
    source_line_count: audit.sourceLineCount,
    malformed_or_wrong_shape_source_lines: audit.malformedRows,
    unique_target_records_loaded: [...audit.sourceRowsById.values()].flat().length,
    exception_export_filename: basename(targetPath),
    exception_export_sha256: createHash("sha256").update(targetText).digest("hex"),
    source_manifest_filename: manifestPath ? basename(manifestPath) : null,
    remote_sources: sourceManifest?.remote_sources ?? [],
    remote_retrieval_metadata_verified: remoteVerified,
    source_country_code_coverage: {
      scope: "GeoNames allCountries source snapshot only; not an ISO 3166 comparison or proof of Job Grid product coverage",
      rows_with_19_fields_and_nonempty_id: audit.sourceRowsWithValidFieldCountAndId,
      malformed_or_wrong_shape_source_lines: audit.malformedRows,
      distinct_raw_country_code_buckets: Object.keys(audit.countryCodeRecordCounts).length,
      country_code_bucket_record_total: audit.countryCodeBucketRecordTotal,
      country_code_record_counts: audit.countryCodeRecordCounts,
      feature_class_record_total: audit.featureClassRecordTotal,
      feature_class_record_counts: audit.featureClassRecordCounts,
      aggregate_totals_match_source_row_count: audit.aggregateTotalsMatchSourceRowCount,
      rows_with_blank_country_code: audit.blankCountryCodeRows,
      rows_with_nonstandard_country_code_format: audit.nonstandardCountryCodeRows,
    },
  };
  const summary = buildExceptionSourceAuditSummary(rows, input);

  await Promise.all([
    writeFile(`${outputPrefix}.csv`, renderExceptionSourceAuditCsv(rows), "utf8"),
    writeFile(`${outputPrefix}.json`, JSON.stringify(summary, null, 2) + "\n", "utf8"),
  ]);
  console.log(JSON.stringify({
    status: "READ_ONLY_EXCEPTION_SOURCE_AUDIT_COMPLETE_NO_PARENT_LINKS",
    unique_exception_ids: summary.unique_exception_ids,
    source_identity_and_raw_codes_match: summary.source_identity_and_raw_codes_match,
    blocked_or_drifted_ids: summary.blocked_or_drifted_ids,
    status_counts: summary.status_counts,
    source_text_sha256: audit.sha256,
    remote_retrieval_metadata_verified: remoteVerified,
    parent_ids_or_links_assigned: 0,
    outputs: [`${outputPrefix}.csv`, `${outputPrefix}.json`],
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
