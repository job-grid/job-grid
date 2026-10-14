import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.length === 0) { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(value => value.length > 0)) rows.push(row);
      row = []; field = "";
      continue;
    }
    field += c;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const [header, ...records] = rows;
  return records.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])));
}

const text = await readFile(new URL("../data/occupations/isco-08-unit-groups.csv", import.meta.url), "utf8");
const records = parseCsv(text);

test("ISCO-08 candidate catalogue contains 436 unique four-digit unit groups", () => {
  assert.equal(records.length, 436);
  const codes = records.map(row => row.isco08_code);
  assert.equal(new Set(codes).size, 436);
  assert.ok(codes.every(code => /^\d{4}$/.test(code)));
});

test("every record carries matching hierarchy codes and parent titles", () => {
  assert.ok(records.every(row =>
    row.isco_version === "ISCO-08" &&
    row.major_group_code === row.isco08_code.slice(0, 1) &&
    row.sub_major_group_code === row.isco08_code.slice(0, 2) &&
    row.minor_group_code === row.isco08_code.slice(0, 3) &&
    row.canonical_title_en.trim().length > 0 &&
    row.major_group_title.trim().length > 0 &&
    row.sub_major_group_title.trim().length > 0 &&
    row.minor_group_title.trim().length > 0
  ));
});

test("candidate records stay unmapped and inactive before or after the official-source sync", () => {
  const allowedSourceStates = new Set(["requires_official_source_crosscheck", "verified_source_match"]);
  assert.ok(records.every(row =>
    row.job_grid_category_slug === "" &&
    row.category_mapping_status === "pending" &&
    allowedSourceStates.has(row.source_verification_status) &&
    row.publicly_active === "false"
  ));
  assert.equal(new Set(records.map(row => row.source_verification_status)).size, 1);
});

test("unit groups cover the expected ISCO-08 hierarchy prefixes", () => {
  assert.equal(new Set(records.map(row => row.major_group_code)).size, 10);
  assert.equal(new Set(records.map(row => row.sub_major_group_code)).size, 43);
  assert.equal(new Set(records.map(row => row.minor_group_code)).size, 130);
});

import { readFile as readFileExtra } from "node:fs/promises";

test("review preview is explicitly labelled and excluded from indexing", async () => {
  const html = await readFileExtra(new URL("../occupations-preview.html", import.meta.url), "utf8");
  const script = await readFileExtra(new URL("../scripts/occupations-preview.js", import.meta.url), "utf8");
  const build = await readFileExtra(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Review preview — not yet approved for production/);
  assert.match(html, /not vacancies|real job vacancy/i);
  assert.match(script, /occupations-isco08-review\.json/);
  assert.match(script, /catalog\.groups\.length !== 436/);
  assert.match(script, /occupation-category-filter/);
  assert.match(script, /Proposed Job Grid category/);
  assert.match(script, /mapping_summary\.proposed_category_mappings/);
  assert.match(script, /major\.value = ""/);
  assert.match(script, /render\(true\)/);
  assert.match(build, /occupations-preview\.html/);
  assert.match(build, /occupations-preview\.js/);
});

test("proposed category mappings use existing slugs but remain unapproved and inactive", async () => {
  const catalog = JSON.parse(await readFileExtra(new URL("../public/data/occupations-isco08-review.json", import.meta.url), "utf8"));
  const existing = JSON.parse(await readFileExtra(new URL("../public/data/job-types.json", import.meta.url), "utf8"));
  const allowed = new Set(existing.categories.map(category => category.slug));
  const proposed = catalog.groups.filter(group => group.proposedCategorySlug);
  const manual = catalog.groups.filter(group => !group.proposedCategorySlug);
  assert.equal(catalog.groups.length, 436);
  assert.equal(catalog.mapping_summary.proposed_category_mappings, proposed.length);
  assert.equal(catalog.mapping_summary.manual_mapping_review_required, manual.length);
  assert.equal(proposed.length + manual.length, 436);
  assert.equal(catalog.mapping_summary.mapping_approved, false);
  assert.ok(["title_keyword_rules_v1", "title_phrase_rules_v2"].includes(catalog.mapping_summary.mapping_method));
  assert.equal(catalog.source_verification_status, "verified_source_match");
  assert.equal(catalog.mapping_summary.source_verified_records, 436);
  assert.ok(catalog.groups.every(group => group.active === false && group.sourceStatus === "verified_source_match"));
  assert.ok(proposed.every(group =>
    allowed.has(group.proposedCategorySlug) &&
    group.mappingStatus === "proposed_rule_match" &&
    group.mappingMethod === catalog.mapping_summary.mapping_method
  ));
  assert.ok(manual.every(group => group.mappingStatus === "manual_review_required"));
  assert.ok(records.every(row =>
    row.job_grid_category_slug === "" &&
    row.category_mapping_status === "pending" &&
    row.source_verification_status === "verified_source_match" &&
    row.publicly_active === "false"
  ));
  if (catalog.mapping_summary.mapping_method === "title_phrase_rules_v2") {
    const businessServices = catalog.groups.find(group => group.code === "1219");
    const proofreading = catalog.groups.find(group => group.title.toLowerCase().includes("proofreading"));
    assert.notEqual(businessServices?.proposedCategorySlug, "driving-transport");
    assert.notEqual(proofreading?.proposedCategorySlug, "construction-building");
    assert.ok(catalog.mapping_audit.ambiguous_manual_review > 0);
  }
});

test("official-source and category-suggestion tooling preserves all production gates", async () => {
  const sync = await readFileExtra(new URL("../scripts/sync_isco08_from_ilo.py", import.meta.url), "utf8");
  const proposer = await readFileExtra(new URL("../scripts/propose_isco08_category_mappings.py", import.meta.url), "utf8");
  const workflow = await readFileExtra(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(sync, /webapps\.ilo\.org/);
  assert.match(sync, /verified_source_match/);
  assert.match(sync, /production_import_authorized.*False/s);
  assert.match(proposer, /title_phrase_rules_v2/);
  assert.match(proposer, /flags=re\.IGNORECASE/);
  assert.match(proposer, /mapping_approved.*False/s);
  assert.match(workflow, /isco08-official-source-sync-artifact/);
  assert.match(workflow, /propose_isco08_category_mappings\.py/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /permissions:\s+contents: read/);
});
