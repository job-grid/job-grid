import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExceptionSourceAuditSummary,
  buildUniqueExceptionTargets,
  compareExceptionTarget,
  validateAllCountriesManifest,
} from "../scripts/geonames-crosswalk-exception-source-audit.mjs";
import { parseGeoNamesLine } from "../scripts/geonames-current-admin-parent-path-audit.mjs";

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

function exception({
  id = "300",
  name = "Target",
  country = "XX",
  feature = "ADM3",
  admin1 = "01",
  admin2 = "02",
  reference = "admin1",
} = {}) {
  return {
    geonames_id: id,
    name,
    country_code: country,
    feature_code: feature,
    raw_admin1_code: admin1,
    raw_admin2_code: admin2,
    reference_level: reference,
  };
}

test("deduplicates exception IDs while preserving level coverage and original raw codes", () => {
  const rows = buildUniqueExceptionTargets([
    exception({ id: "300", reference: "admin1" }),
    exception({ id: "300", reference: "admin2" }),
    exception({ id: "400", country: "KE", admin1: "01", admin2: "" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].geonames_id, "300");
  assert.equal(rows[0].reference_rows, 2);
  assert.deepEqual(rows[0].reference_levels, ["admin1", "admin2"]);
  assert.equal(rows[0].raw_admin1_code, "01");
  assert.equal(rows[0].raw_admin2_code, "02");
});

test("fails closed if overlapping exception rows disagree on identity or raw codes", () => {
  assert.throws(() => buildUniqueExceptionTargets([
    exception({ id: "300", name: "One" }),
    exception({ id: "300", name: "Two" }),
  ]), /Conflicting exception exports/);
  assert.throws(() => buildUniqueExceptionTargets([
    exception({ id: "300", admin1: "01" }),
    exception({ id: "300", admin1: "03" }),
  ]), /Conflicting exception exports/);
});

test("marks exact source identity and raw admin codes as matched without creating parents", () => {
  const target = buildUniqueExceptionTargets([exception({ id: "300" })])[0];
  const row = compareExceptionTarget(target, [
    geoRow({ id: "300", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" }),
  ]);
  assert.equal(row.source_match_status, "SOURCE_IDENTITY_AND_RAW_CODES_MATCH");
  assert.equal(row.mismatched_fields, "");
  assert.equal(row.source_admin3_code, "03");
  assert.equal(row.source_record_count_for_id, 1);
});

test("detects raw-code drift separately and never normalizes the exception value", () => {
  const target = buildUniqueExceptionTargets([exception({ id: "300", admin1: "00", admin2: "" })])[0];
  const row = compareExceptionTarget(target, [
    geoRow({ id: "300", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" }),
  ]);
  assert.equal(row.source_match_status, "BLOCKED_SOURCE_RAW_CODE_OR_IDENTITY_MISMATCH");
  assert.equal(row.raw_admin1_code, "00");
  assert.equal(row.source_admin1_code, "01");
  assert.match(row.mismatched_fields, /raw_admin1_code/);
});

test("blocks source rows missing or duplicated by GeoNames ID", () => {
  const target = buildUniqueExceptionTargets([exception({ id: "300" })])[0];
  assert.equal(compareExceptionTarget(target, []).source_match_status, "BLOCKED_SOURCE_ID_NOT_FOUND");
  assert.equal(compareExceptionTarget(target, [
    geoRow({ id: "300", name: "Target", feature: "ADM3", admin1: "01", admin2: "02" }),
    geoRow({ id: "300", name: "Target", feature: "ADM3", admin1: "01", admin2: "02" }),
  ]).source_match_status, "BLOCKED_DUPLICATE_SOURCE_ID");
});

test("requires exact official allCountries URL, HTTP 200, timestamp and source fingerprint", () => {
  const metadata = {
    remote_sources: [{
      country_code: "WORLD",
      archive_filename: "allCountries.zip",
      source_url: "https://download.geonames.org/export/dump/allCountries.zip",
      retrieved_at_utc: "2026-10-11T01:00:00Z",
      http_status: 200,
      http_last_modified_utc: null,
      archive_sha256: "b".repeat(64),
      archive_size_bytes: 45678,
      zip_crc_validation: "PASS",
    }],
  };
  assert.equal(validateAllCountriesManifest(metadata), true);
  assert.equal(validateAllCountriesManifest({ remote_sources: [] }), false);
  assert.equal(validateAllCountriesManifest({
    remote_sources: [{ ...metadata.remote_sources[0], http_status: 403 }],
  }), false);
  const rows = [{
    country_code: "XX",
    source_match_status: "SOURCE_IDENTITY_AND_RAW_CODES_MATCH",
  }];
  const summary = buildExceptionSourceAuditSummary(rows, { remote_retrieval_metadata_verified: true });
  assert.equal(summary.source_identity_and_raw_codes_match, 1);
  assert.equal(summary.parent_ids_or_links_assigned, 0);
});

test("CLI writes row-level mismatch report and source hash using a small fixture", async () => {
  const temp = await mkdtemp(join(tmpdir(), "geonames-exception-source-audit-"));
  try {
    const sourcePath = join(temp, "allCountries.txt");
    const exceptionPath = join(temp, "exceptions.csv");
    const manifestPath = join(temp, "source-manifest.json");
    const prefix = join(temp, "audit");
    const script = fileURLToPath(new URL("../scripts/geonames-crosswalk-exception-source-audit.mjs", import.meta.url));
    const source = geoRow({ id: "300", name: "Target", feature: "ADM3", country: "XX", admin1: "01", admin2: "02", admin3: "03" });
    const sourceLine = [
      source.geonames_id, source.name, source.ascii_name, "", "1", "2",
      source.feature_class, source.feature_code, source.country_code, "",
      source.admin1_code, source.admin2_code, source.admin3_code, source.admin4_code,
      "0", "", "", "UTC", source.modification_date,
    ].join("\t");
    await writeFile(sourcePath, sourceLine + "\n", "utf8");
    await writeFile(exceptionPath, [
      "reference_level,geonames_id,name,country_code,feature_code,raw_admin1_code,raw_admin2_code",
      "admin1,300,Target,XX,ADM3,01,02",
      "admin2,301,Missing,XX,ADM3,03,04",
      "",
    ].join("\n"), "utf8");
    await writeFile(manifestPath, JSON.stringify({
      remote_sources: [{
        country_code: "WORLD",
        archive_filename: "allCountries.zip",
        source_url: "https://download.geonames.org/export/dump/allCountries.zip",
        retrieved_at_utc: "2026-10-11T01:00:00Z",
        http_status: 200,
        archive_sha256: "b".repeat(64),
        archive_size_bytes: 45678,
        zip_crc_validation: "PASS",
      }],
    }), "utf8");

    const proc = spawnSync(process.execPath, [script, sourcePath, exceptionPath, prefix, manifestPath], { encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout, /READ_ONLY_EXCEPTION_SOURCE_AUDIT_COMPLETE_NO_PARENT_LINKS/);
    const [csv, summaryText] = await Promise.all([
      readFile(prefix + ".csv", "utf8"),
      readFile(prefix + ".json", "utf8"),
    ]);
    const summary = JSON.parse(summaryText);
    assert.equal(summary.unique_exception_ids, 2);
    assert.equal(summary.source_identity_and_raw_codes_match, 1);
    assert.equal(summary.blocked_or_drifted_ids, 1);
    assert.equal(summary.status_counts.SOURCE_IDENTITY_AND_RAW_CODES_MATCH, 1);
    assert.equal(summary.status_counts.BLOCKED_SOURCE_ID_NOT_FOUND, 1);
    assert.equal(summary.input.remote_retrieval_metadata_verified, true);
    assert.match(csv, /BLOCKED_SOURCE_ID_NOT_FOUND/);
    assert.equal(summary.parent_ids_or_links_assigned, 0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
