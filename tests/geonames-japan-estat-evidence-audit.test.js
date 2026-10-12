import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_PAGE_SIZE,
  ESTAT_CATALOG_URL,
  ESTAT_SPARQL_ENDPOINT,
  SPARQL_QUERY,
  buildCandidateAudit,
  buildJapaneseAlternateNameCandidateAudit,
  containsJapaneseOrHanScript,
  buildCatalogQuery,
  buildDetailsQuery,
  fetchEstatSnapshot,
  normalizeExactLabel,
  normalizeJapaneseLabel,
  parseEstatBindings,
  parseGeoNamesSourceRow,
  renderCandidateCsv,
  renderJapaneseAlternateNameCandidateCsv,
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
    target.geonames_id, target.name, target.name, target.alternate_names_raw ?? (target.source_alternate_names ?? []).join(","), target.latitude ?? "35.0000", target.longitude ?? "139.0000",
    target.feature_class ?? "A", target.feature_code, target.country_code, "",
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

function catalogBinding(index, label = `Unrelated label ${index}`, labelJa = "") {
  const row = {
    PERIOD: { type: "uri", value: `http://data.e-stat.go.jp/lod/sac/C27100-${index}-19700401` },
    IDENTIFIER: { type: "literal", value: String(index).padStart(5, "0") },
    LABELEN: { type: "literal", value: label, "xml:lang": "en" },
  };
  if (labelJa) row.LABELJA = { type: "literal", value: labelJa, "xml:lang": "ja" };
  return row;
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
  assert.match(buildCatalogQuery(0), /OPTIONAL\s*\{\s*\?period rdfs:label \?labelJa/);
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
  assert.equal(parsed.alternate_names_raw, "");
  assert.deepEqual(parsed.alternate_names, []);
  const alternateNameRow = sourceGeoRow(japanTarget(2, { alternate_names_raw: "八尾町,やおちょう" }));
  assert.equal(alternateNameRow.alternate_names_raw, "八尾町,やおちょう");
  assert.deepEqual(alternateNameRow.alternate_names, ["八尾町", "やおちょう"]);
  assert.equal(normalizeJapaneseLabel(" 八尾町 "), "八尾町");
  assert.equal(parsed.geonames_id, target.geonames_id);
  assert.equal(parsed.feature_code, "ADM4");
  assert.equal(parsed.country_code, "JP");
  assert.equal(parsed.raw_admin1_code, "00");
  assert.equal(parsed.raw_admin2_code, "");
  assert.equal(parsed.feature_class, "A");
  assert.equal(parsed.latitude, "35.0000");
  assert.equal(parsed.longitude, "139.0000");
  assert.equal(parsed.timezone, "Asia/Tokyo");
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

test("surfaces repeated target names and shared area-code candidates without inferring identity", () => {
  const targets = makeTargets();
  targets[0] = {
    ...targets[0], name: "Takaoka-chō", latitude: "36.7500", longitude: "137.0200",
  };
  targets[1] = {
    ...targets[1], name: "Takaoka-cho", latitude: "36.7600", longitude: "137.0300",
  };
  const verifiedTargets = targets.map((row) => ({
    ...row,
    source_modification_date: "2020-06-11",
    source_ascii_name: row.name,
    source_latitude: row.latitude ?? "35.0000",
    source_longitude: row.longitude ?? "139.0000",
    source_feature_class: "A",
    source_identity_and_raw_codes_verified: true,
  }));
  const report = buildCandidateAudit(
    verifiedTargets,
    [estatRow(1, {
      area_code: "45381",
      label_en: "Takaoka-cho",
      period_uri: "http://data.e-stat.go.jp/lod/sac/C45381-19700401",
      parent_area_code: "45380",
    })],
    "c".repeat(64),
  );
  const targetOne = report.target_results.find((row) => row.geonames_id === verifiedTargets[0].geonames_id);
  assert.equal(targetOne.source_latitude, "36.7500");
  assert.equal(targetOne.source_longitude, "137.0200");
  assert.equal(targetOne.source_feature_class, "A");

  const nameCollision = report.cross_target_identity_review.repeated_normalized_name_groups
    .find((group) => group.normalized_name_key === "takaoka cho");
  assert.ok(nameCollision);
  assert.equal(nameCollision.target_count, 2);
  assert.deepEqual(nameCollision.shared_candidate_area_codes, ["45381"]);
  assert.equal(nameCollision.coordinate_collision, "DISTINCT_COORDINATES_REQUIRE_ENTITY_REVIEW");
  assert.equal(nameCollision.approval, "NO_ENTITY_CROSSWALK_APPROVED");

  const sharedCode = report.cross_target_identity_review.shared_candidate_area_code_groups
    .find((group) => group.area_code === "45381");
  assert.ok(sharedCode);
  assert.equal(sharedCode.distinct_geonames_ids.length, 2);
  assert.equal(sharedCode.approval, "NO_ENTITY_CROSSWALK_APPROVED");
  assert.equal(report.operational_parent_links_created, 0);
  const csv = renderCandidateCsv(report);
  assert.match(csv, /source_latitude/);
  assert.match(csv, /36.7500/);
});

test("identical GeoNames coordinates are flagged for manual review, not silently deduplicated", () => {
  const targets = makeTargets();
  targets[0] = {
    ...targets[0], name: "Shared Name", latitude: "35.1234", longitude: "139.1234",
  };
  targets[1] = {
    ...targets[1], name: "Shared Name", latitude: "35.1234", longitude: "139.1234",
  };
  const verifiedTargets = targets.map((row) => ({
    ...row,
    source_modification_date: "2020-06-11",
    source_latitude: row.latitude ?? "35.0000",
    source_longitude: row.longitude ?? "139.0000",
    source_feature_class: "A",
    source_identity_and_raw_codes_verified: true,
  }));
  const report = buildCandidateAudit(
    verifiedTargets,
    [estatRow(1, { area_code: "12345", label_en: "Shared Name" })],
    "d".repeat(64),
  );
  const group = report.cross_target_identity_review.repeated_normalized_name_groups
    .find((item) => item.normalized_name_key === "shared name");
  assert.ok(group);
  assert.equal(group.coordinate_collision, "EXACT_COORDINATE_COLLISION_REQUIRES_SOURCE_REVIEW");
  assert.equal(report.operational_parent_links_created, 0);
});

test("matches Japanese alternate-name entries only by exact official Japanese label equality", () => {
  const targets = makeTargets().map((target, index) => ({
    ...target,
    source_identity_and_raw_codes_verified: true,
    source_alternate_names: index === 0 ? ["八尾町", "Yaocho"] : index === 1 ? ["架空町"] : [],
  }));
  const sourceRows = [
    estatRow(501, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27100-19700401",
      area_code: "27100",
      label_en: "Unrelated official English label A",
      label_ja: "八尾町",
    }),
    estatRow(502, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27101-19700401",
      area_code: "27101",
      label_en: "Unrelated official English label B",
      label_ja: "八尾町",
    }),
    estatRow(503, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27102-19700401",
      area_code: "27102",
      label_en: "Unrelated official English label C",
      label_ja: "八尾町村",
    }),
  ];
  const english = buildCandidateAudit(targets, sourceRows, "a".repeat(64));
  const japanese = buildJapaneseAlternateNameCandidateAudit(targets, english, sourceRows);
  assert.equal(containsJapaneseOrHanScript("八尾町"), true);
  assert.equal(containsJapaneseOrHanScript("Yaocho"), false);
  assert.equal(japanese.target_count, 126);
  assert.equal(japanese.targets_with_any_alternate_names, 2);
  assert.equal(japanese.targets_with_japanese_or_han_script_alternate_names, 2);
  assert.equal(japanese.targets_with_script_alternate_names_but_no_exact_candidate, 1);
  assert.equal(japanese.alternate_name_tokens_total, 3);
  assert.equal(japanese.alternate_name_tokens_with_japanese_or_han_script, 2);
  assert.equal(japanese.targets_with_japanese_alternate_label_candidates, 1);
  assert.equal(japanese.targets_without_japanese_alternate_label_candidates, 125);
  assert.equal(japanese.target_to_area_code_candidate_associations, 2);
  assert.equal(japanese.distinct_candidate_area_codes, 2);
  const yao = japanese.target_results.find((target) => target.geonames_id === String(targets[0].geonames_id));
  assert.equal(yao.review_status, "MULTIPLE_JAPANESE_LABEL_CODE_CANDIDATES_REQUIRE_DISAMBIGUATION");
  assert.deepEqual(yao.candidates.map((candidate) => candidate.area_code), ["27100", "27101"]);
  assert.equal(yao.candidates.every((candidate) =>
    candidate.periods.some((period) => period.matches_target_japanese_alternate_name)), true);
  assert.equal(japanese.operational_parent_links_created, 0);
  const csv = renderJapaneseAlternateNameCandidateCsv(japanese, "b".repeat(64));
  assert.match(csv, /27100/);
  assert.match(csv, /八尾町/);
  assert.doesNotMatch(csv, /27102/);
  assert.match(csv, /NO_EXACT_JAPANESE_ALTERNATE_LABEL_MATCH/);
});

