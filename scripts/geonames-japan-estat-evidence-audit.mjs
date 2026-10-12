#!/usr/bin/env node
/**
 * Read-only candidate audit of Japanese GeoNames ADM4 records against Japan's
 * Statistical LOD standard-area-code history. Exact normalized English labels
 * discover candidates only; this tool never approves parentage or writes links.
 *
 * Usage:
 *   node scripts/geonames-japan-estat-evidence-audit.mjs <dispositions.csv> <JP.txt> <output-prefix> <geonames-source-manifest.json>
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv } from "./geonames-current-admin-parent-path-audit.mjs";

export const ESTAT_SPARQL_ENDPOINT = "https://data.e-stat.go.jp/lod/sparql/alldata/query";
export const ESTAT_CATALOG_URL = "https://data.e-stat.go.jp/lod/sac";
export const EXPECTED_JAPAN_TARGETS = 126;
export const CATALOG_PAGE_SIZE = 4000;
export const MAX_CATALOG_PAGES = 25;
export const DETAIL_QUERY_BATCH_SIZE = 50;

export function buildCatalogQuery(offset = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_CATALOG_PAGES * CATALOG_PAGE_SIZE) {
    throw new Error("Invalid Statistical LOD page offset.");
  }
  return `
PREFIX sacs: <http://data.e-stat.go.jp/lod/terms/sacs#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?period ?identifier ?labelEn ?labelJa
WHERE {
  ?period a sacs:StandardAreaCode ;
          dcterms:identifier ?identifier ;
          rdfs:label ?labelEn .
  FILTER(LANG(?labelEn) = "en")
  OPTIONAL {
    ?period rdfs:label ?labelJa .
    FILTER(LANG(?labelJa) = "ja")
  }
  FILTER(REGEX(STR(?identifier), "^(0[1-9]|[1-3][0-9]|4[0-7])[0-9]{3}$"))
}
ORDER BY STR(?identifier) ?period
LIMIT ${CATALOG_PAGE_SIZE}
OFFSET ${offset}
`.trim();
}

export function buildDetailsQuery(periodUris) {
  if (!Array.isArray(periodUris) || periodUris.length === 0) {
    throw new Error("At least one candidate URI is required for a details query.");
  }
  const safeUris = [...new Set(periodUris)].map((value) => {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "data.e-stat.go.jp" ||
        !url.pathname.startsWith("/lod/sac/") || url.search || url.hash) {
      throw new Error(`Rejected unexpected Statistical LOD URI: ${value}`);
    }
    return `<${url.href}>`;
  });
  if (safeUris.length > DETAIL_QUERY_BATCH_SIZE) {
    throw new Error(`Candidate details query exceeded the ${DETAIL_QUERY_BATCH_SIZE}-URI batch cap: ${safeUris.length}`);
  }
  return `
PREFIX sacs: <http://data.e-stat.go.jp/lod/terms/sacs#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT
  ?period ?labelJa ?issued ?valid ?parent ?parentIdentifier
  ?parentLabelEn ?parentLabelJa ?previous ?succeeding ?administrativeClass
WHERE {
  VALUES ?period { ${safeUris.join(" ")} }
  OPTIONAL { ?period rdfs:label ?labelJa . FILTER(LANG(?labelJa) = "ja") }
  OPTIONAL { ?period dcterms:issued ?issued }
  OPTIONAL { ?period dcterms:valid ?valid }
  OPTIONAL { ?period sacs:previousCode ?previous }
  OPTIONAL { ?period sacs:succeedingCode ?succeeding }
  OPTIONAL { ?period sacs:administrativeClass ?administrativeClass }
  OPTIONAL {
    ?period dcterms:isPartOf ?parent .
    OPTIONAL { ?parent dcterms:identifier ?parentIdentifier }
    OPTIONAL { ?parent rdfs:label ?parentLabelEn . FILTER(LANG(?parentLabelEn) = "en") }
    OPTIONAL { ?parent rdfs:label ?parentLabelJa . FILTER(LANG(?parentLabelJa) = "ja") }
  }
}
ORDER BY ?period ?issued ?parent
`.trim();
}

export const SPARQL_QUERY = buildCatalogQuery(0);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function bindingValue(binding, key) {
  // Statistical LOD's endpoint currently uppercases SELECT-variable keys in its JSON.
  // Match variable names case-insensitively while preserving the original values.
  const entry = Object.entries(binding ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return entry?.[1]?.value ?? "";
}

/** Accent-insensitive, punctuation-insensitive exact label key. No fuzzy matching. */
export function normalizeExactLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Canonical Unicode normalization only; no transliteration or fuzzy matching. */
export function normalizeJapaneseLabel(value) {
  return String(value ?? "").normalize("NFC").trim();
}

/** Script-only coverage heuristic; Han characters can be shared with Chinese, so this is not a language label. */
export function containsJapaneseOrHanScript(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(String(value ?? ""));
}

export function parseGeoNamesAlternateNames(value) {
  return String(value ?? "").split(",").filter((name) => name.length > 0);
}

export function selectJapanTargets(dispositionRows) {
  const rows = dispositionRows.filter((row) =>
    row.country_code === "JP" &&
    row.feature_code === "ADM4" &&
    row.raw_admin1_code === "00" &&
    row.owner_approved_disposition === "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED"
  );
  const byId = new Map();
  for (const row of rows) {
    if (!row.geonames_id || !row.name) {
      throw new Error("Japan target lacks a GeoNames ID or source name.");
    }
    const prior = byId.get(row.geonames_id);
    if (prior && (prior.name !== row.name ||
        prior.raw_admin1_code !== row.raw_admin1_code ||
        prior.raw_admin2_code !== row.raw_admin2_code ||
        prior.feature_code !== row.feature_code)) {
      throw new Error(`Conflicting rows for Japan GeoNames ID ${row.geonames_id}.`);
    }
    byId.set(row.geonames_id, row);
  }
  return [...byId.values()].sort((a, b) => Number(a.geonames_id) - Number(b.geonames_id));
}

export function parseGeoNamesSourceRow(line) {
  const fields = line.split("\t");
  if (fields.length !== 19 || !/^\d+$/.test(fields[0])) {
    throw new Error("Invalid Japan GeoNames row: expected exactly 19 tab-separated fields and a numeric ID.");
  }
  return {
    geonames_id: fields[0],
    name: fields[1],
    ascii_name: fields[2],
    alternate_names_raw: fields[3] ?? "",
    alternate_names: parseGeoNamesAlternateNames(fields[3] ?? ""),
    feature_class: fields[6],
    latitude: fields[4],
    longitude: fields[5],
    feature_code: fields[7],
    timezone: fields[17],
    country_code: fields[8],
    raw_admin1_code: fields[10],
    raw_admin2_code: fields[11],
    modification_date: fields[18],
  };
}

