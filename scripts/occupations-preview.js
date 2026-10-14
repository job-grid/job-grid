const CATALOG_URL = "/data/occupations-isco08-review.json";
const PAGE_SIZE = 36;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function makeCard(group) {
  return `<article class="occupation-card">
    <div class="occupation-card-head">
      <span class="occupation-code">${escapeHtml(group.code)}</span>
      <span class="occupation-status">Candidate · review required</span>
    </div>
    <h3>${escapeHtml(group.title)}</h3>
    <p class="occupation-parent"><strong>${escapeHtml(group.minorGroupCode)}</strong> · ${escapeHtml(group.minorGroupTitle)}</p>
    <p class="occupation-major">${escapeHtml(group.majorGroupTitle)}</p>
    <div class="occupation-card-foot"><span>Job Grid mapping: pending</span><span>Inactive</span></div>
  </article>`;
}

async function loadCatalog() {
  const response = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The occupation preview catalogue could not be loaded.");
  const catalog = await response.json();
  if (!Array.isArray(catalog.groups) || catalog.groups.length !== 436) {
    throw new Error("The candidate catalogue did not pass its expected-record check.");
  }
  return catalog;
}

function init(catalog) {
  const search = document.querySelector("#occupation-search");
  const major = document.querySelector("#occupation-major-filter");
  const results = document.querySelector("#occupation-results");
  const count = document.querySelector("#occupation-count");
  const more = document.querySelector("#load-more-occupations");
  const clear = document.querySelector("#clear-occupation-filters");
  let visibleCount = PAGE_SIZE;

  const majorGroups = new Map();
  for (const group of catalog.groups) {
    majorGroups.set(group.majorGroupCode, group.majorGroupTitle);
  }
  for (const [code, title] of [...majorGroups.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code + " — " + title;
    major.append(option);
  }

  function getFiltered() {
    const term = normalize(search.value);
    return catalog.groups.filter(group => {
      const queryText = [group.code, group.title, group.majorGroupTitle, group.subMajorGroupTitle, group.minorGroupTitle].join(" ");
      return (!term || normalize(queryText).includes(term)) &&
        (!major.value || group.majorGroupCode === major.value);
    });
  }

  function render(reset = false) {
    if (reset) visibleCount = PAGE_SIZE;
    const filtered = getFiltered();
    const shown = filtered.slice(0, visibleCount);
    results.innerHTML = shown.length ? shown.map(makeCard).join("") :
      '<p class="empty-results">No occupation groups match this search. Try a different title, code, or major group.</p>';
    count.textContent = `Showing ${shown.length} of ${filtered.length} candidate groups · ${catalog.groups.length} total records`;
    more.hidden = shown.length >= filtered.length;
    results.setAttribute("aria-busy", "false");
  }

  search.addEventListener("input", () => render(true));
  major.addEventListener("change", () => render(true));
  clear.addEventListener("click", () => {
    search.value = "";
    major.value = "";
    render(true);
    search.focus();
  });
  more.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    render(false);
  });
  document.querySelector("#occupation-total").textContent = String(catalog.groups.length);
  render(true);
}

const status = document.querySelector("#occupation-count");
loadCatalog().then(init).catch(error => {
  status.textContent = error.message;
  document.querySelector("#occupation-results").innerHTML =
    '<p class="empty-results">The preview could not load its data. Please try again later.</p>';
  document.querySelector("#occupation-results").setAttribute("aria-busy", "false");
  document.querySelector("#load-more-occupations").hidden = true;
});
