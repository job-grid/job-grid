import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateAudit,
  normalizeLabel,
  renderCandidateAuditCsv
} from "../scripts/geonames-kenya-unit-node-candidate-audit.mjs";

const SOURCE_URL = "https://download.geonames.org/export/dump/KE.zip";
const sourceManifest = {
  remote_sources: [{
    country_code: "KE",
    archive_filename: "KE.zip",
    source_url: SOURCE_URL,
    retrieved_at_utc: "2026-10-12T00:00:00Z",
    http_status: 200,
    archive_sha256: "a".repeat(64),
    archive_size_bytes: 1234,
    zip_crc_validation: "PASS"
  }]
};

function geonamesRow({
  id, name, ascii = name, alternate = "", featureClass = "A",
  featureCode = "ADMD", country = "KE", admin1 = "22",
  latitude = "-1.0", longitude = "36.8"
}) {
  const fields = Array(19).fill("");
  Object.assign(fields, {
    0: String(id), 1: name, 2: ascii, 3: alternate, 4: latitude, 5: longitude,
    6: featureClass, 7: featureCode, 8: country, 10: admin1, 18: "2026-10-12"
  });
  return fields.join("\t");
}

function sampleText(extraRows = []) {
  return [
    geonamesRow({
      id: 192705, name: "Kiambururu Sub-Location", ascii: "Kiambururu Sub-Location",
      alternate: "Kiambururu", featureClass: "A", featureCode: "ADM3", admin1: "01"
    }),
    geonamesRow({
      id: 197219, name: "Githunguri Location", alternate: "Githunguri",
      featureClass: "A", featureCode: "ADMD", admin1: "22"
    }),
    geonamesRow({
      id: 400000, name: "Githunguri", featureClass: "P", featureCode: "PPL", admin1: "22"
    }),
    ...extraRows
  ].join("\n") + "\n";
}

test("name matches discover candidates but do not approve Githunguri Location as the sub-county parent", () => {
  const report = buildCandidateAudit(sampleText(), sourceManifest);
  assert.equal(report.status, "NO_EXACT_SUBCOUNTY_LABEL_CANDIDATE_FOUND__PARENT_REMAINS_UNRESOLVED");
  assert.equal(report.summary.exact_githunguri_subcounty_admin_candidate_count, 0);
  assert.equal(report.summary.githunguri_administrative_name_candidate_count, 1);
  assert.equal(report.summary.kiambururu_administrative_name_candidate_count, 1);
  const location = report.candidates.find((row) => row.geonames_id === "197219");
  assert.equal(location.feature_code, "ADMD");
  assert.equal(location.candidate_disposition, "GITHUNGURI_ADMIN_NAME_CANDIDATE_LEVEL_UNVERIFIED");
  assert.deepEqual(report.decision_boundary.approved_parent_ids, []);
  assert.equal(report.decision_boundary.operational_parent_links_created, 0);
});

test("an exact sub-county label candidate is reported for review but is not auto-approved", () => {
  const text = sampleText([
    geonamesRow({
      id: 900001, name: "Githunguri Sub-County", featureClass: "A",
      featureCode: "ADM2", admin1: "22"
    })
  ]);
  const report = buildCandidateAudit(text, sourceManifest);
  assert.equal(report.status, "EXACT_SUBCOUNTY_LABEL_CANDIDATES_FOUND__MANUAL_IDENTITY_REVIEW_REQUIRED");
  assert.equal(report.summary.exact_githunguri_subcounty_admin_candidate_count, 1);
  const candidate = report.candidates.find((row) => row.geonames_id === "900001");
  assert.equal(candidate.exact_githunguri_subcounty_label_match, true);
  assert.equal(candidate.candidate_disposition, "EXACT_LABEL_CANDIDATE_REQUIRES_MANUAL_IDENTITY_CROSSWALK");
  assert.deepEqual(report.decision_boundary.approved_parent_ids, []);
  assert.equal(report.decision_boundary.operational_parent_links_created, 0);
});

test("normalizes label punctuation but preserves exact-match semantics", () => {
  assert.equal(normalizeLabel("  Githunguri—Sub-County "), "githunguri sub county");
  assert.equal(normalizeLabel("Githunguri East"), "githunguri east");
  const report = buildCandidateAudit(sampleText(), sourceManifest);
  assert.equal(report.candidates.some((row) =>
    row.matched_normalized_labels.includes("githunguri east")), false);
});

test("requires pinned, current official Kenya archive provenance", () => {
  assert.throws(() => buildCandidateAudit(sampleText(), { remote_sources: [] }), /source metadata is missing/);
  const invalid = structuredClone(sourceManifest);
  invalid.remote_sources[0].archive_sha256 = "not-a-hash";
  assert.throws(() => buildCandidateAudit(sampleText(), invalid), /SHA-256 is missing or invalid/);
});

test("CSV is deterministic and exposes source-field match details without parent approval", () => {
  const report = buildCandidateAudit(sampleText(), sourceManifest);
  const csv = renderCandidateAuditCsv(report);
  assert.equal(csv.trimEnd().split("\n").length, report.candidates.length + 1);
  assert.match(csv, /197219/);
  assert.match(csv, /alternate_name: Githunguri/);
  assert.match(csv, /GITHUNGURI_ADMIN_NAME_CANDIDATE_LEVEL_UNVERIFIED/);
  assert.deepEqual(report.decision_boundary.approved_parent_ids, []);
});
