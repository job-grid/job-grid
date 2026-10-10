import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/geonames-sample-validate.mjs", import.meta.url));

test("manifest does not promote legacy retrieval timestamps or filesystem mtime into HTTP metadata", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "job-grid-source-manifest-legacy-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const oldRetrievedAt = "2026-10-10T19:00:00.000Z";
  const oldMtimeMislabel = "2026-10-09T11:22:33.000Z";
  await writeFile(join(workspace, "source-manifest.json"), JSON.stringify({
    schema_version: 1,
    sources: {
      "KE.zip": {
        retrieved_at: oldRetrievedAt,
        last_modified_utc: oldMtimeMislabel
      }
    }
  }, null, 2));

  const result = spawnSync(process.execPath, [script, "--workspace", workspace], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 2, result.stderr);

  const manifest = JSON.parse(await readFile(join(workspace, "source-manifest.json"), "utf8"));
  assert.equal(manifest.schema_version, 2);
  const ke = manifest.sources["KE.zip"];
  assert.equal(ke.retrieval_started_at_utc, null);
  assert.equal(ke.retrieval_attempt_completed_at_utc, null);
  assert.equal(ke.retrieved_at_utc, null);
  assert.equal(ke.http_last_modified_header, null);
  assert.equal(ke.http_date_header, null);
  assert.equal(ke.legacy_retrieved_at_unverified, oldRetrievedAt);
  assert.equal(ke.legacy_last_modified_utc_unverified, oldMtimeMislabel);
  assert.equal("last_modified_utc" in ke, false);
  assert.equal("retrieved_at" in ke, false);
  assert.equal(ke.retrieval_metadata_retained_from_previous_manifest, true);

  const fresh = manifest.sources["GB.zip"];
  assert.equal(fresh.retrieved_at_utc, null);
  assert.equal(fresh.http_last_modified_header, null);
  assert.equal(fresh.legacy_last_modified_utc_unverified, null);
});

test("successful mocked retrieval captures the literal server Last-Modified header", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "job-grid-source-manifest-mock-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const mockPath = join(workspace, "mock-fetch.mjs");
  const lastModified = "Thu, 08 Oct 2026 12:34:56 GMT";
  const httpDate = "Sat, 10 Oct 2026 19:00:00 GMT";
  const mockLines = [
    'globalThis.fetch = async (input) => {',
    '  const response = new Response("synthetic source bytes", {',
    '    status: 200,',
    '    headers: {',
    '      "last-modified": "Thu, 08 Oct 2026 12:34:56 GMT",',
    '      "date": "Sat, 10 Oct 2026 19:00:00 GMT"',
    '    }',
    '  });',
    '  return {',
    '    ok: response.ok,',
    '    status: response.status,',
    '    headers: response.headers,',
    '    body: response.body,',
    '    url: String(input)',
    '  };',
    '};',
    ''
  ].join("\n");
  await writeFile(mockPath, mockLines, "utf8");

  const result = spawnSync(process.execPath, [
    "--import", mockPath, script, "--workspace", workspace, "--download"
  ], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 2, result.stderr);

  const manifest = JSON.parse(await readFile(join(workspace, "source-manifest.json"), "utf8"));
  assert.equal(manifest.schema_version, 2);
  const ke = manifest.sources["KE.zip"];
  assert.equal(ke.http_status, 200);
  assert.equal(ke.http_last_modified_header, lastModified);
  assert.equal(ke.http_date_header, httpDate);
  assert.equal(ke.final_response_url, ke.url);
  assert.match(ke.retrieval_started_at_utc, /Z$/);
  assert.match(ke.retrieval_attempt_completed_at_utc, /Z$/);
  assert.match(ke.retrieved_at_utc, /Z$/);
  assert.equal(ke.retrieval_error, null);
  assert.equal(ke.retrieval_metadata_retained_from_previous_manifest, false);
  assert.equal(ke.legacy_retrieved_at_unverified, null);
  assert.equal(ke.legacy_last_modified_utc_unverified, null);
  assert.equal("last_modified_utc" in ke, false);
  assert.equal("retrieved_at" in ke, false);
});

test("GeoNames countryInfo preflight rejects incomplete and overlong records", async () => {
  const validator = await readFile(new URL("../scripts/geonames-sample-validate.mjs", import.meta.url), "utf8");
  assert.match(validator, /if \(f\.length !== 19\)/);
  assert.match(validator, /INVALID_COLUMN_COUNT_EXPECTED_19/);
});

test("preflight refuses staging workspaces inside the repository", async (t) => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const workspace = join(repositoryRoot, ".test-forbidden-geonames-workspace-" + process.pid);
  await rm(workspace, { recursive: true, force: true });
  t.after(async () => rm(workspace, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [script, "--workspace", workspace], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--workspace must be outside the repository root/);
  await assert.rejects(readFile(join(workspace, "source-manifest.json")), { code: "ENOENT" });
});

test("preflight code explicitly keeps source archives outside Git", async () => {
  const source = await readFile(new URL("../scripts/geonames-sample-validate.mjs", import.meta.url), "utf8");
  assert.match(source, /http_last_modified_header/);
  assert.match(source, /legacy_last_modified_utc_unverified/);
  assert.match(source, /retrieval_started_at_utc/);
  assert.match(source, /retrieved_at_utc/);
  assert.match(source, /must be outside the repository root to keep source archives and private outputs out of Git/);
});

