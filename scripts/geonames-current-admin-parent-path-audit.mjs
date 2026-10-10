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
  "candidate_path_source",
  "hierarchy_direct_edge_count",
  "hierarchy_direct_edges",
  "hierarchy_path_candidate_geonames_ids",
  "hierarchy_path_audit_status",
  "hierarchy_path_blocking_reason",
  "parent_path_audit_status",
  "blocking_reason",
  "operational_parent_link_created",
];

export function validateRemoteSourceMetadata(metadata) {
  const sources = metadata?.remote_sources;
  if (!Array.isArray(sources) || sources.length !== 3) return false;
  const byCountry = new Map(sources.map((source) => [source.country_code, source]));
  const expected = {
    JP: { filename: "JP.zip", url: "https://download.geonames.org/export/dump/JP.zip" },
    KE: { filename: "KE.zip", url: "https://download.geonames.org/export/dump/KE.zip" },
    HIERARCHY: { filename: "hierarchy.zip", url: "https://download.geonames.org/export/dump/hierarchy.zip" },
  };
  if (byCountry.size !== Object.keys(expected).length || Object.keys(expected).some((code) => !byCountry.has(code))) return false;

  return Object.entries(expected).every(([countryCode, required]) => {
    const source = byCountry.get(countryCode);
    const timestamp = Date.parse(source?.retrieved_at_utc ?? "");
    return source?.archive_filename === required.filename &&
      source?.source_url === required.url &&
      Number(source?.http_status) === 200 &&
      Number.isFinite(timestamp) &&
      /^[a-f0-9]{64}$/i.test(source?.archive_sha256 ?? "") &&
      Number.isSafeInteger(source?.archive_size_bytes) &&
      source.archive_size_bytes > 0;
  });
}

export function renderAuditCsv(rows) {
  return [OUTPUT_FIELDS.join(","), ...rows.map((row) =>
    OUTPUT_FIELDS.map((field) => csvValue(row[field])).join(","))].join("\n") + "\n";
}

function auditCurrentAdminParentsByCodes(targetRows, sourceRecords) {
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
      candidate_path_source: "",
      hierarchy_direct_edge_count: 0,
      hierarchy_direct_edges: "[]",
      hierarchy_path_candidate_geonames_ids: "",
      hierarchy_path_audit_status: "HIERARCHY_SOURCE_NOT_SUPPLIED",
      hierarchy_path_blocking_reason: "No hierarchy.txt source was supplied to this code-key audit.",
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
    row.candidate_path_source = "COUNTRY_ADMIN_CODES";
    row.parent_path_audit_status = "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL";
    row.blocking_reason = "Exact country/admin-code candidate path found in the supplied snapshot; this is audit evidence only, not approval to write parent links.";
    return row;
  });
}

export function parseHierarchyLine(line) {
  if (!line.trim()) return null;
  const fields = line.split("\\t");
  if (fields.length !== 3 || fields.some((field) => field.length === 0)) {
    throw new Error("Invalid GeoNames hierarchy row: expected parentId, childId, type.");
  }
  return { parent_id: fields[0], child_id: fields[1], relation_type: fields[2] };
}

export async function loadHierarchyEdges(hierarchyPath, relevantChildIds) {
  const stream = createReadStream(hierarchyPath);
  const hash = createHash("sha256");
  stream.on("data", (chunk) => hash.update(chunk));
  const input = createInterface({ input: stream, crlfDelay: Infinity });
  const edges = [];
  let lineCount = 0;
  for await (const line of input) {
    if (!line) continue;
    lineCount += 1;
    const edge = parseHierarchyLine(line);
    if (edge && relevantChildIds.has(edge.child_id)) edges.push(edge);
  }
  return { edges, lineCount, sha256: hash.digest("hex") };
}

