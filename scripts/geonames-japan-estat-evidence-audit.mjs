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
export const QUERY_LIMIT = 20000;

export const SPARQL_QUERY = `
PREFIX sacs: <http://data.e-stat.go.jp/lod/terms/sacs#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT
  ?period ?identifier ?labelEn ?labelJa ?issued ?valid
  ?parent ?parentIdentifier ?parentLabelEn ?parentLabelJa
  ?previous ?succeeding ?administrativeClass
WHERE {
  ?period a sacs:StandardAreaCode ;
          dcterms:identifier ?identifier .
  FILTER(REGEX(STR(?identifier), "^(0[1-9]|[1-3][0-9]|4[0-7])[0-9]{3}$"))

  OPTIONAL { ?period rdfs:label ?labelEn . FILTER(LANG(?labelEn) = "en") }
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
ORDER BY ?identifier ?issued ?period
LIMIT 20000
`.trim();

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

export function buildCandidateAudit(targets, sourceRows, sourceSnapshotSha256) {
  if (!Array.isArray(targets) || targets.length !== EXPECTED_JAPAN_TARGETS) {
    throw new Error(`Expected ${EXPECTED_JAPAN_TARGETS} unique Japan ADM4 raw-admin1-00 targets; got ${targets?.length ?? 0}.`);
  }
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    throw new Error("Official e-Stat response contained no code-history rows.");
  }

  const byLabel = new Map();
  for (const sourceRow of sourceRows) {
    if (!sourceRow.period_uri || !sourceRow.area_code) {
      throw new Error(`e-Stat row missing period URI or standard area code: ${JSON.stringify({ period_uri: sourceRow.period_uri, area_code: sourceRow.area_code, label_en: sourceRow.label_en })}`);
    }
    const key = normalizeExactLabel(sourceRow.label_en);
    if (!key) continue;
    const bucket = byLabel.get(key) ?? [];
    bucket.push(sourceRow);
    byLabel.set(key, bucket);
  }

  const targetResults = targets.map((target) => {
    const key = normalizeExactLabel(target.name);
    const candidates = (byLabel.get(key) ?? [])
      .slice()
      .sort((a, b) =>
        a.area_code.localeCompare(b.area_code) ||
        a.effective_from.localeCompare(b.effective_from) ||
        a.period_uri.localeCompare(b.period_uri));
    const reviewStatus = candidates.length === 0
      ? "NO_EXACT_NORMALIZED_ENGLISH_LABEL_MATCH"
      : candidates.length === 1
        ? "ONE_EXACT_LABEL_CANDIDATE_REQUIRES_IDENTITY_AND_DATE_REVIEW"
        : "MULTIPLE_EXACT_LABEL_CANDIDATES_REQUIRE_DISAMBIGUATION";
    return {
      geonames_id: target.geonames_id,
      geonames_name: target.name,
      country_code: target.country_code,
      feature_code: target.feature_code,
      source_modification_date: target.source_modification_date ?? "",
      raw_admin1_code: target.raw_admin1_code,
      raw_admin2_code: target.raw_admin2_code,
      source_identity_and_raw_codes_verified: target.source_identity_and_raw_codes_verified === true,
      normalized_name_key: key,
      exact_name_candidate_count: candidates.length,
      review_status: reviewStatus,
      candidates,
      operational_parent_link_created: false,
    };
  });

  const countBy = (predicate) => targetResults.filter(predicate).length;
  return {
    report_version: 1,
    status: "PASS_SOURCE_RETRIEVED_TARGET_COVERAGE_COMPLETE; CANDIDATES_REQUIRE_REVIEW; NO_PARENT_LINKS_APPROVED",
    target_count: targetResults.length,
    target_source_identity_and_raw_code_matches: targetResults.filter((row) => row.source_identity_and_raw_codes_verified).length,
    source_code_history_rows: sourceRows.length,
    targets_with_one_exact_label_candidate: countBy((row) => row.exact_name_candidate_count === 1),
    targets_with_multiple_exact_label_candidates: countBy((row) => row.exact_name_candidate_count > 1),
    targets_without_exact_label_candidates: countBy((row) => row.exact_name_candidate_count === 0),
    total_exact_label_candidate_rows: targetResults.reduce((total, row) => total + row.candidates.length, 0),
    candidates_with_official_parent_reference: targetResults.reduce(
      (total, row) => total + row.candidates.filter((candidate) => candidate.parent_uri).length, 0),
    matching_rule: "Exact normalized English label only: Unicode NFKD, remove diacritics, lowercase, punctuation to spaces, collapse whitespace. No token removal, fuzzy similarity, coordinates, proximity, or first-match selection.",
    source_snapshot_sha256: sourceSnapshotSha256,
    target_results: targetResults,
    operational_parent_links_created: 0,
    limitations: [
      "An exact normalized label is only a candidate discovery mechanism, not proof of entity identity.",
      "All historical periods and ambiguous candidates are preserved; no first/most recent candidate is selected automatically.",
      "An e-Stat parent reference is evidence for administrative hierarchy review, not an approved Job Grid GeoNames parent path.",
      "Targets without an exact match remain unresolved; no raw code is normalized or synthesized.",
      "This source covers statistical standard-area-code history, documented by e-Stat from April 1970 onward, and may not cover older or differently defined GeoNames features.",
      "No database, migration, seed, import, production, deployment, or PR merge is performed."
    ],
  };
}