test("Japanese alternate-name review includes ambiguous English targets and records independent code intersection", () => {
  const targets = makeTargets().map((target, index) => ({
    ...target,
    name: index === 0 ? "Ambiguous-chō" : index === 1 ? "Unique-cho" : target.name,
    source_identity_and_raw_codes_verified: true,
    source_alternate_names: index === 0 ? ["複合町"] : index === 1 ? ["唯一町"] : [],
  }));
  const sourceRows = [
    estatRow(801, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27100-19700401",
      area_code: "27100",
      label_en: "Ambiguous-cho",
      label_ja: "複合町",
    }),
    estatRow(802, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27101-19700401",
      area_code: "27101",
      label_en: "Ambiguous cho",
      label_ja: "別町",
    }),
    estatRow(803, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27102-19700401",
      area_code: "27102",
      label_en: "Unique-cho",
      label_ja: "唯一町",
    }),
    estatRow(804, {
      period_uri: "http://data.e-stat.go.jp/lod/sac/C27103-19700401",
      area_code: "27103",
      label_en: "Different English label",
      label_ja: "複合町",
    }),
  ];
  const english = buildCandidateAudit(targets, sourceRows, "c".repeat(64));
  const japanese = buildJapaneseAlternateNameCandidateAudit(targets, english, sourceRows);

  assert.equal(english.target_results[0].exact_name_candidate_count, 2);
  assert.equal(english.target_results[1].exact_name_candidate_count, 1);
  assert.equal(japanese.target_count, 125);
  assert.equal(japanese.english_targets_with_zero_exact_area_code_candidates, 124);
  assert.equal(japanese.english_targets_with_multiple_exact_area_code_candidates, 1);
  assert.equal(japanese.targets_excluded_because_english_candidate_is_unique, 1);
  assert.equal(japanese.targets_with_japanese_candidate_intersecting_english_candidates, 1);
  assert.equal(japanese.operational_parent_links_created, 0);

  const ambiguous = japanese.target_results.find((row) => row.geonames_id === targets[0].geonames_id);
  assert.deepEqual(ambiguous.english_candidate_area_codes, ["27100", "27101"]);
  assert.deepEqual(ambiguous.japanese_candidate_area_codes_also_matching_english, ["27100"]);
  assert.deepEqual(
    ambiguous.candidates.map((candidate) => [candidate.area_code, candidate.matches_exact_english_candidate_area_code]),
    [["27100", true], ["27103", false]],
  );
  assert.equal(ambiguous.operational_parent_link_created, false);

  assert.equal(
    japanese.target_results.some((row) => row.geonames_id === targets[1].geonames_id),
    false,
    "a target with one unique English candidate does not need this fallback review",
  );
  const csv = renderJapaneseAlternateNameCandidateCsv(japanese);
  assert.match(csv, /english_candidate_area_codes/);
  assert.match(csv, /japanese_candidate_area_codes_also_matching_english/);
  assert.match(csv, /27100;27101/);
  assert.match(csv, /true/);
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

