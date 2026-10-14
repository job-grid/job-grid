import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261014093000_create_country_options.sql", import.meta.url),
  "utf8",
);

test("country options migration seeds the complete pinned country/area dropdown source", () => {
  const match = migration.match(
    /INSERT INTO public\.country_options \(code, name\) VALUES\n([\s\S]*?);/,
  );
  assert.ok(match, "seed INSERT exists");

  const rows = [...match[1].matchAll(/^\s*\('([A-Z]{2})', '((?:''|[^'])*)'\),?$/gm)];
  assert.equal(rows.length, 249, "all 249 source options are represented");

  const codes = rows.map((row) => row[1]);
  assert.equal(new Set(codes).size, 249, "country/area codes are unique");
  assert.ok(rows.some((row) => row[1] === "KE" && row[2] === "Kenya"));
  assert.ok(rows.some((row) => row[1] === "JP" && row[2] === "Japan"));
});

test("country options are public-read-only with RLS enabled", () => {
  assert.match(migration, /ALTER TABLE public\.country_options ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY country_options_public_read/);
  assert.match(migration, /FOR SELECT\s+TO anon, authenticated\s+USING \(true\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.country_options FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.country_options TO anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE).*country_options/i);
});

test("country data is labeled as dropdown data rather than a legal-status catalog", () => {
  assert.match(migration, /umpirsky\/country-list.*bd490a163ae4709bbe4b54c4f638f24e032828d2/);
  assert.match(migration, /do not assert sovereignty, legal status, or work eligibility/i);
});
