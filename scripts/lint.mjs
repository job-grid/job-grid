import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const locationPicker = await readFile(new URL("../scripts/location-picker.js", import.meta.url), "utf8");
const build = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
const submitJobPage = await readFile(new URL("../submit-job.html", import.meta.url), "utf8");
const staffSubmissionPage = await readFile(new URL("../staff-job-submissions.html", import.meta.url), "utf8");
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
  [locationPicker.includes("A new query invalidates the previous selection and its suggestions immediately.") && locationPicker.includes("this.matches = [];"), "Place search clears stale suggestions before debounce"],
  [build.includes('"submit-job.html"') && build.includes('"staff-job-submissions.html"'), "Manual submission pages are included in production build"],
  [build.includes('"submit-job.js"') && build.includes('"staff-job-submissions.js"'), "Manual submission scripts are included in production build"],
  [submitJobPage.includes('id="submit-job-form"') && submitJobPage.includes('name="source_reference"'), "Public manual job form includes required source evidence"],
  [staffSubmissionPage.includes('meta name="robots" content="noindex,nofollow"') && staffSubmissionPage.includes('id="submission-workspace"'), "Staff submission workspace is noindex and has a protected workspace"],
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
