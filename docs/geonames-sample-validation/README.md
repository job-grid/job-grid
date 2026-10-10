# GeoNames country archive sample validation

**Two-stage status: READY FOR OWNER REVIEW OF SAMPLE EVIDENCE; BLOCKED FOR CATALOG ACCEPTANCE.** This README records two different validation stages. They answer different questions and must not be combined.

## Stage A — Owner-laptop sample generation and artifact inspection

The owner reports running a local script against the original `allCountries.zip`. The owner-local script reported scanning **13,472,324** records and generated a sample package with **25,685** selected geographic records. This worldwide scan count is attributed to the owner's local script; it was **not independently reproduced by the isolated builder**.

The owner-supplied archive `JobGrid-GeoNames-Sample-20261010-163234.zip` was independently inspected in the builder workspace:

- Uploaded ZIP: 1,346,867 bytes; SHA-256 `feba409196d05d77e4a02e194c3223c2a1849231c8e80594934d9e99370ab4bf`.
- ZIP member integrity test: PASS.
- Extracted selected sample: 25,685 records and 25,685 distinct GeoNames IDs; no duplicate IDs and no invalid/unparsable/out-of-range sample coordinates were found.
- Included supporting samples: 5 country metadata rows, 125 admin1 crosswalk rows, 6,977 admin2 crosswalk rows.
- The sample's 24 `admin1_crosswalk_not_found` exceptions are all Singapore (SG). Independent rechecking against the **included sample crosswalk** reproduced those 24 misses; this is not a validation against the original full crosswalk or a proof that the records are invalid.

**Singapore handling:** retain all 24 as unresolved source-model/crosswalk exceptions requiring review, not automatic invalid-place rejections. Preserve GeoNames IDs and original administrative codes. Do not invent administrative records or parent links. Leave uncertain relationships unresolved/needs-review until an appropriate authoritative source or approved mapping rule resolves them.

The full counts and per-country summary in the detailed report are **reported by the owner-provided local script and inspected sample metadata**, not a second full-source scan. The sample selection is biased by administrative-feature inclusion, population ranking, reservoir sampling, and priority-name matches. It is not a worldwide completeness sample.

## Stage B — Independent source-pinned reproducibility

The original `allCountries.zip`, original `countryInfo` file, and original full admin crosswalk files are not included in the sample package. The isolated builder environment attempted to retrieve nine official GeoNames sources, but DNS resolution failed for all nine. That failure remains recorded in `source-manifest.json` and `results/validation-report.json`; it describes the builder retrieval attempt, not the owner-laptop sample run.

Consequently, all of the following remain incomplete:

1. Recomputing and verifying the original-source SHA-256 hashes against original source bytes.
2. Independently reproducing the owner's reported 13,472,324-record scan and its malformed-row count.
3. Reproducing the selected sample from the pinned full input and script, including selection decisions.
4. Comparing country codes to a separately obtained, current, owner-approved ISO authority snapshot.

The uploaded ZIP's checksum verifies the **uploaded sample package only**. It does not prove that the original source archives match manifest-declared source hashes.

## Timestamp and relationship caveats

The sample builder's manifest field `last_modified_utc` was populated from local filesystem `st_mtime`; it is **not** an HTTP `Last-Modified` header. Rename it to `local_file_mtime_utc` or store verified HTTP header metadata in a separate field.

Crosswalk presence is not proof of a valid parent-child relationship. The current inspected sample does not establish a complete hierarchy; parent links were not resolved. Preserve ID and admin-code distinctions (including name collisions such as multiple Brasília records and distinct Mombasa records). Do not match by name alone.

## Builder source-download attempt

At `2026-10-10T11:21:52Z`, all nine configured official `download.geonames.org/export/dump/` URLs failed in the isolated builder workspace with DNS resolution error `URLError: [Errno -3] Temporary failure in name resolution`. Retries also failed. No original archives were retrieved there; the builder-side source parser therefore had no original source bytes to parse, and original-source checksums/counts are unavailable in that environment—not zero.

## Recommendation and gates

- **READY FOR OWNER REVIEW OF SAMPLE EVIDENCE:** the provided ZIP passed integrity checks and internal sample checks; the 24 Singapore crosswalk misses are characterized as unresolved exceptions.
- **BLOCKED FOR CATALOG ACCEPTANCE:** original-source pinning and reproducibility, current ISO-authority comparison, approved feature-code selection rules, and parent relationship reconciliation remain outstanding.
- No migrations, seeds, database imports, production/Cloudflare/secrets/backup/recovery changes or PR merge are authorized or performed. PR #27 remains open, draft and unmerged. Phase 4C recovery readiness remains separately BLOCKED.

GeoNames attribution/licensing must be retained. This package makes no worldwide-completeness, production-readiness, sovereignty, or employment-eligibility claim.
