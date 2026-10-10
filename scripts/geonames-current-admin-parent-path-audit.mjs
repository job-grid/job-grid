#!/usr/bin/env node
/**
 * Read-only audit of current ADM1-ADM4 ancestor candidates in a pinned
 * GeoNames allCountries.txt file. Candidate IDs are evidence only: this tool
 * never writes parent relationships, database rows, migrations, or imports.
 *
 * Usage:
 *   node scripts/geonames-current-admin-parent-path-audit.mjs <allCountries.txt>
 *   node scripts/geonames-current-admin-parent-path-audit.mjs <allCountries.txt> <dispositions.csv> <output-prefix>
 *
 * GeoNames allCountries.txt schema:
 * geonameid, name, asciiname, alternatenames, latitude, longitude,
 * feature class, feature code, country code, cc2, admin1, admin2, admin3,
 * admin4, population, elevation, dem, timezone, modification date.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const DATA_DIR = new URL(
  "../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",
  import.meta.url,
);
const DEFAULT_TARGETS = fileURLToPath(new URL("owner-approved-dispositions.csv", DATA_DIR));
const CURRENT_ADMIN_DISPOSITION = "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED";
const CURRENT_ADMIN_CODE = /^ADM[1-4]$/;
const CODE_LEVELS = ["admin1_code", "admin2_code", "admin3_code", "admin4_code"];

export function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (char !== "\r" || quoted) {
      field += char;
    }
  }

  if (quoted) throw new Error("Invalid CSV: unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  if (records.length === 0) return [];
  const [headers, ...data] = records;
  if (new Set(headers).size !== headers.length) throw new Error("Invalid CSV: duplicate header.");
  return data
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function parseGeoNamesLine(line) {
  const fields = line.split("\t");
  if (fields.length < 19 || !fields[0]) {
    throw new Error("Invalid GeoNames allCountries row: expected 19 tab-separated fields.");
  }
  return {
    geonames_id: fields[0],
    name: fields[1],
    ascii_name: fields[2],
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

export function buildCurrentAdminTargets(dispositionRows) {
  const byId = new Map();
  for (const row of dispositionRows) {
    if (row.owner_approved_disposition !== CURRENT_ADMIN_DISPOSITION ||
        !CURRENT_ADMIN_CODE.test(row.feature_code)) continue;

    if (!row.geonames_id || !row.country_code) {
      throw new Error("Current administrative exception is missing ID or country.");
    }
    const existing = byId.get(row.geonames_id);
    if (existing) {
      const fields = ["country_code", "feature_code", "raw_admin1_code", "raw_admin2_code"];
      if (fields.some((field) => existing[field] !== row[field])) {
        throw new Error(`Conflicting current administrative exception for GeoNames ID ${row.geonames_id}`);
      }
      continue;
    }
    byId.set(row.geonames_id, { ...row });
  }
  return [...byId.values()].sort((a, b) => a.country_code.localeCompare(b.country_code) ||
    Number(a.geonames_id) - Number(b.geonames_id));
}

function usableCode(value) {
  // Preserve source values exactly. Owner-approved policy says raw "00" is unresolved.
  return typeof value === "string" && value.length > 0 && value !== "00";
}

function compositeKey(countryCode, codes) {
  if (!countryCode || codes.some((code) => !usableCode(code))) return null;
  return [countryCode, ...codes].join("\u0000");
}

function addIndex(index, key, record) {
  if (!key) return;
  const values = index.get(key) ?? [];
  values.push(record);
  index.set(key, values);
}

function collectIndexes(sourceRecords, targetIds) {
  const targetsById = new Map();
  const countryByCode = new Map();
  const adminByLevelAndKey = new Map();

  for (const record of sourceRecords) {
    if (targetIds.has(record.geonames_id)) {
      const matches = targetsById.get(record.geonames_id) ?? [];
      matches.push(record);
      targetsById.set(record.geonames_id, matches);
    }

    if (record.feature_class !== "A") continue;
    if (record.feature_code === "PCLI" && record.country_code) {
      addIndex(countryByCode, record.country_code, record);
    }
    const match = /^ADM([1-4])$/.exec(record.feature_code);
    if (!match) continue;
    const level = Number(match[1]);
    if (level > 3) continue; // Current ADM4 targets are leaves for this audit.
    const key = compositeKey(
      record.country_code,
      CODE_LEVELS.slice(0, level).map((field) => record[field]),
    );
    addIndex(adminByLevelAndKey, `ADM${level}\u0001${key ?? ""}`, record);
  }
  return { targetsById, countryByCode, adminByLevelAndKey };
}

function chooseUnique(index, key) {
  const matches = key ? (index.get(key) ?? []) : [];
  if (matches.length === 0) return { status: "MISSING", record: null };
  if (matches.length > 1) return { status: "AMBIGUOUS", record: null };
  return { status: "FOUND", record: matches[0] };
}

function csvValue(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

const OUTPUT_FIELDS = [
  "geonames_id",
  "name",
  "country_code",
  "feature_code",
  "source_record_present",
  "source_identity_match",
  "source_modification_date",
  "exception_raw_admin1_code",
  "source_raw_admin1_code",
  "exception_raw_admin2_code",
  "source_raw_admin2_code",
  "source_raw_admin3_code",
  "source_raw_admin4_code",
  "country_candidate_geonames_id",
  "candidate_adm1_geonames_id",
  "candidate_adm2_geonames_id",
  "candidate_adm3_geonames_id",
  "candidate_path_geonames_ids",
  "parent_path_audit_status",
  "blocking_reason",
  "operational_parent_link_created",
];

export function renderAuditCsv(rows) {
  return [OUTPUT_FIELDS.join(","), ...rows.map((row) =>
    OUTPUT_FIELDS.map((field) => csvValue(row[field])).join(","))].join("\n") + "\n";
}

export function auditCurrentAdminParents(targetRows, sourceRecords) {
  const targetIds = new Set(targetRows.map((row) => String(row.geonames_id)));
  const { targetsById, countryByCode, adminByLevelAndKey } =
    collectIndexes(sourceRecords, targetIds);

  return targetRows.map((target) => {
    const targetId = String(target.geonames_id);
    const identityRows = targetsById.get(targetId) ?? [];
    const row = {
      geonames_id: targetId,
      name: target.name ?? "",
      country_code: target.country_code,
      feature_code: target.feature_code,
      source_record_present: identityRows.length > 0,
      source_identity_match: false,
      source_modification_date: "",
      exception_raw_admin1_code: target.raw_admin1_code ?? "",
      source_raw_admin1_code: "",
      exception_raw_admin2_code: target.raw_admin2_code ?? "",
      source_raw_admin2_code: "",
      source_raw_admin3_code: "",
      source_raw_admin4_code: "",
      country_candidate_geonames_id: "",
      candidate_adm1_geonames_id: "",
      candidate_adm2_geonames_id: "",
      candidate_adm3_geonames_id: "",
      candidate_path_geonames_ids: "",
      parent_path_audit_status: "",
      blocking_reason: "",
      operational_parent_link_created: false,
    };

    const block = (status, reason) => {
      row.parent_path_audit_status = status;
      row.blocking_reason = reason;
      return row;
    };
    if (identityRows.length === 0) {
      return block("BLOCKED_TARGET_NOT_FOUND_IN_SOURCE", "Target GeoNames ID is absent from the supplied allCountries snapshot.");
    }
    if (identityRows.length > 1) {
      return block("BLOCKED_DUPLICATE_TARGET_ID_IN_SOURCE", "The same target ID occurs more than once in the supplied source.");
    }

    const source = identityRows[0];
    row.source_modification_date = source.modification_date ?? "";
    row.source_raw_admin1_code = source.admin1_code ?? "";
    row.source_raw_admin2_code = source.admin2_code ?? "";
    row.source_raw_admin3_code = source.admin3_code ?? "";
    row.source_raw_admin4_code = source.admin4_code ?? "";

    if (source.country_code !== target.country_code || source.feature_code !== target.feature_code) {
      return block("BLOCKED_SOURCE_IDENTITY_MISMATCH",
        `Expected ${target.country_code}/${target.feature_code}; source has ${source.country_code}/${source.feature_code}.`);
    }
    row.source_identity_match = true;

    if (row.source_raw_admin1_code !== row.exception_raw_admin1_code ||
        row.source_raw_admin2_code !== row.exception_raw_admin2_code) {
      return block("BLOCKED_SOURCE_RAW_CODE_MISMATCH",
        "Source raw admin1/admin2 codes differ from the previously audited exception export; verify snapshot/version before hierarchy work.");
    }

    const countryChoice = chooseUnique(countryByCode, target.country_code);
    if (countryChoice.status === "MISSING") {
      return block("BLOCKED_COUNTRY_RECORD_NOT_FOUND", "No unique matching PCLI country record was found in the supplied source snapshot.");
    }
    if (countryChoice.status === "AMBIGUOUS") {
      return block("BLOCKED_COUNTRY_RECORD_AMBIGUOUS", "Multiple PCLI records have this country code in the supplied source snapshot.");
    }
    row.country_candidate_geonames_id = countryChoice.record.geonames_id;

    const targetLevel = Number(target.feature_code.slice(-1));
    const candidatePath = [countryChoice.record.geonames_id];
    for (let level = 1; level < targetLevel; level += 1) {
      const codeFields = CODE_LEVELS.slice(0, level);
      const codes = codeFields.map((field) => source[field] ?? "");
      const missingIndex = codes.findIndex((code) => !usableCode(code));
      if (missingIndex >= 0) {
        const field = CODE_LEVELS[missingIndex];
        const rawCode = codes[missingIndex];
        const reason = rawCode === "00"
          ? `Raw ${field} is "00"; preserve it and do not normalize or synthesize an ancestor.`
          : `Raw ${field} is blank; the exact composite key for ADM${level} cannot be formed.`;
        return block("BLOCKED_PARENT_CODE_MISSING_OR_PLACEHOLDER", reason);
      }

      const key = compositeKey(target.country_code, codes);
      const selected = chooseUnique(adminByLevelAndKey, `ADM${level}\u0001${key}`);
      if (selected.status === "MISSING") {
        return block("BLOCKED_PARENT_KEY_NOT_FOUND",
          `No exact same-country ADM${level} source record matches the raw composite admin-code key.`);
      }
      if (selected.status === "AMBIGUOUS") {
        return block("BLOCKED_PARENT_KEY_AMBIGUOUS",
          `More than one same-country ADM${level} source record matches the raw composite admin-code key.`);
      }
      if (selected.record.geonames_id === targetId || candidatePath.includes(selected.record.geonames_id)) {
        return block("BLOCKED_PARENT_SELF_REFERENCE",
          `The exact-code ADM${level} candidate would repeat an ID already in the candidate path.`);
      }

      row[`candidate_adm${level}_geonames_id`] = selected.record.geonames_id;
      candidatePath.push(selected.record.geonames_id);
    }

    candidatePath.push(targetId);
    row.candidate_path_geonames_ids = candidatePath.join(">");
    row.parent_path_audit_status = "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL";
    row.blocking_reason = "Exact country/admin-code candidate path found in the supplied snapshot; this is audit evidence only, not approval to write parent links.";
    return row;
  });
}

export function buildAuditSummary(rows, sourceMetadata) {
  const counts = (items, key) => {
    const result = {};
    for (const item of items) result[item[key]] = (result[item[key]] ?? 0) + 1;
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
  };
  const complete = rows.filter((row) =>
    row.parent_path_audit_status === "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL");
  return {
    report_version: "1.0",
    audit_type: "READ_ONLY_EXACT_COMPOSITE_CODE_PARENT_PATH_CANDIDATES",
    created_at_utc: new Date().toISOString(),
    source: {
      ...sourceMetadata,
      remote_retrieval_metadata_verified: false,
      snapshot_version_authority: "UNVERIFIED_LOCAL_INPUT; SHA-256 AND FILE METADATA RECORDED FOR REPRODUCIBILITY",
    },
    target_count: rows.length,
    candidate_paths_found_requiring_owner_approval: complete.length,
    unresolved_or_blocked_targets: rows.length - complete.length,
    statuses: counts(rows, "parent_path_audit_status"),
    by_country: Object.fromEntries([...new Set(rows.map((row) => row.country_code))].sort().map((country) => [
      country,
      {
        count: rows.filter((row) => row.country_code === country).length,
        statuses: counts(rows.filter((row) => row.country_code === country), "parent_path_audit_status"),
      },
    ])),
    source_raw_codes_compared_to_exception_export: true,
    raw_codes_normalized: false,
    name_or_proximity_matching_used: false,
    candidate_parent_ids_are_audit_only: true,
    operational_parent_links_created: 0,
    database_or_production_changes: false,
    limitations: [
      "This report audits exact composite-code paths present in the supplied allCountries.txt only.",
      "It does not establish that the local source file is the latest official GeoNames snapshot; remote retrieval and HTTP metadata require separate verification.",
      "A candidate path is not owner approval and must never be imported as a parent relationship from this report alone.",
      "Raw code 00, blank codes, absent keys, duplicate keys, source identity mismatches, and source raw-code mismatches remain unresolved.",
    ],
  };
}

async function loadRelevantSourceRecords(sourcePath, targetRows) {
  const targetIds = new Set(targetRows.map((row) => String(row.geonames_id)));
  const stream = createReadStream(sourcePath);
  const hash = createHash("sha256");
  stream.on("data", (chunk) => hash.update(chunk));
  const input = createInterface({ input: stream, crlfDelay: Infinity });
  const relevant = [];
  let lineCount = 0;

  for await (const line of input) {
    if (!line) continue;
    lineCount += 1;
    const fields = line.split("\t");
    const geonamesId = fields[0];
    const isTarget = targetIds.has(geonamesId);
    const isUsefulAdmin = fields[6] === "A" &&
      (fields[7] === "PCLI" || /^ADM[1-3]$/.test(fields[7] ?? ""));
    if (!isTarget && !isUsefulAdmin) continue;
    relevant.push(parseGeoNamesLine(line));
  }

  return {
    records: relevant,
    lineCount,
    sha256: hash.digest("hex"),
  };
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error("Usage: node scripts/geonames-current-admin-parent-path-audit.mjs <allCountries.txt> [dispositions.csv] [output-prefix]");
    process.exitCode = 2;
    return;
  }

  const targetPath = process.argv[3] ?? DEFAULT_TARGETS;
  const outputPrefix = process.argv[4] ??
    join(dirname(targetPath), "current-admin-parent-path-audit");
  const [targetText, sourceStat] = await Promise.all([
    readFile(targetPath, "utf8"),
    stat(sourcePath),
  ]);
  const targets = buildCurrentAdminTargets(parseCsv(targetText));
  const loaded = await loadRelevantSourceRecords(sourcePath, targets);
  const rows = auditCurrentAdminParents(targets, loaded.records);
  const summary = buildAuditSummary(rows, {
    filename: basename(sourcePath),
    file_size_bytes: sourceStat.size,
    file_modified_at_utc: sourceStat.mtime.toISOString(),
    sha256: loaded.sha256,
    source_line_count: loaded.lineCount,
    relevant_records_loaded: loaded.records.length,
    target_export_filename: basename(targetPath),
  });

  await Promise.all([
    writeFile(`${outputPrefix}.csv`, renderAuditCsv(rows), "utf8"),
    writeFile(`${outputPrefix}.json`, JSON.stringify(summary, null, 2) + "\n", "utf8"),
  ]);
  console.log(JSON.stringify({
    status: "READ_ONLY_AUDIT_COMPLETE_NO_PARENT_LINKS_CREATED",
    targets: summary.target_count,
    candidate_paths_requiring_owner_approval: summary.candidate_paths_found_requiring_owner_approval,
    unresolved_or_blocked_targets: summary.unresolved_or_blocked_targets,
    statuses: summary.statuses,
    source_sha256: loaded.sha256,
    outputs: [`${outputPrefix}.csv`, `${outputPrefix}.json`],
    operational_parent_links_created: 0,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