export function verifyTargetSourceRows(targets, sourceRows) {
  const wanted = new Set(targets.map((row) => row.geonames_id));
  const byId = new Map();
  for (const row of sourceRows) {
    if (!wanted.has(row.geonames_id)) continue;
    const list = byId.get(row.geonames_id) ?? [];
    list.push(row);
    byId.set(row.geonames_id, list);
  }

  const verified = [];
  const failures = [];
  for (const target of targets) {
    const matches = byId.get(target.geonames_id) ?? [];
    if (matches.length !== 1) {
      failures.push({ geonames_id: target.geonames_id, reason: matches.length === 0 ? "SOURCE_ID_MISSING" : "SOURCE_ID_DUPLICATE" });
      continue;
    }
    const source = matches[0];
    const fields = [
      ["name", target.name, source.name],
      ["country_code", target.country_code, source.country_code],
      ["feature_code", target.feature_code, source.feature_code],
      ["raw_admin1_code", target.raw_admin1_code, source.raw_admin1_code],
      ["raw_admin2_code", target.raw_admin2_code, source.raw_admin2_code],
    ];
    const mismatches = fields.filter(([, expected, actual]) => String(expected ?? "") !== String(actual ?? ""));
    if (mismatches.length) {
      failures.push({
        geonames_id: target.geonames_id,
        reason: "SOURCE_IDENTITY_OR_RAW_CODE_MISMATCH",
        mismatch_fields: mismatches.map(([field]) => field),
      });
      continue;
    }
    verified.push({
      ...target,
      source_modification_date: source.modification_date,
      source_ascii_name: source.ascii_name,
      source_alternate_names_raw: source.alternate_names_raw ?? "",
      source_alternate_names: source.alternate_names ?? [],
      source_feature_class: source.feature_class ?? "",
      source_latitude: source.latitude,
      source_longitude: source.longitude,
      source_timezone: source.timezone ?? "",
    });
  }
  if (failures.length) {
    const error = new Error(`GeoNames target source verification failed for ${failures.length} of ${targets.length} targets.`);
    error.failures = failures;
    throw error;
  }
  if (verified.length !== targets.length) {
    throw new Error(`Expected ${targets.length} exact source matches; got ${verified.length}.`);
  }
  return verified;
}

