# GeoNames unresolved hierarchy and feature-selectability policy — owner-approved conservative defaults

**Status: CONSERVATIVE DEFAULTS APPROVED BY OWNER — 2026-10-11. Parent hierarchy and catalog acceptance remain blocked.**  
**Purpose:** record the conservative review and selectability defaults approved for PR #27.  
**Approval scope:** retain source entities and raw codes; preserve unresolved states; exclude unresolved/historical/undifferentiated rows from current administrative selectors by default; never infer parentage from names or candidate presence alone.  
**Explicit exclusions:** approval does not validate each unresolved row, approve any parent link, certify ISO codes, authorize a paid ISO subscription, authorize schema/migration/seed/import work, or approve production deployment.

## 1. Evidence baseline

The latest read-only source-data audit found:

| Measure | Result |
|---|---:|
| Selected sample rows / distinct GeoNames IDs | 25,685 / 25,685 |
| Admin1 crosswalk keys | 3,865 |
| Admin2 crosswalk keys | 47,642 |
| Exact admin1-key references | 23,320 |
| Exact admin2-composite-key references | 20,445 |
| Admin1 references without a key | 2,333 |
| Admin2 missing-key or missing-context cases | 240 |
| Total unresolved references across both levels | 2,573 |
| Unique affected records after removing 157-row overlap | 2,416 |
| Resolved key-code fields matching the target source rows | 43,765; 0 mismatches |
| Parent IDs or parent links assigned by the audit | 0 |

The 125 ADM1 and 6,977 ADM2 identity matches are valid code-to-record identity lookups, not parent candidates. All 23,195 distinct admin1 candidates use feature code `ADM1`, and all 13,468 distinct admin2 candidates use `ADM2` in this selected sample. These checks confirm candidate and key consistency only; they do not prove semantic parentage or global completeness.

The detailed counts and input/script fingerprints are maintained in the [machine-readable hierarchy audit](geonames-hierarchy-candidate-presence-audit-2026-10-10.json) and [audit report](geonames-hierarchy-candidate-presence-audit-2026-10-10.md).

## 2. Proposed separation of concerns

Job Grid should keep these concepts separate in its eventual catalog:

1. **Source record validity:** whether the source row is structurally usable and has a stable source identity.
2. **Hierarchy resolution:** whether the record's administrative codes identify a reviewed parent path.
3. **Entity/feature type:** whether the record represents a current administrative division, historical division, populated place, locality, zone, or another feature.
4. **User-facing selectability:** whether product policy approves the record for a particular UI selector or workflow.
5. **ISO authority status:** whether any ISO code is confirmed by the owner-approved, current ISO source.

An unresolved hierarchy reference must not automatically invalidate the geographic entity. Conversely, a valid source record must not automatically become a selectable administrative parent.

## 3. Owner-approved conservative treatment defaults

The following defaults are approved at the policy/design level. They guide future implementation and review; they do not create mappings or change production data.

