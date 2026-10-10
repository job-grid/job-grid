#!/usr/bin/env node
/**
 * Derive owner-approved, non-destructive dispositions for committed GeoNames
 * crosswalk exceptions. Original exception inputs are read-only and untouched.
 * No parent IDs or links are ever created by this report generator.
 *
 * Run from any working directory:
 *   node scripts/geonames-approved-exception-dispositions.mjs --write
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DATA_DIR = new URL(
  "../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/",
  import.meta.url
);
export const OWNER_POLICY_APPROVAL_DATE = "2026-10-11";
export const POLICY_DOCUMENT =
  "docs/geonames-feature-selectability-policy-proposal-2026-10-11.md";

const HISTORICAL_ADMIN_CODES = new Set(["ADM1H", "ADM2H", "ADM3H", "ADM4H", "ADMDH"]);
const HISTORICAL_PLACE_CODES = new Set(["PPLH"]);
const PLACE_CODES = new Set(["PPL", "PPLX", "PPLL"]);

function getDisposition(featureCode) {
  if (featureCode === "PCLI") {
    return {
      owner_approved_disposition: "COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED",
      current_admin_selector_treatment: "COUNTRY_ENTITY_NOT_AN_ADMINISTRATIVE_SELECTOR",
    };
  }
  if (HISTORICAL_ADMIN_CODES.has(featureCode)) {
    return {
      owner_approved_disposition: "PRESERVE_HISTORICAL_NOT_CURRENT_ADMIN_SELECTOR",
      current_admin_selector_treatment: "EXCLUDE_CURRENT_ADMIN_SELECTOR_HISTORICAL",
    };
  }
  if (HISTORICAL_PLACE_CODES.has(featureCode)) {
    return {
      owner_approved_disposition: "PRESERVE_HISTORICAL_PLACE_ASSOCIATION_UNRESOLVED",
      current_admin_selector_treatment: "HISTORICAL_PLACE_NOT_CURRENT_ADMIN_BOUNDARY",
    };
  }
  if (featureCode === "ADMD") {
    return {
      owner_approved_disposition: "PRESERVE_UNDIFFERENTIATED_NOT_CURRENT_ADMIN_SELECTOR",
      current_admin_selector_treatment: "EXCLUDE_CURRENT_ADMIN_SELECTOR_UNDIFFERENTIATED",
    };
  }
  if (/^ADM[1-4]$/.test(featureCode)) {
    return {
      owner_approved_disposition: "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED",
      current_admin_selector_treatment: "EXCLUDE_CURRENT_ADMIN_SELECTOR_UNTIL_PARENT_PATH_VERIFIED",
    };
  }
  if (PLACE_CODES.has(featureCode)) {
    return {
      owner_approved_disposition: "PRESERVE_PLACE_IDENTITY_ADMIN_ASSOCIATION_UNRESOLVED",
      current_admin_selector_treatment: "PLACE_ENTITY_NOT_ADMINISTRATIVE_SELECTOR",
    };
  }
  return {
    owner_approved_disposition: "PRESERVE_NONADMIN_ENTITY_ADMIN_ASSOCIATION_UNRESOLVED",
    current_admin_selector_treatment: "NONADMIN_ENTITY_NOT_ADMINISTRATIVE_SELECTOR",
  };
}

export function buildDispositionRows(admin1Rows, admin2Rows) {
  const all = [
    ...admin1Rows.map((row) => ({ ...row, reference_level: "admin1" })),
    ...admin2Rows.map((row) => ({ ...row, reference_level: "admin2" })),
  ];
  const uniqueIds = new Map();
  for (const row of all) {
    if (!row.geonames_id || !row.country_code || !row.feature_code) {
      throw new Error("Crosswalk exception row is missing identity fields.");
    }
    const existing = uniqueIds.get(row.geonames_id);
    if (existing && (
      existing.country_code !== row.country_code ||
      existing.feature_code !== row.feature_code
    )) {
      throw new Error(`Conflicting country/feature identity for GeoNames ID ${row.geonames_id}`);
    }
    if (!existing) uniqueIds.set(row.geonames_id, row);
    const disposition = getDisposition(row.feature_code);
    Object.assign(row, disposition, {
      owner_policy_approval_date: OWNER_POLICY_APPROVAL_DATE,
      parent_link_created: false,
    });
  }
  return all;
}

function countBy(rows, field) {
  const result = {};
  for (const row of rows) result[row[field]] = (result[row[field]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildDispositionSummary(rows, sourceSummary) {
  const admin1 = rows.filter((row) => row.reference_level === "admin1");
  const admin2 = rows.filter((row) => row.reference_level === "admin2");
  const ids1 = new Set(admin1.map((row) => row.geonames_id));
  const ids2 = new Set(admin2.map((row) => row.geonames_id));
  const overlap = [...ids1].filter((id) => ids2.has(id)).length;
  const uniqueMap = new Map();
  for (const row of rows) if (!uniqueMap.has(row.geonames_id)) uniqueMap.set(row.geonames_id, row);
  const uniqueRows = [...uniqueMap.values()];
  const originalMatches =
    admin1.length === sourceSummary.unmatched_admin1_references &&
    admin2.length === sourceSummary.unmatched_admin2_references &&
    overlap === sourceSummary.admin1_admin2_record_overlap &&
    uniqueRows.length === sourceSummary.union_unique_affected_records;
  if (!originalMatches) throw new Error("Derived dispositions do not reconcile to the source summary.");

  const perCountry = {};
  for (const country of [...new Set(rows.map((row) => row.country_code))].sort()) {
    const matching = rows.filter((row) => row.country_code === country);
    perCountry[country] = {
      references: matching.length,
      dispositions: countBy(matching, "owner_approved_disposition"),
    };
  }

  const countryRecords = uniqueRows.filter(
    (row) => row.owner_approved_disposition === "COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED"
  ).length;
  const currentAdminFeatures = uniqueRows.filter(
    (row) => row.owner_approved_disposition === "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED"
  ).length;

  return {
    report_version: "1.0",
    generated_on_utc_date: OWNER_POLICY_APPROVAL_DATE,
    decision_status: "OWNER_APPROVED_CONSERVATIVE_DEFAULTS",
    owner_policy_approval_date: OWNER_POLICY_APPROVAL_DATE,
    policy_document: POLICY_DOCUMENT,
    source_exception_exports_unchanged: true,
    source_raw_codes_preserved: true,
    parent_ids_or_links_assigned: 0,
    input_reference_counts: {
      admin1: admin1.length,
      admin2: admin2.length,
      total: rows.length,
    },
    reconciliation: {
      overlap_ids_between_levels: overlap,
      unique_affected_ids: uniqueRows.length,
      original_summary_matches: originalMatches,
    },
    reference_dispositions: {
      admin1: countBy(admin1, "owner_approved_disposition"),
      admin2: countBy(admin2, "owner_approved_disposition"),
      combined: countBy(rows, "owner_approved_disposition"),
    },
    unique_record_dispositions: countBy(uniqueRows, "owner_approved_disposition"),
    country_level_records_no_admin_parent_required: countryRecords,
    current_admin_features_requiring_country_specific_parent_path: currentAdminFeatures,
    non_country_references_still_needing_hierarchy_or_association_review:
      rows.filter((row) => row.owner_approved_disposition !== "COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED").length,
    per_country: perCountry,
    limitations: [
      "These dispositions apply approved conservative policy to existing feature codes; they do not claim a missing crosswalk key was found.",
      "Current ADM1-ADM4 features with unresolved hierarchy remain excluded from current administrative selectors until a source-pinned country-specific ancestor path is verified.",
      "Historical and undifferentiated entities are retained, not declared invalid, and are not current administrative selector options by default.",
      "Country-level PCLI entities require no administrative parent; their raw source codes are still preserved unchanged.",
      "Place/non-admin entities are preserved; their administrative association can remain unresolved.",
      "No parent IDs, migrations, seeds, imports, database, deployment or production changes are performed.",
    ],
  };
}

const CSV_FIELDS = [
  "reference_level", "geonames_id", "name", "country_code", "feature_code",
  "raw_admin1_code", "raw_admin2_code", "missing_reference_category",
  "proposed_review_classification", "crosswalk_lookup_key", "raw_missing_code",
  "owner_policy_approval_date", "owner_approved_disposition",
  "current_admin_selector_treatment", "parent_link_created",
];

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function toCsv(rows) {
  return [
    CSV_FIELDS.join(","),
    ...rows.map((row) => CSV_FIELDS.map((field) => escapeCsv(row[field])).join(",")),
  ].join("\n") + "\n";
}

export async function generateDispositionAudit() {
  const [admin1Text, admin2Text, summaryText] = await Promise.all([
    readFile(new URL("unmatched_admin1_references.json", DATA_DIR), "utf8"),
    readFile(new URL("unmatched_admin2_references.json", DATA_DIR), "utf8"),
    readFile(new URL("summary.json", DATA_DIR), "utf8"),
  ]);
  const rows = buildDispositionRows(JSON.parse(admin1Text), JSON.parse(admin2Text));
  const summary = buildDispositionSummary(rows, JSON.parse(summaryText));
  return { rows, summary, csv: toCsv(rows) };
}

async function main() {
  const { summary, csv } = await generateDispositionAudit();
  await Promise.all([
    writeFile(new URL("owner-approved-dispositions.csv", DATA_DIR), csv, "utf8"),
    writeFile(
      new URL("owner-approved-disposition-summary.json", DATA_DIR),
      JSON.stringify(summary, null, 2) + "\n",
      "utf8",
    ),
  ]);
  console.log(JSON.stringify({
    status: "PASS_OWNER_APPROVED_DISPOSITIONS_ONLY_NO_PARENT_LINKS",
    rows: summary.input_reference_counts,
    unique_affected_ids: summary.reconciliation.unique_affected_ids,
    current_admin_parent_path_blockers:
      summary.current_admin_features_requiring_country_specific_parent_path,
    country_level_records_no_admin_parent_required:
      summary.country_level_records_no_admin_parent_required,
    parent_ids_or_links_assigned: summary.parent_ids_or_links_assigned,
  }, null, 2));
}

if (process.argv[2] === "--write") await main();
