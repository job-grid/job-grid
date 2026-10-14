const CATALOG_URL = "/data/job-types.json";
const PAGE_SIZE = 30;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function makeRoles(catalog) {
  return catalog.roles.map(([title, categoryIndex]) => ({
    title,
    category: catalog.categories[categoryIndex].name,
    categorySlug: catalog.categories[categoryIndex].slug
  }));
}

function makeRoleCard(role) {
  const initials = role.title.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase();
  const query = encodeURIComponent(role.title);
  return '<article class="role-card type-card">' +
    '<div class="role-card-top"><span class="company-mark mark-cobalt" aria-hidden="true">' + escapeHtml(initials) + '</span>' +
    '<span class="role-type">Job type</span></div>' +
    '<p class="role-category">' + escapeHtml(role.category.toLocaleUpperCase()) + '</p>' +
    '<h3>' + escapeHtml(role.title) + '</h3>' +
    '<p class="role-card-subtitle">Role type catalogue · Not a confirmed vacancy</p>' +
    '<div class="role-card-bottom"><span class="tag">' + escapeHtml(role.category) + '</span>' +
    '<a class="arrow-round" href="/job-types.html?q=' + query + '" aria-label="Explore ' + escapeHtml(role.title) + '">↗</a></div></article>';
}

async function loadCatalog() {
  const response = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The job-type catalogue could not be loaded.");
  const catalog = await response.json();
  if (!Array.isArray(catalog.categories) || !Array.isArray(catalog.roles)) {
    throw new Error("The job-type catalogue has an invalid format.");
  }
  return { ...catalog, roleRecords: makeRoles(catalog) };
}

function initHome(catalog) {
  const container = document.querySelector("#home-job-types");
  if (!container) return;
  const input = document.querySelector("#home-role-search");
  const form = document.querySelector("#home-role-search-form");
  const status = document.querySelector("#home-role-count");
  const featuredCategorySlugs = catalog.categories.slice(0, 6).map((category) => category.slug);

  function render() {
    const query = normalize(input?.value);
    const filtered = catalog.roleRecords.filter((role) =>
      !query || normalize(role.title + " " + role.category).includes(query)
    );
    const featured = [];
    for (const slug of featuredCategorySlugs) {
      const match = filtered.find((role) => role.categorySlug === slug && !featured.includes(role));
      if (match) featured.push(match);
    }
    for (const role of filtered) {
      if (featured.length >= 6) break;
      if (!featured.includes(role)) featured.push(role);
    }
    container.innerHTML = featured.map(makeRoleCard).join("");
    status.textContent = query
      ? filtered.length + " matching role type" + (filtered.length === 1 ? "" : "s") + ". Showing up to 6."
      : catalog.roleRecords.length + " role types across " + catalog.categories.length + " categories.";
    if (query && filtered.length === 0) {
      container.innerHTML = '<p class="empty-results">No role types match that search. Try another title or browse all categories.</p>';
    }
    container.setAttribute("aria-busy", "false");
  }

  input?.addEventListener("input", render);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input?.value.trim() ?? "";
    window.location.href = query ? "/job-types.html?q=" + encodeURIComponent(query) : "/job-types.html";
  });
  render();
}

function initDirectory(catalog) {
  const container = document.querySelector("#job-type-results");
  if (!container) return;
  const input = document.querySelector("#job-type-search");
  const categorySelect = document.querySelector("#job-type-category");
  const status = document.querySelector("#job-type-count");
  const loadMoreButton = document.querySelector("#load-more-role-types");
  const clearButton = document.querySelector("#clear-role-filters");
  let visibleCount = PAGE_SIZE;

  for (const category of catalog.categories) {
    const option = document.createElement("option");
    option.value = category.slug;
    option.textContent = category.name;
    categorySelect.append(option);
  }

  const initialQuery = new URLSearchParams(window.location.search).get("q") ?? "";
  input.value = initialQuery.slice(0, 120);

  function getFilteredRoles() {
    const query = normalize(input.value);
    const selectedCategory = categorySelect.value;
    return catalog.roleRecords.filter((role) => {
      const matchesQuery = !query || normalize(role.title).includes(query) || normalize(role.category).includes(query);
      const matchesCategory = !selectedCategory || role.categorySlug === selectedCategory;
      return matchesQuery && matchesCategory;
    });
  }

  function render() {
    const filtered = getFilteredRoles();
    const visible = filtered.slice(0, visibleCount);
    container.innerHTML = visible.map(makeRoleCard).join("");
    status.textContent = "Showing " + visible.length + " of " + filtered.length +
      " matching role types (" + catalog.roleRecords.length + " total).";
    loadMoreButton.hidden = visibleCount >= filtered.length;
    if (filtered.length === 0) {
      container.innerHTML = '<p class="empty-results">No role types match those filters. Clear the filters or try a broader search.</p>';
    }
    container.setAttribute("aria-busy", "false");
  }

  input.addEventListener("input", () => { visibleCount = PAGE_SIZE; render(); });
  categorySelect.addEventListener("change", () => { visibleCount = PAGE_SIZE; render(); });
  loadMoreButton.addEventListener("click", () => { visibleCount += PAGE_SIZE; render(); });
  clearButton.addEventListener("click", () => {
    input.value = "";
    categorySelect.value = "";
    visibleCount = PAGE_SIZE;
    window.history.replaceState({}, "", window.location.pathname);
    render();
    input.focus();
  });
  render();
}

const homepage = document.querySelector("#home-job-types");
const directory = document.querySelector("#job-type-results");
if (homepage || directory) {
  loadCatalog()
    .then((catalog) => {
      initHome(catalog);
      initDirectory(catalog);
    })
    .catch(() => {
      for (const target of [homepage, directory]) {
        if (target) target.innerHTML = '<p class="empty-results">The role catalogue is temporarily unavailable. Please refresh this page shortly.</p>';
      }
      const status = document.querySelector("#home-role-count, #job-type-count");
      if (status) status.textContent = "The role catalogue could not be loaded.";
    });
}
