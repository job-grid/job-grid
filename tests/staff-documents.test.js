import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../documents.html", import.meta.url), "utf8");
const script = await readFile(new URL("../scripts/staff-documents.js", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const staff = await readFile(new URL("../supabase/functions/staff-applications/index.ts", import.meta.url), "utf8");

test("documents register is private and excluded from indexing", () => {
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /Restricted staff workspace/);
  assert.match(page, /private storage/);
});

test("document register relies on authenticated staff endpoint and never exposes storage paths", () => {
  assert.match(script, /signInWithPassword/);
  assert.match(script, /Authorization: "Bearer " \+ session\.access_token/);
  assert.match(script, /action: "cv", id/);
  assert.match(script, /links expire after 60 seconds/);
  assert.doesNotMatch(script, /cv_storage_path/);
  assert.match(staff, /auth\.getUser\(token\)/);
  assert.match(staff, /staff_roles/);
  assert.match(staff, /createSignedUrl\(application\.cv_storage_path, 60\)/);
});

test("static build includes the documents page and its browser module", () => {
  assert.match(build, /"documents\.html"/);
  assert.match(build, /"staff-documents\.js"/);
});
