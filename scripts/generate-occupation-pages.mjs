import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = "https://jobs-grid.co.ke";
const cataloguePath = path.join(root, "public", "data", "job-types.json");
const outputRoot = path.join(root, "dist");
const categoryNames = new Map([
  ["agriculture-farming", "Agriculture & Farming"],
  ["construction-building", "Construction & Building"],
  ["skilled-trades-repair", "Skilled Trades & Repair"],
  ["driving-transport", "Driving & Transport"],
  ["warehouse-logistics", "Warehouse & Logistics"],
  ["cleaning-housekeeping", "Cleaning & Housekeeping"],
  ["security-safety", "Security & Safety"],
  ["hospitality-tourism", "Hospitality & Tourism"],
  ["food-service-catering", "Food Service & Catering"],
  ["retail-sales", "Retail & Sales"],
  ["customer-service", "Customer Service"],
  ["general-labour", "General Labour"],
  ["manufacturing-factory", "Manufacturing & Factory"],
  ["domestic-household-work", "Domestic & Household Work"],
  ["health-care-caregiving", "Healthcare & Caregiving"],
  ["education-training", "Education & Training"],
  ["office-administration", "Office & Administration"],
  ["it-technology", "IT & Technology"],
  ["finance-accounting", "Finance & Accounting"],
  ["engineering", "Engineering"],
  ["beauty-personal-care", "Beauty & Personal Care"],
  ["maintenance-facilities", "Maintenance & Facilities"],
  ["marketing-communications", "Marketing & Communications"],
  ["professional-services", "Professional Services"],
  ["other", "Other"]
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const data = JSON.parse(await readFile(cataloguePath, "utf8"));
if (!Array.isArray(data.roles)) throw new Error("job-types.json must contain a roles array.");

const seen = new Set();
const roles = [];
for (const row of data.roles) {
  if (!Array.isArray(row) || (row.length !== 2 && row.length !== 3)) {
    throw new Error("Invalid job type row: expected [title, categorySlug] or [title, categorySlug, canonicalSlug].");
  }
  const title = typeof row[0] === "string" ? row[0].trim() : "";
  const categorySlug = typeof row[1] === "string" ? row[1].trim() : "";
  if (!title || !categoryNames.has(categorySlug)) throw new Error(`Invalid occupation title or category: ${JSON.stringify(row)}`);
  const slug = typeof row[2] === "string" && row[2].trim() ? row[2].trim() : slugify(title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid canonical URL slug "${slug}" for: ${title}`);
  if (seen.has(slug)) throw new Error(`Duplicate occupation URL slug "${slug}". Resolve the title/slug collision before publishing.`);
  seen.add(slug);
  roles.push({ title, categorySlug, categoryName: categoryNames.get(categorySlug), slug });
}
if (roles.length === 0) throw new Error("Refusing to generate an empty occupation catalogue.");

const today = new Date().toISOString().slice(0, 10);
const corePaths = [
  "/",
  "/job-types/",
  "/vacancies.html",
  "/countries.html",
  "/for-employers.html"
];
const urls = [
  ...corePaths.map((route) => ({ loc: `${siteRoot}${route}`, lastmod: today })),
  ...roles.map((role) => ({
    loc: `${siteRoot}/job-types/${role.slug}/`,
    lastmod: today
  }))
];

// Generate a real directory landing page as well as individual occupation pages.
const directoryPath = path.join(outputRoot, "job-types", "index.html");
await mkdir(path.dirname(directoryPath), { recursive: true });
const groupedRoles = new Map([...categoryNames.keys()].map((slug) => [slug, []]));
for (const role of roles) groupedRoles.get(role.categorySlug).push(role);
const directoryTitle = "Browse Job Types and Occupations | Job Grid";
const directoryDescription = "Browse Job Grid's occupation catalogue by category and search for matching vacancies.";
const directoryCanonical = `${siteRoot}/job-types/`;
const directorySchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: directoryTitle,
  description: directoryDescription,
  url: directoryCanonical,
  isPartOf: { "@type": "WebSite", name: "Job Grid", url: siteRoot }
};
const directorySections = [...groupedRoles.entries()]
  .filter(([, items]) => items.length > 0)
  .map(([slug, items]) => `<section class="occupation-category" data-category="${escapeHtml(slug)}"><div class="occupation-category-heading"><h2>${escapeHtml(categoryNames.get(slug))}</h2><span>${items.length} occupations</span></div><ul class="occupation-grid">${items
    .map((role) => `<li data-occupation-title="${escapeHtml(role.title.toLowerCase())}"><a href="/job-types/${role.slug}/">${escapeHtml(role.title)}<span aria-hidden="true">↗</span></a></li>`)
    .join("")}</ul></section>`)
  .join("\n");
const directoryHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <title>${escapeHtml(directoryTitle)}</title>
  <meta name="description" content="${escapeHtml(directoryDescription)}">
  <link rel="canonical" href="${directoryCanonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(directoryTitle)}">
  <meta property="og:description" content="${escapeHtml(directoryDescription)}">
  <meta property="og:url" content="${directoryCanonical}">
  <link rel="stylesheet" href="/styles/tokens.css">
  <link rel="stylesheet" href="/styles/global.css">

  <style>
    .occupation-directory{--occupation-border:#e4eaf4;max-width:1240px;margin:0 auto;padding:3.5rem 1.5rem 5rem}
    .occupation-hero{max-width:820px;margin:0 auto 3.5rem;text-align:center}
    .occupation-hero .eyebrow{color:var(--color-primary);font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem;margin-bottom:.8rem}
    .occupation-hero h1{max-width:800px;margin:0 auto 1rem;font-size:clamp(2.4rem,5vw,4.2rem);line-height:1.08}
    .occupation-hero>p:not(.eyebrow){max-width:680px;margin:0 auto 1.5rem;font-size:1.08rem}
    .occupation-search-label{display:block;text-align:left;max-width:680px;margin:1.5rem auto .5rem;font-weight:700;color:var(--color-secondary)}
    .occupation-search-wrap{display:flex;align-items:center;gap:.75rem;max-width:680px;margin:0 auto;padding:.45rem .65rem .45rem 1rem;border:1px solid #d7dfed;border-radius:16px;background:#fff;box-shadow:0 10px 30px rgba(18,40,91,.08)}
    .occupation-search-wrap>span{font-size:1.6rem;color:var(--color-primary)}
    .occupation-search-wrap input{flex:1;min-width:0;border:0;outline:none;padding:.8rem 0;background:transparent;color:var(--color-text)}
    .occupation-search-wrap input:focus-visible{outline:0}
    .occupation-search-wrap button{border:0;border-radius:10px;padding:.55rem .8rem;background:#edf3ff;color:var(--color-secondary);font-weight:700;cursor:pointer}
    .occupation-search-status{font-size:.9rem;margin:.65rem auto 0!important}
    .occupation-pagination{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem;margin:1.75rem auto 0;padding:1rem;border:1px solid #e4eaf4;border-radius:14px;background:#fff}
    .occupation-pagination button{min-width:2.6rem;border:1px solid #d7dfed;border-radius:9px;padding:.6rem .8rem;background:#fff;color:var(--color-secondary);font-weight:700;cursor:pointer}
    .occupation-pagination button[aria-current="page"]{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
    .occupation-pagination button:disabled{opacity:.4;cursor:not-allowed}
    .occupation-pagination-summary{width:100%;text-align:center;color:#5b6b89;font-size:.88rem}
    .occupation-directory-intro{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
    .occupation-directory-intro h2{font-size:1.7rem;margin:0}
    .occupation-directory-intro p{max-width:560px;margin:0;font-size:.92rem}
    .occupation-categories{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem;align-items:start}
    .occupation-category{min-width:0;padding:1.4rem;border:1px solid var(--occupation-border);border-radius:18px;background:#fff;box-shadow:0 6px 22px rgba(18,40,91,.035)}
    .occupation-category[hidden],.occupation-grid li[hidden]{display:none!important}
    .occupation-category-heading{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-bottom:.9rem;border-bottom:1px solid #edf0f6;margin-bottom:.85rem}
    .occupation-category-heading h2{font-size:1.22rem;letter-spacing:-.025em;margin:0}
    .occupation-category-heading>span{flex-shrink:0;font-size:.75rem;font-weight:700;color:#5b6b89;background:#f1f5fb;border-radius:999px;padding:.3rem .55rem}
    .occupation-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.15rem .75rem}
    .occupation-grid li{min-width:0}
    .occupation-grid a{display:flex;align-items:baseline;justify-content:space-between;gap:.35rem;height:100%;padding:.48rem .35rem;border-radius:7px;color:var(--color-text);font-size:.9rem;line-height:1.4;overflow-wrap:anywhere}
    .occupation-grid a span{flex-shrink:0;color:#8a9ab7;font-size:.8rem;opacity:0}
    .occupation-grid a:hover{background:#f3f7ff;color:var(--color-primary)}
    .occupation-grid a:hover span{opacity:1}
    @media(max-width:900px){.occupation-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.occupation-directory-intro{display:block}.occupation-directory-intro p{margin-top:.45rem}}
    @media(max-width:520px){.occupation-directory{padding:2rem 1rem 3rem}.occupation-hero{margin-bottom:2.5rem}.occupation-grid{grid-template-columns:1fr}.occupation-category{padding:1rem}.occupation-category-heading h2{font-size:1.08rem}}
  </style>
  <script type="module" src="/scripts/components.js"></script>
  <script type="module" src="/scripts/main.js"></script>
  <script type="application/ld+json">${JSON.stringify(directorySchema).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <job-grid-header></job-grid-header>
  <main class="occupation-directory section-wrap">
    <section class="occupation-hero">
      <p class="eyebrow">Explore your next move</p>
      <h1>Find your place in the world of work</h1>
      <p>Explore 9,044 occupations across industries. Search by job title or browse a category to discover career paths and matching vacancies.</p>
      <label class="occupation-search-label" for="occupation-search">Search occupations</label>
      <div class="occupation-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input id="occupation-search" type="search" placeholder="Try “driver”, “nurse” or “accountant”" autocomplete="off">
        <button id="occupation-search-clear" type="button" hidden>Clear</button>
      </div>
      <p class="occupation-search-status" id="occupation-search-status" aria-live="polite">Showing all 9,044 occupations</p>
    </section>
    <div class="occupation-directory-intro"><h2>Explore by category</h2><p>Choose an occupation to view its page and search for matching vacancies. A listed occupation is not a guarantee of a current opening.</p></div>
    <div class="occupation-categories">${directorySections}</div>
    <nav class="occupation-pagination" id="occupation-pagination" aria-label="Occupation directory pages"></nav>
  </main>
  <script>
    (() => {
      const input = document.getElementById("occupation-search");
      const clear = document.getElementById("occupation-search-clear");
      const status = document.getElementById("occupation-search-status");
      const items = [...document.querySelectorAll("[data-occupation-title]")];
      const sections = [...document.querySelectorAll(".occupation-category")];
      const pageSize = 30;
      const pagination = document.getElementById("occupation-pagination");
      let currentPage = 1;
      const update = () => {
        const query = input.value.trim().toLocaleLowerCase();
        const matches = items.filter((item) => !query || item.dataset.occupationTitle.includes(query));
        const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
        currentPage = Math.min(currentPage, pageCount);
        const start = (currentPage - 1) * pageSize;
        const visibleItems = new Set(matches.slice(start, start + pageSize));
        for (const item of items) item.hidden = !visibleItems.has(item);
        for (const section of sections) {
          section.hidden = !section.querySelector("[data-occupation-title]:not([hidden])");
        }
        clear.hidden = !query;
        status.textContent = query
          ? "Showing " + matches.length.toLocaleString() + " matching occupations · page " + currentPage + " of " + pageCount
          : "Showing " + items.length.toLocaleString() + " occupations · page " + currentPage + " of " + pageCount;
        pagination.replaceChildren();
        const summary = document.createElement("span");
        summary.className = "occupation-pagination-summary";
        summary.textContent = matches.length
          ? "Showing " + (start + 1).toLocaleString() + "–" + Math.min(start + pageSize, matches.length).toLocaleString() + " of " + matches.length.toLocaleString() + " occupations"
          : "No occupations match your search.";
        pagination.append(summary);
        if (pageCount > 1) {
          const addButton = (label, page, options = {}) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            if (options.current) button.setAttribute("aria-current", "page");
            button.disabled = Boolean(options.disabled);
            button.addEventListener("click", () => {
              currentPage = page;
              update();
              pagination.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
            pagination.append(button);
          };
          addButton("Previous", Math.max(1, currentPage - 1), { disabled: currentPage === 1 });
          const first = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
          const last = Math.min(pageCount, first + 4);
          for (let page = first; page <= last; page++) addButton(String(page), page, { current: page === currentPage });
          addButton("Next", Math.min(pageCount, currentPage + 1), { disabled: currentPage === pageCount });
        }
      };
      input.addEventListener("input", () => { currentPage = 1; update(); });
      clear.addEventListener("click", () => { input.value = ""; currentPage = 1; update(); input.focus(); });
      update();
    })();
  </script>
  <job-grid-footer></job-grid-footer>
</body>
</html>`;
await writeFile(directoryPath, directoryHtml, "utf8");

for (const role of roles) {
  const dir = path.join(outputRoot, "job-types", role.slug);
  await mkdir(dir, { recursive: true });
  const title = `${role.title} Jobs and Career Opportunities | Job Grid`;
  const description = `Explore ${role.title} opportunities in ${role.categoryName}. Search Job Grid for relevant vacancies and submit an application when a suitable opening is available.`;
  const canonical = `${siteRoot}/job-types/${role.slug}/`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonical,
    about: { "@type": "Occupation", name: role.title, occupationalCategory: role.categoryName },
    isPartOf: { "@type": "WebSite", name: "Job Grid", url: siteRoot }
  };
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <link rel="stylesheet" href="/styles/tokens.css">
  <link rel="stylesheet" href="/styles/global.css">
  <script type="module" src="/scripts/components.js"></script>
  <script type="module" src="/scripts/main.js"></script>
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <job-grid-header></job-grid-header>
  <main class="section-wrap" style="max-width:900px;margin:4rem auto;padding:1.5rem">
    <p class="eyebrow"><a href="/job-types/">Job type directory</a> / ${escapeHtml(role.categoryName)}</p>
    <h1>${escapeHtml(role.title)}</h1>
    <p>This occupation is listed in Job Grid's public work catalogue under <strong>${escapeHtml(role.categoryName)}</strong>. The listing describes a type of work; it is not itself a promise that an employer currently has an opening.</p>
    <p>Use Job Grid to search for relevant vacancies. Only actual vacancies with employer-supplied details are presented as job openings. Application checks are handled by the Job Grid team before a candidate can proceed to the next stage.</p>
    <p><a href="/vacancies.html?q=${encodeURIComponent(role.title)}&category=${encodeURIComponent(role.categorySlug)}">Search ${escapeHtml(role.title)} vacancies</a></p>
    <p><a href="/job-types/">Browse all job types</a></p>
  </main>
  <job-grid-footer></job-grid-footer>
</body>
</html>`;
  const canonicalTags = html.match(/<link rel="canonical" href="[^"]+">/g) ?? [];
  if (canonicalTags.length !== 1 || canonicalTags[0] !== `<link rel="canonical" href="${canonical}">`) {
    throw new Error(`Expected exactly one correct canonical URL for ${role.title}.`);
  }
  if (!html.includes(`<a href="/job-types/">Job type directory</a>`)) {
    throw new Error(`Occupation page is missing its directory link: ${role.slug}`);
  }
  await writeFile(path.join(dir, "index.html"), html, "utf8");
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((item) => `  <url><loc>${item.loc}</loc><lastmod>${item.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await writeFile(path.join(outputRoot, "sitemap.xml"), sitemap, "utf8");
await writeFile(path.join(outputRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteRoot}/sitemap.xml\n`, "utf8");

// Fail the build unless every occupation URL appears exactly once in the directory,
 // independent of the visual markup used for the responsive card layout.
for (const role of roles) {
  const href = `href="/job-types/${role.slug}/"`;
  const linkCount = directoryHtml.split(href).length - 1;
  if (linkCount !== 1) throw new Error(`Directory must link to ${role.slug} exactly once; found ${linkCount}.`);
}
const directoryCanonicalTags = directoryHtml.match(/<link rel="canonical" href="[^"]+">/g) ?? [];
if (directoryCanonicalTags.length !== 1 || directoryCanonicalTags[0] !== `<link rel="canonical" href="${directoryCanonical}">`) {
  throw new Error("Occupation directory must have exactly one correct canonical URL.");
}

// Validate sitemap coverage and uniqueness, including all core pages and occupation URLs.
const sitemapLocations = [...sitemap.matchAll(new RegExp("<loc>([^<]+)</loc>", "g"))].map((match) => match[1]);
const expectedLocations = urls.map((item) => item.loc);
if (sitemapLocations.length !== expectedLocations.length) {
  throw new Error(`Sitemap URL count mismatch: expected ${expectedLocations.length}, found ${sitemapLocations.length}.`);
}
if (new Set(sitemapLocations).size !== sitemapLocations.length) {
  throw new Error("Sitemap contains duplicate canonical URLs.");
}
for (const expectedUrl of expectedLocations) {
  if (!sitemapLocations.includes(expectedUrl)) throw new Error(`Sitemap is missing required URL: ${expectedUrl}`);
}
if (!corePaths.every((route) => sitemapLocations.includes(`${siteRoot}${route}`))) {
  throw new Error("Sitemap is missing one or more required core pages.");
}

console.log(`Validated ${roles.length} occupation pages, directory links, unique canonical URLs, and ${sitemapLocations.length} sitemap URLs.`);