export function auditCurrentAdminParents(targetRows, sourceRecords, hierarchyEdges = null) {
  const rows = auditCurrentAdminParentsByCodes(targetRows, sourceRecords);
  if (!Array.isArray(hierarchyEdges)) return rows;

  const byChildId = new Map();
  for (const edge of hierarchyEdges) {
    const edges = byChildId.get(edge.child_id) ?? [];
    edges.push(edge);
    byChildId.set(edge.child_id, edges);
  }
  const recordsById = new Map();
  for (const record of sourceRecords) {
    const matches = recordsById.get(record.geonames_id) ?? [];
    matches.push(record);
    recordsById.set(record.geonames_id, matches);
  }

  for (const row of rows) {
    const direct = byChildId.get(row.geonames_id) ?? [];
    row.hierarchy_direct_edge_count = direct.length;
    row.hierarchy_direct_edges = JSON.stringify(direct.map((edge) => {
      const parents = recordsById.get(edge.parent_id) ?? [];
      const parent = parents.length === 1 ? parents[0] : null;
      return {
        parent_geonames_id: edge.parent_id,
        relationship_type: edge.relation_type,
        parent_record_found: parents.length === 1,
        parent_name: parent?.name ?? null,
        parent_country_code: parent?.country_code ?? null,
        parent_feature_code: parent?.feature_code ?? null,
      };
    }));

    const targetLevelMatch = /^ADM([1-4])$/.exec(row.feature_code);
    if (!targetLevelMatch || !row.source_identity_match) {
      row.hierarchy_path_audit_status = "BLOCKED_TARGET_NOT_SOURCE_VERIFIED";
      row.hierarchy_path_blocking_reason = "Hierarchy paths are evaluated only for source-verified current ADM1-ADM4 target records.";
      continue;
    }
    let cursorId = row.geonames_id;
    const reversePath = [cursorId];
    const seen = new Set(reversePath);
    let hierarchyStatus = "CANDIDATE_PATH_FOUND_FROM_EXPLICIT_HIERARCHY_REQUIRES_OWNER_APPROVAL";
    let reason = "A unique same-country ADM hierarchy edge was found at every expected parent level; candidate only, not approved for operational use.";

    for (let parentLevel = Number(targetLevelMatch[1]) - 1; parentLevel >= 0; parentLevel -= 1) {
      const edges = (byChildId.get(cursorId) ?? []).filter((edge) => edge.relation_type === "ADM");
      if (edges.length === 0) {
        hierarchyStatus = "BLOCKED_NO_DIRECT_ADM_HIERARCHY_EDGE";
        reason = "No direct type=ADM parent edge exists for the current child in the supplied hierarchy snapshot.";
        break;
      }
      if (edges.length > 1) {
        hierarchyStatus = "BLOCKED_AMBIGUOUS_ADM_HIERARCHY_PARENT";
        reason = "Multiple type=ADM parent edges exist for the same child; no parent was selected.";
        break;
      }
      const parentId = edges[0].parent_id;
      if (seen.has(parentId)) {
        hierarchyStatus = "BLOCKED_ADM_HIERARCHY_CYCLE";
        reason = "An ADM parent edge repeats an ID already in the candidate path.";
        break;
      }
      const parents = recordsById.get(parentId) ?? [];
      if (parents.length !== 1) {
        hierarchyStatus = parents.length === 0 ? "BLOCKED_ADM_PARENT_RECORD_NOT_IN_SOURCE" : "BLOCKED_AMBIGUOUS_ADM_PARENT_SOURCE_RECORD";
        reason = parents.length === 0
          ? "A hierarchy parent ID could not be resolved to an exact record in the fetched JP/KE country archives."
          : "A hierarchy parent ID matched multiple source records.";
        break;
      }
      const parent = parents[0];
      const expectedFeatureCode = parentLevel === 0 ? "PCLI" : "ADM" + parentLevel;
      if (parent.country_code !== row.country_code || parent.feature_code !== expectedFeatureCode) {
        hierarchyStatus = "BLOCKED_ADM_PARENT_COUNTRY_OR_LEVEL_MISMATCH";
        reason = "The hierarchy parent does not match the expected same-country feature level (" + expectedFeatureCode + ").";
        break;
      }
      reversePath.push(parentId);
      seen.add(parentId);
      cursorId = parentId;
    }

    row.hierarchy_path_audit_status = hierarchyStatus;
    row.hierarchy_path_blocking_reason = reason;
    if (hierarchyStatus === "CANDIDATE_PATH_FOUND_FROM_EXPLICIT_HIERARCHY_REQUIRES_OWNER_APPROVAL") {
      const path = [...reversePath].reverse().join(">");
      row.hierarchy_path_candidate_geonames_ids = path;
      const pathIds = path.split(">");
      const targetRecord = (recordsById.get(row.geonames_id) ?? [])[0];
      const codeFields = ["admin1_code", "admin2_code", "admin3_code"];
      let rawCodeMismatch = false;
      for (let level = 1; level < Number(targetLevelMatch[1]); level += 1) {
        const ancestor = (recordsById.get(pathIds[level]) ?? [])[0];
        if (!ancestor || (targetRecord?.[codeFields[level - 1]] ?? "") !== (ancestor[codeFields[level - 1]] ?? "")) {
          rawCodeMismatch = true;
          break;
        }
      }
      if (rawCodeMismatch) {
        row.hierarchy_path_audit_status = "BLOCKED_HIERARCHY_RAW_CODE_DISAGREEMENT";
        row.hierarchy_path_blocking_reason = "The explicit hierarchy path conflicts with the child record raw admin codes; keep unresolved pending source review.";
      } else if (row.parent_path_audit_status === "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL" &&
          row.candidate_path_geonames_ids !== path) {
        row.hierarchy_path_audit_status = "BLOCKED_CODE_HIERARCHY_PATH_DISAGREEMENT";
        row.hierarchy_path_blocking_reason = "Exact-code and explicit type=ADM hierarchy candidate paths disagree; manual source review required.";
        row.parent_path_audit_status = "BLOCKED_CODE_HIERARCHY_PATH_DISAGREEMENT";
        row.blocking_reason = row.hierarchy_path_blocking_reason;
      } else if (row.parent_path_audit_status !== "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL") {
        row.parent_path_audit_status = "CANDIDATE_PATH_FOUND_FROM_EXPLICIT_HIERARCHY_REQUIRES_OWNER_APPROVAL";
        row.candidate_path_geonames_ids = path;
        row.candidate_path_source = "GEONAMES_HIERARCHY_ZIP_TYPE_ADM";
        row.blocking_reason = reason;
      }
    }
  }
  return rows;
}


