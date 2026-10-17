import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../public/data/job-types.json", import.meta.url), "utf8"));
const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
const directory = await readFile(new URL("../job-types.html", import.meta.url), "utf8");
const script = await readFile(new URL("../scripts/job-types.js", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const components = await readFile(new URL("../scripts/components.js", import.meta.url), "utf8");

test("starter role titles are distinct and reference category slugs, not a copied category catalogue", () => {
  assert.equal(catalog.roles.length, 9044);
  assert.equal(new Set(catalog.roles.map(([title]) => title.trim().toLocaleLowerCase())).size, 9044);
  assert.equal(Object.hasOwn(catalog, "categories"), false, "static data must not duplicate production categories");
  for (const row of catalog.roles) {
    assert.equal(row.length, 3);
    assert.ok(typeof row[0] === "string" && row[0].trim().length >= 2);
    assert.ok(typeof row[1] === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(row[1]));
    assert.ok(typeof row[2] === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(row[2]));
  }
});

test("website obtains active categories from the existing Supabase category table", () => {
  assert.match(script, /from "\.\/supabase-config\.js"/);
  assert.match(script, /rest\/v1\/job_categories\?select=slug,name,sort_order&is_active=eq\.true&order=sort_order\.asc/);
  assert.match(script, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
  assert.match(home, /9,044 distinct occupation titles/);
  assert.match(home, /not confirmed vacancies/i);
  assert.match(directory, /Important: job types are not vacancies/);
  assert.doesNotMatch(script, /const categories = \[/);
});

test("role directory supports title search, category filters, and incremental results", () => {
  assert.match(directory, /id="job-type-search"/);
  assert.match(directory, /id="job-type-category"/);
  assert.match(directory, /id="load-more-role-types"/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /PAGE_SIZE = 30/);
  assert.match(script, /function escapeHtml/);
});

test("static build includes the new directory page and browser module", () => {
  assert.match(build, /job-types\.html/);
  assert.match(build, /job-types\.js/);
  assert.match(build, /public\/data\//);
  assert.match(components, /job-types\.html/);
});
