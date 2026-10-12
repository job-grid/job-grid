const COUNTRIES_ENDPOINT = "https://restcountries.com/v3.1/all?fields=name,cca2";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const FALLBACK_COUNTRIES = [
  { code: "KE", name: "Kenya" },
  { code: "JP", name: "Japan" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "SG", name: "Singapore" },
  { code: "ZA", name: "South Africa" }
];

// Conservative current-place/admin allowlist. Historical divisions/places and sub-place records
// remain evidence/review candidates, not direct city/town/locality suggestions.
const SELECTABLE_FEATURE_CODES = new Set([
  "ADM1", "ADM2", "ADM3", "ADM4", "ADM5", "ADMD",
  "PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5",
  "PPLC", "PPLCD", "PPLF", "PPLG", "PPLL", "PPLR"
]);

/** Normalize the remote country-list response without treating it as persisted catalog data. */
export function normalizeCountries(rows) {
  if (!Array.isArray(rows)) return [];
  const unique = new Map();
  for (const row of rows) {
    const code = String(row?.cca2 ?? row?.code ?? "").trim().toUpperCase();
    const name = String(row?.name?.common ?? row?.name ?? "").trim();
    if (!/^[A-Z]{2}$/.test(code) || !name) continue;
    if (!unique.has(code)) unique.set(code, { code, name });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** Build a country-scoped geocoding request. CountryCode prevents same-name cross-country matches. */
export function buildGeocodingUrl(query, countryCode, base = GEOCODING_ENDPOINT) {
  const url = new URL(base);
  url.searchParams.set("name", String(query ?? "").trim());
  url.searchParams.set("count", "100");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", String(countryCode ?? "").trim().toUpperCase());
  return url.toString();
}

/** Keep only results matching the selected country and likely administrative/populated-place features. */
export function normalizeLocations(payload, countryCode) {
  const selectedCode = String(countryCode ?? "").trim().toUpperCase();
  if (!selectedCode || !Array.isArray(payload?.results)) return [];
  const seen = new Set();
  const results = [];
  for (const item of payload.results) {
    const code = String(item?.country_code ?? "").trim().toUpperCase();
    const name = String(item?.name ?? "").trim();
    const id = item?.id == null ? "" : String(item.id);
    const featureCode = String(item?.feature_code ?? "").trim().toUpperCase();
    if (code !== selectedCode || !name || !id) continue;
    // Unknown, historical, abandoned/destroyed, and sub-place feature codes are review-only.
    if (!SELECTABLE_FEATURE_CODES.has(featureCode)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      name,
      countryCode: code,
      country: String(item?.country ?? "").trim(),
      admin1: String(item?.admin1 ?? "").trim(),
      admin2: String(item?.admin2 ?? "").trim(),
      admin3: String(item?.admin3 ?? "").trim(),
      admin4: String(item?.admin4 ?? "").trim(),
      featureCode,
      latitude: item?.latitude != null && item.latitude !== "" && Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
      longitude: item?.longitude != null && item.longitude !== "" && Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null
    });
  }
  return results.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "en");
    return byName || a.id.localeCompare(b.id, "en");
  });
}

/** Render the chosen place with any available admin levels; missing parent levels are valid. */
/** Build the versioned, country-scoped payload emitted to future profile/search integrations. */
export function buildLocationSelectionPayload(place, countryCode, countries = []) {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!place || !/^[A-Z]{2}$/.test(code) || place.countryCode !== code || !place.id || !place.name) return null;
  const country = countries.find((item) => item.code === code);
  const adminAreas = [
    ["admin1", place.admin1],
    ["admin2", place.admin2],
    ["admin3", place.admin3],
    ["admin4", place.admin4]
  ].filter(([, name]) => String(name ?? "").trim())
    .map(([level, name]) => ({ level, name: String(name).trim() }));
  const latitude = Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90
    ? place.latitude : null;
  const longitude = Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180
    ? place.longitude : null;
  return {
    schemaVersion: 1,
    country: { code, name: country?.name || place.country || code },
    place: {
      provider: "open-meteo-geocoding",
      providerId: String(place.id),
      name: String(place.name).trim(),
      type: place.featureCode.startsWith("ADM") ? "administrative_area"
        : place.featureCode.startsWith("PPL") ? "populated_place" : "unknown",
      featureCode: place.featureCode || null,
      adminAreas,
      coordinates: latitude !== null && longitude !== null
        ? { latitude, longitude }
        : null
    },
    displayLabel: buildPlaceLabel(place)
  };
}

