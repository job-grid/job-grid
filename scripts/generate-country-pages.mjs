import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = "https://jobs-grid.co.ke";
const outputRoot = path.join(root, "dist");
const cataloguePath = path.join(root, "public", "data", "countries.en.json");
const countries = JSON.parse(await readFile(cataloguePath, "utf8"));
if (!Array.isArray(countries) || countries.length === 0) throw new Error("Country catalogue must be a non-empty array.");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function slugify(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const seenCodes = new Set();
const seenSlugs = new Set();
const pages = [];
for (const row of countries) {
  const code = typeof row?.code === "string" ? row.code.trim().toUpperCase() : "";
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  if (!/^[A-Z]{2}$/.test(code) || !name) throw new Error("Invalid country catalogue entry: " + JSON.stringify(row));
  if (seenCodes.has(code)) throw new Error("Duplicate country code: " + code);
  seenCodes.add(code);
  const slug = slugify(name);
  if (!slug) throw new Error("Country name has no URL slug: " + name);
  if (seenSlugs.has(slug)) throw new Error("Duplicate country SEO slug: " + slug);
  seenSlugs.add(slug);
  pages.push({ code, name, slug, route: "/jobs-in-" + slug + "/" });
}
if (!seenCodes.has("KE")) throw new Error("Country catalogue must include Kenya (KE).");

const sitemapPath = path.join(outputRoot, "sitemap.xml");
const existingSitemap = await readFile(sitemapPath, "utf8");
const existingLocations = [...existingSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const urls = [...existingLocations];
for (const country of pages) {
  const dir = path.join(outputRoot, country.route.slice(1, -1));
  await mkdir(dir, { recursive: true });
  const canonical = siteRoot + country.route;
  const title = "Jobs in " + country.name + " | Job Grid";
  const description = "Explore published vacancies in " + country.name + " on Job Grid. Browse available roles by location and category, and apply through Job Grid. Vacancy details are subject to verification.";
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonical,
    about: { "@type": "Country", name: country.name },
    isPartOf: { "@type": "WebSite", name: "Job Grid", url: siteRoot }
  };
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#004ef5">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="description" content="${escapeHtml(description)}">
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/global.css">
<link rel="stylesheet" href="/styles/vacancies.css">
<script type="module" src="/scripts/components.js"></script>
<script type="module" src="/scripts/main.js"></script>
<script type="module" src="/scripts/country.js"></script>
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a><div id="top"></div><job-grid-header></job-grid-header>
<main id="main" class="section-wrap section-space" data-country-code="${country.code}">
<p class="eyebrow">Country vacancies</p><h1 id="country-title">Jobs in ${escapeHtml(country.name)}</h1>
<p id="country-description" class="section-description">Explore published Job Grid vacancies in ${escapeHtml(country.name)}. Only published, non-expired vacancies are shown.</p>
<p class="country-actions"><a class="button button-secondary" href="/countries.html">← All countries</a> <a id="all-country-jobs" class="button button-primary" href="/vacancies.html?country=${country.code}">Search jobs in this country</a> <a class="button button-secondary" href="/job-types/">Explore all job types</a></p>
<p id="country-job-status" class="vacancy-status" role="status" aria-live="polite"></p>
<div id="country-job-results" class="vacancy-grid" aria-live="polite" aria-busy="true"></div>
</main><job-grid-footer></job-grid-footer>
</body></html>`;
  const canonicalTags = html.match(/<link rel="canonical" href="[^"]+">/g) ?? [];
  if (canonicalTags.length !== 1 || canonicalTags[0] !== `<link rel="canonical" href="${canonical}">`) {
    throw new Error("Incorrect canonical metadata for country: " + country.name);
  }
  if (!html.includes('data-country-code="' + country.code + '"')) throw new Error("Country code missing from generated page: " + country.code);
  await writeFile(path.join(dir, "index.html"), html, "utf8");
  urls.push(canonical);
}

if (new Set(urls).size !== urls.length) throw new Error("Sitemap contains duplicate URLs after country page generation.");
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((loc) => `  <url><loc>${loc}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await writeFile(sitemapPath, sitemap, "utf8");
await writeFile(path.join(outputRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteRoot}/sitemap.xml\n`, "utf8");
const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
for (const country of pages) {
  const canonical = siteRoot + country.route;
  if (sitemapLocations.filter((loc) => loc === canonical).length !== 1) throw new Error("Sitemap must include country URL exactly once: " + canonical);
}
console.log(`Validated ${pages.length} country SEO pages, unique slugs/canonicals, and ${sitemapLocations.length} sitemap URLs.`);