export function parseEstatBindings(bindings) {
  return bindings.map((binding) => ({
    period_uri: bindingValue(binding, "period"),
    area_code: bindingValue(binding, "identifier"),
    label_en: bindingValue(binding, "labelEn"),
    label_ja: bindingValue(binding, "labelJa"),
    effective_from: bindingValue(binding, "issued"),
    effective_until: bindingValue(binding, "valid"),
    parent_uri: bindingValue(binding, "parent"),
    parent_area_code: bindingValue(binding, "parentIdentifier"),
    parent_label_en: bindingValue(binding, "parentLabelEn"),
    parent_label_ja: bindingValue(binding, "parentLabelJa"),
    previous_period_uri: bindingValue(binding, "previous"),
    succeeding_period_uri: bindingValue(binding, "succeeding"),
    administrative_class_uri: bindingValue(binding, "administrativeClass"),
  }));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function buildAreaCodeHistory(sourceRows, areaCode, targetNameKey) {
  const rows = sourceRows.filter((row) => row.area_code === areaCode);
  const periodsByUri = new Map();
  for (const row of rows) {
    let period = periodsByUri.get(row.period_uri);
    if (!period) {
      period = {
        period_uri: row.period_uri,
        area_code: row.area_code,
        label_en: row.label_en,
        label_ja: row.label_ja ?? "",
        effective_from: row.effective_from ?? "",
        effective_until: row.effective_until ?? "",
        matches_target_name: normalizeExactLabel(row.label_en) === targetNameKey,
        parent_references: [],
        previous_period_uris: [],
        succeeding_period_uris: [],
        administrative_class_uris: [],
      };
      periodsByUri.set(row.period_uri, period);
    } else {
      period.matches_target_name ||= normalizeExactLabel(row.label_en) === targetNameKey;
      if (!period.label_ja && row.label_ja) period.label_ja = row.label_ja;
      if (!period.effective_from && row.effective_from) period.effective_from = row.effective_from;
      if (!period.effective_until && row.effective_until) period.effective_until = row.effective_until;
    }
    if (row.parent_uri || row.parent_area_code || row.parent_label_en || row.parent_label_ja) {
      const parent = {
        area_code: row.parent_area_code ?? "",
        uri: row.parent_uri ?? "",
        label_en: row.parent_label_en ?? "",
        label_ja: row.parent_label_ja ?? "",
      };
      const signature = JSON.stringify(parent);
      if (!period.parent_references.some((existing) => JSON.stringify(existing) === signature)) {
        period.parent_references.push(parent);
      }
    }
    for (const value of [row.previous_period_uri]) {
      if (value && !period.previous_period_uris.includes(value)) period.previous_period_uris.push(value);
    }
    for (const value of [row.succeeding_period_uri]) {
      if (value && !period.succeeding_period_uris.includes(value)) period.succeeding_period_uris.push(value);
    }
    for (const value of [row.administrative_class_uri]) {
      if (value && !period.administrative_class_uris.includes(value)) period.administrative_class_uris.push(value);
    }
  }
  const periods = [...periodsByUri.values()].sort((a, b) =>
    a.effective_from.localeCompare(b.effective_from) || a.period_uri.localeCompare(b.period_uri));
  for (const period of periods) {
    period.parent_references.sort((a, b) =>
      a.area_code.localeCompare(b.area_code) || a.uri.localeCompare(b.uri));
    period.previous_period_uris.sort();
    period.succeeding_period_uris.sort();
    period.administrative_class_uris.sort();
  }
  return periods;
}

function buildCrossTargetIdentityReview(targetResults) {
  const normalizedNameGroups = new Map();
  const candidateCodeGroups = new Map();
  for (const target of targetResults) {
    const ids = normalizedNameGroups.get(target.normalized_name_key) ?? [];
    ids.push(target);
    normalizedNameGroups.set(target.normalized_name_key, ids);
    for (const candidate of target.candidates) {
      const records = candidateCodeGroups.get(candidate.area_code) ?? [];
      records.push({
        geonames_id: target.geonames_id,
        geonames_name: target.geonames_name,
        normalized_name_key: target.normalized_name_key,
        source_latitude: target.source_latitude ?? "",
        source_longitude: target.source_longitude ?? "",
        source_feature_class: target.source_feature_class ?? "",
        raw_admin1_code: target.raw_admin1_code,
        raw_admin2_code: target.raw_admin2_code ?? "",
      });
      candidateCodeGroups.set(candidate.area_code, records);
    }
  }

  const repeatedNameGroups = [...normalizedNameGroups.entries()]
    .filter(([, targets]) => targets.length > 1)
    .map(([normalized_name_key, targets]) => {
      const candidateSets = targets.map((target) => new Set(target.candidates.map((candidate) => candidate.area_code)));
      const shared = candidateSets.length
        ? [...candidateSets[0]].filter((code) => candidateSets.every((set) => set.has(code))).sort()
        : [];
      return {
        normalized_name_key,
        geonames_ids: targets.map((target) => target.geonames_id).sort((a, b) => Number(a) - Number(b)),
        source_names: uniqueStrings(targets.map((target) => target.geonames_name)),
        source_coordinate_pairs: uniqueStrings(targets.map((target) =>
          target.source_latitude && target.source_longitude
            ? `${target.source_latitude},${target.source_longitude}`
            : "")),
        feature_classes: uniqueStrings(targets.map((target) => target.source_feature_class ?? "")),
        target_count: targets.length,
        shared_candidate_area_codes: shared,
        coordinate_collision: targets.some((target) => !target.source_latitude || !target.source_longitude)
          ? "COORDINATE_CONTEXT_INCOMPLETE"
          : new Set(targets.map((target) => `${target.source_latitude},${target.source_longitude}`)).size < targets.length
            ? "EXACT_COORDINATE_COLLISION_REQUIRES_SOURCE_REVIEW"
            : "DISTINCT_COORDINATES_REQUIRE_ENTITY_REVIEW",
        approval: "NO_ENTITY_CROSSWALK_APPROVED",
      };
    })
    .sort((a, b) => a.normalized_name_key.localeCompare(b.normalized_name_key));

  const sharedCodeGroups = [...candidateCodeGroups.entries()]
    .filter(([, records]) => new Set(records.map((row) => row.geonames_id)).size > 1)
    .map(([area_code, records]) => ({
      area_code,
      distinct_geonames_ids: uniqueStrings(records.map((row) => row.geonames_id)),
      records: records.sort((a, b) => Number(a.geonames_id) - Number(b.geonames_id)),
      approval: "NO_ENTITY_CROSSWALK_APPROVED",
    }))
    .sort((a, b) => a.area_code.localeCompare(b.area_code));

  return {
    repeated_normalized_name_groups: repeatedNameGroups,
    repeated_normalized_name_group_count: repeatedNameGroups.length,
    shared_candidate_area_code_groups: sharedCodeGroups,
    shared_candidate_area_code_group_count: sharedCodeGroups.length,
    note: "This is a collision-review aid only. Source coordinates, feature class, names, and identical area-code candidates are not sufficient by themselves to approve identity or administrative parentage.",
  };
}

export function buildCandidateAudit(targets, sourceRows, sourceSnapshotSha256) {
  if (!Array.isArray(targets) || targets.length !== EXPECTED_JAPAN_TARGETS) {
    throw new Error(`Expected ${EXPECTED_JAPAN_TARGETS} unique Japan ADM4 raw-admin1-00 targets; got ${targets?.length ?? 0}.`);
  }
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    throw new Error("Official e-Stat response contained no code-history rows.");
  }

  for (const sourceRow of sourceRows) {
    if (!sourceRow.period_uri || !sourceRow.area_code) {
      throw new Error(`e-Stat row missing period URI or standard area code: ${JSON.stringify({ period_uri: sourceRow.period_uri, area_code: sourceRow.area_code, label_en: sourceRow.label_en })}`);
    }
  }

  const targetResults = targets.map((target) => {
    const key = normalizeExactLabel(target.name);
    const matchingRows = sourceRows.filter((sourceRow) => normalizeExactLabel(sourceRow.label_en) === key);
    const matchingRowsByAreaCode = new Map();
    for (const row of matchingRows) {
      const bucket = matchingRowsByAreaCode.get(row.area_code) ?? [];
      bucket.push(row);
      matchingRowsByAreaCode.set(row.area_code, bucket);
    }

    const candidates = [...matchingRowsByAreaCode.entries()]
      .sort(([areaCodeA], [areaCodeB]) => areaCodeA.localeCompare(areaCodeB))
      .map(([areaCode, matchedRows]) => {
        const matchingPeriodUris = uniqueStrings(matchedRows.map((row) => row.period_uri));
        const periods = buildAreaCodeHistory(sourceRows, areaCode, key);
        const parentsAcrossHistory = [];
        for (const period of periods) {
          for (const parent of period.parent_references) {
            const signature = JSON.stringify(parent);
            if (!parentsAcrossHistory.some((existing) => JSON.stringify(existing) === signature)) {
              parentsAcrossHistory.push(parent);
            }
          }
        }
        parentsAcrossHistory.sort((a, b) =>
          a.area_code.localeCompare(b.area_code) || a.uri.localeCompare(b.uri));
        return {
          area_code: areaCode,
          matched_labels_en: uniqueStrings(matchedRows.map((row) => row.label_en)),
          exact_matching_period_count: matchingPeriodUris.length,
          exact_matching_period_uris: matchingPeriodUris,
          history_period_count: periods.length,
          parent_area_codes_across_history: uniqueStrings(parentsAcrossHistory.map((parent) => parent.area_code)),
          parent_references_across_history: parentsAcrossHistory,
          periods,
        };
      });

    const reviewStatus = candidates.length === 0
      ? "NO_EXACT_NORMALIZED_ENGLISH_LABEL_MATCH"
      : candidates.length === 1
        ? "ONE_AREA_CODE_CANDIDATE_REQUIRES_ENTITY_IDENTITY_AND_PERIOD_REVIEW"
        : "MULTIPLE_AREA_CODE_CANDIDATES_REQUIRE_DISAMBIGUATION";
    return {
      geonames_id: target.geonames_id,
      geonames_name: target.name,
      country_code: target.country_code,
      feature_code: target.feature_code,
      source_modification_date: target.source_modification_date ?? "",
      source_ascii_name: target.source_ascii_name ?? "",
      source_feature_class: target.source_feature_class ?? "",
      source_latitude: target.source_latitude ?? "",
      source_longitude: target.source_longitude ?? "",
      source_timezone: target.source_timezone ?? "",
      raw_admin1_code: target.raw_admin1_code,
      raw_admin2_code: target.raw_admin2_code ?? "",
      source_identity_and_raw_codes_verified: target.source_identity_and_raw_codes_verified === true,
      normalized_name_key: key,
      exact_name_candidate_count: candidates.length,
      exact_name_matched_period_count: candidates.reduce((sum, candidate) => sum + candidate.exact_matching_period_count, 0),
      review_status: reviewStatus,
      candidates,
      operational_parent_link_created: false,
    };
  });

  const countBy = (predicate) => targetResults.filter(predicate).length;
  return {
    report_version: 2,
    status: "PASS_SOURCE_RETRIEVED_TARGET_COVERAGE_COMPLETE; DISTINCT_AREA_CODE_CANDIDATES_REQUIRE_REVIEW; NO_PARENT_LINKS_APPROVED",
    target_count: targetResults.length,
    target_source_identity_and_raw_code_matches: targetResults.filter((row) => row.source_identity_and_raw_codes_verified).length,
    source_code_history_rows: sourceRows.length,
    targets_with_one_exact_area_code_candidate: countBy((row) => row.exact_name_candidate_count === 1),
    targets_with_multiple_exact_area_code_candidates: countBy((row) => row.exact_name_candidate_count > 1),
    targets_without_exact_label_candidates: countBy((row) => row.exact_name_candidate_count === 0),
    total_exact_name_matched_area_code_candidates: targetResults.reduce((total, row) => total + row.candidates.length, 0),
    total_exact_name_matched_period_rows: targetResults.reduce((total, row) => total + row.exact_name_matched_period_count, 0),
    candidates_with_official_parent_reference: targetResults.reduce(
      (total, row) => total + row.candidates.filter((candidate) => candidate.parent_references_across_history.length > 0).length, 0),
    matching_rule: "Targets match only on exact normalized English labels. Historical periods are grouped by distinct official 5-digit area code for candidate counting; full period history and parent references are retained. Neither a matching name nor an area code is a verified GeoNames entity crosswalk.",
    source_snapshot_sha256: sourceSnapshotSha256,
    target_results: targetResults,
    cross_target_identity_review: buildCrossTargetIdentityReview(targetResults),
    operational_parent_links_created: 0,
    limitations: [
      "An exact normalized label and distinct source area code are candidate-discovery evidence, not proof of GeoNames entity identity.",
      "Historical periods within each area code are grouped for candidate counts but preserved individually, including effective dates, parent references, predecessor/successor links, and administrative class.",
      "A source area code may match multiple GeoNames IDs with the same normalized name; no one-to-one entity crosswalk is inferred.",
      "An e-Stat parent reference is evidence for administrative hierarchy review, not an approved Job Grid GeoNames parent path.",
      "Targets without an exact label match remain unresolved; no fuzzy matching, raw-code normalization, or synthetic parent is used.",
      "This source covers statistical standard-area-code history, documented by e-Stat from April 1970 onward, and may not cover older or differently defined GeoNames features.",
      "No database, migration, seed, import, production, deployment, or PR merge is performed."
    ],
  };
}

