#!/usr/bin/env node
/**
 * Build a deterministic, candidate-only Kenya crosswalk rebuild ledger.
 * County-level evidence is never promoted to an immediate parent link.
 *
 * Usage:
 *   node scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs
 *     <current-admin1-audit.json> <county-ancestor-evidence.json> <output-prefix>
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EXPECTED = new Map([
  ["192705", {
    rawCode: "01",
    key: "KE.01",
    countyId: "8693007",
    countyName: "Kiambu County",
    reviewStatus: "BLOCKED_LOCATION_VS_SUB_LOCATION_LEVEL_CONFLICT",
    missingEvidence: [
      "A versioned authoritative administrative-unit row with a stable current identifier/code, official unit class, effective period, immediate parent sub-county and county.",
      "An explicit source-backed identifier crosswalk tying that exact unit to GeoNames ID 192705; name or coordinate similarity alone is insufficient.",
      "A verified sequence of hierarchy edges from the GeoNames target to the correct current parent entities."
    ]
  }],
  ["7800132", {
    rawCode: "03",
    key: "KE.03",
    countyId: "8693009",
    countyName: "Meru County",
    reviewStatus: "BLOCKED_NAME_VARIANT_AND_UNIT_TYPE_CROSSWALK",
    missingEvidence: [
      "A versioned authoritative identifier/code for the exact Central Imenti / Imenti Central unit, distinguishing an administrative unit from an electoral constituency and recording its effective period.",
      "An explicit source-backed identifier crosswalk tying that exact administrative unit to GeoNames ID 7800132; a name-order variant is not sufficient.",
      "A verified sequence of hierarchy edges from the GeoNames target to the correct current parent entities."
    ]
  }]
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function getSourceMetadata(audit) {
  const wrapper = audit?.source ?? {};
  const source = wrapper?.manifest?.remote_source ?? wrapper?.manifest?.remoteSource ?? wrapper?.manifest ?? wrapper;
  const url = source.url ?? source.source_url ?? wrapper.url ?? null;
  const sha256 = source.sha256 ?? wrapper.crosswalk_sha256 ?? null;
  const httpStatus = Number(source.http_status ?? wrapper.http_status);
  const retrievedAt = source.retrieved_at_utc ?? wrapper.retrieved_at_utc ?? null;
  const rowCount = Number(audit.crosswalk_row_count ?? source.rows ?? NaN);
  const malformedRows = Number(audit.malformed_rows ?? source.malformed_rows ?? NaN);
  const duplicateValue = audit.duplicate_crosswalk_keys ?? source.duplicate_composite_keys ?? [];
  const duplicateCount = Array.isArray(duplicateValue) ? duplicateValue.length : Number(duplicateValue ?? 0);
  const metadataVerified = wrapper.retrieval_metadata_verified === true ||
    (httpStatus === 200 &&
     typeof url === "string" &&
     /^https:\/\/download\.geonames\.org\/export\/dump\/admin1CodesASCII\.txt$/.test(url) &&
     /^[a-f0-9]{64}$/i.test(sha256 ?? "") &&
     Number.isFinite(Date.parse(retrievedAt ?? "")) &&
     Number.isSafeInteger(rowCount) && rowCount > 0);
  requireCondition(metadataVerified, "Current official GeoNames admin1 crosswalk provenance failed validation.");
  requireCondition(malformedRows === 0, "Current crosswalk contains malformed rows; ledger must fail closed.");
  requireCondition(Number.isSafeInteger(duplicateCount) && duplicateCount === 0, "Current crosswalk contains duplicate keys; ledger must fail closed.");
  requireCondition(httpStatus === 200, "Current crosswalk HTTP status was not 200.");
  requireCondition(/^[a-f0-9]{64}$/i.test(sha256 ?? ""), "Current crosswalk SHA-256 is missing or invalid.");
  return {
    owner: "GeoNames",
    url,
    retrieved_at_utc: retrievedAt,
    http_status: httpStatus,
    sha256,
    row_count: rowCount,
    malformed_rows: malformedRows,
    duplicate_key_count: duplicateCount,
    retrieval_metadata_verified: true
  };
}

function auditKeyRows(target) {
  const value = target.crosswalk_row_count_for_key ?? target.crosswalk_rows_found;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function buildKenyaCrosswalkRebuildLedger(audit, evidence) {
  requireCondition(audit && Array.isArray(audit.targets), "Admin1 audit has no target rows.");
  requireCondition(evidence && Array.isArray(evidence.records), "County-ancestor evidence has no records.");
  const source = getSourceMetadata(audit);
  const auditTargets = new Map(audit.targets.map((row) => [String(row.geonames_id), row]));
  const evidenceTargets = new Map(evidence.records.map((row) => [String(row.geonames_id), row]));
  requireCondition(auditTargets.size === EXPECTED.size, "Expected exactly two current Kenya legacy-code target rows.");
  requireCondition(evidenceTargets.size === EXPECTED.size, "Expected exactly two county-ancestor evidence rows.");

  const records = [...EXPECTED.entries()].map(([id, expected]) => {
    const auditRow = auditTargets.get(id);
    const evidenceRow = evidenceTargets.get(id);
    requireCondition(auditRow && evidenceRow, "Missing matched audit/evidence row for GeoNames ID " + id + ".");
    const rawCode = String(auditRow.source_raw_admin1_code ?? auditRow.raw_admin1_code_preserved ?? "");
    const currentKey = String(auditRow.expected_composite_key ?? auditRow.composite_key_checked ?? "");
    const countryCode = String(auditRow.country_code ?? evidenceRow.country_code ?? "");
    const featureCode = String(auditRow.feature_code ?? evidenceRow.feature_code ?? "");
    requireCondition(rawCode === expected.rawCode, "Raw admin1 code drift for GeoNames ID " + id + ".");
    requireCondition(currentKey === expected.key, "Legacy composite-key drift for GeoNames ID " + id + ".");
    requireCondition(countryCode === "KE" && evidenceRow.country_code === "KE", "Country identity mismatch for GeoNames ID " + id + ".");
    requireCondition(featureCode === "ADM3" && evidenceRow.feature_code === "ADM3", "Expected an ADM3 target for GeoNames ID " + id + ".");
    requireCondition(evidenceRow.raw_admin1_code_preserved === expected.rawCode, "Evidence dossier raw code mismatch for GeoNames ID " + id + ".");

    const ancestor = evidenceRow.candidate_county_ancestor;
    requireCondition(ancestor && String(ancestor.geonames_id) === expected.countyId, "County candidate identity mismatch for GeoNames ID " + id + ".");
    requireCondition(ancestor.name === expected.countyName && ancestor.feature_code === "ADM2", "County candidate name/feature mismatch for GeoNames ID " + id + ".");
    requireCondition(evidenceRow.parent_link_created === false, "Evidence dossier unexpectedly contains a parent link for GeoNames ID " + id + ".");

    const count = auditKeyRows(auditRow);
    requireCondition(count !== null && count >= 0, "Current crosswalk key count is absent for GeoNames ID " + id + ".");
    let currentKeyStatus;
    if (count === 0) currentKeyStatus = "KEY_ABSENT_FROM_CURRENT_CROSSWALK__NO_REPLACEMENT_INFERRED";
    else if (count === 1) currentKeyStatus = "KEY_PRESENT__INDEPENDENT_IDENTITY_AND_PARENT_REVIEW_REQUIRED";
    else currentKeyStatus = "BLOCKED_DUPLICATE_CURRENT_CROSSWALK_KEY";

    return {
      geonames_id: id,
      name: String(auditRow.name ?? auditRow.geonames_name ?? evidenceRow.geonames_name),
      country_code: "KE",
      feature_code: "ADM3",
      raw_admin1_code_preserved: expected.rawCode,
      legacy_composite_key: expected.key,
      current_crosswalk_key_row_count: count,
      current_crosswalk_key_status: currentKeyStatus,
      candidate_county_ancestor: {
        geonames_id: String(ancestor.geonames_id),
        name: ancestor.name,
        feature_code: ancestor.feature_code,
        source_urls: [
          ...(ancestor.evidence_sources ?? []).map((item) => item.url).filter(Boolean),
          ancestor.page_url
        ].filter((url, index, urls) => url && urls.indexOf(url) === index),
        candidate_disposition: ancestor.disposition
      },
      identity_and_path_review_status: expected.reviewStatus,
      immediate_parent_geonames_id: null,
      complete_parent_path_verified: false,
      raw_admin1_code_changed: false,
      operational_parent_link_created: false,
      active_selector_disposition: "EXCLUDE_UNTIL_IDENTITY_AND_IMMEDIATE_PARENT_PATH_ARE_VERIFIED",
      missing_evidence: expected.missingEvidence
    };
  });

  return {
    report_version: "1.0",
    report_date_utc: evidence.audit_date_utc ?? null,
    status: "REBUILD_LEDGER_CREATED__DIRECT_PARENT_PATHS_UNRESOLVED",
    purpose: "Rebuild the Kenya exception crosswalk ledger from current source-pinned GeoNames key checks and separately documented official administrative evidence; keep candidate ancestry distinct from immediate parentage.",
    source: {
      current_admin1_crosswalk: source,
      evidence_dossier_status: evidence.status,
      evidence_dossier_date_utc: evidence.audit_date_utc ?? null
    },
    decision_boundary: {
      current_key_absence_is_not_a_replacement_mapping: true,
      county_ancestor_candidate_is_not_an_immediate_parent: true,
      raw_source_codes_modified: false,
      operational_parent_links_created: 0,
      database_or_production_changes: false
    },
    totals: {
      target_rows: records.length,
      exact_current_legacy_keys_absent: records.filter((row) => row.current_crosswalk_key_row_count === 0).length,
      county_ancestor_candidates_recorded: records.filter((row) => row.candidate_county_ancestor).length,
      immediate_parent_paths_verified: records.filter((row) => row.complete_parent_path_verified).length,
      raw_admin1_codes_changed: records.filter((row) => row.raw_admin1_code_changed).length,
      operational_parent_links_created: records.filter((row) => row.operational_parent_link_created).length,
      excluded_from_active_selector_pending_parent_evidence: records.filter((row) => row.active_selector_disposition.startsWith("EXCLUDE_")).length
    },
    records
  };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function renderKenyaCrosswalkRebuildLedgerCsv(ledger) {
  const fields = [
    "geonames_id",
    "name",
    "country_code",
    "feature_code",
    "raw_admin1_code_preserved",
    "legacy_composite_key",
    "current_crosswalk_key_row_count",
    "current_crosswalk_key_status",
    "candidate_county_ancestor_geonames_id",
    "candidate_county_ancestor_name",
    "candidate_county_ancestor_feature_code",
    "identity_and_path_review_status",
    "immediate_parent_geonames_id",
    "complete_parent_path_verified",
    "raw_admin1_code_changed",
    "operational_parent_link_created",
    "active_selector_disposition",
    "missing_evidence"
  ];
  const rows = ledger.records.map((record) => {
    const row = {
      ...record,
      candidate_county_ancestor_geonames_id: record.candidate_county_ancestor.geonames_id,
      candidate_county_ancestor_name: record.candidate_county_ancestor.name,
      candidate_county_ancestor_feature_code: record.candidate_county_ancestor.feature_code,
      missing_evidence: record.missing_evidence.join("; ")
    };
    return fields.map((field) => csvEscape(row[field])).join(",");
  });
  return [fields.join(","), ...rows].join("\n") + "\n";
}

async function main() {
  const [auditPath, evidencePath, outputPrefix] = process.argv.slice(2);
  if (!auditPath || !evidencePath || !outputPrefix) {
    console.error("Usage: node scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs <current-admin1-audit.json> <county-ancestor-evidence.json> <output-prefix>");
    process.exitCode = 2;
    return;
  }
  const [auditText, evidenceText] = await Promise.all([
    readFile(auditPath, "utf8"),
    readFile(evidencePath, "utf8")
  ]);
  const ledger = buildKenyaCrosswalkRebuildLedger(JSON.parse(auditText), JSON.parse(evidenceText));
  const jsonPath = outputPrefix + ".json";
  const csvPath = outputPrefix + ".csv";
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(ledger, null, 2) + "\n", "utf8"),
    writeFile(csvPath, renderKenyaCrosswalkRebuildLedgerCsv(ledger), "utf8")
  ]);
  console.log(JSON.stringify({
    status: ledger.status,
    target_rows: ledger.totals.target_rows,
    exact_current_legacy_keys_absent: ledger.totals.exact_current_legacy_keys_absent,
    county_ancestor_candidates_recorded: ledger.totals.county_ancestor_candidates_recorded,
    immediate_parent_paths_verified: ledger.totals.immediate_parent_paths_verified,
    raw_admin1_codes_changed: ledger.totals.raw_admin1_codes_changed,
    operational_parent_links_created: ledger.totals.operational_parent_links_created,
    outputs: [jsonPath, csvPath]
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
