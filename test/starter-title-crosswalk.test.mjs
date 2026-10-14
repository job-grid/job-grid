import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const crosswalk = JSON.parse(
  await readFile(new URL("../public/data/job-grid-title-crosswalk-review.json", import.meta.url), "utf8")
);
const occupationCatalog = JSON.parse(
  await readFile(new URL("../public/data/occupations-isco08-review.json", import.meta.url), "utf8")
);
const starterCatalog = JSON.parse(
  await readFile(new URL("../public/data/job-types.json", import.meta.url), "utf8")
);

test("crosswalk includes every starter title exactly once", () => {
  assert.equal(starterCatalog.roles.length, 496);
  assert.equal(crosswalk.rows.length, 496);
  assert.equal(new Set(crosswalk.rows.map(row => row.starterTitle)).size, 496);
  const sourceTitles = new Set(starterCatalog.roles.map(row => row[0]));
  assert.ok(crosswalk.rows.every(row => sourceTitles.has(row.starterTitle)));
});

test("every suggested ISCO code exists in the source-verified 436-group catalogue", () => {
  assert.equal(occupationCatalog.groups.length, 436);
  const groups = new Map(occupationCatalog.groups.map(group => [group.code, group.title]));
  assert.ok(occupationCatalog.groups.every(group => group.sourceStatus === "verified_source_match"));
  for (const row of crosswalk.rows) {
    assert.ok(groups.has(row.suggestedIsco08Code), `Unknown suggestion code for ${row.starterTitle}`);
    assert.equal(groups.get(row.suggestedIsco08Code), row.suggestedIsco08Title);
    assert.equal(row.alternatives.length, 2);
    assert.ok(row.alternatives.every(candidate =>
      groups.has(candidate.code) && groups.get(candidate.code) === candidate.title
    ));
    assert.ok(!row.alternatives.some(candidate => candidate.code === row.suggestedIsco08Code));
  }
});

test("crosswalk remains a review aid and cannot approve or activate data", () => {
  assert.equal(crosswalk.mapping_approved, false);
  assert.equal(crosswalk.production_import_authorized, false);
  assert.equal(crosswalk.publicly_active, false);
  assert.ok(crosswalk.rows.every(row =>
    row.reviewStatus === "pending_human_review" &&
    row.mappingApproved === false &&
    row.sourceVerified === false
  ));
  assert.equal(crosswalk.match_assessment_counts.manual_review_required, 376);
  assert.equal(crosswalk.match_assessment_counts.strong_text_candidate, 25);
});

test("crosswalk preview is non-indexed and clearly distinguishes candidates from approvals", async () => {
  const html = await readFile(new URL("../occupation-title-crosswalk-preview.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../scripts/title-crosswalk-preview.js", import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Candidate matches only — nothing has been approved/);
  assert.match(script, /Human review pending/);
  assert.match(script, /mapping_approved/);
  assert.match(build, /occupation-title-crosswalk-preview\.html/);
  assert.match(build, /title-crosswalk-preview\.js/);
});
