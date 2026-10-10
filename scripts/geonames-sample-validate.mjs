#!/usr/bin/env node
/**
 * Source-pinned GeoNames sample preflight. No database or production operations.
 * Download mode writes only to the explicit staging workspace.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const VERSION = "1.0.0";
const BASE = "https://download.geonames.org/export/dump/";
const LICENSE = "GeoNames CC BY 4.0; data is supplied as-is without warranty.";
const SOURCES = [
  ...["KE.zip", "GB.zip", "JP.zip", "BR.zip", "SG.zip"].map(file => ({ file, url: BASE + file, kind: "country-archive", country: file.slice(0, 2) })),
  { file: "countryInfo.txt", url: BASE + "countryInfo.txt", kind: "country-info" },
  { file: "admin1CodesASCII.txt", url: BASE + "admin1CodesASCII.txt", kind: "admin1-crosswalk" },
  { file: "admin2Codes.txt", url: BASE + "admin2Codes.txt", kind: "admin2-crosswalk" },
  { file: "readme.txt", url: BASE + "readme.txt", kind: "format-documentation" },
];
const ISO_CANDIDATES = {
  KE: ["KE", "KEN", "404"], GB: ["GB", "GBR", "826"], JP: ["JP", "JPN", "392"],
  BR: ["BR", "BRA", "076"], SG: ["SG", "SGP", "702"],
};

function parseArgs(argv) {
  const out = { workspace: null, download: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") out.workspace = argv[++i];
    else if (argv[i] === "--download") out.download = true;
    else throw new Error("Unsupported argument: " + argv[i]);
  }
  if (!out.workspace) throw new Error("--workspace is required");
  return out;
}

async function hashFile(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

async function fetchToFile(source, target) {
  const retrievedAt = new Date().toISOString();
  try {
    const response = await fetch(source.url, { redirect: "follow", signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    if (!response.body) throw new Error("Response body missing");
    await pipeline(response.body, createWriteStream(target));
    return { retrieved_at: retrievedAt, http_status: response.status, retrieval_error: null };
  } catch (error) {
    return { retrieved_at: retrievedAt, http_status: null, retrieval_error: String(error?.message ?? error) };
  }
}

async function main() {
  const { workspace, download } = parseArgs(process.argv.slice(2));
  const root = path.resolve(workspace);
  await mkdir(root, { recursive: true });
  const manifestPath = path.join(root, "source-manifest.json");
  let previous = { sources: {} };
  try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* no prior manifest */ }

  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    parser: { name: "Job Grid GeoNames sample preflight", version: VERSION },
    license: LICENSE,
    no_database_operations: true,
    scope: "KE, GB, JP, BR, SG plus GeoNames metadata/crosswalks; not worldwide coverage",
    sources: {},
    validation: {
      status: "BLOCKED",
      source_records_read: null,
      normalized_records: null,
      accepted: null,
      rejected: null,
      quarantined: null,
      duplicate_source_identifiers: null,
      unmatched_or_ambiguous_country_mappings: null,
      missing_or_invalid_parent_relationships: null,
      feature_type_counts: {},
      iso_code_coverage: {},
      per_country_counts: {},
      note: "Null means not measured. Never interpret null as zero. A current approved ISO dataset and parsed checksum-verified archives are required before record-level counts."
    },
    exceptions: [],
    retrieval_errors: []
  };

  for (const source of SOURCES) {
    const target = path.join(root, source.file);
    const prev = previous.sources?.[source.file] ?? {};
    let retrieval = { retrieved_at: prev.retrieved_at ?? null, http_status: null, retrieval_error: null };
    if (download) retrieval = await fetchToFile(source, target);
    const entry = {
      ...source, ...retrieval, bytes: null, sha256: null,
      expected_sha256: prev.expected_sha256 ?? null, integrity: "NOT_CHECKED"
    };
    try {
      entry.bytes = (await stat(target)).size;
      entry.sha256 = await hashFile(target);
      if (!entry.expected_sha256) {
        entry.integrity = "BLOCKED_EXPECTED_CHECKSUM_NOT_PINNED";
        manifest.exceptions.push({ file: source.file, reason_code: "EXPECTED_SHA256_NOT_PINNED", observed_sha256: entry.sha256 });
      } else if (entry.expected_sha256.toLowerCase() !== entry.sha256) {
        entry.integrity = "BLOCKED_SHA256_MISMATCH";
        manifest.exceptions.push({ file: source.file, reason_code: "SHA256_MISMATCH", expected: entry.expected_sha256, observed: entry.sha256 });
      } else {
        entry.integrity = "CHECKSUM_MATCH";
      }
    } catch {
      entry.integrity = "BLOCK_SOURCE_MISSING";
      manifest.retrieval_errors.push({
        source_url: source.url,
        reason_code: "SOURCE_MISSING",
        retrieval_error: retrieval.retrieval_error ?? "File not present in workspace; run with --download from a network-enabled isolated runner."
      });
    }
    manifest.sources[source.file] = entry;
  }

  // CountryInfo checks run only after a checksum has been explicitly pinned
  // and verified. Candidate ISO codes are not treated as ISO-authority evidence.
  const ci = manifest.sources["countryInfo.txt"];
  if (ci.integrity === "CHECKSUM_MATCH") {
    const rows = (await readFile(path.join(root, "countryInfo.txt"), "utf8")).split(/\r?\n/).filter(line => line && !line.startsWith("#"));
    const byCode = new Map();
    const duplicates = [];
    for (const [index, line] of rows.entries()) {
      const f = line.split("\t");
      if (f.length < 17) {
        manifest.exceptions.push({ file: "countryInfo.txt", line: index + 1, reason_code: "INVALID_COLUMN_COUNT", count: f.length });
        continue;
      }
      if (byCode.has(f[0])) duplicates.push(f[0]);
      else byCode.set(f[0], { alpha2: f[0], alpha3: f[1], numeric: f[2], geonames_id: f[16] });
    }
    manifest.validation.country_info_records_read = rows.length;
    manifest.validation.country_info_duplicate_alpha2 = [...new Set(duplicates)];
    for (const [code, [alpha2, alpha3, numeric]] of Object.entries(ISO_CANDIDATES)) {
      const row = byCode.get(code);
      manifest.validation.iso_code_coverage[code] = {
        candidate_alpha2: alpha2, candidate_alpha3: alpha3, candidate_numeric_text: numeric,
        country_info_match: row ? {
          alpha2_matches: row.alpha2 === alpha2,
          alpha3_matches: row.alpha3 === alpha3,
          numeric_text_matches: row.numeric === numeric,
          geonames_id: row.geonames_id
        } : null,
        approved_iso_authority_verified: false
      };
    }
  }

  manifest.validation.source_files_expected = SOURCES.length;
  manifest.validation.source_files_checksum_match = Object.values(manifest.sources).filter(s => s.integrity === "CHECKSUM_MATCH").length;
  manifest.validation.source_files_missing = Object.values(manifest.sources).filter(s => s.integrity === "BLOCK_SOURCE_MISSING").length;
  manifest.validation.source_files_missing_checksum_pin = Object.values(manifest.sources).filter(s => s.integrity === "BLOCKED_EXPECTED_CHECKSUM_NOT_PINNED").length;
  manifest.validation.source_files_checksum_mismatch = Object.values(manifest.sources).filter(s => s.integrity === "BLOCKED_SHA256_MISMATCH").length;
  manifest.validation.status = "BLOCKED"; // record parsing/mapping is deliberately not claimed by this preflight.
  manifest.validation.note += " The validator currently pins/verifies sources and checks source country metadata only; GeoNames place archive parsing, feature mapping and parent reconciliation remain blocked pending a separately reviewed ZIP/parser implementation and approved ISO source snapshot.";

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(path.join(root, "validation-summary.json"), JSON.stringify(manifest.validation, null, 2) + "\n");
  await writeFile(path.join(root, "exceptions.jsonl"), manifest.exceptions.map(x => JSON.stringify(x)).join("\n") + (manifest.exceptions.length ? "\n" : ""));
  await writeFile(path.join(root, "retrieval-errors.json"), JSON.stringify(manifest.retrieval_errors, null, 2) + "\n");
  console.log(JSON.stringify({
    status: manifest.validation.status,
    parser_version: VERSION,
    source_files_expected: manifest.validation.source_files_expected,
    source_files_checksum_match: manifest.validation.source_files_checksum_match,
    source_files_missing: manifest.validation.source_files_missing,
    checksum_pin_missing: manifest.validation.source_files_missing_checksum_pin,
    checksum_mismatches: manifest.validation.source_files_checksum_mismatch,
    source_records_read: manifest.validation.source_records_read,
    accepted: manifest.validation.accepted,
    rejected: manifest.validation.rejected,
    quarantined: manifest.validation.quarantined,
    output_files: ["source-manifest.json", "validation-summary.json", "exceptions.jsonl", "retrieval-errors.json"],
  }, null, 2));
  if (manifest.validation.status !== "READY") process.exitCode = 2;
}

main().catch(error => {
  console.error("Blocked, failed closed:", error?.stack ?? error);
  process.exitCode = 1;
});
