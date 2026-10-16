import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("vacancy page is wired to the live listing module and filters", async () => {
  const html = await readFile(new URL("../vacancies.html", import.meta.url), "utf8");
  assert.match(html, /\/scripts\/vacancies\.js/);
  assert.match(html, /id="vacancy-results"/);
  assert.match(html, /id="vacancy-country"/);
  assert.match(html, /id="vacancy-category"/);
  assert.match(html, /id="vacancy-skill"/);
  assert.match(html, /id="vacancy-employment"/);
});

test("vacancy module queries published jobs and escapes rendered values", async () => {
  const source = await readFile(new URL("../scripts/vacancies.js", import.meta.url), "utf8");
  assert.match(source, /\/rest\/v1\/jobs/);
  assert.match(source, /status=eq\.published/);
  assert.match(source, /expires_at/);
  assert.match(source, /escapeHtml/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(source, /sb_secret_|service.role/i);
});
