# Kenya legacy admin1 crosswalk audit — 2026-10-11

**Status: EXACT CURRENT CROSSWALK KEYS ABSENT; PARENTAGE STILL UNRESOLVED.**

**Phase 0 CI run:** [38097953584](https://github.com/job-grid/job-grid/actions/runs/38097953584)  
**Seven-day audit artifact:** [CSV, JSON, current crosswalk retrieval manifest](https://github.com/job-grid/job-grid/actions/runs/38097953584/artifacts/11686852169) (expires 2026-10-18).

## Exact-key result

The CI job retrieved the official current GeoNames `admin1CodesASCII.txt` file from `https://download.geonames.org/export/dump/admin1CodesASCII.txt`. The downloaded file contained 3,865 rows, zero malformed rows and zero duplicate composite keys.

| GeoNames ID | Record | Raw admin1 | Exact key checked | Rows for key | Result |
|---|---|---|---|---:|---|
| 192705 | Kiambururu Sub-Location (ADM3) | `01` | `KE.01` | 0 | Unresolved |
| 7800132 | Imenti Central (ADM3) | `03` | `KE.03` | 0 | Unresolved |

The full worldwide `allCountries.zip` audit had already verified both source rows exist exactly once, and that their IDs, names, country/feature codes and raw admin codes match the committed exception export. This crosswalk check now confirms that the exact current admin1 composite keys required by those raw codes do not exist in the current crosswalk file.

## Current source fingerprint

- URL: `https://download.geonames.org/export/dump/admin1CodesASCII.txt`
- Retrieved (UTC): `2026-10-11T00:18:08Z`
- HTTP status: 200
- HTTP Last-Modified: `Sat, 10 Oct 2026 01:58:39 GMT` (`2026-10-10T01:58:39Z`)
- ETag: `"2501f-65d72cdb3fbc2"`
- Size: 151,583 bytes
- SHA-256: `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a`

The same file lists current crosswalk rows such as `KE.22` — Kiambu County (GeoNames ID 192709) — and `KE.35` — Meru County (GeoNames ID 186824). **Those are examples of keys present in the current file, not approved parents for the two ADM3 targets.** No county assignment was made from record names, coordinates, proximity or feature-code assumptions.

## Historical and official-source context

A [2013 GeoNames forum response from a maintainer](https://forum.geonames.org/gforum/posts/list/4269.page) explicitly described the legacy keys `KE.01` and `KE.03` in its original post and said the codes were obsolete, with replacements not then known. Treat that as historical explanatory context only, not a current authoritative mapping.

The [Kenya National Bureau of Statistics](https://www.knbs.or.ke/2019-kenya-population-and-housing-census-reports/) publishes current county/sub-county administrative-unit tables and census mapping materials. The sources checked in this task did not provide a verified individual parent lineage linking either GeoNames ADM3 ID to a specific current GeoNames ADM1 record. An exact authority-backed crosswalk or suitable official boundary/lineage evidence is still required.

## Decision

- Preserve raw `01` and `03` unchanged.
- Keep both records valid as source identities with unresolved administrative-parent associations.
- Do not auto-map them to a likely county based on names or geography.
- Do not create parent IDs or operational parent links. The audit confirms **zero** candidate parent IDs assigned, **zero** links created and **zero** database/production changes.
- Continue to treat the 126 Japanese `ADM4` rows with raw admin1 `00` as a separate unresolved issue.

The [row-level artifact](https://github.com/job-grid/job-grid/actions/runs/38097953584/artifacts/11686852169) contains the machine-readable two-record disposition, 47 current Kenya admin1 keys, and source retrieval manifest. Current official ISO comparison and product/worldwide geographic completeness remain separately unverified.