export function validateJapaneseAlternateNamesV2Audit(audit, targets) {
  if (audit == null) return new Map();
  const source = audit.source ?? {};
  if (
    audit.status !== "PASS_SOURCE_PINNED_MULTILINGUAL_TARGET_ALIAS_EXTRACTION__CANDIDATES_ONLY__NO_PARENT_LINKS_APPROVED" ||
    audit.target_count !== EXPECTED_JAPAN_TARGETS || audit.operational_parent_links_created !== 0 ||
    audit.database_or_production_changes !== false ||
    source.source_url !== "https://download.geonames.org/export/dump/alternateNamesV2.zip" ||
    source.http_status !== 200 || source.zip_crc_validation !== "PASS" ||
    source.member_name !== "alternateNamesV2.txt" ||
    !/^[a-f0-9]{64}$/i.test(String(source.archive_sha256 ?? "")) ||
    !/^[a-f0-9]{64}$/i.test(String(source.source_manifest_sha256 ?? ""))
  ) throw new Error("Official GeoNames multilingual-name target-alias audit failed source/provenance validation.");
  const expectedById = new Map(targets.map((target) => [String(target.geonames_id), target]));
  const byId = new Map();
  for (const row of audit.target_results ?? []) {
    const id = String(row.geonames_id ?? "");
    const expected = expectedById.get(id);
    if (!expected || byId.has(id)) throw new Error("Unexpected or duplicate multilingual alias target ID: " + id);
    const identityFields = [
      [expected.name, row.name], ["JP", row.country_code], ["ADM4", row.feature_code], ["00", row.raw_admin1_code],
      [expected.raw_admin2_code ?? "", row.raw_admin2_code ?? ""],
      ["PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED", row.owner_approved_disposition],
    ];
    if (row.source_identity_scope_verified !== true ||
        identityFields.some(([expectedValue, actual]) => String(expectedValue ?? "") !== String(actual ?? "")) ||
        row.operational_parent_link_created !== false || !Array.isArray(row.aliases) ||
        Number(row.selected_japanese_alias_count) !== row.aliases.length) {
      throw new Error("Multilingual alias target identity/raw-code scope mismatch: " + id);
    }
    const aliasIds = new Set();
    for (const alias of row.aliases) {
      const language = String(alias.language_code ?? "");
      const name = String(alias.alternate_name ?? "");
      const languageIsJapanese = language.toLowerCase().split("-")[0] === "ja";
      const untaggedJapaneseScript = !language && containsJapaneseOrHanScript(name);
      if (String(alias.geonames_id ?? "") !== id || !/^\d+$/.test(String(alias.alternate_name_id ?? "")) ||
          !name.trim() || !(languageIsJapanese || untaggedJapaneseScript) ||
          !/^[a-f0-9]{64}$/i.test(String(alias.source_row_sha256 ?? "")) ||
          String(alias.source_archive_sha256 ?? "") !== String(source.archive_sha256) ||
          aliasIds.has(String(alias.alternate_name_id))) {
        throw new Error("Invalid or duplicate multilingual alias for Japan target " + id);
      }
      aliasIds.add(String(alias.alternate_name_id));
    }
    byId.set(id, row.aliases);
  }
  if (byId.size !== targets.length || [...expectedById.keys()].some((id) => !byId.has(id))) {
    throw new Error("Multilingual audit must preserve all target IDs, including targets without aliases.");
  }
  return byId;
}

