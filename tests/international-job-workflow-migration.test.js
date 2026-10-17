import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261014190000_add_verified_international_job_workflow.sql", import.meta.url),
  "utf8",
);
const docs = await readFile(new URL("../docs/international-job-workflow.md", import.meta.url), "utf8");

test("migration extends existing categories and jobs without recreating the foundation", () => {
  assert.match(migration, /Required existing table public\.job_categories was not found/);
  assert.match(migration, /REFERENCES public\.job_categories \(slug\)/);
  assert.match(migration, /ALTER TABLE public\.jobs\s+ADD COLUMN occupation_id/);
  assert.doesNotMatch(migration, /CREATE TABLE(?: IF NOT EXISTS)? public\.job_categories/i);
  assert.doesNotMatch(migration, /CREATE TABLE(?: IF NOT EXISTS)? public\.job_vacancies/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.job_categories/i);
  assert.doesNotMatch(migration, /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i);
  assert.match(docs, /25 active categories/i);
  assert.match(docs, /no parallel vacancy table/i);
});

test("occupation titles are kept separate from jobs and require evidence for verified status", () => {
  assert.match(migration, /CREATE TABLE public\.occupations/);
  assert.match(migration, /canonical_title text NOT NULL/);
  assert.match(migration, /category_slug text NOT NULL\s+REFERENCES public\.job_categories/);
  assert.match(migration, /isco08_code text/);
  assert.match(migration, /verification_status IN \('pending', 'verified', 'rejected', 'needs_review'\)/);
  assert.match(migration, /occupations_verified_has_evidence/);
  assert.match(migration, /CREATE TABLE public\.occupation_aliases/);
  assert.doesNotMatch(migration, /INSERT INTO public\.occupations/i);
});

test("sources default to disabled and unapproved until permission evidence exists", () => {
  assert.match(migration, /permission_status text NOT NULL DEFAULT 'pending_review'/);
  assert.match(migration, /enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration, /job_sources_approval_requires_evidence/);
  assert.match(migration, /source_connections_no_secret_values/);
  assert.match(migration, /A source cannot be enabled without approved access and permission evidence/);
  assert.match(migration, /CREATE TABLE public\.ingestion_jobs/);
  assert.match(migration, /CREATE TABLE public\.ingestion_errors/);
});

test("vacancies preserve source evidence and have deduplication controls", () => {
  assert.match(migration, /CREATE TABLE public\.job_dedupe_keys/);
  assert.match(migration, /job_dedupe_keys_global_identity UNIQUE/);
  assert.match(migration, /vacancy_sources_external_id_unique/);
  assert.match(migration, /CREATE TABLE public\.job_duplicate_candidates/);
  assert.match(migration, /CREATE TABLE public\.vacancy_evidence/);
  assert.match(migration, /CREATE TABLE public\.eligibility_assessments/);
});

test("publication gate requires current human approval and eligibility evidence", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.job_evidence_ready/);
  assert.match(migration, /e\.verification_status = 'verified'/);
  assert.match(migration, /o\.verification_status = 'verified'/);
  assert.match(migration, /src\.permission_status = 'approved'/);
  assert.match(migration, /international_eligibility IN \('explicitly_open', 'employer_sponsored'\)/);
  assert.match(migration, /reviewed_record_version = j\.record_version/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.publish_verified_job/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.review_job/);
  assert.match(migration, /CREATE POLICY jobs_public_read_published[\s\S]*job_publication_gate_passed\(id\)/);
  assert.match(migration, /publication_records pr[\s\S]*pr\.unpublished_at IS NULL[\s\S]*pr\.job_record_version = j\.record_version/);
});

test("sensitive workflow tables are RLS-protected and public clients cannot write jobs", () => {
  for (const table of [
    "occupations", "occupation_aliases", "job_dedupe_keys", "job_duplicate_candidates",
    "employers", "job_sources", "source_connections", "vacancy_sources",
    "vacancy_evidence", "eligibility_assessments", "staff_roles", "verification_reviews",
    "publication_records", "ingestion_jobs", "ingestion_errors", "audit_logs"
  ]) {
    assert.match(migration, new RegExp("ALTER TABLE public\\." + table + " ENABLE ROW LEVEL SECURITY"));
    assert.match(migration, new RegExp("REVOKE ALL ON TABLE public\\." + table));
  }
  assert.match(migration, /GRANT SELECT ON TABLE public\.occupations TO anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.jobs TO anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.jobs FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /staff_roles sr[\s\S]*sr\.role IN \('publisher', 'system_admin'\)/);
  assert.match(migration, /staff_roles sr[\s\S]*sr\.role IN \('reviewer', 'system_admin'\)/);
});

test("Excel base-title seed imports 496 pending inactive job types and never creates vacancies", async () => {
  const seedMigration = await readFile(
    new URL("../supabase/migrations/20261015120000_seed_base_occupation_catalogue.sql", import.meta.url),
    "utf8",
  );
  const roleData = JSON.parse(await readFile(new URL("./fixtures/job-types-seed.json", import.meta.url), "utf8"));
  assert.equal(roleData.roles.length, 496);
  assert.equal(new Set(roleData.roles.map(([title]) => title.trim().toLocaleLowerCase())).size, 496);
  assert.equal(new Set(roleData.roles.map(([, slug]) => slug)).size, 25);
  assert.match(seedMigration, /INSERT INTO public\.occupations/);
  assert.match(seedMigration, /'pending'/);
  assert.match(seedMigration, /is_active\s*\)/);
  assert.match(seedMigration, /ON CONFLICT \(normalized_title\) DO NOTHING/);
  assert.match(seedMigration, /Expected the 25 existing active Job Grid categories/i);
  assert.match(seedMigration, /expected all 496 unique base titles/i);
  assert.doesNotMatch(seedMigration, /INSERT INTO public\.jobs/i);
  assert.doesNotMatch(seedMigration, /UPDATE public\.jobs|DELETE FROM public\.jobs|TRUNCATE/i);
  for (const [title, slug] of roleData.roles) {
    assert.ok(seedMigration.includes(`('${slug}', '${title.replace(/'/g, "''")}', 'pending'`), `Missing seeded role: ${title}`);
  }
});

