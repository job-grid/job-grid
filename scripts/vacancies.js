import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const JOBS_ENDPOINT = SUPABASE_URL + "/rest/v1/jobs";
const CATEGORIES_ENDPOINT = SUPABASE_URL + "/rest/v1/job_categories?select=slug,name&is_active=eq.true&order=sort_order.asc";
const COUNTRIES_ENDPOINT = SUPABASE_URL + "/rest/v1/country_options?select=code,name&order=name.asc";
const PAGE_SIZE = 24;
const fields = "id,title,slug,employer_name,description,requirements,category_slug,skill_level,employment_type,workplace_type,country_code,region,city,salary_min,salary_max,salary_currency,salary_period,sponsorship_status,application_url,application_instructions,is_featured,status,published_at,expires_at";

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label = (value) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", apikey: SUPABASE_PUBLISHABLE_KEY } });
  if (!response.ok) throw new Error("Supabase request failed (" + response.status + ").");
  return response.json();
}

function fillSelect(select, rows, valueKey, labelKey) {
  for (const row of rows) {
    const option = document.createElement("option");
    option.value = row[valueKey];
    option.textContent = row[labelKey];
    select.append(option);
  }
}

function locationText(job, countriesByCode) {
  return [job.city, job.region, countriesByCode.get(job.country_code) || job.country_code].filter(Boolean).join(", ") || "Location not specified";
}

function salaryText(job) {
  if (job.salary_min == null && job.salary_max == null) return "";
  const amount = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const range = job.salary_min != null && job.salary_max != null
    ? amount(job.salary_min) + "–" + amount(job.salary_max)
    : amount(job.salary_min ?? job.salary_max);
  return [job.salary_currency, range, job.salary_period ? "/ " + label(job.salary_period).toLowerCase() : ""].filter(Boolean).join(" ");
}

function jobCard(job, categoriesBySlug, countriesByCode) {
  const category = categoriesBySlug.get(job.category_slug) || "Other";
  const salary = salaryText(job);
  const application = '<a class="button button-primary button-small" href="/apply.html?job=' + encodeURIComponent(job.id) + '">Apply through Job Grid ↗</a>';
  const instructions = job.application_instructions
    ? '<p class="vacancy-description"><strong>How to apply:</strong> ' + escapeHtml(job.application_instructions) + '</p>'
    : "";
  const requirements = job.requirements
    ? '<p class="vacancy-description"><strong>Requirements:</strong> ' + escapeHtml(job.requirements) + '</p>'
    : "";
  return '<article class="vacancy-card">' +
    '<div class="vacancy-meta"><span class="vacancy-tag">' + escapeHtml(category) + '</span>' +
    (job.is_featured ? '<span class="vacancy-tag">Featured</span>' : '') + '</div>' +
    '<h3>' + escapeHtml(job.title) + '</h3>' +
    '<p class="vacancy-employer">' + escapeHtml(job.employer_name) + '</p>' +
    '<div class="vacancy-meta"><span class="vacancy-tag">' + escapeHtml(locationText(job, countriesByCode)) + '</span>' +
    '<span class="vacancy-tag">' + escapeHtml(label(job.employment_type)) + '</span>' +
    '<span class="vacancy-tag">' + escapeHtml(label(job.workplace_type)) + '</span>' +
    '<span class="vacancy-tag">' + escapeHtml(label(job.skill_level)) + '</span></div>' +
    (salary ? '<p class="vacancy-pay">' + escapeHtml(salary) + '</p>' : '') +
    '<p class="vacancy-description">' + escapeHtml(job.description) + '</p>' + requirements + instructions +
    (job.sponsorship_status && job.sponsorship_status !== "not_stated" ? '<p class="vacancy-description"><strong>Sponsorship:</strong> ' + escapeHtml(label(job.sponsorship_status)) + '</p>' : '') +
    application + '</article>';
}

