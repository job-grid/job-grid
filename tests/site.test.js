import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const components = await readFile(new URL("../scripts/components.js", import.meta.url), "utf8");
const mainScript = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

test("homepage includes semantic landmarks and descriptive metadata", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<title>Job Grid/);
  assert.match(html, /name="description"/);
  assert.match(html, /href="#main"/);
});

test("owner logo remains a replaceable placeholder rather than invented brand artwork", () => {
  assert.match(components, /brand-placeholder/);
  assert.match(components, /LOGO<br>PENDING/);
  assert.match(components, /Brand assets pending owner approval/);
});

test("design tokens contain a consistent colour, typography, radius and spacing system", () => {
  for (const token of ["--color-primary", "--color-secondary", "--color-accent", "--color-bg", "--color-text", "--font-sans", "--radius-lg", "--space-8"]) {
    assert.ok(tokens.includes(token), `Expected token ${token}`);
  }
});

test("responsive and accessibility states are defined", () => {
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 740px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.skip-link/);
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
