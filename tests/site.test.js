import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const components = await readFile(new URL("../scripts/components.js", import.meta.url), "utf8");
const buildScript = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const mainScript = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
const employerHtml = await readFile(new URL("../employer-jobs.html", import.meta.url), "utf8");
const employerCss = await readFile(new URL("../styles/employer.css", import.meta.url), "utf8");
const employerScript = await readFile(new URL("../scripts/employer-jobs.js", import.meta.url), "utf8");
const runtimeConfig = await readFile(new URL("../scripts/runtime-config.js", import.meta.url), "utf8");
const logo = await readFile(new URL("../public/job-grid-logo.png", import.meta.url));

test("homepage includes semantic landmarks and descriptive metadata", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<title>Job Grid/);
  assert.match(html, /name="description"/);
  assert.match(html, /href="#main"/);
});

test("official supplied logo is a valid PNG and is used by the reusable brand component", () => {
  assert.equal(logo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(components, /class JobGridBrand extends HTMLElement/);
  assert.match(components, /src="\/job-grid-logo\.png"/);
  assert.match(components, /alt="Official Job Grid emblem"/);
  assert.match(components, /variant="footer"/);
  assert.match(buildScript, /job-grid-logo\.png/);
  assert.match(buildScript, /new URL\("job-grid-logo\.png", output\)/);
  assert.doesNotMatch(components, /job-grid-logo\.webp/);
  assert.doesNotMatch(buildScript, /job-grid-logo\.webp/);
});

test("design tokens follow the logo's blue, white, and deep-navy identity", () => {
  for (const token of ["--color-primary", "--color-primary-bright", "--color-secondary", "--color-navy-deep", "--color-bg", "--color-text", "--font-sans", "--radius-lg", "--space-8"]) {
    assert.ok(tokens.includes(token), `Expected token ${token}`);
  }
  assert.match(tokens, /--color-primary: #004ef5/);
  assert.match(tokens, /--color-primary-bright: #1161f6/);
  assert.match(tokens, /--color-bg: #ffffff/);
});

test("responsive and accessibility states are defined", () => {
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 740px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.skip-link/);
  assert.match(css, /\.brand-logo/);
});

test("navigation components expose labels and accessible mobile menu state", () => {
  assert.match(components, /aria-label="Main navigation"/);
  assert.match(components, /aria-expanded="false"/);
  assert.match(components, /aria-controls="primary-navigation"/);
  assert.match(mainScript, /setAttribute\("aria-expanded"/);
});

test("vacancy cards are clearly marked sample content and no live features are claimed", () => {
  assert.equal((html.match(/class="role-type">Sample role/g) ?? []).length, 3);
  assert.match(html, /not live vacancies/);
  assert.match(html, /Search, filters, applications, and employer accounts are not connected yet/);
  assert.doesNotMatch(html, /action="https?:\/\//);
});

test("employer portal route is present, noindexed, and never uses fake vacancy data", () => {
  assert.ok(components.includes('href="/employer-jobs.html"'));
  assert.ok(employerHtml.includes('<main id="main"'));
  assert.ok(employerHtml.includes('name="robots" content="noindex, nofollow"'));
  assert.ok(employerHtml.includes('id="close-vacancy-dialog"'));
  assert.ok(employerHtml.includes('id="confirm-close"'));
  assert.ok(employerHtml.includes('id="portal-notice"'));
  assert.ok(employerHtml.includes("Close permission is verified again by the backend"));
  assert.equal(employerHtml.includes("Sample employer"), false);
  assert.equal(employerHtml.includes("Operations Coordinator"), false);
  assert.ok(runtimeConfig.includes('supabaseUrl: ""'));
  assert.ok(runtimeConfig.includes('publishableKey: ""'));
  assert.ok(employerCss.includes("@media (max-width: 740px)"));
  assert.ok(employerScript.includes("auth.getSession"));
  assert.ok(employerScript.includes("Idempotency-Key"));
  assert.ok(employerScript.includes("expected_version"));
  assert.equal(employerHtml.includes('type="password"'), false);
  assert.equal(employerHtml.includes('name="access_token"'), false);
  assert.equal(employerHtml.includes('name="service_role_key"'), false);
});

test("employer workspace uses tenant membership reads and does not send actor identity", () => {
  assert.ok(employerScript.includes("organization_memberships"));
  assert.ok(employerScript.includes('status: "eq.active"'));
  assert.ok(employerScript.includes("vacancies"));
  assert.ok(employerScript.includes('new Set(["owner", "admin", "recruiter"])'));
  assert.ok(employerScript.includes("window?.jobGridAuth"));
  assert.equal(employerScript.includes("actor_user_id:"), false);
});