test("paged snapshot fetches every history period for matched area codes and pins every response", async () => {
  const targetNames = ["Yao-chō"];
  const periodA = "http://data.e-stat.go.jp/lod/sac/C27100-19700401";
  const periodA2 = "http://data.e-stat.go.jp/lod/sac/C27100-19900401";
  const periodB = "http://data.e-stat.go.jp/lod/sac/C27101-19700401";
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    const query = new URLSearchParams(options.body).get("query");
    if (query.includes("VALUES ?period")) {
      return sparqlResponse([
        detailBinding(periodA, { ISSUED: { value: "1970-04-01" } }),
        detailBinding(periodA2, { ISSUED: { value: "1990-04-01" } }),
        detailBinding(periodB, { ISSUED: { value: "1970-04-01" } }),
      ]);
    }
    const offset = Number(query.match(/OFFSET (\\d+)/)?.[1] ?? "0");
    return sparqlResponse(offset === 0 ? [
      { ...catalogBinding(27100, "Yao-cho"), PERIOD: { type: "uri", value: periodA } },
      { ...catalogBinding(27100, "Yao cho"), PERIOD: { type: "uri", value: periodA2 } },
      { ...catalogBinding(27101, "Yao cho"), PERIOD: { type: "uri", value: periodB } },
    ] : []);
  };
  const snapshot = await fetchEstatSnapshot(targetNames, fakeFetch, () => new Date("2026-10-11T00:00:00.000Z"));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, ESTAT_SPARQL_ENDPOINT);
  assert.equal(requests[0].options.method, "POST");
  assert.match(requests[0].options.body, /query=/);
  assert.equal(snapshot.manifest.catalog_url, ESTAT_CATALOG_URL);
  assert.equal(snapshot.manifest.catalog_result_row_count, 3);
  assert.equal(snapshot.manifest.catalog_page_count, 1);
  assert.equal(snapshot.manifest.candidate_area_code_count, 2);
  assert.equal(snapshot.manifest.candidate_history_period_uris_requested, 3);
  assert.equal(snapshot.manifest.candidate_detail_result_rows, 3);
  assert.equal(snapshot.manifest.candidate_detail_batch_count, 1);
  assert.equal(snapshot.sourceRows.length, 3);
  assert.equal(snapshot.sourceRows.every((row) => row.parent_area_code === "27000"), true);
  assert.match(snapshot.manifest.response_sha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.manifest.catalog_query_sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.manifest.captured_at_utc, "2026-10-11T00:00:00Z");
  assert.match(snapshot.responseText, /catalog_pages/);
});