export function buildJapaneseAlternateNameCandidateAudit(targets, englishCandidateAudit, sourceRows, alternateNamesV2Audit = null) {
  if (!Array.isArray(targets) || targets.length !== EXPECTED_JAPAN_TARGETS) {
    throw new Error(`Expected ${EXPECTED_JAPAN_TARGETS} source-verified Japanese targets; got ${targets?.length ?? 0}.`);
  }
  const aliasesByTarget = validateJapaneseAlternateNamesV2Audit(alternateNamesV2Audit, targets);
  const englishResults = new Map(
    (englishCandidateAudit?.target_results ?? []).map((row) => [String(row.geonames_id), row]),
  );
  if (englishResults.size !== EXPECTED_JAPAN_TARGETS) {
    throw new Error("English candidate report is incomplete; cannot define the Japanese-alternate review scope.");
  }
  const targetsWithoutUniqueEnglishCandidate = targets.filter((target) => {
    const english = englishResults.get(String(target.geonames_id));
    if (!english || english.source_identity_and_raw_codes_verified !== true ||
        target.source_identity_and_raw_codes_verified !== true) {
      throw new Error(`Unverified target in Japanese-alternate review: ${target.geonames_id}`);
    }
    const candidateCount = english.exact_name_candidate_count;
    if (!Number.isInteger(candidateCount) || candidateCount < 0) {
      throw new Error(`Invalid English candidate count for Japanese-alternate review: ${target.geonames_id}`);
    }
    const englishCodes = uniqueStrings((english.candidates ?? []).map((candidate) => String(candidate.area_code ?? "")));
    if (englishCodes.length !== candidateCount) {
      throw new Error(`English candidate count/code list disagrees for Japanese-alternate review: ${target.geonames_id}`);
    }
    return candidateCount !== 1;
  });
  const targetResults = targetsWithoutUniqueEnglishCandidate.map((target) => {
    const english = englishResults.get(String(target.geonames_id));
    const englishCandidateAreaCodes = uniqueStrings(
      (english.candidates ?? []).map((candidate) => String(candidate.area_code ?? "")),
    );
    const alternateNameV2Rows = aliasesByTarget.get(String(target.geonames_id)) ?? [];
    const aliasEvidence = [
      ...(target.source_alternate_names ?? []).map((alternateName) => ({
        source: "GeoNames JP.txt inline alternate_names", alternate_name: alternateName, alternate_name_id: "",
        language_code: "", valid_from: "", valid_to: "", is_historic: "",
      })),
      ...alternateNameV2Rows.map((row) => ({ ...row, source: "GeoNames alternateNamesV2.zip" })),
    ];
    const alternateNames = uniqueStrings(aliasEvidence.map((row) => normalizeJapaneseLabel(row.alternate_name)).filter(Boolean));
    const alternateSet = new Set(alternateNames);
    const matchedRows = sourceRows.filter((row) =>
      /^\d{5}$/.test(String(row.area_code ?? "")) &&
      alternateSet.has(normalizeJapaneseLabel(row.label_ja)));
    const rowsByCode = new Map();
    for (const row of matchedRows) {
      const bucket = rowsByCode.get(row.area_code) ?? [];
      bucket.push(row);
      rowsByCode.set(row.area_code, bucket);
    }
    const candidates = [...rowsByCode.entries()]
      .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
      .map(([areaCode, rows]) => {
        const matchingUris = uniqueStrings(rows.map((row) => row.period_uri));
        const matchingLabels = uniqueStrings(rows.map((row) => row.label_ja).filter(Boolean));
        const history = buildAreaCodeHistory(sourceRows, areaCode, "__no_exact_english_label_match__")
          .map((period) => ({
            ...period,
            matches_target_japanese_alternate_name: alternateSet.has(normalizeJapaneseLabel(period.label_ja)),
            matching_geo_names_alternate_names: alternateNames.filter(
              (name) => name === normalizeJapaneseLabel(period.label_ja),
            ),
          }));
        const parentReferences = [];
        for (const period of history) {
          for (const parent of period.parent_references) {
            const signature = JSON.stringify(parent);
            if (!parentReferences.some((existing) => JSON.stringify(existing) === signature)) {
              parentReferences.push(parent);
            }
          }
        }
        parentReferences.sort((a, b) => a.area_code.localeCompare(b.area_code) || a.uri.localeCompare(b.uri));
        const candidateAliasEvidence = aliasEvidence.filter((alias) =>
          matchingLabels.includes(normalizeJapaneseLabel(alias.alternate_name)));
        return {
          area_code: areaCode,
          matches_exact_english_candidate_area_code: englishCandidateAreaCodes.includes(areaCode),
          exact_matching_japanese_label_period_count: matchingUris.length,
          exact_matching_period_uris: matchingUris,
          matched_official_japanese_labels: matchingLabels,
          geo_names_alternate_names_matching_labels: matchingLabels,
          alias_source_kinds: uniqueStrings(candidateAliasEvidence.map((alias) => alias.source)),
          matching_multilingual_alias_ids: uniqueStrings(candidateAliasEvidence.map((alias) => String(alias.alternate_name_id ?? "")).filter(Boolean)),
          matching_multilingual_alias_languages: uniqueStrings(candidateAliasEvidence.map((alias) => String(alias.language_code ?? ""))),
          matching_multilingual_alias_validity_ranges: uniqueStrings(candidateAliasEvidence.map((alias) =>
            String(alias.valid_from ?? "") + ".." + String(alias.valid_to ?? ""))),
          multilingual_alias_evidence: candidateAliasEvidence,
          history_period_count: history.length,
          parent_area_codes_across_history: uniqueStrings(parentReferences.map((parent) => parent.area_code)),
          parent_references_across_history: parentReferences,
          periods: history,
        };
      });
    const status = candidates.length === 0
      ? "NO_EXACT_JAPANESE_ALTERNATE_LABEL_MATCH"
      : candidates.length === 1
        ? "ONE_JAPANESE_LABEL_CODE_CANDIDATE_REQUIRES_ENTITY_AND_PERIOD_REVIEW"
        : "MULTIPLE_JAPANESE_LABEL_CODE_CANDIDATES_REQUIRE_DISAMBIGUATION";
    return {
      geonames_id: String(target.geonames_id),
      geonames_name: target.name,
      source_country_code: target.country_code,
      source_feature_code: target.feature_code,
      raw_admin1_code: target.raw_admin1_code,
      raw_admin2_code: target.raw_admin2_code ?? "",
      source_identity_and_raw_codes_verified: true,
      english_exact_name_candidate_count: english.exact_name_candidate_count,
      english_candidate_area_codes: englishCandidateAreaCodes,
      japanese_candidate_area_codes_also_matching_english: uniqueStrings(
        candidates.filter((candidate) => candidate.matches_exact_english_candidate_area_code)
          .map((candidate) => candidate.area_code),
      ),
      source_alternate_names: uniqueStrings((target.source_alternate_names ?? []).map(normalizeJapaneseLabel).filter(Boolean)),
      alternate_name_v2_values: uniqueStrings(alternateNameV2Rows.map((row) => normalizeJapaneseLabel(row.alternate_name)).filter(Boolean)),
      alternate_name_v2_row_count: alternateNameV2Rows.length,
      alternate_name_count: alternateNames.length,
      alternate_name_tokens_with_japanese_or_han_script: alternateNames.filter(containsJapaneseOrHanScript).length,
      has_japanese_or_han_script_alternate_name: alternateNames.some(containsJapaneseOrHanScript),
      candidate_area_code_count: candidates.length,
      review_status: status,
      candidates,
      operational_parent_link_created: false,
    };
  });
  return {
    report_version: 1,
    status: "PASS_EXACT_JAPANESE_ALTERNATE_LABEL_DISCOVERY; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
    matching_rule: "Review all source-verified Japan targets with zero or multiple distinct exact-English area-code candidates. Only complete GeoNames JP.txt inline names or source-pinned alternateNamesV2.zip records that exactly equal an official e-Stat Japanese label after Unicode NFC normalization and outer trimming are candidate evidence. Each Japanese candidate is flagged when its area code also appears in the exact-English candidate set. No substring, transliteration, reading, fuzzy or proximity matching is used; no candidate approves identity or parentage.",
    target_count: targetResults.length,
    target_scope: "all source-verified Japan targets without exactly one English area-code candidate (zero or multiple); candidates only",
    english_targets_with_zero_exact_area_code_candidates: targetResults.filter((target) => target.english_exact_name_candidate_count === 0).length,
    english_targets_with_multiple_exact_area_code_candidates: targetResults.filter((target) => target.english_exact_name_candidate_count > 1).length,
    targets_with_japanese_candidate_intersecting_english_candidates: targetResults.filter(
      (target) => target.japanese_candidate_area_codes_also_matching_english.length > 0,
    ).length,
    targets_excluded_because_english_candidate_is_unique: EXPECTED_JAPAN_TARGETS - targetResults.length,
    targets_with_any_alternate_names: targetResults.filter((target) => target.alternate_name_count > 0).length,
    targets_with_japanese_or_han_script_alternate_names: targetResults.filter((target) => target.has_japanese_or_han_script_alternate_name).length,
    targets_with_script_alternate_names_but_no_exact_candidate: targetResults.filter((target) =>
      target.has_japanese_or_han_script_alternate_name && target.candidates.length === 0).length,
    alternate_name_tokens_total: targetResults.reduce((sum, target) => sum + target.alternate_name_count, 0),
    alternate_name_tokens_with_japanese_or_han_script: targetResults.reduce(
      (sum, target) => sum + target.alternate_name_tokens_with_japanese_or_han_script, 0),
    targets_with_japanese_alternate_label_candidates: targetResults.filter((target) => target.candidates.length > 0).length,
    targets_without_japanese_alternate_label_candidates: targetResults.filter((target) => target.candidates.length === 0).length,
    targets_with_one_distinct_area_code_candidate: targetResults.filter((target) => target.candidates.length === 1).length,
    targets_with_multiple_distinct_area_code_candidates: targetResults.filter((target) => target.candidates.length > 1).length,
    target_to_area_code_candidate_associations: targetResults.reduce((sum, target) => sum + target.candidates.length, 0),
    distinct_candidate_area_codes: new Set(targetResults.flatMap((target) => target.candidates.map((candidate) => candidate.area_code))).size,
    operational_parent_links_created: 0,
    target_results: targetResults,
  };
}

