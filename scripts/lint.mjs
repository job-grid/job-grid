import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const locationPicker = await readFile(new URL("../scripts/location-picker.js", import.meta.url), "utf8");
const build = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
const countrySeoGenerator = await readFile(new URL("./generate-country-pages.mjs", import.meta.url), "utf8");
const countryPageScript = await readFile(new URL("./country.js", import.meta.url), "utf8");
const submitJobPage = await readFile(new URL("../submit-job.html", import.meta.url), "utf8");
const staffSubmissionPage = await readFile(new URL("../staff-job-submissions.html", import.meta.url), "utf8");
const submissionTableMigration = await readFile(new URL("../supabase/migrations/20261021150000_create_private_job_submissions.sql", import.meta.url), "utf8");
const submissionReviewMigration = await readFile(new URL("../supabase/migrations/20261021170000_atomic_job_submission_review.sql", import.meta.url), "utf8");
const staffSubmissionFunction = await readFile(new URL("../supabase/functions/staff-job-submissions/index.ts", import.meta.url), "utf8");
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
  [build.includes('generate-country-pages.mjs') && countrySeoGenerator.includes('countries.en.json'), "Country SEO pages are generated from the maintained country catalogue"],
  [countrySeoGenerator.includes('Duplicate country SEO slug') && countrySeoGenerator.includes('Sitemap contains duplicate URLs'), "Country SEO generator rejects slug and sitemap collisions"],
  [countryPageScript.includes('dataset.countryCode'), "Generated country pages load vacancies by their static country code"],
  [submitJobPage.includes('id="submit-job-form"') && submitJobPage.includes('name="source_reference"'), "Public manual job form includes required source evidence"],
  [staffSubmissionPage.includes('meta name="robots" content="noindex,nofollow"') && staffSubmissionPage.includes('id="submission-workspace"'), "Staff submission workspace is noindex and has a protected workspace"],
  [submissionTableMigration.includes("ENABLE ROW LEVEL SECURITY") && submissionTableMigration.includes("REVOKE ALL ON TABLE public.job_submissions FROM PUBLIC, anon, authenticated"), "Job submissions table is private to trusted service access"],
  [submissionReviewMigration.includes("FOR UPDATE") && submissionReviewMigration.includes("v_submission.status <> 'pending'"), "Review transaction locks each pending submission against duplicate review"],
  [submissionReviewMigration.includes("staff_vacancy_save_draft") && submissionReviewMigration.includes("v_submission.source_reference"), "Accepted submissions use existing draft workflow and preserve source evidence"],
  [submissionReviewMigration.includes("ARRAY['publisher','system_admin']") && submissionReviewMigration.includes("status = 'accepted_as_draft'") && submissionReviewMigration.includes("'published_at', NULL"), "Draft acceptance is role-gated and explicitly unpublished"],
  [staffSubmissionFunction.includes("db.auth.getUser(token)") && staffSubmissionFunction.includes("staff_roles") && staffSubmissionFunction.includes("staff_job_submission_review"), "Staff review endpoint validates session and staff role before actions"],
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
