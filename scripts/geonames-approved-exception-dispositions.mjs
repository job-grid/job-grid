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
const CURRENT_POPULATED_PLACE_CODES = new Set([
  "PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5",
  "PPLC", "PPLCD", "PPLF", "PPLG", "PPLL", "PPLR", "PPLS",
]);
const HISTORICAL_OR_NONCURRENT_POPULATED_PLACE_CODES = new Set([
  "PPLCH", "PPLH", "PPLQ", "PPLW",
]);

function getCountryScopedDestinationTreatment(featureCode) {
  if (featureCode === "PCLI") {
    return {
      country_scoped_destination_treatment: "COUNTRY_AREA_NOT_A_POPULATED_PLACE_DESTINATION",
      country_scoped_destination_operational_selectable: false,
    };
  }
  if (CURRENT_POPULATED_PLACE_CODES.has(featureCode)) {
    return {
      country_scoped_destination_treatment:
        "CURRENT_POPULATED_PLACE_CANDIDATE__ADMIN_PARENT_NOT_REQUIRED_FOR_COUNTRY_ONLY_SEARCH",
      country_scoped_destination_operational_selectable: false,
    };
  }
  if (HISTORICAL_OR_NONCURRENT_POPULATED_PLACE_CODES.has(featureCode)) {
    return {
      country_scoped_destination_treatment: "HISTORICAL_OR_NONCURRENT_POPULATED_PLACE_HELD_OUT",
      country_scoped_destination_operational_selectable: false,
    };
  }
  if (featureCode.startsWith("PPL")) {
    return {
      country_scoped_destination_treatment: "OTHER_POPULATED_PLACE_FAMILY_TYPE_REQUIRES_REVIEW",
      country_scoped_destination_operational_selectable: false,
    };
  }
  if (/^ADM/.test(featureCode)) {
    return {
      country_scoped_destination_treatment: "ADMINISTRATIVE_ENTITY__USE_ADMIN_CATALOG_POLICY",
      country_scoped_destination_operational_selectable: false,
    };
  }
  return {
    country_scoped_destination_treatment: "OUTSIDE_APPROVED_CURRENT_POPULATED_PLACE_SCOPE__REVIEW_REQUIRED",
    country_scoped_destination_operational_selectable: false,
  };
}

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
    Object.assign(row, disposition, getCountryScopedDestinationTreatment(row.feature_code), {
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
  const countryScopedPlaceCandidates = uniqueRows.filter(
    (row) => row.country_scoped_destination_treatment.startsWith("CURRENT_POPULATED_PLACE_CANDIDATE__")
  );
  const otherPplReviewRows = uniqueRows.filter(
    (row) => row.country_scoped_destination_treatment === "OTHER_POPULATED_PLACE_FAMILY_TYPE_REQUIRES_REVIEW"
  );
  const historicalPlaceRows = uniqueRows.filter(
    (row) => row.country_scoped_destination_treatment === "HISTORICAL_OR_NONCURRENT_POPULATED_PLACE_HELD_OUT"
  );
  const countryAreaRows = uniqueRows.filter(
    (row) => row.country_scoped_destination_treatment === "COUNTRY_AREA_NOT_A_POPULATED_PLACE_DESTINATION"
  );

  return {
    report_version: "1.2",
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
    country_scoped_destination_review: {
      scope: "five-country crosswalk-exception union only; not a worldwide catalogue total",
      unique_exception_records: uniqueRows.length,
      current_populated_place_candidate_unique_ids: countryScopedPlaceCandidates.length,
      current_populated_place_candidate_ids_by_feature_code: countBy(countryScopedPlaceCandidates, "feature_code"),
      current_populated_place_candidate_ids_by_source_country_code: countBy(countryScopedPlaceCandidates, "country_code"),
      other_populated_place_family_unique_ids_held_for_review: otherPplReviewRows.length,
      historical_or_noncurrent_place_unique_ids_held: historicalPlaceRows.length,
      country_area_entities_not_place_destinations: countryAreaRows.length,
      administrative_parent_required_for_country_only_search: false,
      source_country_to_internal_country_mapping_approved: false,
      current_place_candidates_waiting_for_country_mapping_review: countryScopedPlaceCandidates.length,
      operational_selectable_rows: 0,
      parent_links_created: 0,
      policy: "A verified current populated place may be considered for country-only search without an administrative parent, but it must not be assigned to a region/county or used in hierarchical filtering until that parent edge is verified.",
    },
    initial_operational_admin_catalog: {
      source_exception_rows_preserved: true,
      current_admin_records_excluded_for_unresolved_parent_path: currentAdminFeatures,
      current_admin_records_eligible_from_this_exception_set: 0,
      reentry_rule: "Re-admit only after row-level identity, administrative level, effective period where relevant, and immediate-parent path are verified and reviewed.",
    },
    non_country_references_still_needing_hierarchy_or_association_review:
      rows.filter((row) => row.owner_approved_disposition !== "COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED").length,
    per_country: perCountry,
    limitations: [
      "These dispositions apply approved conservative policy to existing feature codes; they do not claim a missing crosswalk key was found.",
      "All current ADM1-ADM4 records in this unresolved-exception set are excluded from the initial operational administrative catalog, not only hidden from selectors; the original source rows remain in the audit exports.",
      "An excluded current administrative record can re-enter a later catalog release only after row-level identity, administrative level, effective period where relevant, and the immediate-parent path are verified and reviewed.",
      "Historical and undifferentiated entities are retained, not declared invalid, and are not current administrative selector options by default.",
      "Country-level PCLI entities require no administrative parent; their raw source codes are still preserved unchanged.",
      "Place/non-admin entities are preserved; their administrative association can remain unresolved.",
      "Country-scoped current-place candidates are distinct from administrative-selector eligibility; their operational selection still requires an approved source-country-to-internal-country mapping, and no parent edge is inferred.",
      "No parent IDs, migrations, seeds, imports, database, deployment or production changes are performed.",
    ],
  };
}

const CSV_FIELDS = [
  "reference_level", "geonames_id", "name", "country_code", "feature_code",
  "raw_admin1_code", "raw_admin2_code", "missing_reference_category",
  "proposed_review_classification", "crosswalk_lookup_key", "raw_missing_code",
  "owner_policy_approval_date", "owner_approved_disposition",
  "current_admin_selector_treatment", "country_scoped_destination_treatment",
  "country_scoped_destination_operational_selectable", "parent_link_created",
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

const INITIAL_ADMIN_EXCLUSION_FIELDS = [
  "geonames_id",
  "name",
  "country_code",
  "feature_code",
  "raw_admin1_code",
  "raw_admin2_code",
  "initial_operational_admin_catalog_disposition",
  "exclusion_reason",
  "parent_link_created",
];

export function toInitialAdminCatalogExclusionCsv(rows) {
  const excluded = rows
    .filter((row) =>
      row.owner_approved_disposition === "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED" &&
      /^ADM[1-4]$/.test(row.feature_code))
    .filter((row, index, all) =>
      all.findIndex((candidate) => candidate.geonames_id === row.geonames_id) === index)
    .sort((a, b) =>
      a.country_code.localeCompare(b.country_code) ||
      Number(a.geonames_id) - Number(b.geonames_id));

  return [
    INITIAL_ADMIN_EXCLUSION_FIELDS.join(","),
    ...excluded.map((row) => {
      const exclusionReason = row.country_code === "JP" && row.raw_admin1_code === "00"
        ? "RAW_ADMIN1_00_GENERAL_FEATURE_ANCESTOR_UNRESOLVED"
        : "EXACT_COUNTRY_ADMIN_PARENT_KEY_NOT_FOUND";
      const result = {
        geonames_id: row.geonames_id,
        name: row.name,
        country_code: row.country_code,
        feature_code: row.feature_code,
        raw_admin1_code: row.raw_admin1_code,
        raw_admin2_code: row.raw_admin2_code,
        initial_operational_admin_catalog_disposition:
          "EXCLUDE_FROM_INITIAL_OPERATIONAL_CATALOG_UNRESOLVED_PARENT_PATH",
        exclusion_reason: exclusionReason,
        parent_link_created: false,
      };
      return INITIAL_ADMIN_EXCLUSION_FIELDS.map((field) => escapeCsv(result[field])).join(",");
    }),
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
  return {
    rows,
    summary,
    csv: toCsv(rows),
    initialAdminCatalogExclusionCsv: toInitialAdminCatalogExclusionCsv(rows),
  };
}

async function main() {
  const { summary, csv, initialAdminCatalogExclusionCsv } = await generateDispositionAudit();
  await Promise.all([
    writeFile(new URL("owner-approved-dispositions.csv", DATA_DIR), csv, "utf8"),
    writeFile(
      new URL("initial-operational-admin-catalog-exclusions.csv", DATA_DIR),
      initialAdminCatalogExclusionCsv,
      "utf8",
    ),
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
    excluded_from_initial_operational_admin_catalog:
      summary.initial_operational_admin_catalog.current_admin_records_excluded_for_unresolved_parent_path,
    eligible_from_these_unresolved_current_admin_exceptions:
      summary.initial_operational_admin_catalog.current_admin_records_eligible_from_this_exception_set,
    country_level_records_no_admin_parent_required:
      summary.country_level_records_no_admin_parent_required,
    country_scoped_current_place_candidates:
      summary.country_scoped_destination_review.current_populated_place_candidate_unique_ids,
    country_scoped_candidates_operationally_selectable: 0,
    parent_ids_or_links_assigned: summary.parent_ids_or_links_assigned,
  }, null, 2));
}

if (process.argv[2] === "--write") await main();
