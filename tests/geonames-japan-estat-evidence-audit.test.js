import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_PAGE_SIZE,
  ESTAT_CATALOG_URL,
  ESTAT_SPARQL_ENDPOINT,
  SPARQL_QUERY,
  buildCandidateAudit,
  buildCatalogQuery,
  buildDetailsQuery,
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
    period_uri: `http://data.e-stat.go.jp/lod/sac/C27100-${index}0101`,
    area_code: "27100",
    label_en: `Japanese target ${index}`,
    label_ja: `日本の対象${index}`,
    effective_from: "1970-04-01",
    effective_until: "",
    parent_uri: "http://data.e-stat.go.jp/lod/sac/C27000-19700401",
    parent_area_code: "27000",
    parent_label_en: "Osaka-fu",
    parent_label_ja: "大阪府",
    previous_period_uri: "",
    succeeding_period_uri: "",
    administrative_class_uri: "http://data.e-stat.go.jp/lod/terms/sacs#Municipality",
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

function sparqlResponse(bindings) {
  const body = Buffer.from(JSON.stringify({ head: { vars: [] }, results: { bindings } }));
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => ({
        date: "Sun, 11 Oct 2026 00:00:00 GMT",
        "last-modified": null,
        etag: '"snapshot"',
        "content-type": "application/sparql-results+json",
      }[name.toLowerCase()] ?? null),
    },
    arrayBuffer: async () => body,
  };
}

function catalogBinding(index, label = `Unrelated label ${index}`) {
  return {
    PERIOD: { type: "uri", value: `http://data.e-stat.go.jp/lod/sac/C27100-${index}-19700401` },
    IDENTIFIER: { type: "literal", value: String(index).padStart(5, "0") },
    LABELEN: { type: "literal", value: label, "xml:lang": "en" },
  };
}

function detailBinding(uri, overrides = {}) {
  return {
    PERIOD: { type: "uri", value: uri },
    LABELJA: { type: "literal", value: "八尾町", "xml:lang": "ja" },
    ISSUED: { type: "literal", value: "1970-04-01" },
    PARENT: { type: "uri", value: "http://data.e-stat.go.jp/lod/sac/C27000-19700401" },
    PARENTIDENTIFIER: { type: "literal", value: "27000" },
    PARENTLABELEN: { type: "literal", value: "Osaka-fu", "xml:lang": "en" },
    PARENTLABELJA: { type: "literal", value: "大阪府", "xml:lang": "ja" },
    ADMINISTRATIVECLASS: { type: "uri", value: "http://data.e-stat.go.jp/lod/terms/sacs#Municipality" },
    ...overrides,
  };
}

test("normalizes diacritics and punctuation for exact label discovery only", () => {
  assert.equal(normalizeExactLabel("Yao-chō"), "yao cho");
  assert.equal(normalizeExactLabel("Yao-cho"), "yao cho");
  assert.notEqual(normalizeExactLabel("Yao-chō"), normalizeExactLabel("Yaocho"));
  assert.notEqual(normalizeExactLabel("Yao-chō"), normalizeExactLabel("Yao-chou"));
});

