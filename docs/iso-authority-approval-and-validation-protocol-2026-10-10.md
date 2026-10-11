# ISO authority approval and compliant validation protocol — 2026-10-10

## Owner decision recorded

On 2026-10-10, the owner approved the proposed ISO authority source for the Job Grid country-code review: the official [ISO 3166 Country Codes page](https://committee.iso.org/iso-3166-country-codes.html) and its linked [ISO Online Browsing Platform (OBP)](https://www.iso.org/obp/ui/).

This records approval of the *source choice*. It does not mean a snapshot has been acquired or compared, and it does not authorize a paid subscription, use of a third-party mirror as if it were ISO, or any database/deployment action.

## Important ISO usage boundary

The official [ISO 3166 country-codes page](https://committee.iso.org/iso-3166-country-codes.html) says ISO 3166 codes are available through the OBP and that free-of-charge use of ISO country codes is allowed. The same page also expressly says that, outside content made available through ISO Open Data and subject to its terms, ISO content may not be used for AI or similar technologies, including by prompting AI tools to generate responses.

The current [ISO Open Data catalogue](https://committee.iso.org/open-data.html) describes datasets for ISO deliverable metadata, technical committees, and the International Classification for Standards (ICS); it does not currently list the ISO 3166 country-code list as an Open Data dataset.

Therefore, for this validation:
- Do not paste, upload, or commit the ISO source snapshot, source rows, country names, or individual code tuples into an AI tool.
- Obtain/use the source under the access and usage terms shown by ISO. Do not purchase a paid collection unless the owner separately authorizes the cost.
- Run the comparison as deterministic local code. The comparator added in `scripts/compare-iso3166-current-codes.py` does not download or transmit the source and defaults to an aggregate-only JSON report. Its optional row-level details can contain specific code values and must remain local/private.
- Only the aggregate report (counts, comparison status, source filename/size/hash and verified retrieval metadata, without names or code tuples) may be considered for repository documentation. The raw snapshot and detailed mismatch file must stay outside Git.
- If the official source cannot be obtained in a machine-readable format without additional permission/payment, stop at that blocker rather than scraping, bypassing access controls, or substituting an unofficial mirror for ISO authority.

## Local comparison procedure

1. Obtain the current **ISO 3166-1 country-code list only** through the official ISO source. Do not mix in ISO 3166-2 subdivision codes or ISO 3166-3 formerly used codes. Preserve the original downloaded file locally and keep it outside the repository.
2. Record the true source URL and actual retrieval timestamp. Record an HTTP `Last-Modified` value only if a server response header was really captured; never substitute local filesystem modification time.
3. On a trusted local machine, run the comparator against the source CSV and the already downloaded GeoNames `countryInfo.txt` file. Adjust the three column-header flags to match the exact headers in the local ISO CSV:

   `python scripts/compare-iso3166-current-codes.py --iso-csv "C:\path\outside-repo\iso3166-1-current.csv" --country-info "C:\Users\jonat\OneDrive\Desktop\JobGrid-GeoNames\countryInfo.txt.txt" --output "C:\path\outside-repo\iso-comparison-summary.json" --source-url "OFFICIAL_ISO_SOURCE_URL" --retrieved-at-utc "ACTUAL_UTC_TIMESTAMP" --alpha2-column "Alpha-2 code" --alpha3-column "Alpha-3 code" --numeric-column "Numeric code" --private-details-path "C:\path\outside-repo\iso-comparison-details-private.csv"`

   The text in uppercase is a placeholder, not a real URL or timestamp. Replace it with captured evidence. Do not run against an HTML page renamed `.csv`.
4. Review the aggregate JSON locally. Any nonzero code-conflict counts, invalid snapshot rows, or duplicate ISO identifiers block a clean result. GeoNames-only codes remain review candidates; they are not automatically invalid. A clean comparison of shared fields is not itself approval to change catalog values or hierarchy.
5. Keep the source file and optional detail CSV outside Git. Never send the source rows or detail file to an AI assistant. After owner review, a privacy-safe aggregate report may be documented in PR #27 with the original snapshot hash and truthful provenance.

## Latest acquisition check — 2026-10-11

The official ISO 3166 page was checked for a permitted machine-readable source. It distinguishes the freely viewable Online Browsing Platform from the paid **Country Codes Collection**, which offers the current official lists in CSV, XML and XLS and is listed at **CHF 300 per year**. ISO also permits free-of-charge use of ISO country codes, but that is not evidence that the current downloadable collection itself is free. See the official [ISO 3166 page](https://committee.iso.org/iso-3166-country-codes.html) and [Country Codes Collection product page](https://committee.iso.org/cms/live/live/en/sites/isoorg/contents/data/publication/50/00/PUB500001.html).

**Disposition: STOP AT THE ACCESS/COST GATE.** No subscription was purchased, no authenticated collection download was attempted, and no machine-readable ISO snapshot was acquired or compared. The owner previously approved the source choice, not a paid subscription. Do not scrape the OBP, bypass access controls, or substitute a third-party mirror as ISO authority. If the owner separately authorizes the listed subscription cost, or identifies an official machine-readable snapshot that is available under terms permitting this use, perform the deterministic comparison locally and retain only aggregate results in Git. Keep any source file and row-level details outside Git and out of AI tools.

This acquisition check closes no code/hierarchy gate; ISO comparison remains **UNVERIFIED** and catalog acceptance remains **BLOCKED**.

## Result and current gate

**Owner approval of source choice: RECORDED.**  
**Current ISO snapshot captured and hashed: NOT YET VERIFIED.**  
**Deterministic snapshot comparison: NOT YET RUN.**  
**Catalog acceptance: BLOCKED pending source evidence, code review and remaining hierarchy/feature decisions.**

PR #27 must remain open, draft and unmerged. No migrations, seeds, imports, production/Cloudflare/secrets, backup/recovery or deployment changes are authorized by this source approval.
