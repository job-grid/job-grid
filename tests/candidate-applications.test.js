import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261016150000_add_private_candidate_applications.sql", import.meta.url), "utf8");
const submit = await readFile(new URL("../supabase/functions/submit-application/index.ts", import.meta.url), "utf8");
const staff = await readFile(new URL("../supabase/functions/staff-applications/index.ts", import.meta.url), "utf8");
const vacancies = await readFile(new URL("../scripts/vacancies.js", import.meta.url), "utf8");
const country = await readFile(new URL("../scripts/country.js", import.meta.url), "utf8");
const apply = await readFile(new URL("../apply.html", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

test("candidate data and internal notes are private and have no browser grants", () => {
  assert.match(migration, /CREATE TABLE public\.candidate_applications/);
  assert.match(migration, /CREATE TABLE public\.candidate_application_notes/);
  assert.match(migration, /ALTER TABLE public\.candidate_applications ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.candidate_applications FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.candidate_application_notes FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /VALUES \('candidate-cvs', 'candidate-cvs', false/);
  assert.match(migration, /5242880/);
});

test("public submission validates data, file type, vacancy status, consent and limits", () => {
  assert.match(submit, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(submit, /application\/pdf/);
  assert.match(submit, /5 \* 1024 \* 1024/);
  assert.match(submit, /job is no longer accepting applications/);
  assert.match(submit, /recentCount/);
  assert.match(submit, /consent_at/);
  assert.match(config, /\[functions\.submit-application\]\s+verify_jwt = false/);
});

test("candidate job cards route through Job Grid and do not expose external apply links", () => {
  assert.match(vacancies, /Apply through Job Grid/);
  assert.match(vacancies, /\/apply\.html\?job=/);
  assert.doesNotMatch(vacancies, /Apply on employer site/);
  assert.match(country, /Apply through Job Grid/);
  assert.doesNotMatch(country, /Apply on employer site/);
  assert.match(apply, /Submit to Job Grid/);
  assert.match(apply, /name="cv"/);
  assert.match(apply, /name="consent"/);
});

test("staff endpoint verifies authentication and staff roles before access", () => {
  assert.match(staff, /auth\.getUser\(token\)/);
  assert.match(staff, /staff_roles/);
  assert.match(staff, /reviewer.*system_admin/);
  assert.match(staff, /createSignedUrl\(application\.cv_storage_path, 60\)/);
  assert.match(staff, /candidate_internal_note_added/);
  assert.match(config, /\[functions\.staff-applications\]\s+verify_jwt = true/);
});

test("static build includes the application and restricted staff pages", () => {
  assert.match(build, /"apply\.html"/);
  assert.match(build, /"staff\.html"/);
  assert.match(build, /"apply\.js"/);
  assert.match(build, /"staff\.js"/);
});
