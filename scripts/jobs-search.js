import {
  buildPublicJobsUrl,
  formatEmploymentType,
  formatPublicLocation,
  formatPublicSalary,
  normalizePublicJobsResponse,
  validateJobSearchFilters
} from "./public-job-data.js";

const form = document.querySelector("#job-search-form");
const results = document.querySelector("#job-search-results");
const status = document.querySelector("#job-search-status");

function setStatus(message, tone = "neutral") {
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function appendText(parent, tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function clearResults() {
  if (results) results.replaceChildren();
}

function createJobCard(job) {
  const card = document.createElement("article");
  card.className = "job-result-card";

  const meta = document.createElement("div");
  meta.className = "job-result-meta";
  appendText(meta, "span", "job-result-reference", job.reference || "Published vacancy");
  if (job.organization.verified) appendText(meta, "span", "verified-label", "Verified employer");
  card.append(meta);

  const title = appendText(card, "h2", "job-result-title", job.title);
  title.classList.add("job-result-heading");

  appendText(card, "p", "job-result-organization", job.organization.displayName);
  appendText(card, "p", "job-result-location", formatPublicLocation(job.location));

  const facts = document.createElement("div");
  facts.className = "job-result-facts";
  appendText(facts, "span", "", formatEmploymentType(job.employmentType));
  appendText(facts, "span", "", formatPublicSalary(job.salary));
  if (job.occupation.label) appendText(facts, "span", "", job.occupation.label);
  card.append(facts);

  const link = document.createElement("a");
  link.className = "button button-secondary job-detail-link";
  link.href = "/job.html?slug=" + encodeURIComponent(job.slug);
  link.textContent = "View job details";
  card.append(link);
  return card;
}

function readFilters() {
  return {
    q: form.elements.namedItem("q")?.value || "",
    country: form.elements.namedItem("country")?.value || "",
    city: form.elements.namedItem("city")?.value || ""
  };
}

async function submitSearch(event) {
  event.preventDefault();
  clearResults();

  const validation = validateJobSearchFilters(readFilters());
  if (!validation.valid) {
    setStatus(validation.error, "error");
    return;
  }

  setStatus("Checking currently published vacancies…", "loading");
  try {
    const response = await fetch(buildPublicJobsUrl(validation.filters), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store"
    });

    if (!response.ok) {
      // Do not show raw gateway/provider errors or hidden-record status details.
      throw new Error(response.status === 404 || response.status === 405 ? "not-connected" : "unavailable");
    }

    const payload = await response.json();
    const jobs = normalizePublicJobsResponse(payload, Date.now());
    if (!jobs.length) {
      setStatus("No current published vacancies matched these filters. Try a broader search.", "empty");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const job of jobs) fragment.append(createJobCard(job));
    results.replaceChildren(fragment);
    setStatus(jobs.length + (jobs.length === 1 ? " published vacancy found." : " published vacancies found."), "success");
  } catch (error) {
    clearResults();
    if (error instanceof TypeError && error.message !== "Failed to fetch") {
      setStatus("The search response could not be validated. No vacancies are shown until the API contract is satisfied.", "error");
    } else {
      setStatus("The Job Grid jobs service is not connected or is temporarily unavailable. No sample vacancies are shown.", "error");
    }
  }
}

if (form && results && status) {
  form.addEventListener("submit", submitSearch);
  form.addEventListener("reset", () => {
    clearResults();
    setStatus("Search for current published vacancies. No sample listings are loaded.", "neutral");
  });

  const query = new URLSearchParams(window.location.search);
  for (const field of ["q", "country", "city"]) {
    const value = query.get(field);
    const element = form.elements.namedItem(field);
    if (value && element) element.value = value;
  }
  setStatus("Search for current published vacancies. No sample listings are loaded.", "neutral");
}
