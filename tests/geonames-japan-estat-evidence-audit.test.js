
import test from "node:test";
import assert from "node:assert/strict";
import {
  ESTAT_CATALOG_URL,
  ESTAT_SPARQL_ENDPOINT,
  SPARQL_QUERY,
  buildCandidateAudit,
  fetchEstatSnapshot,
  normalizeExactLabel,
  parseEstatBindings,
  parseGeoNamesSourceRow,
  renderCandidateCsv,
  selectJapanTargets,
  verifyTargetSourceRows,
} from "../scripts/geonames-japan-estat-evidence-audit.mjs";

function japanTarget(index, overrides = {}) {
  return {
    geonames_id: String(1848000 + index),
    name: index === 1 ? "Yao-chō" : `Japanese target ${index}`,
    country_code: "JP",
    feature_code: "ADM4",
    raw_admin1_code: "00",
    raw_admin2_code: "",
    owner_approved_disposition: "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED",
    ...overrides,
  };
}

function estatRow(index, overrides = {}) {
  return {
    period_uri: `https://data.e-stat.go.jp/lod/sac/C27100-${index}0101`,
    area_code: "27100",
    label_en: `Japanese target ${index}`,
    label_ja: `日本の対象${index}`,
    effective_from: "1970-04-01",
    effective_until: "",
    parent_uri: "https://data.e-stat.go.jp/lod/sac/C27000-19700401",
    parent_area_code: "27000",
    parent_label_en: "Osaka-fu",
    parent_label_ja: "大阪府",
    previous_period_uri: "",
    succeeding_period_uri: "",
    administrative_class_uri: "https://data.e-stat.go.jp/lod/terms/sacs#Municipality",
    ...overrides,
  };
}

function makeTargets() {
  return Array.from({ length: 126 }, (_, index) => japanTarget(index + 1));
}

function sourceGeoRow(target) {
  const fields = [
    target.geonames_id, target.name, target.name, "", "35.0000", "139.0000",
    "A", target.feature_code, target.country_code, "",
    target.raw_admin1_code, target.raw_admin2_code, "", "", "0", "", "", "Asia/Tokyo", "2020-06-11",
  ];
  return parseGeoNamesSourceRow(fields.join("\t"));
}

test("normalizes diacritics and punctuation for exact label discovery only", () => {
  assert.equal(normalizeExactLabel("Yao-chō"), "yao cho");
  assert.equal(normalizeExactLabel("Yao-cho"), "yao cho");
  assert.notEqual(normalizeExactLabel("Yao-chō"), normalizeExactLabel("Yaocho"));
  assert.notEqual(normalizeExactLabel("Yao-chō"), normalizeExactLabel("Yao-chou"));
});

test("selects the exact 126 Japan ADM4 raw-admin1-00 targets and deduplicates consistent IDs", () => {
  const rows = makeTargets();
  rows.push({ ...rows[0] });
  rows.push(japanTarget(127, { country_code: "KE" }));
  rows.push(japanTarget(128, { raw_admin1_code: "01" }));
  rows.push(japanTarget(129, { owner_approved_disposition: "COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED" }));
  const selected = selectJapanTargets(rows);
  assert.equal(selected.length, 126);
  assert.equal(new Set(selected.map((row) => row.geonames_id)).size, 126);
});

test("fails closed on conflicting duplicate source identities in target export", () => {
  const rows = makeTargets();
  rows.push(japanTarget(1, { name: "different name" }));
  assert.throws(() => selectJapanTargets(rows), /Conflicting rows/);
});

test("parses a GeoNames row and preserves raw administrative codes exactly", () => {
  const target = japanTarget(1);
  const parsed = sourceGeoRow(target);
  assert.equal(parsed.geonames_id, target.geonames_id);
  assert.equal(parsed.feature_code, "ADM4");
  assert.equal(parsed.country_code, "JP");
  assert.equal(parsed.raw_admin1_code, "00");
  assert.equal(parsed.raw_admin2_code, "");
  assert.equal(parsed.modification_date, "2020-06-11");
  assert.throws(() => parseGeoNamesSourceRow("1\ttoo few"), /exactly 19/);
});

test("verifies all targets against GeoNames source identity and raw codes", () => {
  const targets = makeTargets();
  const sourceRows = targets.map(sourceGeoRow);
  const verified = verifyTargetSourceRows(targets, sourceRows);
  assert.equal(verified.length, 126);
  assert.equal(verified.every((row) => row.source_modification_date === "2020-06-11"), true);
});

test("source verification rejects a raw-code mismatch instead of normalizing it", () => {
  const target = [japanTarget(1)];
  const source = [sourceGeoRow(target[0])];
  source[0].raw_admin1_code = "";
  assert.throws(
    () => verifyTargetSourceRows(target, source),
    (error) => /verification failed/.test(error.message) &&
      error.failures[0].reason === "SOURCE_IDENTITY_OR_RAW_CODE_MISMATCH" &&
      error.failures[0].mismatch_fields.includes("raw_admin1_code"),
  );
});