export function renderCandidateCsv(report) {
  const headers = [
    "geonames_id", "geonames_name", "raw_admin1_code", "raw_admin2_code", "source_modification_date",
    "source_identity_and_raw_codes_verified", "normalized_name_key", "exact_name_candidate_count", "review_status",
    "candidate_area_code", "candidate_period_uri", "candidate_label_en", "candidate_label_ja",
    "candidate_effective_from", "candidate_effective_until", "candidate_parent_area_code",
    "candidate_parent_uri", "candidate_parent_label_en", "candidate_parent_label_ja",
    "candidate_previous_period_uri", "candidate_succeeding_period_uri",
    "candidate_administrative_class_uri", "source_snapshot_sha256", "operational_parent_link_created",
  ];
  const csvCell = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(",")];
  for (const target of report.target_results) {
    const candidates = target.candidates.length ? target.candidates : [null];
    for (const candidate of candidates) {
      const row = {
        geonames_id: target.geonames_id,
        geonames_name: target.geonames_name,
        raw_admin1_code: target.raw_admin1_code,
        raw_admin2_code: target.raw_admin2_code,
        source_modification_date: target.source_modification_date,
        source_identity_and_raw_codes_verified: target.source_identity_and_raw_codes_verified,
        normalized_name_key: target.normalized_name_key,
        exact_name_candidate_count: target.exact_name_candidate_count,
        review_status: target.review_status,
        candidate_area_code: candidate?.area_code,
        candidate_period_uri: candidate?.period_uri,
        candidate_label_en: candidate?.label_en,
        candidate_label_ja: candidate?.label_ja,
        candidate_effective_from: candidate?.effective_from,
        candidate_effective_until: candidate?.effective_until,
        candidate_parent_area_code: candidate?.parent_area_code,
        candidate_parent_uri: candidate?.parent_uri,
        candidate_parent_label_en: candidate?.parent_label_en,
        candidate_parent_label_ja: candidate?.parent_label_ja,
        candidate_previous_period_uri: candidate?.previous_period_uri,
        candidate_succeeding_period_uri: candidate?.succeeding_period_uri,
        candidate_administrative_class_uri: candidate?.administrative_class_uri,
        source_snapshot_sha256: report.source_snapshot_sha256,
        operational_parent_link_created: false,
      };
      lines.push(headers.map((header) => csvCell(row[header])).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

export async function fetchEstatSnapshot(fetchImpl = fetch, now = () => new Date()) {
  const form = new URLSearchParams({ query: SPARQL_QUERY });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(ESTAT_SPARQL_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "Job-Grid-Geography-Evidence-Audit/1.0",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(120000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = bytes.toString("utf8");
      if (!response.ok) {
        throw new Error(`e-Stat SPARQL HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const parsed = JSON.parse(text);
      const bindings = parsed?.results?.bindings;
      if (!Array.isArray(bindings) || bindings.length === 0) {
        throw new Error("e-Stat SPARQL response lacks non-empty results.bindings.");
      }
      if (bindings.length >= QUERY_LIMIT) {
        throw new Error(`e-Stat source result reached the ${QUERY_LIMIT}-row safety limit; paginate before using this snapshot.`);
      }
      return {
        bindings,
        responseText: text,
        manifest: {
          source_name: "Japan Statistical LOD — Standard Area Code List",
          catalog_url: ESTAT_CATALOG_URL,
          endpoint_url: ESTAT_SPARQL_ENDPOINT,
          query_sha256: sha256(SPARQL_QUERY),
          captured_at_utc: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
          http_status: response.status,
          http_date_header: response.headers.get("date"),
          http_last_modified_header: response.headers.get("last-modified"),
          etag: response.headers.get("etag"),
          response_content_type: response.headers.get("content-type"),
          response_bytes: bytes.byteLength,
          response_sha256: sha256(bytes),
          result_row_count: bindings.length,
          result_cap: QUERY_LIMIT,
          license_note: "The official Statistical LOD SPARQL API page states that site content is licensed CC BY 4.0 except where otherwise noted; confirm applicable dataset terms before redistribution.",
          source_scope_note: "e-Stat documents standard-area-code and related municipality abolishment, absorption, name-change and hierarchy data from April 1970 onward. This is a candidate evidence source, not a GeoNames crosswalk.",
        },
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      const retryable = /HTTP 429|HTTP 5\d\d|fetch failed|timed out|timeout/i.test(message);
      if (attempt === 3 || !retryable) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
    }
  }
  throw lastError ?? new Error("e-Stat source retrieval failed.");
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
  const snapshot = await fetchEstatSnapshot(fetchImpl, now);
  const missingRequiredBinding = snapshot.bindings.find((binding) =>
    !bindingValue(binding, "period")?.length || !bindingValue(binding, "identifier")?.length
  );
  if (missingRequiredBinding) {
    throw new Error(`e-Stat result variable mismatch or unbound key fields: ${JSON.stringify({
      available_binding_keys: Object.keys(missingRequiredBinding),
      first_binding: missingRequiredBinding,
    })}`);
  }
  const sourceRows = parseEstatBindings(snapshot.bindings);
  const report = buildCandidateAudit(targets, sourceRows, snapshot.manifest.response_sha256);
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
