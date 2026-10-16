import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const endpoint = SUPABASE_URL + "/rest/v1/country_options?select=code,name&order=name.asc";
const search = document.querySelector("#country-search");
const results = document.querySelector("#country-results");
const count = document.querySelector("#country-count");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let countries = [];

function render() {
  const q = String(search.value ?? "").trim().toLocaleLowerCase();
  const filtered = countries.filter((c) => !q || c.name.toLocaleLowerCase().includes(q) || c.code.toLocaleLowerCase() === q);
  count.textContent = "Showing " + filtered.length + " of " + countries.length + " countries and territories.";
  results.innerHTML = filtered.length ? filtered.map((c) =>
    '<article class="role-card type-card"><div class="role-card-top"><span class="company-mark mark-cobalt" aria-hidden="true">' + escapeHtml(c.code) + '</span><span class="role-type">Destination</span></div><h2>' + escapeHtml(c.name) + '</h2><p class="role-card-subtitle">Browse published vacancies in this destination.</p><div class="role-card-bottom"><span class="tag">' + escapeHtml(c.code) + '</span><a class="arrow-round" href="/country.html?code=' + encodeURIComponent(c.code) + '" aria-label="Browse jobs in ' + escapeHtml(c.name) + '">↗</a></div></article>'
  ).join("") : '<p class="empty-results">No countries match that search. Try a different name or country code.</p>';
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