async function init() {
  const results = $("#vacancy-results");
  const status = $("#vacancy-status");
  const count = $("#vacancy-count");
  const form = $("#vacancy-filters");
  const queryInput = $("#vacancy-query");
  const countrySelect = $("#vacancy-country");
  const categorySelect = $("#vacancy-category");
  const skillSelect = $("#vacancy-skill");
  const employmentSelect = $("#vacancy-employment");
  const loadMore = $("#load-more-vacancies");
  const clear = $("#clear-vacancy-filters");

  let jobs = [];
  let visibleCount = PAGE_SIZE;
  let categoriesBySlug = new Map();
  let countriesByCode = new Map();

  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("q") || "";
  const initialCountry = (params.get("country") || "").toUpperCase();
  const initialCategory = params.get("category") || "";
  queryInput.value = initialQuery.slice(0, 120);

  try {
    const [jobRows, categories, countries] = await Promise.all([
      getJson(JOBS_ENDPOINT + "?select=" + encodeURIComponent(fields) + "&status=eq.published&order=is_featured.desc,published_at.desc.nullslast&limit=500"),
      getJson(CATEGORIES_ENDPOINT),
      getJson(COUNTRIES_ENDPOINT)
    ]);
    if (!Array.isArray(jobRows) || !Array.isArray(categories) || !Array.isArray(countries)) {
      throw new Error("The vacancy service returned an unexpected response.");
    }
    categoriesBySlug = new Map(categories.map((item) => [item.slug, item.name]));
    countriesByCode = new Map(countries.map((item) => [item.code, item.name]));
    fillSelect(categorySelect, categories, "slug", "name");
    fillSelect(countrySelect, countries, "code", "name");
    if (countriesByCode.has(initialCountry)) countrySelect.value = initialCountry;
    if (categoriesBySlug.has(initialCategory)) categorySelect.value = initialCategory;
    const now = Date.now();
    jobs = jobRows.filter((job) =>
      job && job.status !== "draft" &&
      (!job.published_at || Date.parse(job.published_at) <= now) &&
      (!job.expires_at || Date.parse(job.expires_at) > now)
    );
    count.textContent = jobs.length + " published vacancy" + (jobs.length === 1 ? "" : " vacancies");
    render();
  } catch (error) {
    results.innerHTML = '<p class="vacancy-empty">We could not connect to the published vacancy service. Please refresh and try again later.</p>';
    results.setAttribute("aria-busy", "false");
    status.textContent = "Vacancy service temporarily unavailable.";
    count.textContent = "Listings unavailable";
    console.error("Job Grid vacancy search failed:", error);
    return;
  }

  function filteredJobs() {
    const query = normalize(queryInput.value);
    return jobs.filter((job) => {
      const searchable = normalize([job.title, job.employer_name, job.description, job.city, job.region].join(" "));
      return (!query || searchable.includes(query)) &&
        (!countrySelect.value || job.country_code === countrySelect.value) &&
        (!categorySelect.value || job.category_slug === categorySelect.value) &&
        (!skillSelect.value || job.skill_level === skillSelect.value) &&
        (!employmentSelect.value || job.employment_type === employmentSelect.value);
    });
  }

  function render() {
    const matching = filteredJobs();
    const visible = matching.slice(0, visibleCount);
    results.innerHTML = visible.length
      ? visible.map((job) => jobCard(job, categoriesBySlug, countriesByCode)).join("")
      : '<p class="vacancy-empty">No published vacancies match these filters yet. Try another search or clear the filters. Job types in the separate catalogue are not confirmed vacancies.</p>';
    results.setAttribute("aria-busy", "false");
    status.textContent = "Showing " + visible.length + " of " + matching.length + " matching published vacancies.";
    loadMore.hidden = visibleCount >= matching.length;
  }

  for (const control of [queryInput, countrySelect, categorySelect, skillSelect, employmentSelect]) {
    control.addEventListener("input", () => { visibleCount = PAGE_SIZE; render(); });
    control.addEventListener("change", () => { visibleCount = PAGE_SIZE; render(); });
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); visibleCount = PAGE_SIZE; render(); });
  loadMore.addEventListener("click", () => { visibleCount += PAGE_SIZE; render(); });
  clear.addEventListener("click", () => {
    form.reset();
    visibleCount = PAGE_SIZE;
    render();
    queryInput.focus();
  });
}

if ($("#vacancy-results")) init();
