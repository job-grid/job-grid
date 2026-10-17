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

const urls = [
  { loc: `${siteRoot}/job-types/`, lastmod: new Date().toISOString().slice(0, 10) },
  ...roles.map((role) => ({
    loc: `${siteRoot}/job-types/${role.slug}/`,
    lastmod: new Date().toISOString().slice(0, 10)
  }))
];

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
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <main class="section-wrap" style="max-width:900px;margin:4rem auto;padding:1.5rem">
    <p class="eyebrow"><a href="/job-types/">Job type directory</a> / ${escapeHtml(role.categoryName)}</p>
    <h1>${escapeHtml(role.title)}</h1>
    <p>This occupation is listed in Job Grid's public work catalogue under <strong>${escapeHtml(role.categoryName)}</strong>. The listing describes a type of work; it is not itself a promise that an employer currently has an opening.</p>
    <p>Use Job Grid to search for relevant vacancies. Only actual vacancies with employer-supplied details are presented as job openings. Application checks are handled by the Job Grid team before a candidate can proceed to the next stage.</p>
    <p><a href="/vacancies.html?q=${encodeURIComponent(role.title)}&category=${encodeURIComponent(role.categorySlug)}">Search ${escapeHtml(role.title)} vacancies</a></p>
    <p><a href="/job-types/">Browse all job types</a></p>
  </main>
</body>
</html>`;
  await writeFile(path.join(dir, "index.html"), html, "utf8");
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((item) => `  <url><loc>${item.loc}</loc><lastmod>${item.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await writeFile(path.join(outputRoot, "sitemap.xml"), sitemap, "utf8");
await writeFile(path.join(outputRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteRoot}/sitemap.xml\n`, "utf8");

console.log(`Generated ${roles.length} indexable occupation pages and sitemap URLs.`);
