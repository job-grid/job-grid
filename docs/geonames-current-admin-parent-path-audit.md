# Current administrative parent-path audit tooling — 2026-10-11

**Status: repeatable read-only audit added; no parent links approved or written.**

## Purpose

The 128 current administrative exception records (126 Japan ADM4, 2 Kenya ADM3) remain blocked from current selectors until their parent paths are evidenced. The new script audits an explicitly supplied GeoNames allCountries.txt snapshot using exact country/admin-code composite keys. It does not infer from labels, coordinates, proximity, other records with similar names, or feature level alone.

## Run

From the repository root, against an extracted source dump:

```sh
node scripts/geonames-current-admin-parent-path-audit.mjs /absolute/path/to/allCountries.txt
```

Optional second and third arguments select the dispositions CSV and output prefix:

```sh
node scripts/geonames-current-admin-parent-path-audit.mjs /path/to/allCountries.txt docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/owner-approved-dispositions.csv /path/to/output/current-admin-parent-path-audit
```

The script writes a row-level CSV plus a JSON summary. The JSON records the source-file SHA-256, byte size, modification time, line count and filename. These values pin the exact local bytes used for the audit; they do **not** claim that the source is the latest official snapshot or substitute for remote HTTP retrieval metadata.

## Exact-code rules

- Confirm that the target GeoNames ID exists exactly once and that source country and feature code match the approved exception export.
- Compare the source row's raw admin1/admin2 values with the existing exception export before calculating candidate parents. If either differs, stop that row for source/version review.
- Resolve each required level only by the exact composite key built from the same country and the raw admin code fields needed for that level, with the parent feature code exactly ADM1, ADM2 or ADM3.
- Preserve raw codes without normalization. An empty code or raw 00 blocks the ancestor lookup; it is never changed to blank, zero, a guessed code or a synthetic parent.
- Missing keys and non-unique keys are blockers. No name, proximity or “first match” fallback is allowed.
- A complete path is labelled CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL. Candidate IDs in the report are evidence only. The report always states that zero operational parent links were created.

## External evidence already checked manually

Three official GeoNames record pages demonstrate why feature class alone is insufficient to create an ancestor chain:

- [Yao-chō, Japan — GeoNames ID 1848521](https://www.geonames.org/1848521/yao-cho.html) is marked ADM4, but its displayed administrative hierarchy lists Japan and Yao-chō without intermediate ADM1–ADM3 records.
- [Kiambururu Sub-Location, Kenya — GeoNames ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html) is marked ADM3, but its displayed administrative hierarchy lists Kenya and Kiambururu without intermediate ADM1 or ADM2 records.\n- [Imenti Central, Kenya — GeoNames ID 7800132](https://www.geonames.org/7800132/imenti-central.html) is marked ADM3, but its displayed administrative hierarchy lists Kenya and Imenti Central without intermediate ADM1 or ADM2 records.

The [official GeoNames feature-code reference](https://www.geonames.org/export/codes.html) defines the administrative feature levels. GeoNames' [place hierarchy service documentation](https://www.geonames.org/export/place-hierarchy.html) describes the separate hierarchy view. A missing intermediate record must be treated as a source-evidence gap, not filled from a feature-code definition.

The existing exception export still reports 126 Japan records with raw admin1 00, plus two Kenya records with nonzero codes whose exact crosswalk keys were absent from the audited inputs. These three pages are representative manual checks, covering both Kenyan targets and one Japanese target; they are not evidence that every record in the 128-record set has been individually reviewed.

## Current decision boundary

This tooling does not modify source files, exception exports, migrations, schemas, seeds, imports, databases, deployment or production. It does not certify ISO authority codes or worldwide completeness. Any candidate parent path remains subject to owner review and explicit approval before any operational relationship is written.
