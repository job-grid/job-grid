import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const selectorPath = fileURLToPath(
  new URL("../scripts/geonames-sample-selection-independent-check.py", import.meta.url),
);
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

function sourceRow({
  id,
  name = `Place ${id}`,
  featureClass = "P",
  featureCode = featureClass === "A" ? "ADM1" : "PPL",
  country = "KE",
  latitude = "1.25",
  longitude = "36.75",
  population = "0",
} = {}) {
  return [
    String(id), name, name, "", latitude, longitude, featureClass, featureCode,
    country, "", "00", "", "", "", String(population), "", "0", "Africa/Nairobi",
    "2026-10-10",
  ];
}

function runPython(args) {
  const result = spawnSync(python, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("independent selector deterministically ranks places and preserves unresolved input evidence", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "geonames-independent-selector-"));
  try {
    const sourceRows = [
      sourceRow({ id: 900, name: "Nairobi", population: "1" }),
      ...Array.from({ length: 105 }, (_, i) =>
        sourceRow({ id: 1000 + i, name: `Town ${i}`, population: String(i) }),
      ),
      sourceRow({ id: 2, name: "Administrative area", featureClass: "A" }),
      sourceRow({
        id: 3000,
        name: "Bad-coordinate test",
        latitude: "not-a-number",
        population: "999999",
      }),
      // GeoNames IDs must be unique across selected countries; preserve first hit.
      sourceRow({ id: 1004, name: "Duplicate ID in GB", country: "GB" }),
      ["malformed", "row"],
    ];
    const sourceRowsPath = path.join(temporary, "source-rows.json");
    const archivePath = path.join(temporary, "allCountries.zip");
    writeFileSync(sourceRowsPath, JSON.stringify(sourceRows), "utf8");

    const createArchive = [
      "import json, sys, zipfile",
      "from pathlib import Path",
      "rows = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))",
      "with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as archive:",
      "    archive.writestr('allCountries.txt', ''.join('\\t'.join(row) + '\\n' for row in rows))",
    ].join("\n");
    runPython(["-c", createArchive, sourceRowsPath, archivePath]);

    const inspectSelection = [
      "import importlib.util, json, sys",
      "from pathlib import Path",
      "spec = importlib.util.spec_from_file_location('independent_selector', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "rows, summary = module.select_rows(Path(sys.argv[2]))",
      "print(json.dumps({'rows': rows, 'summary': summary}, ensure_ascii=False))",
    ].join("\n");
    const result = JSON.parse(runPython(["-c", inspectSelection, selectorPath, archivePath]));
    const { rows, summary } = result;

    assert.equal(summary.worldwide_rows_scanned, 110);
    assert.equal(summary.malformed_worldwide_rows, 1);
    assert.equal(summary.duplicate_ids_across_selected_countries, 1);
    assert.equal(summary.invalid_coordinates_across_selected_countries, 1);
    assert.equal(summary.selected_sample_rows, summary.selected_sample_unique_ids);
    assert.equal(summary.selected_sample_rows, rows.length);

    const byId = new Map(rows.map(row => [row[0], row]));
    assert.ok(byId.has("2"), "all administrative features should be included");
    assert.ok(byId.has("900"), "priority-name match should be included");
    assert.ok(byId.has("3000"), "invalid coordinates are counted and not silently dropped");
    assert.ok(!byId.has("1004") || byId.get("1004")[8] === "KE", "keep the first ID occurrence");
    assert.ok(!byId.has("malformed"));

    const topPopulationIds = new Set(
      rows.filter(row => row[19].split(";").includes("top_population_sample")).map(row => row[0]),
    );
    const expectedTopIds = new Set([
      "3000",
      ...Array.from({ length: 99 }, (_, i) => String(1006 + i)),
    ]);
    assert.deepEqual([...topPopulationIds].sort((a, b) => Number(a) - Number(b)),
      [...expectedTopIds].sort((a, b) => Number(a) - Number(b)));

    assert.ok(byId.get("900")[19].split(";").includes("priority_name_match"));
    assert.ok(byId.get("2")[19].split(";").includes("administrative_feature"));
    assert.ok(byId.get("3000")[19].split(";").includes("top_population_sample"));

    const sortedIds = rows.map(row => Number(row[0]));
    assert.deepEqual(sortedIds, [...sortedIds].sort((a, b) => a - b));
    assert.ok(rows.every(row => row.length === 20), "output rows must retain 19 source fields plus sample_reason");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("independent selector refuses unsafe output overwrites", () => {
  const source = readFileSync(selectorPath, "utf8");
  assert.match(source, /if output_path\.exists\(\) or report_path\.exists\(\):/);
  assert.match(source, /Refusing to overwrite existing output or report files\./);
  assert.match(source, /same seeded Python random\.Random/);
  assert.match(source, /does not establish worldwide geographic catalog completeness/i);
});
