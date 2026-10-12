# Japan native e-Stat period graph — proposal (2026-10-12)

**Status:** Source-derived historical hierarchy proposal; review-only. It is not a current nationwide catalog, database seed, selector configuration, or approved GeoNames crosswalk.

## Why this is the next step

The Japan audit has verified 126 GeoNames source identities and raw administrative codes. The 1995 MLIT spatial-first review found containing polygons for 120 of those targets, producing 105 distinct e-Stat area-code candidates and 120 target-to-area-code associations. The corresponding official e-Stat detail retrieval reconciled 557 historical code-period records. These source facts support building a native e-Stat history view, but do not prove a GeoNames record and an e-Stat administrative unit are the same entity.

The permanent design should therefore represent Japanese source-native units and their dated parent references in the e-Stat namespace independently of GeoNames. An unresolved GeoNames ID must not erase an official Japanese unit from a future reconciled catalog, and a spatial/name candidate must not silently become an identity crosswalk.

## Generated proposal

The CI workflow builds a deterministic, source-fingerprinted graph from the official e-Stat spatial-first period-history report and manifest:

- **Source-period nodes** keyed by exact e-Stat period URI, retaining five-digit code, English/Japanese labels, effective dates, previous/succeeding period URIs, administrative-class references, and whether the published period covers 1995-10-01.
- **Parent-reference edges** retaining the exact parent period URI, code, labels, child period and evidence status. Multiple references remain ambiguous; invalid/self-references stay in an unresolved report. The graph never rewrites them into operational relationships.
- **Parent-reference-only stubs** for valid parent URIs outside the 105-code detailed history. These are marked as stubs, not fully detailed nodes or accepted canonical parent records.
- **GeoNames-to-area-code candidate associations** preserving raw admin1=00 and marking the 1995 spatial relation as context only, not entity identity.

The workflow artifact contains the JSON report and row-level CSVs for period nodes, source-declared parent edges, target/area-code candidates, and unresolved parent references. Each report includes SHA-256 fingerprints for the input report, detail manifest, e-Stat catalog snapshot, source catalog pages and detail-query batches.

## Acceptance boundary

Every record remains non-selectable. The output asserts zero verified GeoNames-to-e-Stat crosswalks, zero approved operational parent links and zero production changes. It does not claim the official 1995 geography is current, and the 105-code slice is not a complete Japanese national catalog. No database migrations, seeds, imports, deployment or production writes are triggered.

## Next acceptance gates

1. Review source licence/retention terms before any long-term storage of source snapshots.
2. Fetch and reconcile current e-Stat period histories and current MLIT boundaries separately from 1995 historical evidence.
3. Retrieve period details for referenced parent URIs and resolve multiple-parent or malformed-reference cases without discarding source evidence.
4. Approve stable internal unit identities and duplicate-prevention rules before deciding public selectability.
5. Keep GeoNames crosswalk verification as an independent decision; never infer identity from names, spatial containment, or the existence of an official parent reference.
6. Keep the ISO machine-readable snapshot comparison and actual backup/restore readiness as separate catalog acceptance gates.

No production or database change is made by this proposal.