test("fetches full code history for exact Japanese alternate-label candidates", async () => {
  const matchingPeriod = "http://data.e-stat.go.jp/lod/sac/C27100-19700401";
  const unrelatedPeriod = "http://data.e-stat.go.jp/lod/sac/C27102-19700401";
  const requests = [];
  const fakeFetch = async (_url, options) => {
    requests.push(options);
    const query = new URLSearchParams(options.body).get("query");
    if (query.includes("VALUES ?period")) {
      assert.match(query, /C27100-19700401/);
      assert.doesNotMatch(query, /C27102-19700401/);
      return sparqlResponse([
        detailBinding(matchingPeriod, { LABELJA: { type: "literal", value: "八尾町", "xml:lang": "ja" } }),
      ]);
    }
    const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? "0");
    return sparqlResponse(offset === 0 ? [
      { ...catalogBinding(27100, "Unrelated English label A", "八尾町"), PERIOD: { type: "uri", value: matchingPeriod } },
      { ...catalogBinding(27102, "Unrelated English label B", "八尾町村"), PERIOD: { type: "uri", value: unrelatedPeriod } },
    ] : []);
  };
  const snapshot = await fetchEstatSnapshot(
    ["Yao-chō"],
    fakeFetch,
    () => new Date("2026-10-11T00:00:00.000Z"),
    [{ geonames_id: "1848001", target_name: "Yao-chō", alternate_names: ["八尾町"] }],
  );
  assert.equal(requests.length, 2);
  assert.equal(snapshot.manifest.candidate_area_code_count, 0);
  assert.equal(snapshot.manifest.japanese_alternate_name_candidate_area_code_count, 1);
  assert.equal(snapshot.manifest.candidate_area_code_count_including_japanese_alternate_names, 1);
  assert.equal(snapshot.manifest.candidate_history_period_uris_requested, 1);
  assert.equal(snapshot.sourceRows.find((row) => row.period_uri === matchingPeriod).label_ja, "八尾町");
  assert.equal(snapshot.sourceRows.find((row) => row.period_uri === unrelatedPeriod).label_ja, "八尾町村");
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
