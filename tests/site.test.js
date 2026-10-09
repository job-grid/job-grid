import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const components = await readFile(new URL("../scripts/components.js", import.meta.url), "utf8");
const mainScript = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
const logo = await readFile(new URL("../public/job-grid-logo.webp", import.meta.url));

test("homepage includes semantic landmarks and descriptive metadata", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<title>Job Grid/);
  assert.match(html, /name="description"/);
  assert.match(html, /href="#main"/);
});

test("official supplied logo has a valid WebP signature and is used by a reusable brand component", () => {
  assert.equal(logo.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(logo.subarray(8, 12).toString("ascii"), "WEBP");
  assert.match(components, /class JobGridBrand extends HTMLElement/);
  assert.match(components, /src="\/public\/job-grid-logo\.webp"/);
  assert.match(components, /alt="Official Job Grid emblem"/);
  assert.match(components, /variant="footer"/);
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
