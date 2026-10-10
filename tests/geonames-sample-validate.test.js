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

 
test("crosswalk exports have deterministic schemas, sorting, and measured aggregate counts", async () => {
 const fs = await import("node:fs/promises");
 const a1 = JSON.parse(await fs.readFile(new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin1_references.json", import.meta.url), "utf8"));
 const a2 = JSON.parse(await fs.readFile(new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin2_references.json", import.meta.url), "utf8"));
 const summary = JSON.parse(await fs.readFile(new URL("../docs/geonames-sample-independent-source-verification-2026-10-10.json", import.meta.url), "utf8")).crosswalk_exception_reconciliation;
 const sourceSummary = JSON.parse(await fs.readFile(new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/summary.json", import.meta.url), "utf8"));
 const keys = ["geonames_id","name","country_code","feature_code","raw_admin1_code","raw_admin2_code","missing_reference_category","proposed_review_classification","crosswalk_lookup_key","raw_missing_code"];
 for (const rows of [a1,a2]) {
  for (const row of rows) assert.deepEqual(Object.keys(row), keys);
  const compareRows = (a,b) => {
    for (const key of ["country_code","geonames_id","raw_admin1_code","raw_admin2_code","feature_code","name"]) {
      if (a[key] < b[key]) return -1;
      if (a[key] > b[key]) return 1;
    }
    return 0;
  };
  assert.deepEqual(rows, [...rows].sort(compareRows));
  assert.ok(rows.every(r => !("parent_id" in r) && !("proposed_parent_id" in r)));
 }
 assert.equal(a1.length,2333); assert.equal(new Set(a1.map(r=>r.geonames_id)).size,2333);
 assert.equal(a2.length,240); assert.equal(new Set(a2.map(r=>r.geonames_id)).size,240);
 assert.equal(summary.counts.records_in_both_exception_categories,157);
 assert.equal(summary.counts.unique_records_in_either_exception_category,2416);
 assert.equal(summary.singapore.prior_exception_count,24);
 assert.equal(summary.singapore.broader_admin1_miss_count,142);
 assert.equal(summary.singapore.exact_id_overlap_count,24);
 assert.equal(summary.singapore.prior_only_count,0);
 assert.equal(summary.singapore.broader_only_count,118);
 assert.equal(summary.singapore.raw_admin1_code_counts["00"],118);
 assert.equal(sourceSummary.prior_sg_exception_ids,24);
 assert.equal(sourceSummary.broader_sg_admin1_misses,142);
 assert.equal(sourceSummary.sg_prior_exception_ids_overlap,24);
 assert.deepEqual(sourceSummary.sg_prior_only_ids,[]);
 assert.equal(sourceSummary.sg_broader_only_ids.length,118);
 const sgIds = a1.filter(r=>r.country_code==="SG").map(r=>r.geonames_id).sort();
 assert.deepEqual(sgIds.filter(id=>sourceSummary.sg_exact_overlap_ids.includes(id)), [...sourceSummary.sg_exact_overlap_ids].sort());
 assert.deepEqual(sgIds.filter(id=>sourceSummary.sg_broader_only_ids.includes(id)), [...sourceSummary.sg_broader_only_ids].sort());
 assert.deepEqual([...sourceSummary.sg_exact_overlap_ids].sort().filter(id=>sourceSummary.sg_broader_only_ids.includes(id)), []);
 assert.equal(summary.global_gates.full_worldwide_scan_reproduction,"UNVERIFIED");
 assert.equal(summary.global_gates.current_owner_approved_iso_comparison,"UNVERIFIED");
});

test("unmatched codes remain unresolved and exports prohibit fabricated parent links", async () => {
 const fs = await import("node:fs/promises");
 const rows = [
  ...JSON.parse(await fs.readFile(new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin1_references.json", import.meta.url), "utf8")),
  ...JSON.parse(await fs.readFile(new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin2_references.json", import.meta.url), "utf8"))
 ];
 for (const row of rows) {
  assert.ok(row.missing_reference_category);
  assert.ok(row.proposed_review_classification.startsWith("UNRESOLVED_"));
  assert.ok(!("parent_id" in row) && !("proposed_parent_id" in row));
  if (row.raw_missing_code === "00") assert.equal(row.proposed_review_classification,"UNRESOLVED_PLACEHOLDER_CODE");
  else assert.equal(row.proposed_review_classification,"UNRESOLVED_MISSING_OR_VERSION_DEPENDENT_REFERENCE");
 }
});


test("row-level CSV files mirror the JSON counts and expected field schema", async () => {
  const dir = new URL("../docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/", import.meta.url);
  const admin1Csv = await readFile(new URL("unmatched_admin1_references.csv", dir), "utf8");
  const admin2Csv = await readFile(new URL("unmatched_admin2_references.csv", dir), "utf8");
  const expectedHeader = "geonames_id,name,country_code,feature_code,raw_admin1_code,raw_admin2_code,missing_reference_category,proposed_review_classification,crosswalk_lookup_key,raw_missing_code";
  const admin1Lines = admin1Csv.split("\n").map(line => line.replace(/\r$/, "")).filter(Boolean);
  const admin2Lines = admin2Csv.split("\n").map(line => line.replace(/\r$/, "")).filter(Boolean);
  assert.equal(admin1Lines[0], expectedHeader);
  assert.equal(admin2Lines[0], expectedHeader);
  assert.equal(admin1Lines.length - 1, 2333);
  assert.equal(admin2Lines.length - 1, 240);
});


test("GeoNames validator unpacks all 19 source fields, including cc2 at column 10", async () => {
  const validator = await readFile(new URL("../scripts/geonames-sample-validator.py", import.meta.url), "utf8");
  const tuple = "gid,nm,ascii_name,alt,lat,lon,fc,ft,country,cc2,a1,a2,a3,a4,pop,elev,dem,tz,mod";
  assert.ok(validator.includes(`${tuple}=f`), "the source row must unpack the corrected 19-field tuple");
  const fields = tuple.split(",");
  assert.equal(fields.length, 19);
  assert.equal(fields[8], "country");
  assert.equal(fields[9], "cc2");
  assert.equal(fields[10], "a1");
  assert.equal(fields[18], "mod");
});


test("worldwide scan repeat report distinguishes same-machine repeatability from independent reproduction", async () => {
  const scan = JSON.parse(await readFile(new URL("../docs/geonames-worldwide-scan-reproduction-2026-10-10.json", import.meta.url), "utf8"));
  assert.equal(scan.results.worldwide_records_scanned, 13472324);
  assert.equal(scan.results.malformed_worldwide_rows, 0);
  assert.equal(scan.results.selected_place_rows, 25685);
  assert.equal(scan.comparison_with_prior_owner_run.worldwide_records_scanned_both_runs, 13472324);
  assert.equal(scan.comparison_with_prior_owner_run.sample_payload_byte_for_byte_comparison, "NOT_MEASURED");
  assert.equal(scan.limitations.full_worldwide_scan_independently_reproduced, false);
  assert.equal(scan.limitations.current_approved_iso_authority_comparison, "UNVERIFIED");
  assert.equal(scan.iso_authority_candidate.owner_approval_received, false);
  assert.equal(scan.iso_authority_candidate.snapshot_downloaded_and_hashed, false);
  assert.equal(scan.input_sources.find(source => source.key === "allCountries").sha256, "3b6ba297e83d5cd6717a41cfe72b6cd85d167b0d0ff06069b2c33d410d6abe15");
});
