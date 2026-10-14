import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../public/data/job-types.json", import.meta.url), "utf8"));
const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
const directory = await readFile(new URL("../job-types.html", import.meta.url), "utf8");
const script = await readFile(new URL("../scripts/job-types.js", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const components = await readFile(new URL("../scripts/components.js", import.meta.url), "utf8");

test("starter role catalogue contains 496 unique titles across 25 categories", () => {
  assert.equal(catalog.categories.length, 25);
  assert.equal(catalog.roles.length, 496);
  assert.equal(new Set(catalog.categories.map((category) => category.name)).size, 25);
  assert.equal(new Set(catalog.categories.map((category) => category.slug)).size, 25);
  const titles = catalog.roles.map(([title]) => title.trim().toLocaleLowerCase());
  assert.equal(new Set(titles).size, 496, "role titles must not repeat");
  for (const [title, categoryIndex] of catalog.roles) {
    assert.ok(title.length >= 2);
    assert.ok(Number.isInteger(categoryIndex) && categoryIndex >= 0 && categoryIndex < catalog.categories.length);
  }
});

test("role directory clearly distinguishes job types from employer vacancies", () => {
  assert.match(directory, /Important: job types are not vacancies/);
  assert.match(directory, /employer-supplied details/);
  assert.match(directory, /id="job-type-search"/);
  assert.match(directory, /id="job-type-category"/);
  assert.match(directory, /id="load-more-role-types"/);
  assert.match(home, /not confirmed vacancies/i);
  assert.match(home, /id="home-job-types"/);
  assert.doesNotMatch(home, /Sample employer/);
});

test("browser catalogue escapes dynamic text and supports title/category filters", () => {
  assert.match(script, /function escapeHtml/);
  assert.match(script, /aria-label="Explore /);
  assert.match(script, /job-type-category/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /PAGE_SIZE = 30/);
});

test("static build includes the new directory page and script", () => {
  assert.match(build, /job-types\.html/);
  assert.match(build, /job-types\.js/);
  assert.match(build, /public\/data\//);
  assert.match(components, /job-types\.html/);
});