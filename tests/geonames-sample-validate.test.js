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

test("the owner-laptop five-country comparison passes while global source and ISO gates remain incomplete", () => {
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
  const stageCReport = await readFile(new URL("../docs/geonames-sample-independent-source-verification-2026-10-10.md", import.meta.url), "utf8");
  const stageCJson = await readFile(new URL("../docs/geonames-sample-independent-source-verification-2026-10-10.json", import.meta.url), "utf8");

  for (const document of [readme, report, sourceManifest, builderReport]) {
    assert.match(document, /13472324|13,472,324/);
    assert.match(document, /independently reproduced|independently_reproduced|not independently reproduced|builder did not/i);
  }
  assert.match(readme, /catalog acceptance.*BLOCKED|BLOCKED.*catalog acceptance/i);
  assert.match(report, /catalog_acceptance.*BLOCKED/);
  assert.match(sourceManifest, /stage_b_independent_source_pinned_reproducibility/);
  assert.match(builderReport, /Stage A|stage_a_owner_laptop_sample_generation_and_artifact_inspection/);
  assert.match(design, /## 5C\. Reconciled evidence status/);
  assert.match(design, /13,472,324/);
  assert.match(design, /Stage A.*Stage B/s);
  assert.match(readme, /last_modified_utc/);
  assert.match(readme, /Singapore/);
  assert.match(readme, /not automatic invalid/i);
  assert.match(builderReport, /does not describe or negate the separate owner-laptop sample generation/i);
  assert.match(report, /admin1_crosswalk_not_found/);
  assert.match(report, /original-source SHA-256|original source bytes/i);
  assert.match(stageCReport, /Stage C sample-record comparison: PASS/);
  assert.match(stageCReport, /25,685/);
  assert.match(stageCReport, /all 19 original fields/);
  assert.match(stageCReport, /admin1CodesASCII.txt.*3,865/s);
  assert.match(stageCReport, /admin2Codes.txt.*47,642/s);
  assert.match(stageCReport, /24 Singapore/);
  assert.match(stageCReport, /catalog acceptance remains .*BLOCKED/i);
  assert.match(stageCJson, /"five_country_sample_record_comparison": "PASS"/);
  assert.match(stageCJson, /"sample_ids_matched": 25685/);
  assert.match(stageCJson, /"missing_sample_ids": 0/);
  assert.match(stageCJson, /"admin1_unmatched": 2161/);
  assert.match(stageCJson, /"source_record_exact_match_to_KE_zip": true/);
  assert.match(sourceManifest, /owner_laptop_five_country_archive_comparison/);
});
