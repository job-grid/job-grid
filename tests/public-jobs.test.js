import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPublicJobsUrl,
  cleanPublicText,
  formatEmploymentType,
  formatPublicLocation,
  formatPublicSalary,
  isPubliclyVisibleJob,
  normalizePublicJob,
  normalizePublicJobsResponse,
  validateJobSearchFilters
} from "../scripts/public-job-data.js";

const now = Date.parse("2026-10-13T00:00:00.000Z");
const visibleJob = () => ({
  id: "vac_1",
  reference: "JG-100",
  slug: "support-specialist-nairobi",
  title: "Support specialist",
  status: "published",
  organization: { displayName: "Example employer", verificationStatus: "verified" },
  location: { countryCode: "KE", city: "Nairobi", region: null },
  occupation: { code: "support-01", label: "Customer support" },
  employmentType: "full_time",
  salary: { min: null, max: null, currency: null, payPeriod: null },
  sponsorshipStatus: "not_stated",
  publishedAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
  description: "Public role summary.",
  applicationInstructions: "Use the employer's official application channel.",
  internalNote: "not for public display",
  candidateName: "Example candidate",
  documentLink: "/private/document"
});

test("search URL encodes only approved public filters and caps results", () => {
  const url = buildPublicJobsUrl({ q: "care & support", country: "ke", city: "Kisumu Central" });
  assert.equal(url, "/api/v1/jobs?q=care+%26+support&country=KE&city=Kisumu+Central&limit=25");
  assert.throws(() => buildPublicJobsUrl({ country: "KEN" }), /two-letter country code/);
  assert.throws(() => buildPublicJobsUrl({ q: "x".repeat(161) }), /160 characters/);
  assert.throws(() => buildPublicJobsUrl({}, "https://example.com/api/jobs"), /same-origin/);
});

test("search filter validation normalizes values and rejects malformed codes", () => {
  assert.deepEqual(validateJobSearchFilters({ q: "  nurse  ", country: "ke", city: " Kisumu " }), {
    valid: true,
    filters: { q: "nurse", country: "KE", city: "Kisumu" }
  });
  assert.equal(validateJobSearchFilters({ country: "1K" }).valid, false);
  assert.equal(validateJobSearchFilters({ city: "x".repeat(101) }).valid, false);
});

test("only published jobs inside the publication window are visible", () => {
  assert.equal(isPubliclyVisibleJob(visibleJob(), now), true);
  assert.equal(isPubliclyVisibleJob({ ...visibleJob(), status: "closed" }, now), false);
  assert.equal(isPubliclyVisibleJob({ ...visibleJob(), publishedAt: "2026-12-01T00:00:00.000Z" }, now), false);
  assert.equal(isPubliclyVisibleJob({ ...visibleJob(), expiresAt: "2026-10-12T23:59:59.000Z" }, now), false);
  assert.equal(isPubliclyVisibleJob({ ...visibleJob(), expiresAt: "invalid" }, now), false);
  assert.equal(isPubliclyVisibleJob({ ...visibleJob(), status: "draft" }, now), false);
});

test("public normalizer allowlists properties and excludes internal fields", () => {
  const normalized = normalizePublicJob(visibleJob(), now);
  assert.ok(normalized);
  assert.equal(normalized.title, "Support specialist");
  assert.equal(normalized.organization.verified, true);
  assert.equal(normalized.salary.currency, "");
  assert.equal(Object.hasOwn(normalized, "description"), false);
  assert.equal(Object.hasOwn(normalized, "internalNote"), false);
  assert.equal(Object.hasOwn(normalized, "candidateName"), false);
  assert.equal(Object.hasOwn(normalized, "documentLink"), false);
});

test("detail normalization adds bounded public text only", () => {
  const normalized = normalizePublicJob(visibleJob(), now, true);
  assert.equal(normalized.description, "Public role summary.");
  assert.equal(normalized.applicationInstructions, "Use the employer's official application channel.");
  assert.equal(cleanPublicText("hello" + String.fromCharCode(0) + "world"), "");
  assert.equal(normalizePublicJob({ ...visibleJob(), title: "   " }, now), null);
});

test("malformed list response is rejected and non-public records are skipped", () => {
  assert.throws(() => normalizePublicJobsResponse({ items: [] }, now), /unexpected response/);
  const rows = normalizePublicJobsResponse({ data: [visibleJob(), { ...visibleJob(), status: "closed" }, null] }, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "vac_1");
});

test("missing or inconsistent salary is not fabricated", () => {
  assert.equal(formatPublicSalary(null), "Salary not stated");
  assert.equal(formatPublicSalary({ min: null, max: null, currency: null }), "Salary not stated");
  assert.equal(formatPublicSalary({ min: 2000, max: 1000, currency: "USD" }), "Salary not stated");
  assert.equal(formatPublicSalary({ min: 1000, max: 1500, currency: "USD", payPeriod: "month" }), "$1,000–$1,500 per month");
});

test("location and employment labels use supplied public facts", () => {
  assert.equal(formatPublicLocation({ city: "Nairobi", countryCode: "KE" }), "Nairobi, KE");
  assert.equal(formatPublicLocation({}), "Location not stated");
  assert.equal(formatEmploymentType("full_time"), "Full-time");
});

test("search and detail pages have noindex, accessible statuses, and no sample listings", async () => {
  const jobsHtml = await readFile(new URL("../jobs.html", import.meta.url), "utf8");
  const detailHtml = await readFile(new URL("../job.html", import.meta.url), "utf8");
  assert.match(jobsHtml, /name="robots" content="noindex,nofollow"/);
  assert.match(jobsHtml, /id="job-search-form"/);
  assert.match(jobsHtml, /id="job-search-results"/);
  assert.match(jobsHtml, /id="job-search-status"/);
  assert.match(jobsHtml, /no sample listings/);
  assert.match(detailHtml, /id="job-detail-panel" class="job-detail-panel" hidden/);
  assert.match(detailHtml, /id="job-detail-description"/);
  assert.match(detailHtml, /Applications are not connected in this preview/);
});