test("source verification rejects absent or duplicate target IDs", () => {
  const targets = [japanTarget(1)];
  assert.throws(() => verifyTargetSourceRows(targets, []), /verification failed/);
  assert.throws(
    () => verifyTargetSourceRows(targets, [sourceGeoRow(targets[0]), sourceGeoRow(targets[0])]),
    /verification failed/,
  );
});

test("exact normalized labels report candidate periods but never approve or write parents", () => {
  const targets = makeTargets();
  const verifiedTargets = targets.map((row) => ({
    ...row,
    source_modification_date: "2020-06-11",
    source_identity_and_raw_codes_verified: true,
  }));
  const sourceRows = [
    estatRow(1, { area_code: "27100", label_en: "Yao-cho" }),
    estatRow(2, { area_code: "27100", label_en: "Yao cho", period_uri: "https://data.e-stat.go.jp/lod/sac/C27100-19900401" }),
    estatRow(3, { area_code: "27102", label_en: "Different Place" }),
  ];
  const report = buildCandidateAudit(verifiedTargets, sourceRows, "a".repeat(64));
  assert.equal(report.target_count, 126);
  assert.equal(report.target_source_identity_and_raw_code_matches, 126);
  assert.equal(report.operational_parent_links_created, 0);
  const yao = report.target_results.find((row) => row.geonames_id === verifiedTargets[0].geonames_id);
  assert.equal(yao.exact_name_candidate_count, 2);
  assert.equal(yao.review_status, "MULTIPLE_EXACT_LABEL_CANDIDATES_REQUIRE_DISAMBIGUATION");
  assert.equal(yao.candidates.every((candidate) => Boolean(candidate.parent_uri)), true);
  assert.equal(yao.operational_parent_link_created, false);
  assert.equal(report.targets_without_exact_label_candidates, 125);
  const csv = renderCandidateCsv(report);
  assert.match(csv, /MULTIPLE_EXACT_LABEL_CANDIDATES_REQUIRE_DISAMBIGUATION/);
  assert.match(csv, /false/);
});

test("does not use fuzzy name matching, parent reference, or approximate labels", () => {
  const targets = makeTargets().map((row) => ({
    ...row, source_modification_date: "2020-06-11", source_identity_and_raw_codes_verified: true,
  }));
  const report = buildCandidateAudit(
    targets,
    [estatRow(1, { label_en: "Yaocho" })],
    "b".repeat(64),
  );
  const yao = report.target_results.find((row) => row.geonames_name === "Yao-chō");
  assert.equal(yao.exact_name_candidate_count, 0);
  assert.equal(yao.review_status, "NO_EXACT_NORMALIZED_ENGLISH_LABEL_MATCH");
});

test("maps JSON SPARQL bindings into evidence fields", () => {
  const [row] = parseEstatBindings([{
    period: { value: "https://data.e-stat.go.jp/lod/sac/C27100-19700401" },
    identifier: { value: "27100" },
    labelEn: { value: "Yao-cho" },
    labelJa: { value: "八尾町" },
    issued: { value: "1970-04-01" },
    parent: { value: "https://data.e-stat.go.jp/lod/sac/C27000-19700401" },
    parentIdentifier: { value: "27000" },
    parentLabelEn: { value: "Osaka-fu" },
    parentLabelJa: { value: "大阪府" },
  }]);
  assert.equal(row.area_code, "27100");
  assert.equal(row.label_en, "Yao-cho");
  assert.equal(row.label_ja, "八尾町");
  assert.equal(row.parent_area_code, "27000");
});

test("fetch pins query/result hashes and fails closed on empty or truncated API results", async () => {
  const body = Buffer.from(JSON.stringify({ results: { bindings: [{
    period: { value: "https://data.e-stat.go.jp/lod/sac/C27100-19700401" },
    identifier: { value: "27100" },
    labelEn: { value: "Yao-cho" },
  }] } }));
  let captured;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => ({
        date: "Sun, 11 Oct 2026 00:00:00 GMT",
        "last-modified": null,
        etag: '"snapshot"',
        "content-type": "application/sparql-results+json",
      }[name] ?? null) },
      arrayBuffer: async () => body,
    };
  };
  const snapshot = await fetchEstatSnapshot(fakeFetch, () => new Date("2026-10-11T00:00:00.000Z"));
  assert.equal(captured.url, ESTAT_SPARQL_ENDPOINT);
  assert.equal(captured.options.method, "POST");
  assert.match(captured.options.body, /query=/);
  assert.match(SPARQL_QUERY, /sacs:previousCode/);
  assert.equal(snapshot.manifest.catalog_url, ESTAT_CATALOG_URL);
  assert.equal(snapshot.manifest.result_row_count, 1);
  assert.match(snapshot.manifest.response_sha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.manifest.query_sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.manifest.captured_at_utc, "2026-10-11T00:00:00Z");

  await assert.rejects(
    () => fetchEstatSnapshot(async () => ({
      ok: true, status: 200, headers: { get: () => null },
      arrayBuffer: async () => Buffer.from('{"results":{"bindings":[]}}'),
    })),
    /non-empty results.bindings/,
  );
});