test("catalog queries page complete source and do not request optional detail fields for every period", () => {
  assert.match(SPARQL_QUERY, /LIMIT 4000/);
  assert.match(buildCatalogQuery(0), /OFFSET 0/);
  assert.match(buildCatalogQuery(4000), /OFFSET 4000/);
  assert.throws(() => buildCatalogQuery(-1), /Invalid/);
  assert.throws(() => buildCatalogQuery(1.5), /Invalid/);
  assert.match(buildDetailsQuery(["http://data.e-stat.go.jp/lod/sac/C27100-19700401"]), /sacs:previousCode/);
  assert.throws(() => buildDetailsQuery(["https://data.e-stat.go.jp/lod/sac/C27100-19700401"]), /Rejected unexpected/);
  assert.throws(() => buildDetailsQuery(["http://example.com/lod/sac/C27100-19700401"]), /Rejected unexpected/);
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

test("groups historical code periods under distinct area-code candidates without approving parents", () => {
  const targets = makeTargets();
  const verifiedTargets = targets.map((row) => ({
    ...row,
    source_modification_date: "2020-06-11",
    source_identity_and_raw_codes_verified: true,
  }));
  const sourceRows = [
    estatRow(1, { area_code: "27100", label_en: "Yao-cho", period_uri: "http://data.e-stat.go.jp/lod/sac/C27100-19700401" }),
    estatRow(2, { area_code: "27100", label_en: "Yao cho", period_uri: "http://data.e-stat.go.jp/lod/sac/C27100-19900401" }),
    estatRow(3, { area_code: "27101", label_en: "Yao cho", period_uri: "http://data.e-stat.go.jp/lod/sac/C27101-19700401" }),
    estatRow(4, { area_code: "27102", label_en: "Different Place" }),
  ];
  const report = buildCandidateAudit(verifiedTargets, sourceRows, "a".repeat(64));
  assert.equal(report.target_count, 126);
  assert.equal(report.target_source_identity_and_raw_code_matches, 126);
  assert.equal(report.operational_parent_links_created, 0);
  const yao = report.target_results.find((row) => row.geonames_id === verifiedTargets[0].geonames_id);
  assert.equal(yao.exact_name_candidate_count, 2);
  assert.equal(yao.exact_name_matched_period_count, 3);
  assert.equal(yao.review_status, "MULTIPLE_AREA_CODE_CANDIDATES_REQUIRE_DISAMBIGUATION");
  const code27100 = yao.candidates.find((candidate) => candidate.area_code === "27100");
  assert.equal(code27100.exact_matching_period_count, 2);
  assert.equal(code27100.history_period_count, 2);
  assert.equal(code27100.periods.length, 2);
  assert.equal(code27100.periods.every((period) => period.parent_references.some((parent) => parent.area_code === "27000")), true);
  assert.equal(yao.candidates.every((candidate) => candidate.area_code !== ""), true);
  assert.equal(yao.operational_parent_link_created, false);
  assert.equal(report.targets_without_exact_label_candidates, 125);
  const csv = renderCandidateCsv(report);
  assert.match(csv, /MULTIPLE_AREA_CODE_CANDIDATES_REQUIRE_DISAMBIGUATION/);
  assert.match(csv, /candidate_history_period_count/);
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

test("maps uppercase JSON SPARQL bindings into evidence fields", () => {
  const [row] = parseEstatBindings([{
    PERIOD: { value: "http://data.e-stat.go.jp/lod/sac/C27100-19700401" },
    IDENTIFIER: { value: "27100" },
    LABELEN: { value: "Yao-cho" },
    LABELJA: { value: "八尾町" },
    ISSUED: { value: "1970-04-01" },
    PARENT: { value: "http://data.e-stat.go.jp/lod/sac/C27000-19700401" },
    PARENTIDENTIFIER: { value: "27000" },
    PARENTLABELEN: { value: "Osaka-fu" },
    PARENTLABELJA: { value: "大阪府" },
  }]);
  assert.equal(row.area_code, "27100");
  assert.equal(row.label_en, "Yao-cho");
  assert.equal(row.label_ja, "八尾町");
  assert.equal(row.parent_area_code, "27000");
});

test("paged snapshot fetches candidate details and pins every response", async () => {
  const targetNames = ["Yao-chō"];
  const periodA = "http://data.e-stat.go.jp/lod/sac/C27100-19700401";
  const periodB = "http://data.e-stat.go.jp/lod/sac/C27100-19900401";
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    const query = new URLSearchParams(options.body).get("query");
    if (query.includes("VALUES ?period")) {
      return sparqlResponse([
        detailBinding(periodA, { ISSUED: { value: "1970-04-01" } }),
        detailBinding(periodB, { ISSUED: { value: "1990-04-01" } }),
      ]);
    }
    const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? "0");
    return sparqlResponse(offset === 0 ? [
      catalogBinding(27100, "Yao-cho"),
      { ...catalogBinding(27101, "Yao cho"), PERIOD: { type: "uri", value: periodB } },
    ].map((row, index) => ({ ...row, PERIOD: { type: "uri", value: index === 0 ? periodA : periodB } })) : []);
  };
  const snapshot = await fetchEstatSnapshot(targetNames, fakeFetch, () => new Date("2026-10-11T00:00:00.000Z"));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, ESTAT_SPARQL_ENDPOINT);
  assert.equal(requests[0].options.method, "POST");
  assert.match(requests[0].options.body, /query=/);
  assert.equal(snapshot.manifest.catalog_url, ESTAT_CATALOG_URL);
  assert.equal(snapshot.manifest.catalog_result_row_count, 2);
  assert.equal(snapshot.manifest.catalog_page_count, 1);
  assert.equal(snapshot.manifest.candidate_detail_result_rows, 2);
  assert.equal(snapshot.sourceRows.length, 2);
  assert.equal(snapshot.sourceRows.every((row) => row.parent_area_code === "27000"), true);
  assert.match(snapshot.manifest.response_sha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.manifest.catalog_query_sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.manifest.captured_at_utc, "2026-10-11T00:00:00Z");
  assert.match(snapshot.responseText, /catalog_pages/);
});

test("paginates when catalogue page reaches its size and fails closed for an empty first page", async () => {
  const requests = [];
  const fakeFetch = async (_url, options) => {
    requests.push(options);
    const query = new URLSearchParams(options.body).get("query");
    const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? "0");
    if (offset === 0) {
      return sparqlResponse(Array.from({ length: CATALOG_PAGE_SIZE }, (_, index) => catalogBinding(index, `Unmatched place ${index}`)));
    }
    return sparqlResponse([]);
  };
  const snapshot = await fetchEstatSnapshot(["Yao-chō"], fakeFetch, () => new Date("2026-10-11T00:00:00.000Z"));
  assert.equal(requests.length, 2);
  assert.equal(snapshot.manifest.catalog_page_count, 2);
  assert.equal(snapshot.manifest.catalog_result_row_count, CATALOG_PAGE_SIZE);
  assert.equal(snapshot.manifest.candidate_detail_result_rows, 0);
  assert.equal(snapshot.sourceRows.length, CATALOG_PAGE_SIZE);
  assert.equal(snapshot.manifest.candidate_detail_batch_count, 0);

  await assert.rejects(
    () => fetchEstatSnapshot(["Yao-chō"], async () => sparqlResponse([])),
    /expected results.bindings/,
  );
});
