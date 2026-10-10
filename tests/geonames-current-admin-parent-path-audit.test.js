import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditCurrentAdminParents,
  buildAuditSummary,
  buildCurrentAdminTargets,
  parseCsv,
  parseGeoNamesLine,
  renderAuditCsv,
  validateRemoteSourceMetadata,
} from "../scripts/geonames-current-admin-parent-path-audit.mjs";

function geoRow({
  id,
  name = "Feature",
  feature = "ADM1",
  country = "XX",
  admin1 = "",
  admin2 = "",
  admin3 = "",
  admin4 = "",
  featureClass = "A",
  date = "2026-10-10",
}) {
  const fields = [
    id, name, name, "", "1", "2", featureClass, feature, country, "",
    admin1, admin2, admin3, admin4, "0", "", "", "UTC", date,
  ];
  return parseGeoNamesLine(fields.join("\t"));
}

function target({
  id,
  name = "Target",
  country = "XX",
  feature = "ADM3",
  admin1 = "01",
  admin2 = "02",
  disposition = "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED",
} = {}) {
  return {
    geonames_id: id,
    name,
    country_code: country,
    feature_code: feature,
    raw_admin1_code: admin1,
    raw_admin2_code: admin2,
    owner_approved_disposition: disposition,
  };
}

test("parses GeoNames source fields without changing raw administrative codes", () => {
  const row = geoRow({
    id: "300",
    name: "Feature",
    feature: "ADM3",
    country: "XX",
    admin1: "01",
    admin2: "02",
    admin3: "03",
  });
  assert.equal(row.geonames_id, "300");
  assert.equal(row.feature_code, "ADM3");
  assert.equal(row.country_code, "XX");
  assert.equal(row.admin1_code, "01");
  assert.equal(row.admin2_code, "02");
  assert.equal(row.admin3_code, "03");
});

