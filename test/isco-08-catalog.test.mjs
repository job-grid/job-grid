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

test("candidate records stay unmapped, unverified, and inactive", () => {
  assert.ok(records.every(row =>
    row.job_grid_category_slug === "" &&
    row.category_mapping_status === "pending" &&
    row.source_verification_status === "requires_official_source_crosscheck" &&
    row.publicly_active === "false"
  ));
});

test("unit groups cover the expected ISCO-08 hierarchy prefixes", () => {
  assert.equal(new Set(records.map(row => row.major_group_code)).size, 10);
  assert.equal(new Set(records.map(row => row.sub_major_group_code)).size, 43);
  assert.equal(new Set(records.map(row => row.minor_group_code)).size, 130);
});
