import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261014120000_create_job_catalog_and_jobs.sql", import.meta.url),
  "utf8",
);

test("job categories seed the agreed broad skilled and general-work categories", () => {
  const match = migration.match(
    /INSERT INTO public\.job_categories \(slug, name, group_name, description, sort_order\) VALUES\n([\s\S]*?)\nON CONFLICT/,
  );
  assert.ok(match, "job category seed INSERT exists");

  const rows = [...match[1].matchAll(/^\s*\('([a-z0-9-]+)', '((?:''|[^'])*)', '(operations|trades|services|professional|other)', '((?:''|[^'])*)', (\d+)\),?$/gm)];
  assert.equal(rows.length, 25, "the initial catalog has 25 categories");
  assert.equal(new Set(rows.map((row) => row[1])).size, 25, "category slugs are unique");
  for (const slug of ["general-labour", "agriculture-farming", "skilled-trades-repair", "health-care-caregiving", "it-technology", "other"]) {
    assert.ok(rows.some((row) => row[1] === slug), `missing category: ${slug}`);
  }
});

test("jobs support country, category, skill level and common employment fields", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.jobs/);
  assert.match(migration, /category_slug text NOT NULL\s+REFERENCES public\.job_categories/);
  assert.match(migration, /skill_level IN \('skilled', 'semi_skilled', 'unskilled'\)/);
  assert.match(migration, /employment_type IN \([\s\S]*'apprenticeship'/);
  assert.match(migration, /country_code text NOT NULL\s+REFERENCES public\.country_options \(code\)/);
  assert.match(migration, /salary_min numeric\(12,2\)/);
  assert.match(migration, /sponsorship_status text NOT NULL DEFAULT 'not_stated'/);
  assert.match(migration, /status text NOT NULL DEFAULT 'draft'/);
  assert.match(migration, /jobs_publication_window_valid/);
});

test("public access is read-only and only returns published non-expired jobs", () => {
  assert.match(migration, /ALTER TABLE public\.job_categories ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public\.jobs ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.job_categories TO anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.jobs TO anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.jobs FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.job_categories FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE POLICY jobs_public_read_published[\s\S]*status = 'published'[\s\S]*published_at <= now\(\)[\s\S]*expires_at > now\(\)/);
  assert.match(migration, /CREATE POLICY job_categories_public_read[\s\S]*is_active = true/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE).*public\.(?:jobs|job_categories)/i);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("job skill level labels and the admin-managed boundary are documented", async () => {
  const docs = await readFile(new URL("../docs/jobs-catalog-mvp.md", import.meta.url), "utf8");
  assert.match(docs, /administrator manually creates and updates job advertisements using the existing Supabase Dashboard/i);
  assert.match(docs, /there is no browser INSERT, UPDATE, or DELETE grant/i);
  assert.match(docs, /entry-level \/ no specialist skill required/i);
});
