import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const CATALOG_URL = "/data/job-types.json";
const CATEGORY_OPTIONS_ENDPOINT = SUPABASE_URL +
  "/rest/v1/job_categories?select=slug,name,sort_order&is_active=eq.true&order=sort_order.asc";
const PAGE_SIZE = 30;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function makeRoles(roleData, categories) {
  const categoriesBySlug = new Map(categories.map((category) => [category.slug, category]));
  return roleData.roles.flatMap((row) => {
    if (!Array.isArray(row) || row.length !== 2) return [];
    const [title, categorySlug] = row;
    const category = categoriesBySlug.get(categorySlug);
    if (typeof title !== "string" || !category || !title.trim()) return [];
    return [{
      title: title.trim(),
      category: category.name,
      categorySlug: category.slug
    }];
  });
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
  const [roleResponse, categoryResponse] = await Promise.all([
    fetch(CATALOG_URL, { headers: { Accept: "application/json" } }),
    fetch(CATEGORY_OPTIONS_ENDPOINT, {
      headers: {
        Accept: "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY
      }
    })
  ]);

  if (!roleResponse.ok) throw new Error("The starter role list could not be loaded.");
  if (!categoryResponse.ok) throw new Error("The existing Job Grid categories could not be loaded.");

  const roleData = await roleResponse.json();
  const categories = await categoryResponse.json();

  if (!Array.isArray(roleData.roles) || !Array.isArray(categories)) {
    throw new Error("The role or category catalogue has an invalid format.");
  }

  const validCategories = categories.filter((category) =>
    category &&
    typeof category.slug === "string" &&
    typeof category.name === "string" &&
    Number.isInteger(category.sort_order)
  );
  if (validCategories.length === 0) {
    throw new Error("No active categories are available in the existing Job Grid database.");
  }

  const roleRecords = makeRoles(roleData, validCategories);
  return {
    categories: validCategories,
    roleRecords,
    totalRoleRows: roleData.roles.length,
    unmappedRoleCount: roleData.roles.length - roleRecords.length
  };
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
      : catalog.roleRecords.length + " role types across " + catalog.categories.length + " active database categories.";
    if (catalog.unmappedRoleCount > 0) {
      status.textContent += " " + catalog.unmappedRoleCount + " titles with unknown categories are hidden for review.";
    }
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
      " matching role types (" + catalog.roleRecords.length + " mapped titles across " +
      catalog.categories.length + " active database categories).";
    if (catalog.unmappedRoleCount > 0) {
      status.textContent += " " + catalog.unmappedRoleCount + " unmapped titles are held out of view.";
    }
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
      if (status) status.textContent = "The existing category catalogue or starter role data could not be loaded.";
    });
}
