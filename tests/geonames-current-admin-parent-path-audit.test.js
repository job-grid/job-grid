import test from "node:test";
import assert from "node:assert/strict";
import {
  auditCurrentAdminParents,
  buildCurrentAdminTargets,
  parseCsv,
  parseGeoNamesLine,
  renderAuditCsv,
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