export function renderJapaneseAlternateNameCandidateCsv(report, sourceSnapshotSha256 = "") {
  const headers = [
    "geonames_id", "geonames_name", "source_country_code", "source_feature_code",
    "raw_admin1_code", "raw_admin2_code", "source_identity_and_raw_codes_verified",
    "english_exact_name_candidate_count", "english_candidate_area_codes",
    "japanese_candidate_area_codes_also_matching_english",
    "source_alternate_names", "alternate_name_v2_values", "alternate_name_v2_row_count", "alternate_name_count",
    "alternate_name_tokens_with_japanese_or_han_script", "has_japanese_or_han_script_alternate_name",
    "candidate_area_code_count", "review_status", "candidate_area_code",
    "candidate_matches_exact_english_candidate_area_code", "exact_matching_japanese_label_period_count",
    "candidate_history_period_count", "matched_official_japanese_labels", "candidate_alias_source_kinds",
    "matching_multilingual_alias_ids", "matching_multilingual_alias_languages", "matching_multilingual_alias_validity_ranges",
    "matching_period_uris", "matching_period_date_ranges", "history_parent_area_codes",
    "history_parent_labels_en", "history_parent_labels_ja", "source_snapshot_sha256",
    "operational_parent_link_created",
  ];
  const csvCell = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(",")];
  for (const target of report.target_results) {
    const candidates = target.candidates.length ? target.candidates : [null];
    for (const candidate of candidates) {
      const matchedPeriods = (candidate?.periods ?? []).filter((period) =>
        period.matches_target_japanese_alternate_name === true);
      const historyPeriods = candidate?.periods ?? [];
      const row = {
        ...target,
        source_alternate_names: target.source_alternate_names.join(";"),
        alternate_name_v2_values: target.alternate_name_v2_values.join(";"),
        english_candidate_area_codes: target.english_candidate_area_codes.join(";"),
        japanese_candidate_area_codes_also_matching_english:
          target.japanese_candidate_area_codes_also_matching_english.join(";"),
        candidate_alias_source_kinds: (candidate?.alias_source_kinds ?? []).join(";"),
        matching_multilingual_alias_ids: (candidate?.matching_multilingual_alias_ids ?? []).join(";"),
        matching_multilingual_alias_languages: (candidate?.matching_multilingual_alias_languages ?? []).join(";"),
        matching_multilingual_alias_validity_ranges: (candidate?.matching_multilingual_alias_validity_ranges ?? []).join(";"),
        candidate_area_code: candidate?.area_code ?? "",
        candidate_matches_exact_english_candidate_area_code:
          candidate ? String(candidate.matches_exact_english_candidate_area_code === true) : "",
        exact_matching_japanese_label_period_count: candidate?.exact_matching_japanese_label_period_count ?? "",
        candidate_history_period_count: candidate?.history_period_count ?? "",
        matched_official_japanese_labels: (candidate?.matched_official_japanese_labels ?? []).join(";"),
        matching_period_uris: (candidate?.exact_matching_period_uris ?? []).join(";"),
        matching_period_date_ranges: matchedPeriods.map((period) =>
          `${period.effective_from || ""}..${period.effective_until || ""}`).join(";"),
        history_parent_area_codes: uniqueStrings(historyPeriods.flatMap((period) =>
          period.parent_references.map((parent) => parent.area_code))).join(";"),
        history_parent_labels_en: uniqueStrings(historyPeriods.flatMap((period) =>
          period.parent_references.map((parent) => parent.label_en))).join(";"),
        history_parent_labels_ja: uniqueStrings(historyPeriods.flatMap((period) =>
          period.parent_references.map((parent) => parent.label_ja))).join(";"),
        source_snapshot_sha256: sourceSnapshotSha256,
        operational_parent_link_created: false,
      };
      lines.push(headers.map((header) => csvCell(row[header])).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

export function renderCandidateCsv(report) {
  const headers = [
    "geonames_id", "geonames_name", "country_code", "feature_code", "raw_admin1_code",
    "raw_admin2_code", "source_modification_date", "source_ascii_name", "source_feature_class",
    "source_latitude", "source_longitude", "source_timezone", "source_identity_and_raw_codes_verified",
    "normalized_name_key", "exact_name_candidate_count", "exact_name_matched_period_count", "review_status",
    "candidate_area_code", "candidate_exact_matching_period_count", "candidate_history_period_count",
    "candidate_period_uri", "candidate_period_label_en", "candidate_period_label_ja",
    "candidate_period_effective_from", "candidate_period_effective_until", "candidate_period_matches_target_name",
    "candidate_period_parent_area_codes", "candidate_period_parent_uris", "candidate_period_parent_labels_en",
    "candidate_period_parent_labels_ja", "candidate_period_previous_uris", "candidate_period_succeeding_uris",
    "candidate_period_administrative_class_uris", "source_snapshot_sha256", "operational_parent_link_created",
  ];
  const csvCell = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const joinValues = (values) => uniqueStrings(values).join(";");
  const lines = [headers.join(",")];
  for (const target of report.target_results) {
    const candidates = target.candidates.length ? target.candidates : [null];
    for (const candidate of candidates) {
      const periods = candidate?.periods?.length ? candidate.periods : [null];
      for (const period of periods) {
        const parents = period?.parent_references ?? [];
        const row = {
          geonames_id: target.geonames_id,
          geonames_name: target.geonames_name,
          country_code: target.country_code,
          feature_code: target.feature_code,
          raw_admin1_code: target.raw_admin1_code,
          raw_admin2_code: target.raw_admin2_code,
          source_modification_date: target.source_modification_date,
          source_ascii_name: target.source_ascii_name,
          source_feature_class: target.source_feature_class,
          source_latitude: target.source_latitude,
          source_longitude: target.source_longitude,
          source_timezone: target.source_timezone,
          source_identity_and_raw_codes_verified: target.source_identity_and_raw_codes_verified,
          normalized_name_key: target.normalized_name_key,
          exact_name_candidate_count: target.exact_name_candidate_count,
          exact_name_matched_period_count: target.exact_name_matched_period_count,
          review_status: target.review_status,
          candidate_area_code: candidate?.area_code,
          candidate_exact_matching_period_count: candidate?.exact_matching_period_count,
          candidate_history_period_count: candidate?.history_period_count,
          candidate_period_uri: period?.period_uri,
          candidate_period_label_en: period?.label_en,
          candidate_period_label_ja: period?.label_ja,
          candidate_period_effective_from: period?.effective_from,
          candidate_period_effective_until: period?.effective_until,
          candidate_period_matches_target_name: period?.matches_target_name,
          candidate_period_parent_area_codes: joinValues(parents.map((parent) => parent.area_code)),
          candidate_period_parent_uris: joinValues(parents.map((parent) => parent.uri)),
          candidate_period_parent_labels_en: joinValues(parents.map((parent) => parent.label_en)),
          candidate_period_parent_labels_ja: joinValues(parents.map((parent) => parent.label_ja)),
          candidate_period_previous_uris: joinValues(period?.previous_period_uris ?? []),
          candidate_period_succeeding_uris: joinValues(period?.succeeding_period_uris ?? []),
          candidate_period_administrative_class_uris: joinValues(period?.administrative_class_uris ?? []),
          source_snapshot_sha256: report.source_snapshot_sha256,
          operational_parent_link_created: false,
        };
        lines.push(headers.map((header) => csvCell(row[header])).join(","));
      }
    }
  }
  return lines.join("\n") + "\n";
}

export async function requestEstatQuery(query, fetchImpl, now, { allowEmpty = false } = {}) {
  const form = new URLSearchParams({ query });
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(ESTAT_SPARQL_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "Job-Grid-Geography-Evidence-Audit/1.0",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(60000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = bytes.toString("utf8");
      if (!response.ok) throw new Error(`e-Stat SPARQL HTTP ${response.status}: ${text.slice(0, 200)}`);
      const parsed = JSON.parse(text);
      const bindings = parsed?.results?.bindings;
      if (!Array.isArray(bindings) || (!allowEmpty && bindings.length === 0)) {
        throw new Error("e-Stat SPARQL response lacks expected results.bindings.");
      }
      return {
        parsed,
        bindings,
        text,
        manifest: {
          endpoint_url: ESTAT_SPARQL_ENDPOINT,
          query_sha256: sha256(query),
          captured_at_utc: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
          http_status: response.status,
          http_date_header: response.headers.get("date"),
          http_last_modified_header: response.headers.get("last-modified"),
          etag: response.headers.get("etag"),
          response_content_type: response.headers.get("content-type"),
          response_bytes: bytes.byteLength,
          response_sha256: sha256(bytes),
          result_row_count: bindings.length,
        },
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      const retryable = /HTTP 429|HTTP 5\\d\\d|fetch failed|timed out|timeout/i.test(message);
      if (attempt === 2 || !retryable) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
  }
  throw lastError ?? new Error("e-Stat source retrieval failed.");
}

/**
 * Page the exact official code-list over SPARQL because the public endpoint
 * truncates large results. Enrich only exact-label candidates with hierarchy
 * and historical properties; do not assume a returned label proves identity.
 */
export async function fetchEstatSnapshot(
  targetNames,
  fetchImpl = fetch,
  now = () => new Date(),
  targetJapaneseAlternateNameRecords = [],
) {
  const targetKeys = new Set(targetNames.map(normalizeExactLabel).filter(Boolean));
  const catalogPages = [];
  const catalogRows = [];
  for (let pageNumber = 0; pageNumber < MAX_CATALOG_PAGES; pageNumber += 1) {
    const offset = pageNumber * CATALOG_PAGE_SIZE;
    const page = await requestEstatQuery(buildCatalogQuery(offset), fetchImpl, now, { allowEmpty: offset > 0 });
    const pageRows = parseEstatBindings(page.bindings);
    if (pageRows.some((row) => !row.period_uri || !row.area_code || !row.label_en)) {
      const sample = page.bindings.find((binding) =>
        !bindingValue(binding, "period") || !bindingValue(binding, "identifier") || !bindingValue(binding, "labelEn"));
      throw new Error(`e-Stat catalog page contained unbound required variables: ${JSON.stringify({ offset, keys: Object.keys(sample ?? {}), sample })}`);
    }
    if (pageRows.length > CATALOG_PAGE_SIZE) {
      throw new Error(`e-Stat page ${pageNumber} exceeded page-size cap.`);
    }
    catalogPages.push({
      offset,
      row_count: pageRows.length,
      manifest: page.manifest,
      response: page.parsed,
      response_text: page.text,
    });
    catalogRows.push(...pageRows);
    if (pageRows.length < CATALOG_PAGE_SIZE) break;
    if (pageNumber === MAX_CATALOG_PAGES - 1) {
      throw new Error(`e-Stat catalog reached the ${MAX_CATALOG_PAGES}-page safety cap; additional pagination is required.`);
    }
  }
  if (catalogRows.length === 0) throw new Error("e-Stat catalog returned zero standard-area-code rows.");

  const initiallyMatchedRows = catalogRows.filter((row) => targetKeys.has(normalizeExactLabel(row.label_en)));
  const englishMatchedTargetKeys = new Set(
    initiallyMatchedRows.map((row) => normalizeExactLabel(row.label_en)),
  );
  const unmatchedTargetKeys = new Set(
    [...targetKeys].filter((key) => !englishMatchedTargetKeys.has(key)),
  );
  const englishCodesByTargetKey = new Map();
  for (const row of initiallyMatchedRows) {
    const key = normalizeExactLabel(row.label_en);
    const codes = englishCodesByTargetKey.get(key) ?? new Set();
    codes.add(row.area_code);
    englishCodesByTargetKey.set(key, codes);
  }
  const alternateJapaneseKeys = new Set(
    targetJapaneseAlternateNameRecords
      .filter((record) => {
        const key = normalizeExactLabel(record.target_name);
        const codeCount = englishCodesByTargetKey.get(key)?.size ?? 0;
        return codeCount !== 1;
      })
      .flatMap((record) => record.alternate_names ?? [])
      .map(normalizeJapaneseLabel)
      .filter(Boolean),
  );
  const japaneseAlternateMatchedRows = catalogRows.filter((row) =>
    alternateJapaneseKeys.has(normalizeJapaneseLabel(row.label_ja)));
  const englishCandidateAreaCodes = new Set(initiallyMatchedRows.map((row) => row.area_code));
  const japaneseAlternateCandidateAreaCodes = new Set(japaneseAlternateMatchedRows.map((row) => row.area_code));
  const candidateAreaCodes = new Set([...englishCandidateAreaCodes, ...japaneseAlternateCandidateAreaCodes]);
  // Once an area code matches a target label, retrieve every period for that code
  // so the review report captures changes in name, dates, and parent over time.
  const candidateUris = [...new Set(catalogRows
    .filter((row) => candidateAreaCodes.has(row.area_code))
    .map((row) => row.period_uri))].sort();
  const detailBatches = [];
  const detailRows = [];
  for (let offset = 0; offset < candidateUris.length; offset += DETAIL_QUERY_BATCH_SIZE) {
    const uris = candidateUris.slice(offset, offset + DETAIL_QUERY_BATCH_SIZE);
    const query = buildDetailsQuery(uris);
    const result = await requestEstatQuery(query, fetchImpl, now);
    const rows = parseEstatBindings(result.bindings);
    if (rows.some((row) => !row.period_uri)) {
      throw new Error(`e-Stat candidate-detail batch at offset ${offset} omitted a bound period URI.`);
    }
    detailBatches.push({
      target_offset: offset,
      requested_period_count: uris.length,
      query,
      manifest: result.manifest,
      response: result.parsed,
      response_text: result.text,
    });
    detailRows.push(...rows);
  }
  const detailsByUri = new Map();
  for (const row of detailRows) {
    const items = detailsByUri.get(row.period_uri) ?? [];
    items.push(row);
    detailsByUri.set(row.period_uri, items);
  }
  const sourceRows = [];
  for (const row of catalogRows) {
    const details = detailsByUri.get(row.period_uri) ?? [null];
    for (const detail of details) {
      sourceRows.push({
        ...row,
        label_ja: detail?.label_ja || row.label_ja || "",
        effective_from: detail?.effective_from ?? "",
        effective_until: detail?.effective_until ?? "",
        parent_uri: detail?.parent_uri ?? "",
        parent_area_code: detail?.parent_area_code ?? "",
        parent_label_en: detail?.parent_label_en ?? "",
        parent_label_ja: detail?.parent_label_ja ?? "",
        previous_period_uri: detail?.previous_period_uri ?? "",
        succeeding_period_uri: detail?.succeeding_period_uri ?? "",
        administrative_class_uri: detail?.administrative_class_uri ?? "",
      });
    }
  }

  const pageManifests = catalogPages.map((page) => ({
    offset: page.offset,
    row_count: page.row_count,
    ...page.manifest,
  }));
  const detailBatchManifests = detailBatches.map((batch) => ({
    target_offset: batch.target_offset,
    requested_period_count: batch.requested_period_count,
    ...batch.manifest,
  }));
  const combinedSourceHash = sha256([
    ...pageManifests.map((page) => `${page.offset}:${page.response_sha256}`),
    ...detailBatchManifests.map((batch) => `${batch.target_offset}:${batch.response_sha256}`),
    ...(detailBatchManifests.length === 0 ? ["NO_CANDIDATE_DETAIL_QUERY"] : []),
  ].join("\n"));
  const totalBytes = pageManifests.reduce((sum, page) => sum + page.response_bytes, 0) +
    detailBatchManifests.reduce((sum, batch) => sum + batch.response_bytes, 0);
  const manifest = {
    source_name: "Japan Statistical LOD — Standard Area Code List",
    catalog_url: ESTAT_CATALOG_URL,
    endpoint_url: ESTAT_SPARQL_ENDPOINT,
    captured_at_utc: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
    http_status: 200,
    catalog_query_sha256: sha256(SPARQL_QUERY),
    catalog_page_size: CATALOG_PAGE_SIZE,
    catalog_page_count: pageManifests.length,
    catalog_result_row_count: catalogRows.length,
    catalog_pages: pageManifests,
    candidate_detail_batch_count: detailBatchManifests.length,
    candidate_detail_batches: detailBatchManifests,
    candidate_detail_result_rows: detailRows.length,
    response_bytes: totalBytes,
    response_sha256: combinedSourceHash,
    source_snapshot_sha256: combinedSourceHash,
    result_row_count: catalogRows.length,
    result_cap_per_page: CATALOG_PAGE_SIZE,
    candidate_area_code_count: englishCandidateAreaCodes.size,
    candidate_area_code_count_including_japanese_alternate_names: candidateAreaCodes.size,
    japanese_alternate_name_candidate_area_code_count: japaneseAlternateCandidateAreaCodes.size,
    candidate_history_period_uris_requested: candidateUris.length,
    license_note: "The official Statistical LOD SPARQL API page states that site content is licensed CC BY 4.0 except where otherwise noted; confirm applicable dataset terms before redistribution.",
    source_scope_note: "e-Stat documents standard-area-code and related municipality abolishment, absorption, name-change and hierarchy data from April 1970 onward. This is a candidate evidence source, not a GeoNames crosswalk.",
  };
  const responsePayload = {
    catalog_pages: catalogPages.map(({ offset, row_count, manifest: pageManifest, response }) => ({
      offset, row_count, source: pageManifest, response,
    })),
    candidate_details: detailBatches.map(({ target_offset, requested_period_count, manifest: detailManifest, response }) => ({
      target_offset,
      requested_period_count,
      source: detailManifest,
      response,
    })),
  };
  return {
    sourceRows,
    responseText: JSON.stringify(responsePayload, null, 2) + "\n",
    manifest,
  };
}

export async function runAudit({ targetsPath, geoNamesPath, outputPrefix, geoNamesManifestPath, alternateNamesV2AuditPath = null, fetchImpl = fetch, now = () => new Date() }) {
  const targetBytes = await readFile(targetsPath);
  const targetsRaw = selectJapanTargets(parseCsv(targetBytes.toString("utf8")));
  if (targetsRaw.length !== EXPECTED_JAPAN_TARGETS) {
    throw new Error(`Expected ${EXPECTED_JAPAN_TARGETS} unique Japan ADM4 raw-admin1-00 targets; got ${targetsRaw.length}.`);
  }

  const geoBytes = await readFile(geoNamesPath);
  const geoText = geoBytes.toString("utf8");
  const geoLines = geoText.split(/\r?\n/).filter((line) => line.length > 0);
  const targetIds = new Set(targetsRaw.map((row) => row.geonames_id));
  const geoTargets = [];
  let malformedRows = 0;
  for (const line of geoLines) {
    const fields = line.split("\t");
    if (fields.length !== 19 || !/^\d+$/.test(fields[0] ?? "")) {
      malformedRows += 1;
      continue;
    }
    if (targetIds.has(fields[0])) {
      geoTargets.push(parseGeoNamesSourceRow(line));
    }
  }
  if (malformedRows !== 0) throw new Error(`Official JP.txt contains ${malformedRows} malformed/wrong-shape rows; source audit stopped.`);
  const targets = verifyTargetSourceRows(targetsRaw, geoTargets).map((row) => ({
    ...row,
    source_identity_and_raw_codes_verified: true,
  }));
  const geoNamesManifest = JSON.parse(await readFile(geoNamesManifestPath, "utf8"));
  const alternateNamesV2AuditBytes = alternateNamesV2AuditPath ? await readFile(alternateNamesV2AuditPath) : null;
  const alternateNamesV2Audit = alternateNamesV2AuditBytes ? JSON.parse(alternateNamesV2AuditBytes.toString("utf8")) : null;
  const aliasesByTarget = validateJapaneseAlternateNamesV2Audit(alternateNamesV2Audit, targets);
  const japaneseAlternateNameRecords = targets.map((row) => ({
    geonames_id: String(row.geonames_id),
    target_name: row.name,
    alternate_names: uniqueStrings([
      ...(row.source_alternate_names ?? []),
      ...(aliasesByTarget.get(String(row.geonames_id)) ?? []).map((alias) => alias.alternate_name),
    ].map(normalizeJapaneseLabel).filter(Boolean)),
  }));
  const snapshot = await fetchEstatSnapshot(
    targets.map((row) => row.name),
    fetchImpl,
    now,
    japaneseAlternateNameRecords,
  );
  const report = buildCandidateAudit(targets, snapshot.sourceRows, snapshot.manifest.source_snapshot_sha256);
  report.japanese_alternate_name_candidate_audit = buildJapaneseAlternateNameCandidateAudit(
    targets,
    report,
    snapshot.sourceRows,
    alternateNamesV2Audit,
  );
  report.generated_at_utc = now().toISOString().replace(/\.\d{3}Z$/, "Z");
  report.input = {
    target_export_path: targetsPath,
    target_export_sha256: sha256(targetBytes),
    unique_japan_targets: targets.length,
    geonames_country_text_sha256: sha256(geoBytes),
    geonames_country_text_size_bytes: geoBytes.byteLength,
    geonames_country_source_line_count: geoLines.length,
    geonames_country_malformed_or_wrong_shape_lines: malformedRows,
    source_identity_and_raw_code_matches: targets.length,
    geonames_alternate_names_v2_audit_sha256: alternateNamesV2AuditBytes ? sha256(alternateNamesV2AuditBytes) : null,
    geonames_alternate_names_v2_selected_alias_rows: alternateNamesV2Audit?.summary?.selected_japanese_alias_rows ?? 0,
  };
  report.source = {
    geoNames: geoNamesManifest,
    eStat: snapshot.manifest,
    geoNamesAlternateNamesV2: alternateNamesV2Audit ? {
      source_url: alternateNamesV2Audit.source?.source_url,
      retrieved_at_utc: alternateNamesV2Audit.source?.retrieved_at_utc,
      http_status: alternateNamesV2Audit.source?.http_status,
      etag: alternateNamesV2Audit.source?.etag,
      archive_sha256: alternateNamesV2Audit.source?.archive_sha256,
      archive_size_bytes: alternateNamesV2Audit.source?.archive_size_bytes,
      zip_crc_validation: alternateNamesV2Audit.source?.zip_crc_validation,
      member_name: alternateNamesV2Audit.source?.member_name,
      member_uncompressed_size_bytes: alternateNamesV2Audit.source?.member_uncompressed_size_bytes,
      source_manifest_sha256: alternateNamesV2Audit.source?.source_manifest_sha256,
      dispositions_sha256: alternateNamesV2Audit.source?.dispositions_sha256,
      target_count: alternateNamesV2Audit.target_count,
      source_rows_scanned: alternateNamesV2Audit.source_rows_scanned,
      summary: alternateNamesV2Audit.summary,
      status: alternateNamesV2Audit.status,
    } : null,
  };
  const prefix = resolve(outputPrefix);
  await mkdir(dirname(prefix), { recursive: true });
  await Promise.all([
    writeFile(`${prefix}.json`, JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(`${prefix}.csv`, renderCandidateCsv(report), "utf8"),
    writeFile(`${prefix}.manifest.json`, JSON.stringify(report.source, null, 2) + "\n", "utf8"),
    writeFile(`${prefix}.source-response.json`, snapshot.responseText, "utf8"),
    writeFile(
      `${prefix}.japanese-alternate-name-candidates.csv`,
      renderJapaneseAlternateNameCandidateCsv(
        report.japanese_alternate_name_candidate_audit,
        snapshot.manifest.source_snapshot_sha256,
      ),
      "utf8",
    ),
  ]);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [targetsPath, geoNamesPath, outputPrefix, geoNamesManifestPath, alternateNamesV2AuditPath] = process.argv.slice(2);
  if (!targetsPath || !geoNamesPath || !outputPrefix || !geoNamesManifestPath) {
    process.stderr.write("Usage: node scripts/geonames-japan-estat-evidence-audit.mjs <dispositions.csv> <JP.txt> <output-prefix> <geonames-source-manifest.json> [japan-alternate-names-v2-target-aliases.json]\n");
    process.exitCode = 2;
  } else {
    runAudit({ targetsPath, geoNamesPath, outputPrefix, geoNamesManifestPath, alternateNamesV2AuditPath })
      .then((report) => {
        const summary = { ...report };
        delete summary.target_results;
        if (summary.japanese_alternate_name_candidate_audit) {
          const alternateSummary = { ...summary.japanese_alternate_name_candidate_audit };
          delete alternateSummary.target_results;
          summary.japanese_alternate_name_candidate_audit = alternateSummary;
        }
        process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
        if (report.operational_parent_links_created !== 0) {
          throw new Error("Safety boundary violation: audit may not create operational parent links.");
        }
      })
      .catch((error) => {
        process.stderr.write(`Japan e-Stat candidate audit failed closed: ${error.stack ?? error}\n`);
        if (error.failures) process.stderr.write(JSON.stringify(error.failures, null, 2) + "\n");
        process.exitCode = 1;
      });
  }
}
