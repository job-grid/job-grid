# GeoNames country archive sample validation

**Current disposition: BLOCKED — official source downloads could not be retrieved in the available isolated workspace.** This directory intentionally contains no source archive and makes no measured source-record claims.

## Exact sources

The JSON manifest lists five small country archives (KE, GB, JP, BR, SG), countryInfo.txt, admin1CodesASCII.txt, admin2Codes.txt and readme.txt with exact URLs. GeoNames' published database terms identify the database as CC BY 4.0; preserve attribution and verify the applicable notice for each distribution before redistribution.

## Reproducible rerun

1. In an isolated staging workspace, download each exact URL in `source-manifest.json`. Capture retrieval timestamp, HTTP status, byte size and SHA-256; never claim a timestamp or checksum until the bytes are actually obtained.
2. Create `expected-sha256.json` mapping all nine filenames to `{ "sha256": "<observed sha256>" }`.
3. Run:

   ```sh
   python3 scripts/geonames-sample-validator.py \
     --source-dir /path/to/staged-source \
     --output-dir /path/to/results \
     --expected-manifest /path/to/expected-sha256.json
   ```

4. The script stops before parsing if any file is missing or any SHA-256 fails to match. It tests ZIP CRCs, reports measured raw/accepted/quarantined counts, duplicate GeoNames IDs, candidate feature-code counts, country metadata candidate coverage and exceptions. It has no database connection code.
5. Review all exceptions and feature mapping with the owner. This is not authorization to seed or import anything.

## Limits

- Current ISO comparisons are against the source's GeoNames `countryInfo.txt` candidates only. `iso_authority_verified` remains false until a separately approved and source-pinned ISO authority data extract is added.
- The requested source set does not include `alternateNamesV2.zip`; the script makes no alternate-name completeness claim.
- Parent relationships must be reconciled by country context, admin codes and source IDs. Names alone are not keys. Any unresolved parent or source mapping must remain quarantined; no invented city parents.
- The proposed feature-code mapping is conservative and is not owner-approved policy.
- Sample results cannot imply worldwide coverage.

## Retrieval failure observed

At 2026-10-10T11:21:52Z, all nine official `download.geonames.org/export/dump/` URLs failed in the isolated workspace with `URLError: <urlopen error [Errno -3] Temporary failure in name resolution>`. Retries to `www.geonames.org/export/zip/KE.zip` and the official `readme.txt` URL failed with the same DNS resolution error. `source-manifest.json` and `results/validation-report.json` record that failure. No archives were retrieved, so SHA-256, ZIP integrity and record counts are unavailable—not zero.
