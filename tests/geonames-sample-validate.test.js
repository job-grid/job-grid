import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/geonames-sample-validate.mjs", import.meta.url), "utf8");

test("GeoNames preflight is source-pinned and explicit about its limited scope", () => {
  for (const name of ["KE.zip", "GB.zip", "JP.zip", "BR.zip", "SG.zip", "countryInfo.txt", "admin1CodesASCII.txt", "admin2Codes.txt", "readme.txt"]) {
    assert.ok(source.includes(name), `expected source ${name}`);
  }
  assert.match(source, /expected_sha256/);
  assert.match(source, /SHA256_MISMATCH/);
  assert.match(source, /BLOCK_SOURCE_MISSING/);
  assert.match(source, /no_database_operations/);
});

test("ISO numeric values are preserved as strings, including Brazil 076", () => {
  assert.match(source, /BR: \["BR", "BRA", "076"\]/);
  assert.match(source, /candidate_numeric_text/);
  assert.doesNotMatch(source, /parseInt\([^\n]*numeric/);
});

test("unmeasured validation counts are null, not fabricated zeros", () => {
  assert.match(source, /source_records_read: null/);
  assert.match(source, /accepted: null/);
  assert.match(source, /rejected: null/);
  assert.match(source, /quarantined: null/);
  assert.match(source, /Null means not measured/);
});

test("the command fails closed while ZIP parsing and ISO authority verification remain unavailable", () => {
  assert.match(source, /status: "BLOCKED"/);
  assert.match(source, /approved_iso_authority_verified: false/);
  assert.match(source, /process.exitCode = 2/);
});


test("documentation keeps owner-laptop sample evidence distinct from builder retrieval failures", async () => {
  const readme = await readFile(new URL("../docs/geonames-sample-validation/README.md", import.meta.url), "utf8");
  const report = await readFile(new URL("../docs/geonames-sample-validation-report-2026-10-10.json", import.meta.url), "utf8");
  const design = await readFile(new URL("../docs/country-catalog-database-foundation.md", import.meta.url), "utf8");
  const sourceManifest = await readFile(new URL("../docs/geonames-sample-validation/source-manifest.json", import.meta.url), "utf8");
  const builderReport = await readFile(new URL("../docs/geonames-sample-validation/results/validation-report.json", import.meta.url), "utf8");

  for (const document of [readme, report, design, sourceManifest, builderReport]) {
    assert.match(document, /13472324|13,472,324/);
    assert.match(document, /independently reproduced|full scan.*false|not.*reproduced/i);
    assert.match(document, /catalog acceptance.*BLOCKED|BLOCKED.*catalog acceptance/i);
  }
  assert.match(readme, /last_modified_utc/);
  assert.match(readme, /Singapore/);
  assert.match(readme, /not automatic invalid/i);
  assert.match(builderReport, /does not describe or negate the separate owner-laptop sample generation/i);
  assert.match(report, /admin1_crosswalk_not_found/);
  assert.match(report, /original-source SHA-256|original source bytes/i);
});
