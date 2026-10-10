import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../scripts/compare-iso3166-current-codes.py", import.meta.url);
const python = process.platform === "win32" ? "python" : "python3";

async function runFixture(t, isoCsv, geonamesText) {
  const dir = await mkdtemp(join(tmpdir(), "job-grid-iso-test-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const isoPath = join(dir, "synthetic-current-codes.csv");
  const geonamesPath = join(dir, "synthetic-countryInfo.txt");
  const reportPath = join(dir, "aggregate-report.json");
  await writeFile(isoPath, isoCsv, "utf8");
  await writeFile(geonamesPath, geonamesText, "utf8");

  const result = spawnSync(python, [
    script.pathname,
    "--iso-csv", isoPath,
    "--country-info", geonamesPath,
    "--output", reportPath,
    "--source-url", "https://example.invalid/synthetic-fixture-only",
    "--retrieved-at-utc", "2026-10-10T00:00:00Z",
    "--alpha2-column", "Alpha-2 code",
    "--alpha3-column", "Alpha-3 code",
    "--numeric-column", "Numeric code"
  ], { encoding: "utf8" });

  assert.equal(result.error, undefined, result.error?.message);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  return { result, report };
}

test("ISO comparator runs offline and emits aggregate counts without code tuples", async (t) => {
  const { result, report } = await runFixture(
    t,
    "Alpha-2 code,Alpha-3 code,Numeric code\nAA,AAA,001\nBB,BBB,002\n",
    "AA\tAAA\t001\nBB\tBBX\t999\nCC\tCCC\t003\n"
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(report.status, "MISMATCHES_FOUND_REVIEW_REQUIRED");
  assert.equal(report.counts.iso_valid_rows, 2);
  assert.equal(report.counts.geonames_rows_with_alpha2_found_in_iso, 2);
  assert.equal(report.counts.alpha3_conflict_rows_for_matching_alpha2, 1);
  assert.equal(report.counts.numeric3_conflict_rows_for_matching_alpha2, 1);
  assert.equal(report.counts.geonames_rows_without_iso_alpha2_match, 1);
  assert.equal(report.source_snapshot.snapshot_content_written_to_report, false);

  const serialized = JSON.stringify(report);
  for (const sourceValue of ["AA", "AAA", "BBX", "999", "CC", "CCC"]) {
    assert.ok(!serialized.includes(sourceValue), "aggregate report leaked a source code value: " + sourceValue);
  }
});

test("ISO comparator distinguishes a clean shared-code comparison from approval", async (t) => {
  const { result, report } = await runFixture(
    t,
    "Alpha-2 code,Alpha-3 code,Numeric code\nAA,AAA,001\n",
    "AA\tAAA\t001\nZZ\tZZZ\t999\n"
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.status, "PASS_SHARED_CODE_FIELDS_UNMATCHED_CANDIDATES_REVIEW_REQUIRED");
  assert.equal(report.counts.alpha3_conflict_rows_for_matching_alpha2, 0);
  assert.equal(report.counts.numeric3_conflict_rows_for_matching_alpha2, 0);
  assert.equal(report.counts.geonames_rows_without_iso_alpha2_match, 1);
  assert.ok(report.governance.database_operations === false);
});
