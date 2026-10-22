import { readFile } from "node:fs/promises";

const baseUrl = (process.env.BASE_URL || "https://jobs-grid.co.ke").replace(/\/$/, "");
const cataloguePath = new URL("../public/data/countries.en.json", import.meta.url);
const countries = JSON.parse(await readFile(cataloguePath, "utf8"));

function slugify(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

if (!Array.isArray(countries) || countries.length === 0) {
  throw new Error("Country catalogue must be a non-empty array.");
}

const routes = countries.map((country) => {
  if (!country?.code || !country?.name) throw new Error("Country entry is missing its code or name.");
  return { code: country.code, name: country.name, path: `/jobs-in-${slugify(country.name)}/` };
});
if (new Set(routes.map((route) => route.path)).size !== routes.length) {
  throw new Error("Country catalogue produces duplicate SEO routes.");
}

const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`, { signal: AbortSignal.timeout(10000) });
if (sitemapResponse.status !== 200) throw new Error(`Sitemap returned HTTP ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const sitemapLocations = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim()));
const missingFromSitemap = routes.filter(({ path }) => !sitemapLocations.has(`${baseUrl}${path}`));
if (missingFromSitemap.length) {
  throw new Error(`${missingFromSitemap.length} country routes missing from sitemap: ${missingFromSitemap.slice(0, 10).map((r) => r.path).join(", ")}`);
}
console.log(`PASS sitemap contains all ${routes.length} country URLs.`);

const failures = [];
let next = 0;
const concurrency = 20;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= routes.length) return;
    const route = routes[index];
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(`${baseUrl}${route.path}`, {
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
          headers: { "user-agent": "JobGrid-Production-Country-Route-Check/1.0" }
        });
        if (response.status === 200) {
          console.log(`PASS ${route.path} HTTP 200`);
          lastError = "";
          break;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (lastError) failures.push({ path: route.path, error: lastError });
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

if (failures.length) {
  console.error(`FAILED: ${failures.length}/${routes.length} country routes did not return HTTP 200.`);
  for (const failure of failures) console.error(`FAIL ${failure.path}: ${failure.error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS all ${routes.length} country SEO routes return HTTP 200.`);
}
