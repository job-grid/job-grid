# GeoNames country archive sample validation

**Current status: INDEPENDENT CURRENT-SOURCE GLOBAL SCAN AND EXCEPTION IDENTITY RECONCILIATION PASS; SAMPLE-SELECTION ALGORITHM, ISO COMPARISON AND CATALOG ACCEPTANCE REMAIN BLOCKED.** This README records historical builder evidence and later owner-computer verification separately. The builder's historical DNS retrieval failure remains accurate for that environment and is not contradicted by the later successful local-source verification.

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


## Stage C — five-country sample-record comparison PASS; hierarchy review remains blocked

The five requested country ZIPs are now present in the owner's connected Windows folder. All five passed ZIP CRC integrity checks. Source rows were parsed and compared to the 25,685-row sample by GeoNames ID and all 19 source fields.

| Archive | Bytes | SHA-256 | Source rows | Exact sample matches | ZIP CRC |
|---|---:|---|---:|---:|---|
| `KE.zip` | 859,668 | `d7335182356ab6609f93c1f66527195acd75bf72a841915b337858d65a172f43` | 31,490 | 2,631 | PASS |
| `GB.zip` | 3,639,180 | `eefc08df408aa4c3218151b5d9ca73768555fafac676a2ce5d612e2007c1f32a` | 109,181 | 12,096 | PASS |
| `JP.zip` | 4,959,247 | `f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58` | 103,762 | 4,899 | PASS |
| `BR.zip` | 7,177,385 | `4a9ddffb465ccad219127146f0678087cfece414ca0240bee53a5ea6750eebd8` | 235,530 | 5,888 | PASS |
| `SG.zip` | 69,019 | `7e18942c0241144089da0b9bea659c96fadc201573be9d25a02442eb7b7f09d8` | 1,979 | 171 | PASS |

**Total:** 481,942 source rows parsed; 25,685/25,685 sample rows matched exactly. Missing IDs: 0; conflicting fields: 0; ambiguous ID matches: 0; duplicate source IDs: 0; malformed 19-field rows: 0. `JP (1).zip` is identical to `JP.zip` by size and SHA-256.

### Measured crosswalk lookup

The owner-computer full crosswalks contained 3,865 unique admin1 code keys and 47,642 unique admin2 code keys. An exact raw-code lookup over each sample row found 2,333 unmatched non-empty admin1 code references and 240 unmatched non-empty admin2 code references. By country, admin1 unmatched counts: KE 26, GB 3, JP 2,161, BR 1, SG 142; admin2 unmatched counts: KE 5, GB 29, JP 206, BR 0, SG 0.

These are exact-key existence counts, not final invalid-record counts. The sample includes administrative features and place/locality rows. Japan's 2,161 unresolved admin1 keys all use raw code `00`; Singapore has 142 non-empty raw admin1 codes missing from the full crosswalk (118 `00` and 24 codes `01`–`05`). The existing exceptions CSV lists 24 SG `admin1_crosswalk_not_found` rows; overlap with the broader 142-row set has not been checked by individual ID. A durable per-record exception export is still required.

Keep all 24 recorded Singapore exceptions unresolved. Preserve raw IDs/codes; do not classify `00` as invalid without an owner-approved rule; do not infer that unmatched nonzero codes are legacy without evidence; do not invent parent links or merge same-name entities. The row-level code lookup found no resolved admin2 key whose admin1 key was missing, but this does not prove a complete parent hierarchy.

The owner-provided source files came from the official GeoNames URLs above, but this task did not re-fetch those URLs or capture HTTP Last-Modified headers. The hashes and ZIP checks are measured on local files. The originally reported 13,472,324-row worldwide scan was not reproduced; the full `allCountries.zip` was not opened or parsed. A current owner-approved ISO authority snapshot also remains unavailable.

**Current disposition:** Stage C selected-sample source comparison **PASS**; administrative hierarchy and row-level exception packaging remain incomplete; independent worldwide reproducibility and ISO comparison remain unverified; **catalog acceptance BLOCKED**. PR #27 remains open, draft and unmerged. No database, production, Cloudflare, secrets, backup or recovery changes were performed. Phase 4C remains separately BLOCKED.


## Stage C row-level crosswalk reconciliation update — 2026-10-10

The row-level crosswalk reconciliation has now been exported and committed under `docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/`:

- `unmatched_admin1_references.csv` and `unmatched_admin1_references.json`: 2,333 rows.
- `unmatched_admin2_references.csv` and `unmatched_admin2_references.json`: 240 rows.
- `summary.json`: deterministic aggregate counts and Singapore ID-set reconciliation.

