# GeoNames unresolved hierarchy and feature-selectability policy — proposal for owner review

**Status: DRAFT / NOT APPROVED.**  
**Purpose:** define a conservative review rule for unresolved administrative codes and historical/undifferentiated feature types observed in PR #27.  
**Scope:** documentation and decision support only. This proposal does not alter source data, assign parent IDs, create migrations/seeds, import records, change production, or approve catalog acceptance.

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

## 3. Proposed default treatment matrix

These are recommendations for explicit owner review, not approved production rules.

| Case | Evidence seen | Proposed conservative treatment | Must not do |
|---|---|---|---|
| Exact admin1 crosswalk key, candidate present as same-country `ADM1` | Key and candidate checks pass in sample | Mark the crosswalk candidate as **resolved for review**; keep parent link unapproved until country-level hierarchy policy is approved | Do not treat code consistency alone as approval to assign a parent |
| Exact admin2 composite key, candidate present as same-country `ADM2` | Composite key and candidate checks pass in sample | Mark the crosswalk candidate as **resolved for review**; require the admin1 context and approved parent-path rule | Do not assign a parent based only on name, proximity, or candidate presence |
| Raw admin code `00` | Placeholder/nonstandard candidate; 2,284 admin1 and 2 admin2 cases | Preserve raw value and source row; mark **UNRESOLVED_PLACEHOLDER_CODE**; require a documented country/feature rule before hierarchy use | Do not silently convert `00` to blank, zero, a real code, or a synthetic parent |
| Nonzero code with no exact crosswalk key | 49 admin1 plus 237 admin2 cases are currently classified missing/version-dependent | Preserve raw code; compare source version and country-specific format; keep **UNRESOLVED_MISSING_OR_VERSION_DEPENDENT_REFERENCE** until evidenced | Do not label the code legacy or invalid without source/version evidence |
| Admin2 code exists but admin1 context is blank | One admin2 case | Preserve both raw fields; mark **UNRESOLVED_MISSING_ADMIN1_CONTEXT**; do not generate a composite lookup key | Do not guess admin1 context from name or a neighboring record |
| Historical administrative feature codes `ADM1H`–`ADM4H` | 952 rows in admin1-unresolved records; 235 historical administrative rows in admin2-unresolved records | Preserve identity and history; propose an explicit historical status and prohibit use as a current administrative parent by default until owner review; allow a legacy display/search policy to be decided separately | Do not delete these rows or overwrite their feature codes |
| Undifferentiated administrative features `ADMD` / `ADMDH` | 1,104 `ADMD` and 7 `ADMDH` among admin1-unresolved records; 5 `ADMD` in admin2-unresolved records | Keep level **UNRESOLVED_UNDIFFERENTIATED** unless a country-specific source rule establishes its level | Do not infer admin1/admin2 level from the crosswalk column alone |
| Populated-place and non-administrative feature types (`PPL`, `PPLX`, `PPLL`, `PPLH`, `PCLI`, `ZN`, etc.) with unresolved admin code | Present in admin1 exception export | Preserve the geographic entity and its feature type; represent administrative association as unresolved independently of entity validity | Do not classify a populated place as invalid merely because its admin reference is absent |
| Same-name records with different GeoNames IDs | Repeated names occur in sample | Preserve distinct IDs and feature/admin context; require an explicit authority-backed crosswalk to combine identities | Do not deduplicate or merge by name alone |

GeoNames feature definitions are documented in the official [GeoNames Feature Codes reference](https://www.geonames.org/export/codes.html). Feature codes provide descriptive context; they do not alone establish that a specific row is current, invalid, selectable, or a valid parent for another row.

## 4. Proposed review statuses

Use hierarchy-resolution statuses independently from record and selector status. Suggested values:

- `RESOLVED_CANDIDATE_REVIEW_REQUIRED` — exact key and source candidate are present, but parentage is not yet approved.
- `UNRESOLVED_PLACEHOLDER_CODE` — source uses a placeholder/nonstandard code such as raw `00`.
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
7. Historical/undifferentiated features and placeholder/nonstandard codes have an approved handling rule.
8. Parentage is source/version-pinned, reproducible, reviewable, and covered by synthetic tests.
9. Selectability is decided separately from parentage and follows owner-approved catalog policy.

Passing the first five checks does not automatically satisfy the ancestor-path, history, ISO, or selectability gates.

## 6. Decisions requiring owner approval

| Decision | Conservative proposed default | Current state |
|---|---|---|
| Raw `00` handling | Leave unresolved; no normalization or parent link | Not approved |
| Nonzero unmatched codes | Keep unresolved until version/format evidence is found | Not approved |
| Historical admin features | Preserve; do not use as current parents/selectable current boundaries by default | Not approved |
| Undifferentiated `ADMD` / `ADMDH` | Keep level unresolved until evidence resolves the level | Not approved |
| Populated places with unresolved admin codes | Preserve place identity; unresolved admin association remains separate | Not approved |
| Selector default for unresolved or historical rows | Do not display as current administrative options until explicit selection policy approves it; retain non-destructive record and referenceability | Not approved |
| Current official ISO snapshot | Obtain only from an approved, permitted source path; no paid acquisition without separate cost approval | Unverified |
| Worldwide completeness/source pinning | Requires reproducible source evidence beyond the selected sample | Unverified |

## 7. Acceptance remains blocked

The current audit confirms candidate presence, feature-level consistency, and source-key consistency for the selected sample, but the following are not complete:

- 2,333 unresolved admin1 references and 240 unresolved admin2 key/context cases;
- owner approval of placeholder, historical, undifferentiated, and selectability policies;
- complete country-specific parent-hierarchy path validation;
- a current official ISO snapshot and deterministic comparison under approved access terms;
- independent verification of source origin and worldwide completeness.

**No database migration, seed, import, production deployment, Cloudflare change, or backup/recovery operation is authorized by this proposal.** The proposal is documentation for owner review and must remain unapproved until the decisions above are explicitly accepted.
