import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const jobsHtml = await readFile(new URL("../jobs.html", import.meta.url), "utf8");
const detailHtml = await readFile(new URL("../job.html", import.meta.url), "utf8");
const jobsCss = await readFile(new URL("../styles/jobs.css", import.meta.url), "utf8");
const build = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
const jobsData = await readFile(new URL("./public-job-data.js", import.meta.url), "utf8");
const checks = [
  [html.includes('<html lang="en">'), "HTML language is declared"],
  [html.includes('href="#main"'), "Skip navigation link exists"],
  [html.includes('id="main"'), "Main landmark exists"],
  [html.includes('name="description"'), "Page description metadata exists"],
  [css.includes(":focus-visible"), "Visible keyboard focus styling exists"],
  [css.includes("@media (max-width: 740px)"), "Mobile breakpoint exists"],
  [css.includes("@media (prefers-reduced-motion: reduce)"), "Reduced motion preference is respected"],
  [tokens.includes("--color-primary:") && tokens.includes("--color-text:") && tokens.includes("--color-border:"), "Core design tokens exist"],
  [!html.includes('href="#"'), "No empty placeholder links exist"],
  [!html.includes("supabase.from(") && !html.includes("DATABASE_URL"), "Homepage does not query a database"],
  [jobsHtml.includes('<meta name="robots" content="noindex,nofollow"') && jobsHtml.includes('id="job-search-form"'), "Job search page is a noindex preview with a search form"],
  [jobsHtml.includes('id="job-search-status"') && jobsHtml.includes('id="job-search-results"'), "Job search has accessible status and results regions"],
  [detailHtml.includes('id="job-detail-panel"') && detailHtml.includes('id="job-detail-description"'), "Public job detail page has required content slots"],
  [!jobsHtml.includes("Sample role") && !detailHtml.includes("Sample role"), "Job pages do not hardcode sample vacancies"],
  [jobsCss.includes("@media (max-width: 740px)"), "Job pages include a mobile layout"],
  [build.includes('"jobs.html"') && build.includes('"job.html"'), "Static build includes search and detail pages"],
  [build.includes('"public-job-data.js"') && build.includes('"jobs-search.js"') && build.includes('"job-detail.js"'), "Static build includes public jobs modules"],
  [jobsData.includes('"/api/v1/jobs"'), "Public job data adapter targets the documented API contract"],
];
let failed = false;
for (const [passed, description] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${description}`);
  if (!passed) failed = true;
}
const syntax = spawnSync(process.execPath, ["scripts/check-syntax.mjs"], { stdio: "inherit" });
if (syntax.status !== 0) failed = true;
if (failed) process.exit(1);
console.log("Lint checks passed.");
