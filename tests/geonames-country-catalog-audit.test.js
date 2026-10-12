import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/geonames-country-catalog-audit.py", import.meta.url));
const python = process.platform === "win32" ? "python" : "python3";
const row = (id, name, featureClass, featureCode, { countryCode = "", admin1Code = "", admin2Code = "", admin3Code = "", admin4Code = "" } = {}) => {
  const fields = [id, name, name, "", "0", "0", featureClass, featureCode, countryCode, "", admin1Code, admin2Code, admin3Code, admin4Code, "0", "0", "UTC", "2026-01-01", ""];
  return fields.join("\t");
};
const countryInfo = ({ alpha2 = "AA", alpha3 = "AAA", numeric = "001", name = "Synthetic Country", id = "100" } = {}) =>
  [alpha2, alpha3, numeric, "", name, "", "1", "100", "EU", "", "", "", "", "", "", "en", id, "", ""].join("\t");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function writeZip(path, memberName, memberText) {
  const name = Buffer.from(memberName, "utf8");
  const data = Buffer.from(memberText, "utf8");
  const crc = crc32(data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + data.length, 16);
  await writeFile(path, Buffer.concat([local, data, central, end]));
}
async function runFixture(t, infoRows, pcliRows) {
  const dir = await mkdtemp(join(tmpdir(), "job-grid-country-audit-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const infoPath = join(dir, "synthetic-countryInfo.txt");
  const archivePath = join(dir, "synthetic-allCountries.zip");
  const reportPath = join(dir, "aggregate-report.json");
  await writeFile(infoPath, infoRows.join("\n") + "\n", "utf8");
  await writeZip(archivePath, "allCountries.txt", pcliRows.join("\n") + "\n");
  const result = spawnSync(python, [
    script, "--all-countries-zip", archivePath, "--country-info", infoPath, "--output", reportPath
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const coveragePath = join(dir, "geonames-destination-source-coverage.json");
  const destinationCoverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const coverageCsvPath = join(dir, "geonames-destination-coverage-by-source-country.csv");
  const destinationCoverageCsv = await readFile(coverageCsvPath, "utf8");
  return { result, report, destinationCoverage, destinationCoverageCsv };
}

test("countryInfo and PCLI IDs reconcile and the aggregate report contains no source rows", async (t) => {
  const { result, report } = await runFixture(
    t, [countryInfo()], [row("100", "Synthetic Country", "A", "PCLI")]
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.status, "PASS_GEO_NAMES_COUNTRY_IDENTITY_AUDIT");
  assert.equal(report.counts.country_info_rows, 1);
  assert.equal(report.counts.pcli_rows, 1);
  assert.equal(report.counts.country_info_ids_matching_pcli, 1);
  assert.equal(report.counts.country_info_ids_not_pcli, 0);
  assert.equal(report.counts.country_info_ids_matching_current_or_territory_feature, 1);
  assert.equal(report.counts.country_info_ids_matching_any_recognized_country_feature, 1);
  assert.equal(report.counts.country_info_ids_without_recognized_country_feature, 0);
  assert.equal(report.counts.pcli_ids_without_country_info, 0);
  const json = JSON.stringify(report);
  for (const privateValue of ["Synthetic Country", "AA", "AAA", "001", "100"]) {
    assert.ok(!json.includes(privateValue), "aggregate report leaked source value " + privateValue);
  }
});

test("a missing recognized country feature identity blocks the audit", async (t) => {
  const { result, report } = await runFixture(
    t, [countryInfo()], [row("200", "Different Entity", "A", "PCLI")]
  );
  assert.equal(result.status, 1);
  assert.equal(report.status, "BLOCKED_REVIEW_REQUIRED");
  assert.equal(report.counts.country_info_ids_without_recognized_country_feature, 1);
  assert.equal(report.counts.current_or_territory_feature_ids_without_country_info, 1);
  assert.equal(report.counts.pcli_ids_without_country_info, 1);
});

test("dependent and historical political features are categorized without false PCLI gaps", async (t) => {
  const { result, report } = await runFixture(
    t,
    [
      countryInfo({ alpha2: "AA", alpha3: "AAA", numeric: "001", name: "Independent Synthetic Entity", id: "100" }),
      countryInfo({ alpha2: "AB", alpha3: "ABA", numeric: "002", name: "Dependent Synthetic Entity", id: "101" }),
      countryInfo({ alpha2: "AC", alpha3: "ACA", numeric: "003", name: "Historical Synthetic Entity", id: "102" })
    ],
    [
      row("100", "Independent Synthetic Entity", "A", "PCLI"),
      row("101", "Dependent Synthetic Entity", "A", "PCLD"),
      row("102", "Historical Synthetic Entity", "A", "PCLH"),
      row("103", "Current Territory Not In CountryInfo", "A", "PCLS")
    ]
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.status, "PASS_GEO_NAMES_COUNTRY_IDENTITY_WITH_REVIEW_ITEMS");
  assert.equal(report.counts.country_info_ids_matching_pcli, 1);
  assert.equal(report.counts.country_info_ids_not_pcli, 2);
  assert.equal(report.counts.country_info_ids_matching_current_or_territory_feature, 2);
  assert.equal(report.counts.country_info_ids_matching_historical_political_feature, 1);
  assert.equal(report.counts.country_info_ids_matching_any_recognized_country_feature, 3);
  assert.equal(report.counts.country_info_ids_without_recognized_country_feature, 0);
  assert.equal(report.counts.current_or_territory_feature_ids_without_country_info, 1);
  assert.equal(report.interpretation.current_or_territory_feature_to_country_info_id_join, "REVIEW_SCOPE_ONLY");
  assert.equal(report.interpretation.iso3166_authority_comparison, "NOT_PERFORMED");
});

test("a numeric-code format anomaly and historic metadata remain review items", async (t) => {
  const { result, report } = await runFixture(
    t,
    [countryInfo({ numeric: "--" })],
    [row("100", "Synthetic Country", "A", "PCLI")]
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.status, "PASS_GEO_NAMES_COUNTRY_IDENTITY_WITH_REVIEW_ITEMS");
  assert.equal(report.counts.country_info_invalid_numeric3_rows, 1);
  assert.equal(report.interpretation.numeric3_format_review_required, 1);
  assert.equal(report.interpretation.catalog_acceptance, "BLOCKED_PENDING_ISO_REVIEW_AND_OTHER_ACCEPTANCE_GATES");
});

test("duplicate country codes and duplicate country IDs block the audit", async (t) => {
  const { result, report } = await runFixture(
    t,
    [
      countryInfo(),
      countryInfo({ alpha2: "AB", alpha3: "ABA", numeric: "002", name: "Second Synthetic Country", id: "101" }),
      countryInfo({ alpha2: "AA", alpha3: "AAA", numeric: "001", name: "Third Synthetic Country", id: "101" })
    ],
    [row("101", "Country One", "A", "PCLI"), row("101", "Country Two", "A", "PCLI")]
  );
  assert.equal(result.status, 1);
  assert.equal(report.status, "BLOCKED_REVIEW_REQUIRED");
  assert.equal(report.counts.country_info_duplicate_alpha2_groups, 1);
  assert.equal(report.counts.country_info_duplicate_alpha3_groups, 1);
  assert.equal(report.counts.country_info_duplicate_numeric3_groups, 1);
  assert.equal(report.counts.country_info_duplicate_geoname_id_groups, 1);
  assert.equal(report.counts.pcli_duplicate_geoname_id_groups, 1);
});

test("malformed countryInfo and worldwide rows fail closed", async (t) => {
  const { result, report } = await runFixture(
    t,
    [countryInfo().split("\t").slice(0, 10).join("\t")],
    [row("100", "Synthetic Country", "A", "PCLI").split("\t").slice(0, 9).join("\t")]
  );
  assert.equal(result.status, 1);
  assert.equal(report.status, "BLOCKED_REVIEW_REQUIRED");
  assert.equal(report.counts.country_info_malformed_rows, 1);
  assert.equal(report.counts.all_countries_malformed_rows, 1);
});
test("destination coverage distinguishes current place candidates, administrative levels, and historical places", async (t) => {
  const { result, report, destinationCoverage, destinationCoverageCsv } = await runFixture(
    t,
    [
      countryInfo({ alpha2: "KE", alpha3: "KEN", numeric: "404", name: "Kenya", id: "100" }),
      countryInfo({ alpha2: "GB", alpha3: "GBR", numeric: "826", name: "United Kingdom", id: "101" })
    ],
    [
      row("100", "Kenya", "A", "PCLI"),
      row("101", "United Kingdom", "A", "PCLI"),
      row("200", "Nairobi", "P", "PPLC", { countryCode: "KE", admin1Code: "05" }),
      row("201", "Kisumu", "P", "PPL", { countryCode: "KE", admin1Code: "26", admin2Code: "KIS" }),
      row("202", "Historic Kenya Place", "P", "PPLH", { countryCode: "KE" }),
      row("203", "London", "P", "PPL", { countryCode: "GB", admin1Code: "ENG" }),
      row("204", "Kenya first-level unit", "A", "ADM1", { countryCode: "KE", admin1Code: "05" }),
      row("205", "Kenya second-level unit", "A", "ADM2", { countryCode: "KE", admin1Code: "05", admin2Code: "KIS" })
    ]
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(destinationCoverage.current_place_candidate_rows, 3);
  assert.equal(destinationCoverage.historical_or_noncurrent_place_rows, 1);
  assert.equal(destinationCoverage.current_admin1_rows, 1);
  assert.equal(destinationCoverage.current_admin2_rows, 1);
  assert.equal(destinationCoverage.country_info_alpha2_code_rows, 2);
  assert.equal(destinationCoverage.country_info_alpha2_codes_with_current_place_candidates, 2);
  assert.equal(destinationCoverage.country_info_alpha2_codes_without_current_place_candidates, 0);
  assert.equal(destinationCoverage.selectable_destinations_approved, false);
  assert.equal(destinationCoverage.worldwide_destination_completeness, "NOT_ESTABLISHED_BY_SOURCE_COUNTS_ALONE");
  assert.equal(report.interpretation.destination_coverage, "SOURCE_FEATURE_DISTRIBUTION_AUDITED_NOT_WORLDWIDE_PRODUCT_COMPLETENESS");
  assert.equal(report.interpretation.destination_candidate_rows, 3);
  const coverageLines = destinationCoverageCsv.trim().split("\\n");
  const countryCodeColumn = coverageLines[0].split(",").indexOf("source_country_code");
  assert.ok(countryCodeColumn >= 0);
  assert.ok(coverageLines.slice(1).some(line => line.split(",")[countryCodeColumn] === "KE"));
});

test("a country with only historical/abandoned places is surfaced without auto-selection", async (t) => {
  const { result, destinationCoverage } = await runFixture(
    t,
    [countryInfo({ alpha2: "KE", alpha3: "KEN", numeric: "404", name: "Kenya", id: "100" })],
    [
      row("100", "Kenya", "A", "PCLI"),
      row("202", "Historic Kenya Place", "P", "PPLH", { countryCode: "KE" }),
      row("203", "Abandoned Kenya Place", "P", "PPLQ", { countryCode: "KE" })
    ]
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(destinationCoverage.current_place_candidate_rows, 0);
  assert.equal(destinationCoverage.historical_or_noncurrent_place_rows, 2);
  assert.equal(destinationCoverage.country_info_alpha2_codes_without_current_place_candidates, 1);
  assert.equal(destinationCoverage.selectable_destinations_approved, false);
});
