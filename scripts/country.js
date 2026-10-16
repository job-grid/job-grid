import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const params = new URLSearchParams(window.location.search);
const code = (params.get("code") || "").toUpperCase();
const title = document.querySelector("#country-title");
const description = document.querySelector("#country-description");
const status = document.querySelector("#country-job-status");
const results = document.querySelector("#country-job-results");
const allJobs = document.querySelector("#all-country-jobs");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label = (value) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const headers = { Accept: "application/json", apikey: SUPABASE_PUBLISHABLE_KEY };

function card(job, countryName) {
  const place = [job.city, job.region, countryName].filter(Boolean).join(", ");
  return '<article class="vacancy-card"><div class="vacancy-meta"><span class="vacancy-tag">' + escapeHtml(label(job.category_slug)) + '</span><span class="vacancy-tag">' + escapeHtml(label(job.employment_type)) + '</span></div><h2>' + escapeHtml(job.title) + '</h2><p class="vacancy-employer">' + escapeHtml(job.employer_name) + '</p><p class="vacancy-tag">' + escapeHtml(place || countryName) + '</p><p class="vacancy-description">' + escapeHtml(job.description) + '</p>' + (job.application_url ? '<a class="button button-primary button-small" href="' + escapeHtml(job.application_url) + '" target="_blank" rel="noopener noreferrer">Apply on employer site ↗</a>' : '') + '</article>';
}

async function init() {
  if (!/^[A-Z]{2}$/.test(code)) {
    title.textContent = "Choose a country";
    description.textContent = "The country code is missing or invalid. Browse the country directory to select a destination.";
    status.textContent = "";
    results.innerHTML = '<p class="vacancy-empty"><a href="/countries.html">Browse all countries</a></p>';
    results.setAttribute("aria-busy", "false");
    return;
  }
  allJobs.href = "/vacancies.html?country=" + encodeURIComponent(code);
  try {
    const [countryResponse, jobsResponse] = await Promise.all([
      fetch(SUPABASE_URL + "/rest/v1/country_options?select=code,name&code=eq." + encodeURIComponent(code) + "&limit=1", { headers }),
      fetch(SUPABASE_URL + "/rest/v1/jobs?select=id,title,employer_name,description,category_slug,employment_type,country_code,region,city,application_url,status,published_at,expires_at&country_code=eq." + encodeURIComponent(code) + "&status=eq.published&order=published_at.desc.nullslast&limit=500", { headers })
    ]);
    if (!countryResponse.ok || !jobsResponse.ok) throw new Error("Country vacancy data unavailable.");
    const countryRows = await countryResponse.json();
    const jobs = await jobsResponse.json();
    if (!countryRows.length) throw new Error("Country not found.");
    const country = countryRows[0];
    const now = Date.now();
    const published = (Array.isArray(jobs) ? jobs : []).filter((job) =>
      (!job.published_at || Date.parse(job.published_at) <= now) &&
      (!job.expires_at || Date.parse(job.expires_at) > now)
    );
    title.textContent = "Jobs in " + country.name;
    document.title = "Jobs in " + country.name + " — Job Grid";
    description.textContent = "Explore currently published Job Grid vacancies in " + country.name + ". Listings below are filtered to this country.";
    status.textContent = published.length + " published vacancy" + (published.length === 1 ? "" : " vacancies") + " in " + country.name + ".";
    results.innerHTML = published.length ? published.map((job) => card(job, country.name)).join("") : '<p class="vacancy-empty">There are no published vacancies in ' + escapeHtml(country.name) + ' yet. This country page is connected and ready to show genuine listings when authorized administrators publish them. You can <a href="/vacancies.html?country=' + encodeURIComponent(code) + '">check the country filter</a> or <a href="/countries.html">choose another country</a>.</p>';
    results.setAttribute("aria-busy", "false");
  } catch (error) {
    title.textContent = "Jobs by country";
    description.textContent = "We could not load this country’s published vacancies.";
    status.textContent = "Country service temporarily unavailable.";
    results.innerHTML = '<p class="vacancy-empty">Please refresh the page or <a href="/countries.html">return to the country directory</a>.</p>';
    results.setAttribute("aria-busy", "false");
    console.error("Job Grid country page failed:", error);
  }
}
init();