The current row-level comparison shows 157 GeoNames IDs occur in both exception sets; the union contains 2,416 unique affected IDs. Therefore 2,333 + 240 is a reference-count sum, not a count of unique records.

For Singapore, the existing 24 exception IDs have **24/24 exact ID overlap** with the broader set of 142 admin1 misses. There are 118 additional IDs in the wider set and no prior-only IDs. The 142 misses comprise 118 raw `00` values and 24 raw values in `01`–`05`. All remain unresolved pending owner-approved representation/policy; there are no synthetic parent links.

These exports are row-level evidence, not a final classification of record validity or hierarchy correctness. Preserve raw codes and GeoNames IDs. The independent worldwide scan, current approved ISO comparison, worldwide completeness, and catalog acceptance remain UNVERIFIED/BLOCKED as previously stated. Phase 4C remains separately BLOCKED.


## Stage A repeat scan — same owner computer — 2026-10-10

A second run of the existing owner-computer `prepare_sample.py` completed in a separate output directory. It again reported 13,472,324 worldwide rows, zero malformed rows, and a 25,685-record selected sample; the five-country source row total remains 481,942. The source inputs and their owner-computer SHA-256 values are recorded in `docs/geonames-worldwide-scan-reproduction-2026-10-10.json`.

This is a repeat run of the same implementation on the same computer, not independent cross-platform reproduction. Byte-for-byte output comparison with the earlier sample has not been measured. Consequently, Stage B independent-source reproducibility remains incomplete.

The repeat run's manifest still used the key `last_modified_utc` for local filesystem `st_mtime`. This is not HTTP Last-Modified evidence. Interpret it as local filesystem metadata only; `http_last_modified_utc` remains null unless a real response header is captured. The original sample package was not altered.