test("builds an exact composite-code candidate path but never creates a parent link", () => {
  const targetRow = target({ id: "300", feature: "ADM3", admin1: "01", admin2: "02" });
  const sourceRows = [
    geoRow({ id: "1", name: "Country XX", feature: "PCLI", country: "XX" }),
    geoRow({ id: "10", name: "Level One", feature: "ADM1", country: "XX", admin1: "01" }),
    geoRow({ id: "20", name: "Level Two", feature: "ADM2", country: "XX", admin1: "01", admin2: "02" }),
    geoRow({ id: "300", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" }),
  ];

  const [result] = auditCurrentAdminParents([targetRow], sourceRows);
  assert.equal(result.parent_path_audit_status, "CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL");
  assert.equal(result.country_candidate_geonames_id, "1");
  assert.equal(result.candidate_adm1_geonames_id, "10");
  assert.equal(result.candidate_adm2_geonames_id, "20");
  assert.equal(result.candidate_path_geonames_ids, "1>10>20>300");
  assert.equal(result.operational_parent_link_created, false);
  assert.match(renderAuditCsv([result]), /CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL/);
});

test('does not normalize raw "00" or use it to synthesize an ADM1 parent', () => {
  const targetRow = target({
    id: "2000", name: "Unresolved Japan ADM4", country: "JP", feature: "ADM4",
    admin1: "00", admin2: "",
  });
  const sourceRows = [
    geoRow({ id: "1861060", name: "Japan", feature: "PCLI", country: "JP" }),
    geoRow({ id: "1861000", name: "Fake zero-code row", feature: "ADM1", country: "JP", admin1: "00" }),
    geoRow({ id: "2000", name: "Unresolved Japan ADM4", feature: "ADM4", country: "JP", admin1: "00" }),
  ];

  const [result] = auditCurrentAdminParents([targetRow], sourceRows);
  assert.equal(result.parent_path_audit_status, "BLOCKED_PARENT_CODE_MISSING_OR_PLACEHOLDER");
  assert.match(result.blocking_reason, /raw.*"00"/i);
  assert.equal(result.candidate_adm1_geonames_id, "");
  assert.equal(result.candidate_adm2_geonames_id, "");
  assert.equal(result.candidate_adm3_geonames_id, "");
  assert.equal(result.operational_parent_link_created, false);
});

test("blocks when an exact parent key is absent instead of matching by name", () => {
  const targetRow = target({ id: "300", feature: "ADM3", admin1: "01", admin2: "02" });
  const sourceRows = [
    geoRow({ id: "1", name: "Country XX", feature: "PCLI", country: "XX" }),
    geoRow({ id: "300", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" }),
  ];

  const [result] = auditCurrentAdminParents([targetRow], sourceRows);
  assert.equal(result.parent_path_audit_status, "BLOCKED_PARENT_KEY_NOT_FOUND");
  assert.match(result.blocking_reason, /exact same-country ADM1/i);
  assert.equal(result.candidate_adm1_geonames_id, "");
  assert.equal(result.operational_parent_link_created, false);
});

test("blocks an ambiguous composite key instead of choosing the first parent", () => {
  const targetRow = target({ id: "300", feature: "ADM3", admin1: "01", admin2: "02" });
  const sourceRows = [
    geoRow({ id: "1", name: "Country XX", feature: "PCLI", country: "XX" }),
    geoRow({ id: "10", name: "Level One A", feature: "ADM1", country: "XX", admin1: "01" }),
    geoRow({ id: "11", name: "Level One B", feature: "ADM1", country: "XX", admin1: "01" }),
    geoRow({ id: "300", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" }),
  ];

  const [result] = auditCurrentAdminParents([targetRow], sourceRows);
  assert.equal(result.parent_path_audit_status, "BLOCKED_PARENT_KEY_AMBIGUOUS");
  assert.match(result.blocking_reason, /more than one/i);
  assert.equal(result.candidate_adm1_geonames_id, "");
  assert.equal(result.operational_parent_link_created, false);
});

test("blocks identity or raw-code drift between target export and source snapshot", () => {
  const wrongIdentityTarget = target({ id: "300", feature: "ADM3", admin1: "01", admin2: "02" });
  const wrongIdentity = geoRow({ id: "300", name: "Target", feature: "PPL", country: "XX", admin1: "01", admin2: "02" });
  const [identityResult] = auditCurrentAdminParents([wrongIdentityTarget], [
    geoRow({ id: "1", name: "Country XX", feature: "PCLI", country: "XX" }),
    wrongIdentity,
  ]);
  assert.equal(identityResult.parent_path_audit_status, "BLOCKED_SOURCE_IDENTITY_MISMATCH");

  const driftTarget = target({ id: "301", feature: "ADM3", admin1: "03", admin2: "02" });
  const driftSource = geoRow({ id: "301", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" });
  const [driftResult] = auditCurrentAdminParents([driftTarget], [
    geoRow({ id: "1", name: "Country XX", feature: "PCLI", country: "XX" }),
    driftSource,
  ]);
  assert.equal(driftResult.parent_path_audit_status, "BLOCKED_SOURCE_RAW_CODE_MISMATCH");
});

test("selects only approved current ADM1-ADM4 hierarchy blockers and deduplicates matching IDs", () => {
  const rows = [
    target({ id: "300", feature: "ADM3" }),
    target({ id: "300", feature: "ADM3" }),
    target({ id: "400", feature: "ADM4" }),
    target({ id: "500", feature: "ADM4", disposition: "PRESERVE_HISTORICAL_NOT_CURRENT_ADMIN_SELECTOR" }),
  ];
  assert.deepEqual(buildCurrentAdminTargets(rows).map((row) => row.geonames_id), ["300", "400"]);
});

test("parses quoted CSV values with commas and doubled quotes", () => {
  const rows = parseCsv('id,name\n1,"Tokyo, ""Japan"""\n');
  assert.deepEqual(rows, [{ id: "1", name: 'Tokyo, "Japan"' }]);
});


test("CLI reads a pinned source fixture, writes auditable artifacts, and records zero operational links", async () => {
  const temp = await mkdtemp(join(tmpdir(), "geonames-parent-audit-"));
  try {
    const sourcePath = join(temp, "allCountries.txt");
    const targetPath = join(temp, "targets.csv");
    const outputPrefix = join(temp, "audit-output");
    const scriptPath = fileURLToPath(new URL("../scripts/geonames-current-admin-parent-path-audit.mjs", import.meta.url));
    const sourceRows = [
      geoRow({ id: "1", name: "Country XX", feature: "PCLI", country: "XX" }),
      geoRow({ id: "10", name: "Level One", feature: "ADM1", country: "XX", admin1: "01" }),
      geoRow({ id: "20", name: "Target ADM2", feature: "ADM2", country: "XX", admin1: "01", admin2: "02" }),
    ];
    const targetCsv = [
      "geonames_id,name,country_code,feature_code,raw_admin1_code,raw_admin2_code,owner_approved_disposition",
      "20,Target ADM2,XX,ADM2,01,02,PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED",
      "",
    ].join("\n");
    await writeFile(sourcePath, sourceRows.map((row) => [
      row.geonames_id, row.name, row.ascii_name, "", "1", "2", row.feature_class, row.feature_code,
      row.country_code, "", row.admin1_code, row.admin2_code, row.admin3_code, row.admin4_code,
      "0", "", "", "UTC", row.modification_date,
    ].join("\t")).join("\n") + "\n", "utf8");
    await writeFile(targetPath, targetCsv, "utf8");

    const processResult = spawnSync(process.execPath, [scriptPath, sourcePath, targetPath, outputPrefix], {
      encoding: "utf8",
    });
    assert.equal(processResult.status, 0, processResult.stderr || processResult.stdout);
    assert.match(processResult.stdout, /READ_ONLY_AUDIT_COMPLETE_NO_PARENT_LINKS_CREATED/);

    const [csv, summaryText] = await Promise.all([
      readFile(outputPrefix + ".csv", "utf8"),
      readFile(outputPrefix + ".json", "utf8"),
    ]);
    const summary = JSON.parse(summaryText);
    assert.equal(summary.target_count, 1);
    assert.equal(summary.candidate_paths_found_requiring_owner_approval, 1);
    assert.equal(summary.operational_parent_links_created, 0);
    assert.equal(summary.source.sha256.length, 64);
    assert.equal(summary.source.source_line_count, 3);
    assert.equal(summary.source.remote_retrieval_metadata_verified, false);
    assert.match(csv, /1>10>20/);
    assert.match(csv, /false$/m);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("validates exact official JP and KE archive retrieval metadata without inventing Last-Modified", () => {
  const metadata = {
    remote_sources: ["JP", "KE"].map((countryCode, index) => ({
      country_code: countryCode,
      archive_filename: countryCode + ".zip",
      source_url: "https://download.geonames.org/export/dump/" + countryCode + ".zip",
      retrieved_at_utc: "2026-10-11T01:00:00Z",
      http_status: 200,
      http_last_modified_utc: index === 0 ? "Sat, 10 Oct 2026 00:54:00 GMT" : null,
      archive_sha256: "a".repeat(64),
      archive_size_bytes: 12345 + index,
    })),
  };
  assert.equal(validateRemoteSourceMetadata(metadata), true);
  const summary = buildAuditSummary([], {
    remote_sources: metadata.remote_sources,
    remote_retrieval_metadata_verified: validateRemoteSourceMetadata(metadata),
  });
  assert.equal(summary.source.remote_retrieval_metadata_verified, true);
  assert.equal(summary.source.http_last_modified_captured, false);
  assert.equal(validateRemoteSourceMetadata({ remote_sources: metadata.remote_sources.slice(0, 1) }), false);
  assert.equal(validateRemoteSourceMetadata({
    remote_sources: metadata.remote_sources.map((source) => ({ ...source, http_status: 404 })),
  }), false);
});
