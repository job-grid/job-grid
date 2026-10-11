# Country/area code cross-check protocol — 2026-10-12

**Status:** Read-only source-audit tooling; current result is in the latest Phase 0 CI artifact. This protocol does not authorize schema, import or production work.

## Purpose

Compare GeoNames countryInfo alpha-2/alpha-3 pairs against the current public country/area table maintained by the United Nations Statistics Division (UNSD) under the Standard Country or Area Codes for Statistical Use (M49) page. The table exposes ISO-alpha2 and ISO-alpha3 columns. The audit joins only by the complete alpha-2 + alpha-3 pair; names are not identity keys.

Sources: [UNSD M49 overview](https://unstats.un.org/unsd/methodology/m49/overview/) and [ISO 3166 country-code information](https://www.iso.org/iso-3166-country-codes.html).

## Numeric-code boundary

The UN explains that the alphabetic codes in M49 are assigned by ISO, while M49 numeric codes are maintained by UNSD for statistical use. The audit therefore never labels an M49 numeric code as proof of an ISO numeric-3 value. Numeric equality is diagnostic only. Missing/conflicting tuples are review cases and never permission to rewrite a code.

This public cross-check advances the review without purchasing the annual ISO collection. It is not called a downloaded ISO Country Codes Collection file or a direct ISO-published machine-readable snapshot. Conflicts and non-standard GeoNames codes remain visible in row-level evidence.

## Audit behavior

CI retrieves and fingerprints the live GeoNames countryInfo file and the public UN M49 overview HTML, including URL, status, retrieval time, Last-Modified/ETag when exposed, bytes and SHA-256. The parser fails closed on a missing/changed table, malformed rows, duplicate identifiers or provenance/checksum mismatches.

The aggregate JSON and row-level CSV/JSON are uploaded as a short-lived CI artifact. Row-level source IDs/codes are not committed as a permanent report by this utility. No code is automatically corrected, and every mismatch remains a review case.

## What this closes, and what it does not

A passing run validates retrieval and structure, and provides a reproducible cross-check of GeoNames alpha-code tuples against the current UN table displaying ISO-assigned alpha codes. It does **not** claim direct ISO package provenance, settle exceptional entries, approve geopolitical or selectability policy, resolve administrative parents, or prove worldwide destination completeness.

Remaining work: disposition of every unmatched/conflicting row; approved entity-kind and selectability rules; source-specific administrative hierarchies and place-identity reconciliation; outstanding geographic association reviews; and the separate backup/restore readiness gate. Destination completeness must be scoped by country, feature type, administrative level, alias/language coverage and source-update policy. A country-code list alone cannot establish it.

No database schema, migration, seed, import, production or deployment operation is performed by this audit.
