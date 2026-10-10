import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/geonames-hierarchy-candidate-presence-audit.py", import.meta.url));
const python = process.platform === "win32" ? "python" : "python3";
const header = [
  "geonameid", "name", "asciiname", "alternatenames", "latitude", "longitude",
  "feature_class", "feature_code", "country_code", "cc2", "admin1_code",
  "admin2_code", "admin3_code", "admin4_code", "population", "elevation",
  "dem", "timezone", "modification_date", "sample_reason"
].join("\t");

function row(id, name, featureClass, featureCode, country, admin1 = "", admin2 = "") {
  return [
    id, name, name, "", "0", "0", featureClass, featureCode, country, "",
    admin1, admin2, "", "", "0", "", "0", "UTC", "2020-01-01", "synthetic-fixture"
  ].join("\t");
}

test("hierarchy audit is read-only and distinguishes missing admin1 context", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-hierarchy-audit-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const sourceRoot = join(root, "sources");
  const outputDir = join(root, "audit-output");
  const sampleDir = join(sourceRoot, "sample-output-20261010-163234");
  await mkdir(sampleDir, { recursive: true });

  const sample = [
    header,
    row("100", "Fixture Place", "P", "PPL", "AA", "01", "001"),
    row("10", "Fixture Admin1", "A", "ADM1", "AA", "01", ""),
    row("11", "Fixture Admin2", "A", "ADM2", "AA", "01", "001"),
    row("12", "Historical Admin2 Without Admin1", "A", "ADM2H", "AA", "", "012"),
    row("13", "Unresolved Placeholder Child", "P", "PPL", "AA", "00", "")
  ].join("\n") + "\n";
  await writeFile(join(sampleDir, "geonames_places_sample.tsv"), sample, "utf8");
  await writeFile(join(sourceRoot, "admin1CodesASCII.txt"), "AA.01\tFixture Admin1\tFixture Admin1\t10\n", "utf8");
  await writeFile(join(sourceRoot, "admin2Codes.txt"), "AA.01.001\tFixture Admin2\tFixture Admin2\t11\n", "utf8");

  const result = spawnSync(python, [
    script,
    "--source-root", sourceRoot,
    "--output-dir", outputDir
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(await readFile(join(outputDir, "hierarchy-audit-summary.json"), "utf8"));
  assert.equal(report.status, "PASS_CANDIDATE_PRESENCE_ONLY_NO_PARENT_LINKS_APPROVED");
  assert.equal(report.input_integrity.sample_rows, 5);
  assert.equal(report.input_integrity.sample_unique_ids, 5);
  assert.equal(report.input_integrity.duplicate_sample_ids, 0);
  assert.equal(report.admin1.code_references_with_exact_crosswalk_key, 1);
  assert.equal(report.admin1.code_references_without_exact_key, 1);
  assert.equal(report.admin1.raw_00_placeholder_candidates, 1);
  assert.equal(report.admin1.unmatched_nonzero_code_references, 0);
  assert.equal(report.admin1.candidate_presence_issues, 0);
  assert.equal(report.admin2.references_with_exact_composite_crosswalk_key, 1);
  assert.equal(report.admin2.references_missing_composite_crosswalk_key, 0);
  assert.equal(report.admin2.references_uncheckable_due_to_blank_admin1_context, 1);
  assert.equal(report.admin2.total_unresolved_admin2_rows, 1);
  assert.equal(report.admin2.candidate_presence_issues, 0);
  assert.deepEqual(report.distinct_candidate_feature_codes_by_level_and_country.admin1.AA, { ADM1: 1 });
  assert.deepEqual(report.distinct_candidate_feature_codes_by_level_and_country.admin2.AA, { ADM2: 1 });
  assert.deepEqual(report.candidate_key_code_consistency_by_level_and_country.admin1.AA, {
    target_admin_rows_checked: 2,
    target_admin1_code_matches: 2
  });
  assert.deepEqual(report.candidate_key_code_consistency_by_level_and_country.admin2.AA, {
    complete_composite_key_matches: 2,
    target_admin1_code_matches: 2,
    target_admin2_code_matches: 2,
    target_admin_rows_checked: 2
  });
  assert.equal(report.exceptions.rows, 0);
  assert.equal(report.scope.parent_links_written, false);
  assert.equal(report.input_manifest.length, 3);
  assert.ok(report.input_manifest.every(input => /^[a-f0-9]{64}$/.test(input.sha256)));

  const exceptionCsv = await readFile(join(outputDir, "hierarchy-audit-exceptions.csv"), "utf8");
  assert.equal(exceptionCsv.trim().split("\n").length, 1, "only header is expected when no candidate-presence mismatch exists");
});

test("hierarchy audit refuses to place generated source-data reports inside a Git checkout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-hierarchy-path-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "sources");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, "admin1CodesASCII.txt"), "", "utf8");
  await writeFile(join(sourceRoot, "admin2Codes.txt"), "", "utf8");
  const sampleDir = join(sourceRoot, "sample-output-20261010-163234");
  await mkdir(sampleDir, { recursive: true });
  await writeFile(join(sampleDir, "geonames_places_sample.tsv"), header + "\n", "utf8");

  const result = spawnSync(python, [
    script,
    "--source-root", sourceRoot,
    "--output-dir", join(fileURLToPath(new URL("..", import.meta.url)), "forbidden-audit-output")
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /outside the repository root/);
});

test("hierarchy audit rejects duplicate sample column headers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-hierarchy-duplicate-header-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const sourceRoot = join(root, "sources");
  const outputDir = join(root, "audit-output");
  const sampleDir = join(sourceRoot, "sample-output-20261010-163234");
  await mkdir(sampleDir, { recursive: true });

  const duplicateHeader = header.replace("feature_class", "geonameid");
  const sample = [
    duplicateHeader,
    row("100", "Fixture Place", "P", "PPL", "AA", "01", "001"),
    row("10", "Fixture Admin1", "A", "ADM1", "AA"),
    row("11", "Fixture Admin2", "A", "ADM2", "AA", "01", "001")
  ].join("\\n") + "\\n";
  await writeFile(join(sampleDir, "geonames_places_sample.tsv"), sample, "utf8");
  await writeFile(join(sourceRoot, "admin1CodesASCII.txt"), "AA.01\\tFixture Admin1\\tFixture Admin1\\t10\\n", "utf8");
  await writeFile(join(sourceRoot, "admin2Codes.txt"), "AA.01.001\\tFixture Admin2\\tFixture Admin2\\t11\\n", "utf8");

  const result = spawnSync(python, [
    script,
    "--source-root", sourceRoot,
    "--output-dir", outputDir
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Sample TSV has duplicate column headers/);
});

test("ADM1 and ADM2 code-to-ID self matches are identity matches, not parent links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-hierarchy-identity-match-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const sourceRoot = join(root, "sources");
  const outputDir = join(root, "audit-output");
  const sampleDir = join(sourceRoot, "sample-output-20261010-163234");
  await mkdir(sampleDir, { recursive: true });

  const sample = [
    header,
    row("100", "Fixture Place", "P", "PPL", "AA", "01", "001"),
    row("10", "Fixture Admin1", "A", "ADM1", "AA", "01", ""),
    row("11", "Fixture Admin2", "A", "ADM2", "AA", "01", "001")
  ].join("\n") + "\n";
  await writeFile(join(sampleDir, "geonames_places_sample.tsv"), sample, "utf8");
  await writeFile(join(sourceRoot, "admin1CodesASCII.txt"), "AA.01\tFixture Admin1\tFixture Admin1\t10\n", "utf8");
  await writeFile(join(sourceRoot, "admin2Codes.txt"), "AA.01.001\tFixture Admin2\tFixture Admin2\t11\n", "utf8");

  const result = spawnSync(python, [
    script,
    "--source-root", sourceRoot,
    "--output-dir", outputDir
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(await readFile(join(outputDir, "hierarchy-audit-summary.json"), "utf8"));
  assert.equal(report.status, "PASS_CANDIDATE_PRESENCE_ONLY_NO_PARENT_LINKS_APPROVED");
  assert.equal(report.admin1.candidate_identity_matches, 1);
  assert.equal(report.admin1.candidate_self_references, 0);
  assert.equal(report.admin1.resolved_references_whose_candidate_id_is_present_as_same_country_administrative_feature, 2);
  assert.equal(report.admin1.candidate_presence_issues, 0);
  assert.equal(report.admin2.candidate_identity_matches, 1);
  assert.equal(report.admin2.candidate_self_references, 0);
  assert.equal(report.admin2.resolved_references_whose_candidate_id_is_present_as_same_country_administrative_feature, 1);
  assert.equal(report.admin2.candidate_presence_issues, 0);
  assert.equal(report.exceptions.rows, 0);
  assert.equal(report.scope.parent_links_written, false);

  const exceptionCsv = await readFile(join(outputDir, "hierarchy-audit-exceptions.csv"), "utf8");
  assert.equal(exceptionCsv.trim().split("\n").length, 1, "identity matches must not be exported as hierarchy failures");
});

test("a self-referencing candidate on a non-ADM1 row is blocked and exported", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-hierarchy-invalid-self-reference-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const sourceRoot = join(root, "sources");
  const outputDir = join(root, "audit-output");
  const sampleDir = join(sourceRoot, "sample-output-20261010-163234");
  await mkdir(sampleDir, { recursive: true });

  const sample = [
    header,
    row("10", "Wrong-Level Fixture", "P", "PPL", "AA", "01", "")
  ].join("\n") + "\n";
  await writeFile(join(sampleDir, "geonames_places_sample.tsv"), sample, "utf8");
  await writeFile(join(sourceRoot, "admin1CodesASCII.txt"), "AA.01\tUnexpected Target\tUnexpected Target\t10\n", "utf8");
  await writeFile(join(sourceRoot, "admin2Codes.txt"), "", "utf8");

  const result = spawnSync(python, [
    script,
    "--source-root", sourceRoot,
    "--output-dir", outputDir
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr);

  const report = JSON.parse(await readFile(join(outputDir, "hierarchy-audit-summary.json"), "utf8"));
  assert.equal(report.status, "BLOCKED_SELF_REFERENCE_CANDIDATES_FOUND");
  assert.equal(report.admin1.candidate_identity_matches, 0);
  assert.equal(report.admin1.candidate_self_references, 1);
  assert.equal(report.admin1.candidate_presence_issues, 1);
  assert.equal(report.exceptions.rows, 1);
  assert.equal(report.scope.parent_links_written, false);

  const exceptionCsv = await readFile(join(outputDir, "hierarchy-audit-exceptions.csv"), "utf8");
  assert.match(exceptionCsv, /ADMIN1_CROSSWALK_CANDIDATE_SELF_REFERENCE/);
});

test("crosswalk target code fields must match the lookup key", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "job-grid-hierarchy-target-code-mismatch-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const sourceRoot = join(root, "sources");
  const outputDir = join(root, "audit-output");
  const sampleDir = join(sourceRoot, "sample-output-20261010-163234");
  await mkdir(sampleDir, { recursive: true });

  const sample = [
    header,
    row("100", "Fixture Place", "P", "PPL", "AA", "01", "001"),
    row("10", "Wrong Admin1 Code", "A", "ADM1", "AA", "02", ""),
    row("11", "Wrong Admin2 Codes", "A", "ADM2", "AA", "02", "999")
  ].join("\n") + "\n";
  await writeFile(join(sampleDir, "geonames_places_sample.tsv"), sample, "utf8");
  await writeFile(join(sourceRoot, "admin1CodesASCII.txt"), "AA.01\tFixture Admin1\tFixture Admin1\t10\n", "utf8");
  await writeFile(join(sourceRoot, "admin2Codes.txt"), "AA.01.001\tFixture Admin2\tFixture Admin2\t11\n", "utf8");

  const result = spawnSync(python, [
    script,
    "--source-root", sourceRoot,
    "--output-dir", outputDir
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr);

  const report = JSON.parse(await readFile(join(outputDir, "hierarchy-audit-summary.json"), "utf8"));
  assert.equal(report.status, "BLOCKED_CANDIDATE_PRESENCE_MISMATCHES");
  assert.equal(report.candidate_key_code_consistency_by_level_and_country.admin1.AA.target_admin1_code_matches, 0);
  assert.equal(report.candidate_key_code_consistency_by_level_and_country.admin1.AA.target_admin1_code_mismatches, 1);
  assert.equal(report.candidate_key_code_consistency_by_level_and_country.admin2.AA.target_admin1_code_mismatches, 1);
  assert.equal(report.candidate_key_code_consistency_by_level_and_country.admin2.AA.target_admin2_code_mismatches, 1);
  assert.equal(report.admin1.candidate_presence_issues, 1);
  assert.equal(report.admin2.candidate_presence_issues, 2);
  assert.equal(report.exceptions.rows, 3);
  assert.match(await readFile(join(outputDir, "hierarchy-audit-exceptions.csv"), "utf8"), /ADMIN1_CROSSWALK_TARGET_ADMIN1_CODE_MISMATCH/);
  assert.match(await readFile(join(outputDir, "hierarchy-audit-exceptions.csv"), "utf8"), /ADMIN2_CROSSWALK_TARGET_ADMIN2_CODE_MISMATCH/);
  assert.equal(report.scope.parent_links_written, false);
});
