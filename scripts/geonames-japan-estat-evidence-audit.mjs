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

SELECT DISTINCT ?period ?identifier ?labelEn
WHERE {
  ?period a sacs:StandardAreaCode ;
          dcterms:identifier ?identifier ;
          rdfs:label ?labelEn .
  FILTER(LANG(?labelEn) = "en")
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
    latitude: fields[4],
    longitude: fields[5],
    feature_code: fields[7],
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
    verified.push({ ...target, source_modification_date: source.modification_date });
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

export function renderCandidateCsv(report) {
  const headers = [
    "geonames_id", "geonames_name", "country_code", "feature_code", "raw_admin1_code",
    "raw_admin2_code", "source_modification_date", "source_identity_and_raw_codes_verified",
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

async function requestEstatQuery(query, fetchImpl, now, { allowEmpty = false } = {}) {
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
export async function fetchEstatSnapshot(targetNames, fetchImpl = fetch, now = () => new Date()) {
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
  const candidateAreaCodes = new Set(initiallyMatchedRows.map((row) => row.area_code));
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
        label_ja: detail?.label_ja ?? "",
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
    candidate_area_code_count: candidateAreaCodes.size,
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

export async function runAudit({ targetsPath, geoNamesPath, outputPrefix, geoNamesManifestPath, fetchImpl = fetch, now = () => new Date() }) {
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
  const snapshot = await fetchEstatSnapshot(targets.map((row) => row.name), fetchImpl, now);
  const report = buildCandidateAudit(targets, snapshot.sourceRows, snapshot.manifest.source_snapshot_sha256);
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
  };
  report.source = {
    geoNames: geoNamesManifest,
    eStat: snapshot.manifest,
  };
  const prefix = resolve(outputPrefix);
  await mkdir(dirname(prefix), { recursive: true });
  await Promise.all([
    writeFile(`${prefix}.json`, JSON.stringify(report, null, 2) + "\n", "utf8"),
    writeFile(`${prefix}.csv`, renderCandidateCsv(report), "utf8"),
    writeFile(`${prefix}.manifest.json`, JSON.stringify(report.source, null, 2) + "\n", "utf8"),
    writeFile(`${prefix}.source-response.json`, snapshot.responseText, "utf8"),
  ]);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [targetsPath, geoNamesPath, outputPrefix, geoNamesManifestPath] = process.argv.slice(2);
  if (!targetsPath || !geoNamesPath || !outputPrefix || !geoNamesManifestPath) {
    process.stderr.write("Usage: node scripts/geonames-japan-estat-evidence-audit.mjs <dispositions.csv> <JP.txt> <output-prefix> <geonames-source-manifest.json>\n");
    process.exitCode = 2;
  } else {
    runAudit({ targetsPath, geoNamesPath, outputPrefix, geoNamesManifestPath })
      .then((report) => {
        const summary = { ...report };
        delete summary.target_results;
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
