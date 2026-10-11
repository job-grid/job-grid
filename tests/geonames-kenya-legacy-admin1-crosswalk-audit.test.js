import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditKenyaLegacyAdmin1Codes,
  parseAdmin1Crosswalk,
  renderKenyaAuditCsv,
  validateCrosswalkManifest,
} from "../scripts/geonames-kenya-legacy-admin1-crosswalk-audit.mjs";

function manifest() {
  return {
    remote_source: {
      filename: "admin1CodesASCII.txt",
      url: "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
      retrieved_at_utc: "2026-10-11T00:00:00Z",
      http_status: 200,
      sha256: "a".repeat(64),
      size_bytes: 1000,
    },
  };
}

test("parses admin1 crosswalk records and flags malformed or duplicate keys", () => {
  const parsed = parseAdmin1Crosswalk([
    "KE.22\tKiambu County\tKiambu County\t192709",
    "KE.35\tMeru County\tMeru County\t186824",
    "KE.22\tDuplicate key\tDuplicate key\t192710",
    "bad row",
    "",
  ].join("\n"));
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.malformedRows, 1);
  assert.deepEqual(parsed.duplicateCodes, ["KE.22"]);
  assert.equal(parsed.byCode.get("KE.35").geonames_id, "186824");
});

test("classifies both raw Kenya keys as unresolved when absent from the official crosswalk", () => {
  const text = [
    "KE.22\tKiambu County\tKiambu County\t192709",
    "KE.35\tMeru County\tMeru County\t186824",
  ].join("\n") + "\n";
  const report = auditKenyaLegacyAdmin1Codes(text, manifest());
  assert.equal(report.target_count, 2);
  assert.equal(report.targets[0].expected_composite_key, "KE.01");
  assert.equal(report.targets[1].expected_composite_key, "KE.03");
  assert.ok(report.targets.every((row) =>
    row.status === "KEY_ABSENT_FROM_CURRENT_ADMIN1_CROSSWALK_PARENT_UNRESOLVED"));
  assert.equal(report.targets[0].source_raw_admin1_code_preserved, "01");
  assert.equal(report.targets[1].source_raw_admin1_code_preserved, "03");
  assert.equal(report.source.retrieval_metadata_verified, true);
  assert.equal(report.candidate_parent_ids_assigned, 0);
  assert.equal(report.operational_parent_links_created, 0);
});

test("a key's presence does not automatically approve the parent or link", () => {
  const text = [
    "KE.01\tOld division key\tOld division key\t123",
    "KE.03\tAnother old key\tAnother old key\t456",
  ].join("\n") + "\n";
  const report = auditKenyaLegacyAdmin1Codes(text, manifest());
  assert.ok(report.targets.every((row) =>
    row.status === "KEY_PRESENT_REQUIRES_INDEPENDENT_PARENT_SOURCE_REVIEW"));
  assert.equal(report.targets[0].current_crosswalk_geonames_id, "123");
  assert.equal(report.operational_parent_links_created, 0);
});

test("manifest validator requires exact URL, response success and hash", () => {
  const good = manifest();
  assert.equal(validateCrosswalkManifest(good), true);
  assert.equal(validateCrosswalkManifest({
    remote_source: { ...good.remote_source, http_status: 403 },
  }), false);
  assert.equal(validateCrosswalkManifest({
    remote_source: { ...good.remote_source, url: "https://example.com/admin1CodesASCII.txt" },
  }), false);
});

test("CLI writes a small report and explicit no-link disposition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "geonames-kenya-admin1-audit-"));
  try {
    const source = join(dir, "admin1CodesASCII.txt");
    const manifestPath = join(dir, "source-manifest.json");
    const prefix = join(dir, "audit");
    const scriptPath = fileURLToPath(new URL("../scripts/geonames-kenya-legacy-admin1-crosswalk-audit.mjs", import.meta.url));
    await writeFile(source, "KE.22\tKiambu County\tKiambu County\t192709\n", "utf8");
    await writeFile(manifestPath, JSON.stringify(manifest()), "utf8");
    const proc = spawnSync(process.execPath, [scriptPath, source, prefix, manifestPath], { encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout, /READ_ONLY_KENYA_LEGACY_CROSSWALK_AUDIT_COMPLETE/);
    const [csv, json] = await Promise.all([
      readFile(prefix + ".csv", "utf8"),
      readFile(prefix + ".json", "utf8"),
    ]);
    const report = JSON.parse(json);
    assert.equal(report.source.retrieval_metadata_verified, true);
    assert.equal(report.targets.length, 2);
    assert.match(csv, /KEY_ABSENT_FROM_CURRENT_ADMIN1_CROSSWALK_PARENT_UNRESOLVED/);
    assert.equal(report.operational_parent_links_created, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("row-level CSV preserves the raw code and parent-link safety boundary", () => {
  const report = auditKenyaLegacyAdmin1Codes("KE.35\tMeru County\tMeru County\t186824\n");
  const csv = renderKenyaAuditCsv(report);
  assert.match(csv, /192705,Kiambururu Sub-Location,KE,ADM3,01,KE\.01/);
  assert.match(csv, /7800132,Imenti Central,KE,ADM3,03,KE\.03/);
  assert.match(csv, /false,false/);
});
