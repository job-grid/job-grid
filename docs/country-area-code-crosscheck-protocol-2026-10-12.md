# Country/area code cross-check protocol — 2026-10-12

**Status:** Read-only source-audit tooling; current result is in the latest Phase 0 CI artifact. This protocol does not authorize schema, import or production work.

## Purpose

Compare GeoNames countryInfo alpha-2/alpha-3 pairs against the current public country/area table maintained by the United Nations Statistics Division (UNSD) under the Standard Country or Area Codes for Statistical Use (M49) page. The table exposes ISO-alpha2 and ISO-alpha3 columns. The audit joins only by the complete alpha-2 + alpha-3 pair; names are not identity keys.

Sources: [UNSD M49 overview](https://unstats.un.org/unsd/methodology/m49/overview/) and [ISO 3166 country-code information](https://www.iso.org/iso-3166-country-codes.html).

## Numeric-code boundary

The UN M49 page describes its numerical codes as those used for statistical processing by UNSD, and ISO's country-code guidance states that the numeric country code is assigned by the UN. The audit now compares the GeoNames countryInfo numeric value with the UN value for each exact alpha-2 + alpha-3 pair; the live source has 248 exact pair/numeric agreements and zero numeric conflicts. Only those rows receive a proposed ISO numeric-3 candidate, with explicit provenance; an alpha pair with a conflicting numeric value blocks the audit. Kosovo remains without an ISO numeric value, while Taiwan's `TW/TWN/158` tuple has separate official ISO-newsletter corroboration. Historical source tuples remain historical-only.

This public cross-check advances the review without purchasing the annual ISO collection. It is not called a downloaded ISO Country Codes Collection file or a direct current ISO OBP snapshot. Numeric candidates are source-backed, not proof that the live ISO collection was refreshed in this run; a periodic direct ISO-source review remains open. Conflicts and non-standard GeoNames codes remain visible in row-level evidence.

## Audit behavior

CI retrieves and fingerprints the live GeoNames countryInfo file and the public UN M49 overview HTML, including URL, status, retrieval time, Last-Modified/ETag when exposed, bytes and SHA-256. The parser fails closed on a missing/changed table, malformed rows, duplicate identifiers or provenance/checksum mismatches.

The aggregate JSON and row-level CSV/JSON are uploaded as a short-lived CI artifact. Row-level source IDs/codes are not committed as a permanent report by this utility. No code is automatically corrected, and every mismatch remains a review case.

## What this closes, and what it does not

A passing run validates retrieval and structure, and provides a reproducible cross-check of GeoNames alpha-code tuples against the current UN table displaying ISO-assigned alpha codes. It does **not** claim direct ISO package provenance, settle exceptional entries, approve geopolitical or selectability policy, resolve administrative parents, or prove worldwide destination completeness.

Remaining work: disposition of every unmatched/conflicting row; approved entity-kind and selectability rules; source-specific administrative hierarchies and place-identity reconciliation; outstanding geographic association reviews; and the separate backup/restore readiness gate. Destination completeness must be scoped by country, feature type, administrative level, alias/language coverage and source-update policy. A country-code list alone cannot establish it.

No database schema, migration, seed, import, production or deployment operation is performed by this audit.

## Measured CI run — 2026-10-12

The [successful country/area audit](https://github.com/job-grid/job-grid/actions/runs/38190820033) parsed 252 GeoNames countryInfo rows against 248 coded country/area rows in UN M49: 248 exact alpha-2/alpha-3 pairs, four source tuples absent from the current table, zero code conflicts and zero duplicate code groups. A versioned [exception-disposition manifest](geonames-un-m49-exception-dispositions-2026-10-12.json) accounts for all four; the validator requires the manifest ID set to equal the live non-M49 set exactly, so new and stale exceptions fail closed.

The same CI job produces a 252-row [country/area destination candidate package](https://github.com/job-grid/job-grid/actions/runs/38190820033/artifacts/11721722211): 250 proposed current destination areas and two historical, nonselectable references. The source tuple is retained for each row; no source code is automatically replaced; the package explicitly says it has not been imported and has zero operationally selectable rows. The two former entities are preserved as historical references; Kosovo and Taiwan are treated as searchable geographic destinations without making a sovereignty claim.

The current ISO Country Codes Collection/live OBP snapshot is still not captured by this audit. The direct code tuple for Taiwan has corroborating ISO newsletter evidence but must be refreshed under the periodic ISO-source process. More importantly, this is only the country/area layer: country-specific admin paths, place-level feature coverage, aliases/localized names, and import acceptance still require separate evidence and review.