export function buildPlaceLabel(place) {
  if (!place) return "";
  const segments = [place.name, place.admin4, place.admin3, place.admin2, place.admin1, place.country];
  return segments
    .map((value) => String(value ?? "").trim())
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(", ");
}

/** Escape all remote text before inserting it into the light-DOM UI. */
export function escapeLocationText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

if (typeof customElements !== "undefined" && typeof HTMLElement !== "undefined" && !customElements.get("job-grid-location-picker")) {
  class JobGridLocationPicker extends HTMLElement {
    constructor() {
      super();
      this.countries = [];
      this.matches = [];
      this.selected = null;
      this.selectedCountry = "";
      this.requestId = 0;
      this.searchTimer = null;
    }

    connectedCallback() {
      if (this.dataset.initialized === "true") return;
      this.dataset.initialized = "true";
      this.innerHTML = `
        <section class="location-picker-section section-wrap section-space" aria-labelledby="location-picker-title">
          <div class="location-picker-heading">
            <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> Location search preview</p>
            <h2 id="location-picker-title">Find a place, anywhere you’re looking.</h2>
            <p class="section-description">Choose a country first, then search for a city, town or locality. County, state or province details appear when the source provides them.</p>
          </div>
          <div class="location-picker-card">
            <div class="location-picker-fields">
              <label class="location-field">
                <span>Country</span>
                <select name="country" autocomplete="country-name" required>
                  <option value="">Loading countries…</option>
                </select>
              </label>
              <label class="location-field">
                <span>City, town or village</span>
                <input name="place-query" type="search" minlength="2" maxlength="100" placeholder="Choose a country first" autocomplete="off" disabled />
              </label>
            </div>
            <p class="location-status" role="status" aria-live="polite">Loading the country list…</p>
            <div class="location-results" aria-label="Place suggestions"></div>
            <div class="location-selection" aria-live="polite"></div>
            <p class="location-attribution">Location suggestions are based on GeoNames data through Open-Meteo. Small localities may be missing. This is a preview: selections are not saved to a candidate profile.</p>
          </div>
        </section>`;
      this.countrySelect = this.querySelector('[name="country"]');
      this.placeInput = this.querySelector('[name="place-query"]');
      this.status = this.querySelector(".location-status");
      this.resultsContainer = this.querySelector(".location-results");
      this.selectionContainer = this.querySelector(".location-selection");

      this.countrySelect.addEventListener("change", () => this.onCountryChange());
      this.placeInput.addEventListener("input", () => this.onPlaceInput());
      this.resultsContainer.addEventListener("click", (event) => {
        const button = event.target.closest("[data-location-index]");
        if (!button) return;
        const index = Number(button.dataset.locationIndex);
        if (!Number.isInteger(index) || !this.matches[index]) return;
        this.selected = this.matches[index];
        this.renderSelection();
        const payload = buildLocationSelectionPayload(this.selected, this.selectedCountry, this.countries);
        if (payload) {
          this.dispatchEvent(new CustomEvent("job-grid-location-selected", {
            detail: payload,
            bubbles: true,
            composed: true
          }));
        }
      });
      this.addEventListener("click", (event) => {
        if (event.target.closest('[data-action="retry-countries"]')) void this.loadCountries();
      });
      void this.loadCountries();
    }

    async loadCountries() {
      this.status.textContent = "Loading country list…";
      try {
        const response = await fetch(COUNTRIES_ENDPOINT, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Country source unavailable.");
        const countries = normalizeCountries(await response.json());
        if (countries.length < 200) throw new Error("Country source returned an incomplete list.");
        this.countries = countries;
        this.renderCountryOptions();
        this.status.textContent = "Choose a country to begin.";
      } catch {
        try {
          const response = await fetch("/data/countries.en.json", { headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error("Bundled country list unavailable.");
          const bundledCountries = normalizeCountries(await response.json());
          if (bundledCountries.length < 200) throw new Error("Bundled country list is incomplete.");
          this.countries = bundledCountries;
          this.renderCountryOptions();
          this.status.textContent = "Country list loaded from the bundled backup. Place search still requires an internet connection.";
        } catch {
          this.countries = normalizeCountries(FALLBACK_COUNTRIES);
          this.renderCountryOptions();
          this.status.innerHTML = 'The full country list could not be loaded. A limited fallback list is available; <button class="inline-retry" type="button" data-action="retry-countries">try loading all countries again</button>.';
        }
      }
    }

    renderCountryOptions() {
      const currentCode = this.selectedCountry;
      this.countrySelect.innerHTML = '<option value="">Select a country…</option>' + this.countries.map((country) =>
        `<option value="${escapeLocationText(country.code)}">${escapeLocationText(country.name)}</option>`
      ).join("");
      this.countrySelect.value = this.countries.some((country) => country.code === currentCode) ? currentCode : "";
    }

    onCountryChange() {
      this.selectedCountry = this.countrySelect.value;
      this.requestId += 1;
      this.selected = null;
      this.matches = [];
      this.placeInput.value = "";
      this.placeInput.disabled = !this.selectedCountry;
      this.placeInput.placeholder = this.selectedCountry ? "Type at least 2 letters…" : "Choose a country first";
      this.resultsContainer.replaceChildren();
      this.selectionContainer.replaceChildren();
      if (this.searchTimer !== null) clearTimeout(this.searchTimer);
      this.status.textContent = this.selectedCountry ? "Now search for a city, town or village." : "Choose a country to begin.";
      if (this.selectedCountry) this.placeInput.focus();
    }

    onPlaceInput() {
      this.requestId += 1;
      const requestId = this.requestId;
      const query = this.placeInput.value.trim();
      this.selected = null;
      this.selectionContainer.replaceChildren();
      if (this.searchTimer !== null) clearTimeout(this.searchTimer);
      if (!this.selectedCountry || query.length < 2) {
        this.matches = [];
        this.resultsContainer.replaceChildren();
        this.status.textContent = query.length === 1 ? "Enter at least 2 letters to search." : "Type a place name to see suggestions.";
        return;
      }
      this.status.textContent = "Searching within the selected country…";
      this.searchTimer = setTimeout(() => void this.searchPlaces(query, requestId), 300);
    }

    async searchPlaces(query, requestId) {
      try {
        const response = await fetch(buildGeocodingUrl(query, this.selectedCountry), { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Place source unavailable.");
        const payload = await response.json();
        if (requestId !== this.requestId) return;
        this.matches = normalizeLocations(payload, this.selectedCountry);
        this.renderMatches();
      } catch {
        if (requestId !== this.requestId) return;
        this.matches = [];
        this.resultsContainer.replaceChildren();
        this.status.textContent = "We couldn’t load place suggestions. Check your connection and try again.";
      }
    }

    renderMatches() {
      if (!this.matches.length) {
        this.resultsContainer.replaceChildren();
        this.status.textContent = "No matching place found in this country. Try a shorter name or a different spelling.";
        return;
      }
      this.resultsContainer.innerHTML = this.matches.map((place, index) => {
        const label = buildPlaceLabel(place);
        const type = place.featureCode.startsWith("ADM") ? "Administrative area" : "Populated place";
        return `<button class="location-result" type="button" data-location-index="${index}" aria-label="Select ${escapeLocationText(label)}">
          <span class="location-result-icon" aria-hidden="true">⌖</span>
          <span class="location-result-copy"><strong>${escapeLocationText(place.name)}</strong><small>${escapeLocationText([place.admin2, place.admin1, place.country].filter((value, i, all) => value && all.indexOf(value) === i).join(" · ") || place.country)}</small></span>
          <span class="location-result-type">${type}</span>
        </button>`;
      }).join("");
      this.status.textContent = `${this.matches.length} place suggestions found. Select the correct one.`;
    }

    renderSelection() {
      if (!this.selected) {
        this.selectionContainer.replaceChildren();
        return;
      }
      const label = buildPlaceLabel(this.selected);
      this.selectionContainer.innerHTML = `<div class="location-selected-card">
        <span class="location-selected-mark" aria-hidden="true">✓</span>
        <div><strong>Selected location</strong><p>${escapeLocationText(label)}</p>
        <small>This choice is confirmed in the preview only. Saving it to a profile will be connected when candidate accounts are implemented.</small></div>
      </div>`;
      this.status.textContent = "Location selected for this preview.";
    }
  }

  customElements.define("job-grid-location-picker", JobGridLocationPicker);
}
