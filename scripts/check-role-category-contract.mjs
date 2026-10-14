import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const categoryPath = process.env.JOB_GRID_ACTIVE_CATEGORY_FILE;
assert.ok(categoryPath, "JOB_GRID_ACTIVE_CATEGORY_FILE must point to query results from PostgreSQL");
const categoryLines = (await readFile(categoryPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
const categories = categoryLines.map((line) => {
  const [slug, name, sortOrder] = line.split("\t");
  return { slug, name, sortOrder: Number(sortOrder) };
});

const roleData = JSON.parse(await readFile(new URL("../public/data/job-types.json", import.meta.url), "utf8"));
assert.equal(categories.length, 25, "anonymous category lookup should expose the same 25 active categories");
assert.equal(new Set(categories.map((category) => category.slug)).size, 25, "category slugs must be unique");
assert.ok(categories.every((category) => category.name && Number.isInteger(category.sortOrder)));
assert.deepEqual(
  categories.map((category) => category.sortOrder),
  [...categories.map((category) => category.sortOrder)].sort((a, b) => a - b),
  "category query must preserve the website's sort order",
);
assert.equal(roleData.roles.length, 496, "static starter role list row count changed unexpectedly");
assert.equal(
  new Set(roleData.roles.map(([title]) => title.normalize("NFKC").trim().toLocaleLowerCase())).size,
  roleData.roles.length,
  "starter role titles must remain distinct",
);
const categorySlugs = new Set(categories.map((category) => category.slug));
const unmapped = roleData.roles.filter((row) => !Array.isArray(row) || row.length !== 2 || !categorySlugs.has(row[1]));
assert.deepEqual(unmapped, [], "all visible starter titles must map to an existing database category slug");
assert.equal(Object.hasOwn(roleData, "categories"), false, "static file must not duplicate database categories");
console.log("PASS: website category contract — 25 live database categories, 496 unique starter titles, 0 unmapped slugs");