| Case | Evidence seen | Proposed conservative treatment | Must not do |
|---|---|---|---|
| Exact admin1 crosswalk key, candidate present as same-country `ADM1` | Key and candidate checks pass in sample | Mark the crosswalk candidate as **resolved for review**; keep parent link unapproved until country-level hierarchy policy is approved | Do not treat code consistency alone as approval to assign a parent |
| Exact admin2 composite key, candidate present as same-country `ADM2` | Composite key and candidate checks pass in sample | Mark the crosswalk candidate as **resolved for review**; require the admin1 context and approved parent-path rule | Do not assign a parent based only on name, proximity, or candidate presence |
| Raw admin code `00` (field-specific) | Seen in 2,284 admin1 and 2 admin2 unresolved references. The official [GeoNames README](https://download.geonames.org/export/dump/readme.txt) defines admin1 code `00` as a general feature for which no specific admin1 code is defined; that statement is not assumed to explain every admin2-field `00`. | Preserve raw value and source row. For admin1 `00`, keep the ancestor unresolved; for admin2 `00`, keep the association unresolved pending field-specific evidence. **UNRESOLVED_PLACEHOLDER_CODE** is a conservative review bucket, not a claim that the record is malformed or invalid. Five `PCLI` country entities receive a separate **COUNTRY_LEVEL_NO_ADMIN_PARENT_REQUIRED** disposition; their raw `00` remains unchanged. | Do not silently convert `00` to blank, zero, a real code, or a synthetic parent |
| Country-level `PCLI` record with raw admin code `00` | Five country entities: Brazil, United Kingdom, Japan, Kenya, Singapore | Preserve the country record and raw fields; no administrative parent is required because the entity is a country-level independent political entity. | Do not fabricate an administrative parent or normalize the raw code |
| Nonzero code with no exact crosswalk key | 49 admin1 plus 237 admin2 cases are currently classified missing/version-dependent | Preserve raw code; compare source version and country-specific format; keep **UNRESOLVED_MISSING_OR_VERSION_DEPENDENT_REFERENCE** until evidenced | Do not label the code legacy or invalid without source/version evidence |
| Admin2 code exists but admin1 context is blank | One admin2 case | Preserve both raw fields; mark **UNRESOLVED_MISSING_ADMIN1_CONTEXT**; do not generate a composite lookup key | Do not guess admin1 context from name or a neighboring record |
| Historical administrative feature codes `ADM1H`–`ADM4H` | 952 rows in admin1-unresolved records; 235 historical administrative rows in admin2-unresolved records | Preserve identity and history; not selectable as current administrative options or used as current parents by default; decide any legacy display/search behavior separately in a future product-specific review | Do not delete these rows or overwrite their feature codes |
| Undifferentiated administrative features `ADMD` / `ADMDH` | 1,104 `ADMD` and 7 `ADMDH` among admin1-unresolved records; 5 `ADMD` in admin2-unresolved records | Keep level **UNRESOLVED_UNDIFFERENTIATED** unless a country-specific source rule establishes its level | Do not infer admin1/admin2 level from the crosswalk column alone |
| Populated-place and non-administrative feature types (`PPL`, `PPLX`, `PPLL`, `PPLH`, `PCLI`, `ZN`, etc.) with unresolved admin code | Present in admin1 exception export | Preserve the geographic entity and its feature type; represent administrative association as unresolved independently of entity validity | Do not classify a populated place as invalid merely because its admin reference is absent |
| Same-name records with different GeoNames IDs | Repeated names occur in sample | Preserve distinct IDs and feature/admin context; require an explicit authority-backed crosswalk to combine identities | Do not deduplicate or merge by name alone |

GeoNames feature definitions are documented in the official [GeoNames Feature Codes reference](https://www.geonames.org/export/codes.html), which defines `PCLI` as an independent political entity and distinguishes current administrative levels from historical and undifferentiated ones. Feature codes provide entity/level context; they do not alone establish that any individual candidate is a semantically correct parent.

## 4. Approved review-status semantics

Use hierarchy-resolution statuses independently from record and selector status. These labels are approved for documentation and review; they are not yet a claim that the application schema or runtime behavior implements them:

- `RESOLVED_CANDIDATE_REVIEW_REQUIRED` — exact key and source candidate are present, but parentage is not yet approved.
- `UNRESOLVED_PLACEHOLDER_CODE` — conservative review bucket for a raw administrative value that does not safely resolve hierarchy. For GeoNames admin1 code `00`, the official README documents general-feature semantics (no specific admin1 code defined); this status does **not** imply the source record is malformed or invalid. The current Japan parent-path audit uses the more specific status `BLOCKED_RAW_ADMIN1_00_GENERAL_FEATURE_ANCESTOR_UNRESOLVED`.
- `UNRESOLVED_MISSING_OR_VERSION_DEPENDENT_REFERENCE` — nonzero code has no exact match in the current crosswalk snapshot.
- `UNRESOLVED_MISSING_ADMIN1_CONTEXT` — required context for a composite admin2 key is absent.
- `UNRESOLVED_HISTORICAL_FEATURE_POLICY` — source feature is historical and its product treatment has not been approved.
- `UNRESOLVED_UNDIFFERENTIATED_LEVEL` — administrative feature does not specify its level.
- `PARENTAGE_APPROVED` — only after a reviewed country-specific hierarchy rule and complete path evidence are recorded.

Do not use `INVALID` as a synonym for any unresolved status. If eventually implemented, each status needs a controlled definition, transition rule, reviewer/evidence provenance, and regression test.

## 5. Minimum parent-link acceptance checklist

A future parent link should not be eligible for automatic approval unless all relevant conditions hold:

1. The child record and raw country/admin codes are preserved and structurally valid.
2. The exact composite key resolves uniquely in the source-pinned crosswalk snapshot.
3. The target GeoNames ID exists uniquely in the same source snapshot and belongs to the expected country and administrative feature level.
4. The target record's own raw admin-code fields agree with the lookup key. The current audit checks this property for 43,765 resolved references with zero mismatches.
5. The parent candidate is not an inappropriate self-parent. Valid ADM1/ADM2 identity matches are recognized as identities, never as parent links.
6. The expected ancestor path is coherent under an explicit country-specific rule; every required level is either verified or documented as not applicable.
7. Historical/undifferentiated features, raw admin1 `00` general-feature codes, admin2-field raw `00` cases, and other missing/version-dependent references have an approved field-specific handling rule.
8. Parentage is source/version-pinned, reproducible, reviewable, and covered by synthetic tests.
9. Selectability is decided separately from parentage and follows owner-approved catalog policy.

Passing the first five checks does not automatically satisfy the ancestor-path, history, ISO, or selectability gates.

## 6. Owner decision recorded — 2026-10-11

The owner approved the conservative defaults for the first six decisions below. ISO source acquisition and worldwide completeness remain separate evidence gates.

| Decision | Approved conservative default or remaining gate | Status |
|---|---|---|
| Raw `00` handling | Leave unresolved; no normalization or parent link | **Approved conservative default** |
| Nonzero unmatched codes | Keep unresolved until version/format evidence is found | **Approved conservative default** |
| Historical admin features | Preserve; do not use as current parents/selectable current boundaries by default; keep historical identity | **Approved conservative default** |
| Undifferentiated `ADMD` / `ADMDH` | Keep level unresolved until evidence resolves the level | **Approved conservative default** |
| Populated places with unresolved admin codes | Preserve place identity; unresolved admin association remains separate | **Approved conservative default** |
| Selector default for unresolved or historical rows | Do not display unresolved, historical, or undifferentiated rows as current administrative choices by default; retain records and referenceability | **Approved conservative default** |
| Current official ISO snapshot | Obtain only from an approved, permitted source path; no paid acquisition without separate cost approval | **Unverified; separate source/cost gate** |
| Worldwide completeness/source pinning | Requires reproducible source evidence beyond the selected sample | **Unverified** |

## 7. Remaining acceptance blockers

The audit confirms candidate presence, feature-level consistency, and source-key consistency for the selected sample. The owner-approved disposition audit narrows the current administrative-selector parent-path review to 128 current `ADM3`/`ADM4` records (2 `ADM3`, 126 `ADM4`); other historical, undifferentiated and non-administrative records remain retained under the approved defaults. Catalog acceptance remains blocked pending:

- review/disposition of the 2,333 admin1 and 240 admin2 exception references (2,573 total). Five country-level `PCLI` records do not require an administrative parent under the approved disposition; the other 2,568 reference rows remain in hierarchy/association review, affecting 2,411 unique GeoNames IDs;
- complete country-specific parent-hierarchy path validation and source-backed approval of individual parent links;
- a current official ISO snapshot and deterministic comparison under permitted access terms; a paid subscription still requires separate cost authorization;
- independent verification of source origin/retrieval metadata and worldwide completeness.

**No database migration, seed, import, production deployment, Cloudflare change, or backup/recovery operation is authorized by this policy approval.** The policy defaults are approved; the catalog itself is not accepted, and parent links remain unassigned.
