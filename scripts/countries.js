import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const endpoint = SUPABASE_URL + "/rest/v1/country_options?select=code,name&order=name.asc";
const search = document.querySelector("#country-search");
const results = document.querySelector("#country-results");
const count = document.querySelector("#country-count");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function countryFlag(code, name) {
  const normalized = String(code ?? "").toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) {
    return '<span class="country-flag-fallback" role="img" aria-label="' + escapeHtml(name) + ' destination">🌐</span>';
  }
  // Use actual flag images so the result does not depend on emoji font support.
  // If a flag asset is unavailable, show a neutral globe instead of broken-image text.
  const safeName = escapeHtml(name);
  return '<img class="country-flag-image" src="https://flagcdn.com/w80/' + normalized + '.png" alt="' + safeName + ' flag" width="54" height="36" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false">' +
    '<span class="country-flag-fallback" role="img" aria-label="' + safeName + ' destination" hidden>🌐</span>';
}

let countries = [];

function render() {
  const q = String(search.value ?? "").trim().toLocaleLowerCase();
  const filtered = countries.filter((c) => !q || c.name.toLocaleLowerCase().includes(q) || c.code.toLocaleLowerCase() === q);
  count.textContent = "Showing " + filtered.length + " of " + countries.length + " countries and territories.";
  results.innerHTML = filtered.length ? filtered.map((c) => {
    const name = escapeHtml(c.name);
    const code = escapeHtml(c.code);
    const flag = countryFlag(c.code, c.name);
    const destinationDescription = "Explore published vacancies and career opportunities in " + name + ". Browse any occupation and filter results for this destination.";
    return '<article class="role-card type-card country-card">' +
      '<div class="role-card-top"><span class="country-flag">' + flag + '</span><span class="role-type">Destination</span></div>' +
      '<p class="country-code">' + code + '</p><h2>' + name + '</h2>' +
      '<p class="role-card-subtitle country-description">' + destinationDescription + '</p>' +
      '<div class="country-card-actions"><a class="button button-primary button-small" href="/country.html?code=' + encodeURIComponent(c.code) + '">Browse jobs <span aria-hidden="true">↗</span></a>' +
      '<span class="tag" aria-label="Country code">' + code + '</span></div></article>';
  }).join("") : '<p class="empty-results">No countries match that search. Try a different name or country code.</p>';
  results.setAttribute("aria-busy", "false");
}
search.addEventListener("input", render);

async function init() {
  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json", apikey: SUPABASE_PUBLISHABLE_KEY } });
    if (!response.ok) throw new Error("Country catalogue unavailable (" + response.status + ").");
    const rows = await response.json();
    countries = Array.isArray(rows) ? rows.filter((c) => /^[A-Z]{2}$/.test(String(c.code || "")) && String(c.name || "").trim()) : [];
    if (!countries.length) throw new Error("No country records returned.");
    render();
  } catch (error) {
    count.textContent = "Country catalogue temporarily unavailable.";
    results.innerHTML = '<p class="empty-results">We could not load the country list. Please refresh and try again.</p>';
    results.setAttribute("aria-busy", "false");
    console.error("Job Grid country directory failed:", error);
  }
}
init();