For the ISO gate, the proposed authoritative source is the [ISO 3166 Maintenance Agency's Online Browsing Platform information](https://committee.iso.org/iso-3166-country-codes.html). ISO says the OBP is kept up to date. The [ISO 3166-1:2020 standard page](https://www.iso.org/standard/72482.html) says this edition was reviewed and confirmed in 2025 and remains current. The owner approved the source choice on 2026-10-10. The specific snapshot still needs permitted retrieval, local hashing and deterministic comparison; no ISO snapshot has been captured or compared. Follow [the ISO approval and validation protocol](../iso-authority-approval-and-validation-protocol-2026-10-10.md), and do not send the source rows or code tuples to AI tools.

## Follow-up verification — 2026-10-10

The earlier status above that marked the full-world scan as unverified has been superseded by a separate PowerShell/.NET streaming verification against the existing local `allCountries.zip`. The independent verifier scanned **13,472,324** rows, found **0** malformed worldwide rows, and matched **25,685/25,685** existing sample records by GeoNames ID and all 19 original fields. Local input sizes and SHA-256 hashes were recalculated and matched the previous manifest. Seven original/repeat output and attribution files were measured byte-identical.

See [the independent worldwide verification report](../geonames-worldwide-independent-verification-2026-10-10.md) and its [machine-readable JSON](../geonames-worldwide-independent-verification-2026-10-10.json).

Still unresolved: the official GeoNames URLs were not re-fetched, so source-origin and remote retrieval metadata remain unverified; the sample-selection algorithm has not been independently reimplemented; the ISO snapshot has not been compared; worldwide completeness and parent-hierarchy correctness remain unverified. The Singapore and other crosswalk exceptions remain unresolved and catalog acceptance remains **BLOCKED**. Phase 4C remains separately **BLOCKED**.

## Source preflight provenance hardening — 2026-10-10

The reusable preflight in `scripts/geonames-sample-validate.mjs` is now version **1.1.0** and writes manifest schema version **2**.

- The staging workspace must be **outside the Git repository**. The preflight fails before creating the workspace when a repository path is supplied.
- Successful retrieval records separate retrieval-start and retrieval-completion timestamps, the effective response URL, HTTP status, and the literal `Last-Modified` and `Date` headers received from the server. The HTTP `Last-Modified` field remains null unless a real response header is captured.
- A legacy `retrieved_at` or `last_modified_utc` carried forward from older manifests is placed in explicitly unverified legacy fields; it is not promoted to verified server metadata.
- The preflight now requires exactly **19 tab-separated fields** in each `countryInfo.txt` data row and records an invalid-column-count exception for both truncated and overlong rows.
- Automated synthetic tests cover these behaviors. They do not download or validate the actual upstream GeoNames files.

This updates the tool for future local retrievals. It does **not** retroactively establish official-source provenance or HTTP retrieval metadata for previously observed local files. The country catalog remains **BLOCKED** pending the approved ISO comparison, source-origin evidence and unresolved hierarchy/feature policy decisions.


## Stage D — independent live global-source audit — 2026-10-11

**Result: PASS for full current source scan and all unresolved crosswalk-exception record identities; catalog acceptance remains BLOCKED.** A new CI job downloaded GeoNames' official `allCountries.zip` directly, captured the HTTP response metadata and hash, validated ZIP integrity, extracted the full source, then scanned it end-to-end.

| Measure | Independently measured current-source result |
|---|---:|
| Source archive HTTP status / ZIP CRC | 200 / PASS |
| Extracted source lines | 13,472,324 |
| Malformed or wrong-shape rows | 0 |
| Unique IDs in crosswalk exception export | 2,416 |
| Exact ID, name, country, feature code, raw admin1 and admin2 matches | 2,416 |
| Missing/duplicate source IDs or source identity/raw-code drift | 0 |

The current run therefore independently reproduces the reported 13,472,324-line worldwide source scan count and verifies every unique record in the unresolved exception export against that full source. This closes source identity/raw-code drift for the 2,416 exception IDs in the current snapshot. It does **not** establish that any absent admin crosswalk key has been found, nor does it approve any parent relationship.

The official source fingerprint and aggregate result are committed in [the machine-readable global audit summary](../geonames-global-exception-source-audit-2026-10-11.json). The full row-level CSV, detailed JSON and source retrieval manifest are in [the seven-day workflow artifact](https://github.com/job-grid/job-grid/actions/runs/38097453927/artifacts/11686636684) (expires 2026-10-18). The full 422 MB archive and its 1.79 GB extracted text were not committed and are not included in the artifact.

**Still unverified:** independent reproduction of the algorithm that selected the separate 25,685-row sample; current ISO authority comparison; and product/worldwide geographic completeness. The current administrative hierarchy gate remains blocked: 126 Japan ADM4 records preserve raw admin1 `00`, and two Kenyan ADM3 records have neither an exact ADM1 composite-key match nor a direct `ADM` hierarchy edge. No parent links, schema/migration/seed/import, database, production or deployment changes were made.


## Stage E — Kenya legacy admin1 key audit — 2026-10-11

A separate read-only CI audit retrieved the current official GeoNames `admin1CodesASCII.txt` and checked the exact composite keys required by the two unresolved Kenya ADM3 records:

- GeoNames ID 192705, Kiambururu Sub-Location: source raw admin1 remains `01`; key `KE.01` has zero rows in the current crosswalk.
- GeoNames ID 7800132, Imenti Central: source raw admin1 remains `03`; key `KE.03` has zero rows in the current crosswalk.

The audit parsed 3,865 rows with zero malformed rows and zero duplicate composite keys. HTTP retrieval metadata and the source hash are in the [machine-readable audit](../geonames-kenya-legacy-admin1-crosswalk-audit-2026-10-11.json); the [report](../geonames-kenya-legacy-admin1-crosswalk-audit-2026-10-11.md) explains the evidence and limits. The source was retrieved at `2026-10-11T00:18:08Z` (HTTP 200; Last-Modified `2026-10-10T01:58:39Z`; SHA-256 `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a`).

GeoNames' current crosswalk also includes records such as `KE.22` and `KE.35`, but these were not inferred as replacements or assigned to the target rows. Historical forum guidance called KE.01/KE.03 obsolete but is not an authoritative replacement map. The two records remain valid source identities with unresolved parent associations. No names/proximity matching, parent IDs, operational links or production changes were used.


## Stage F — Kenyan external county-ancestor evidence review — 2026-10-11

The exact current admin1 keys `KE.01` and `KE.03` remain absent. Separate official sources now give county-level ancestry leads for the two affected records, but do not prove the exact GeoNames-ID lineage or immediate parent path:
- `192705` Kiambururu Sub-Location: an IEBC Act schedule lists Kiambururu among sub-locations of Kiambu County; a 2024 Ministry of Interior Gazette lists Kiambururu as a Location under Githunguri Sub-County. Candidate county ancestor only: GeoNames Kiambu County ADM2 ID `8693007` (not related Kiambu ADM1 ID `192709`); level discrepancy remains.
- `7800132` Imenti Central: Meru County Government lists Central Imenti as an administrative sub-county and constituency and uses “Imenti Central” in its administrator list; a 2022 Gazette places Central Imenti under Meru County. Candidate county ancestor only: GeoNames Meru County ADM2 ID `8693009` (not related Meru ADM1 ID `186824`).

See the [Kenya external ancestor evidence review](../geonames-kenya-external-ancestor-evidence-2026-10-11.md) and its [machine-readable candidate list](../geonames-kenya-external-ancestor-evidence-2026-10-11.json). These are owner-review candidates only and have not been approved or written as parent links. Raw codes `01` and `03` remain unchanged.