export function buildAuditSummary(rows, sourceMetadata) {
  const remoteVerified = sourceMetadata?.remote_retrieval_metadata_verified === true;
  const remoteSources = sourceMetadata?.remote_sources ?? [];
  const counts = (items, key) => {
    const result = {};
    for (const item of items) result[item[key]] = (result[item[key]] ?? 0) + 1;
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
  };
  const complete = rows.filter((row) =>
    row.parent_path_audit_status === "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL" ||
    row.parent_path_audit_status === "CANDIDATE_PATH_FOUND_FROM_EXPLICIT_HIERARCHY_REQUIRES_OWNER_APPROVAL");
  const hierarchyPathsFound = rows.filter((row) =>
    row.hierarchy_path_audit_status === "CANDIDATE_PATH_FOUND_FROM_EXPLICIT_HIERARCHY_REQUIRES_OWNER_APPROVAL").length;
  const directAdmEdgesForTargets = rows.filter((row) => {
    try { return JSON.parse(row.hierarchy_direct_edges).some((edge) => edge.relationship_type === "ADM"); }
    catch { return false; }
  }).length;
  return {
    report_version: "1.0",
    audit_type: "READ_ONLY_EXACT_COMPOSITE_CODE_PARENT_PATH_CANDIDATES",
    created_at_utc: new Date().toISOString(),
    source: {
      ...sourceMetadata,
      remote_retrieval_metadata_verified: remoteVerified,
      http_last_modified_captured: remoteVerified && remoteSources.every((item) => Boolean(item.http_last_modified_utc)),
      snapshot_version_authority: remoteVerified
        ? "OFFICIAL_GEONAMES_JP_AND_KE_COUNTRY_ARCHIVES_RETRIEVED_AND_HASHED; NO IMMUTABLE RELEASE ID CLAIMED"
        : "UNVERIFIED_LOCAL_INPUT; SHA-256 AND FILE METADATA RECORDED FOR REPRODUCIBILITY",
    },
    target_count: rows.length,
    candidate_paths_found_requiring_owner_approval: complete.length,
    explicit_hierarchy_paths_found_requiring_owner_approval: hierarchyPathsFound,
    targets_with_direct_adm_hierarchy_edges: directAdmEdgesForTargets,
    targets_with_any_direct_hierarchy_edges: rows.filter((row) => row.hierarchy_direct_edge_count > 0).length,
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
      "This report audits exact composite-code and supplied hierarchy edges present in the provided JP/KE source subset only; it does not establish worldwide completeness.",
      "A retrieval URL, timestamp and hash pin the downloaded bytes but do not establish an immutable publisher release ID.",
      "HTTP Last-Modified is reported as captured only when that response header was actually present.",
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
    console.error("Usage: node scripts/geonames-current-admin-parent-path-audit.mjs <source-subset.txt> [dispositions.csv] [output-prefix] [remote-source-manifest.json] [hierarchy.txt]");
    process.exitCode = 2;
    return;
  }

  const targetPath = process.argv[3] ?? DEFAULT_TARGETS;
  const outputPrefix = process.argv[4] ??
    join(dirname(targetPath), "current-admin-parent-path-audit");
  const metadataPath = process.argv[5] ?? null;
  const hierarchyPath = process.argv[6] ?? null;
  const [targetText, sourceStat, metadataText] = await Promise.all([
    readFile(targetPath, "utf8"),
    stat(sourcePath),
    metadataPath ? readFile(metadataPath, "utf8") : Promise.resolve(null),
  ]);
  const targets = buildCurrentAdminTargets(parseCsv(targetText));
  const loaded = await loadRelevantSourceRecords(sourcePath, targets);
  const hierarchyLoaded = hierarchyPath
    ? await loadHierarchyEdges(hierarchyPath, new Set(loaded.records.map((record) => record.geonames_id)))
    : null;
  const rows = auditCurrentAdminParents(targets, loaded.records, hierarchyLoaded?.edges ?? null);
  const remoteMetadata = metadataText ? JSON.parse(metadataText) : null;
  const remoteVerified = validateRemoteSourceMetadata(remoteMetadata);
  const summary = buildAuditSummary(rows, {
    filename: basename(sourcePath),
    file_size_bytes: sourceStat.size,
    file_modified_at_utc: sourceStat.mtime.toISOString(),
    sha256: loaded.sha256,
    source_line_count: loaded.lineCount,
    relevant_records_loaded: loaded.records.length,
    target_export_filename: basename(targetPath),
    source_manifest_filename: metadataPath ? basename(metadataPath) : null,
    hierarchy_text_filename: hierarchyPath ? basename(hierarchyPath) : null,
    hierarchy_text_line_count: hierarchyLoaded?.lineCount ?? null,
    hierarchy_text_sha256: hierarchyLoaded?.sha256 ?? null,
    hierarchy_edges_loaded_for_relevant_children: hierarchyLoaded?.edges.length ?? null,
    remote_sources: remoteMetadata?.remote_sources ?? [],
    remote_retrieval_metadata_verified: remoteVerified,
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
    remote_retrieval_metadata_verified: summary.source.remote_retrieval_metadata_verified,
    http_last_modified_captured: summary.source.http_last_modified_captured,
    outputs: [`${outputPrefix}.csv`, `${outputPrefix}.json`],
    operational_parent_links_created: 0,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
