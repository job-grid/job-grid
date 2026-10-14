import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeCountries, buildGeocodingUrl, normalizeLocations, buildPlaceLabel, buildLocationSelectionPayload, escapeLocationText } from "../scripts/location-picker.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../scripts/supabase-config.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const components = await readFile(new URL("../scripts/components.js", import.meta.url), "utf8");
const buildScript = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const mainScript = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
const logo = await readFile(new URL("../public/job-grid-logo.png", import.meta.url));
const countryData = JSON.parse(await readFile(new URL("../public/data/countries.en.json", import.meta.url), "utf8"));

test("homepage includes semantic landmarks and descriptive metadata", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<title>Job Grid/);
  assert.match(html, /name="description"/);
  assert.match(html, /href="#main"/);
});

test("official supplied logo is a valid PNG and is used by the reusable brand component", () => {
  assert.equal(logo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(components, /class JobGridBrand extends HTMLElement/);
  assert.match(components, /src="\/job-grid-logo\.png"/);
  assert.match(components, /alt="Official Job Grid emblem"/);
  assert.match(components, /variant="footer"/);
  assert.match(buildScript, /job-grid-logo\.png/);
  assert.match(buildScript, /new URL\("job-grid-logo\.png", output\)/);
  assert.doesNotMatch(components, /job-grid-logo\.webp/);
  assert.doesNotMatch(buildScript, /job-grid-logo\.webp/);
});

test("design tokens follow the logo's blue, white, and deep-navy identity", () => {
  for (const token of ["--color-primary", "--color-primary-bright", "--color-secondary", "--color-navy-deep", "--color-bg", "--color-text", "--font-sans", "--radius-lg", "--space-8"]) {
    assert.ok(tokens.includes(token), `Expected token ${token}`);
  }
  assert.match(tokens, /--color-primary: #004ef5/);
  assert.match(tokens, /--color-primary-bright: #1161f6/);
  assert.match(tokens, /--color-bg: #ffffff/);
});

test("responsive and accessibility states are defined", () => {
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 740px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.skip-link/);
  assert.match(css, /\.brand-logo/);
});

test("navigation components expose labels and accessible mobile menu state", () => {
  assert.match(components, /aria-label="Main navigation"/);
  assert.match(components, /aria-expanded="false"/);
  assert.match(components, /aria-controls="primary-navigation"/);
  assert.match(mainScript, /setAttribute\("aria-expanded"/);
});

test("homepage presents role types without inventing employer vacancies", () => {
  assert.match(html, /Browse all role types/);
  assert.match(html, /496 distinct base role titles/);
  assert.match(html, /not confirmed vacancies/i);
  assert.match(html, /id="home-job-types"/);
  assert.doesNotMatch(html, /Sample employer/);
  assert.doesNotMatch(html, /class="role-type">Sample role/);
});
test("country selector reads the public country catalog from Supabase first", async () => {
  const picker = await readFile(new URL("../scripts/location-picker.js", import.meta.url), "utf8");
  assert.equal(SUPABASE_URL, "https://tnrdovdhlwitjzecduxa.supabase.co");
  assert.match(SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(SUPABASE_PUBLISHABLE_KEY, /^sb_secret_/);
  assert.match(picker, /\/rest\/v1\/country_options\?select=code,name&order=name\.asc/);
  assert.match(picker, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(picker, /Authorization\s*:/);
  assert.ok(
    picker.indexOf("fetch(COUNTRY_OPTIONS_ENDPOINT") < picker.indexOf('fetch("/data/countries.en.json"'),
    "Supabase should be tried before the bundled country-list fallback",
  );
  assert.ok(buildScript.includes('"supabase-config.js"'), "public config must be included in static output");
});

test("country selector is included in the homepage and shipped in the static build", async () => {
  assert.ok(html.includes("<job-grid-location-picker></job-grid-location-picker>"));
  assert.ok(html.includes("/scripts/location-picker.js"));
  assert.ok(html.includes("/styles/location-picker.css"));
  assert.ok(buildScript.includes('"location-picker.js"'));
  const pickerCss = await readFile(new URL("../styles/location-picker.css", import.meta.url), "utf8");
  assert.ok(pickerCss.includes("location-picker-fields"));
  assert.ok(pickerCss.includes("@media (max-width: 740px)"));
});

test("bundled country data covers a broad worldwide list and includes Kenya and Japan", () => {
  assert.ok(countryData.length >= 240, "Expected a broad country/area fallback list");
  assert.equal(countryData.find((country) => country.code === "KE")?.name, "Kenya");
  assert.equal(countryData.find((country) => country.code === "JP")?.name, "Japan");
  assert.equal(new Set(countryData.map((country) => country.code)).size, countryData.length);
  assert.ok(buildScript.includes("public/data/"));
  assert.ok(buildScript.includes("public/data/"));
  assert.ok(buildScript.includes('new URL("data/", output)'));
});

test("country list normalization discards invalid/duplicate codes and sorts labels", () => {
  const result = normalizeCountries([
    { cca2: "JP", name: { common: "Japan" } },
    { cca2: "KE", name: { common: "Kenya" } },
    { cca2: "KE", name: { common: "Kenya Duplicate" } },
    { cca2: "X", name: { common: "Bad code" } },
    { cca2: "GB", name: { common: "United Kingdom" } }
  ]);
  assert.deepEqual(result.map((country) => country.code), ["JP", "KE", "GB"].sort((a, b) => {
    const names = { JP: "Japan", KE: "Kenya", GB: "United Kingdom" };
    return names[a].localeCompare(names[b], "en");
  }));
  assert.equal(result.find((country) => country.code === "KE").name, "Kenya");
});

test("geocoding requests always constrain results to the selected country", () => {
  const url = new URL(buildGeocodingUrl("Kisumu", "ke"));
  assert.equal(url.searchParams.get("name"), "Kisumu");
  assert.equal(url.searchParams.get("countryCode"), "KE");
  assert.equal(url.searchParams.get("count"), "100");
  assert.equal(url.searchParams.get("format"), "json");
});

test("a changed place query clears old suggestions before the debounce starts", async () => {
  const pickerScript = await readFile(new URL("../scripts/location-picker.js", import.meta.url), "utf8");
  const inputHandler = pickerScript.match(/onPlaceInput\(\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(inputHandler, "Expected the place input handler to exist");
  const newQueryGate = inputHandler.indexOf("if (!this.selectedCountry || query.length < 2)");
  assert.ok(newQueryGate >= 0, "Expected the minimum-query gate");
  assert.ok(inputHandler.indexOf("this.matches = [];") < newQueryGate, "Old matches must be cleared before the next query is evaluated");
  assert.ok(inputHandler.indexOf("this.resultsContainer.replaceChildren();") < newQueryGate, "Old visible suggestions must be removed before debounce");
});

test("place normalization keeps the selected country and allows missing parent levels", () => {
  const result = normalizeLocations({ results: [
    { id: 1, name: "Kisumu", country_code: "KE", country: "Kenya", admin1: "Kisumu County", feature_code: "PPLA" },
    { id: 2, name: "Paris", country_code: "FR", country: "France", feature_code: "PPLA" },
    { id: 1, name: "Kisumu duplicate", country_code: "KE", feature_code: "PPL" },
    { id: 3, name: "Not a place", country_code: "KE", feature_code: "STM" },
    { id: 4, name: "Unknown feature type", country_code: "KE" },
    { name: "Missing identifier", country_code: "KE", feature_code: "PPL" }
  ] }, "KE");
  assert.equal(result.length, 1, "unclassified feature types must stay review-only");
  assert.equal(result.some((place) => place.name === "Unknown feature type"), false);
  assert.equal(result[0].name, "Kisumu");
  assert.equal(result[0].admin2, "");
  assert.equal(buildPlaceLabel(result[0]), "Kisumu, Kisumu County, Kenya");
  assert.deepEqual(normalizeLocations({ results: [{ id: 2, name: "Paris", country_code: "FR" }] }, "KE"), []);
});

test("historical, abandoned, destroyed and sub-place feature codes are not selectable", () => {
  const sourceResponse = { results: [
    { id: 200, name: "Current county", country_code: "KE", country: "Kenya", feature_code: "ADM2" },
    { id: 201, name: "Former county", country_code: "KE", country: "Kenya", feature_code: "ADM2H" },
    { id: 202, name: "Former town", country_code: "KE", country: "Kenya", feature_code: "PPLH" },
    { id: 203, name: "Abandoned town", country_code: "KE", country: "Kenya", feature_code: "PPLQ" },
    { id: 204, name: "Destroyed town", country_code: "KE", country: "Kenya", feature_code: "PPLW" },
    { id: 205, name: "City section", country_code: "KE", country: "Kenya", feature_code: "PPLX" },
    { id: 206, name: "Grouped settlements", country_code: "KE", country: "Kenya", feature_code: "PPLS" }
  ] };

  const results = normalizeLocations(sourceResponse, "KE");
  assert.deepEqual(
    results.map((place) => [place.id, place.featureCode]),
    [["200", "ADM2"], ["206", "PPLS"]]
  );
});

test("same-named places in different countries remain distinct by country and source ID", () => {
  const sourceResponse = { results: [
    { id: 501, name: "Springfield", country_code: "US", country: "United States", feature_code: "PPL" },
    { id: 902, name: "Springfield", country_code: "KE", country: "Kenya", feature_code: "PPL" }
  ] };

  const kenya = normalizeLocations(sourceResponse, "KE");
  const unitedStates = normalizeLocations(sourceResponse, "US");

  assert.equal(kenya.length, 1);
  assert.equal(unitedStates.length, 1);
  assert.equal(kenya[0].name, unitedStates[0].name);
  assert.notEqual(kenya[0].id, unitedStates[0].id);
  assert.equal(kenya[0].countryCode, "KE");
  assert.equal(unitedStates[0].countryCode, "US");

  const kenyaPayload = buildLocationSelectionPayload(kenya[0], "KE", [{ code: "KE", name: "Kenya" }]);
  const usPayload = buildLocationSelectionPayload(unitedStates[0], "US", [{ code: "US", name: "United States" }]);
  assert.equal(kenyaPayload.place.providerId, "902");
  assert.equal(usPayload.place.providerId, "501");
  assert.equal(kenyaPayload.country.code, "KE");
  assert.equal(usPayload.country.code, "US");
});

test("Kenya and Japan locations remain selectable when administrative parents are incomplete", () => {
  const sourceResponse = { results: [
    {
      id: 4101, name: "Central", country_code: "KE", country: "Kenya",
      admin2: "County A", feature_code: "PPL", latitude: null, longitude: null
    },
    {
      id: 8102, name: "Central", country_code: "JP", country: "Japan",
      admin3: "District A", feature_code: "PPL", latitude: null, longitude: null
    }
  ] };

  const kenya = normalizeLocations(sourceResponse, "KE");
  const japan = normalizeLocations(sourceResponse, "JP");

  assert.equal(kenya.length, 1);
  assert.equal(japan.length, 1);
  assert.equal(kenya[0].id, "4101");
  assert.equal(japan[0].id, "8102");
  assert.equal(kenya[0].admin1, "");
  assert.equal(kenya[0].admin2, "County A");
  assert.equal(japan[0].admin1, "");
  assert.equal(japan[0].admin2, "");
  assert.equal(japan[0].admin3, "District A");
  assert.equal(buildPlaceLabel(kenya[0]), "Central, County A, Kenya");
  assert.equal(buildPlaceLabel(japan[0]), "Central, District A, Japan");

  const japanPayload = buildLocationSelectionPayload(japan[0], "JP", [{ code: "JP", name: "Japan" }]);
  assert.deepEqual(japanPayload.place.adminAreas, [{ level: "admin3", name: "District A" }]);
  assert.equal(japanPayload.place.coordinates, null);

  const kenyaPayload = buildLocationSelectionPayload(kenya[0], "KE", [{ code: "KE", name: "Kenya" }]);
  assert.deepEqual(kenyaPayload.place.adminAreas, [{ level: "admin2", name: "County A" }]);
  assert.equal(kenyaPayload.place.coordinates, null);
});

test("invalid or out-of-range coordinates are never emitted as a valid location point", () => {
  const place = normalizeLocations({ results: [{
    id: 9999, name: "Outside", country_code: "KE", country: "Kenya",
    feature_code: "PPL", latitude: 91, longitude: 181
  }] }, "KE")[0];
  const payload = buildLocationSelectionPayload(place, "KE", [{ code: "KE", name: "Kenya" }]);
  assert.deepEqual(payload.place.coordinates, null);
});

test("selected location emits a versioned country-scoped integration payload with optional admin levels", () => {
  const place = normalizeLocations({ results: [{
    id: 314159,
    name: "Kisumu",
    country_code: "KE",
    country: "Kenya",
    admin1: "Kisumu County",
    feature_code: "PPLA",
    latitude: -0.1022,
    longitude: 34.7617
  }] }, "KE")[0];
  const payload = buildLocationSelectionPayload(place, "KE", [{ code: "KE", name: "Kenya" }]);
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(payload.country, { code: "KE", name: "Kenya" });
  assert.equal(payload.place.provider, "open-meteo-geocoding");
  assert.equal(payload.place.providerId, "314159");
  assert.equal(payload.place.type, "populated_place");
  assert.deepEqual(payload.place.adminAreas, [{ level: "admin1", name: "Kisumu County" }]);
  assert.deepEqual(payload.place.coordinates, { latitude: -0.1022, longitude: 34.7617 });
  assert.equal(payload.displayLabel, "Kisumu, Kisumu County, Kenya");
  assert.equal(buildLocationSelectionPayload(place, "JP", [{ code: "JP", name: "Japan" }]), null);
});

test("location selector remains a frontend preview until persistence is built", async () => {
  const docs = await readFile(new URL("../docs/location-selector-mvp.md", import.meta.url), "utf8");
  assert.match(docs, /frontend preview only/i);
  assert.match(docs, /does not save a candidate profile/i);
  assert.match(docs, /import a catalog/i);
});


test("remote place text is escaped before HTML insertion", () => {
  assert.equal(escapeLocationText('<img src="x" onerror="bad">'), "&lt;img src=&quot;x&quot; onerror=&quot;bad&quot;&gt;");
});
