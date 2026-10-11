# Japan identity collision review — 2026-10-11

**Disposition: candidate-level findings recorded; no administrative parent paths approved.** This review separates name matching from GeoNames entity identity. It uses the captured GeoNames coordinates and the official Ministry of Land, Infrastructure, Transport and Tourism (MLIT) administrative-code lists to audit selected name collisions. It does not write operational hierarchy data.

## Reproducibility

- PR branch code head reviewed: `cdfec51b700122f837dcd6032bfd4f3014892ea4`.
- [Phase 0 CI #393](https://github.com/job-grid/job-grid/actions/runs/38103790293): passed, **98 tests passed / 0 failed**. GeoNames Japan, Kenya, global-source, parent-path, migration, repository-integrity, dependency, and secret checks passed.
- [Full Japan identity/candidate evidence artifact](https://github.com/job-grid/job-grid/actions/runs/38103790293/artifacts/11688463721), available until 2026-10-18. It contains all 126 records, source coordinates, current raw codes, row-level candidate/period data, source response snapshots, and manifests.
- GeoNames Japan source archive `JP.zip`: SHA-256 `f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58`; HTTP 200; archive integrity passed; all 126 selected IDs matched the retrieved source name, country, feature code and raw administrative codes.
- e-Stat code-history query: 14,741 source rows; 156 candidate/history periods retrieved for 35 area-code candidates; combined response SHA-256 `ca52a59ef64294e9af01c303ebad7f4408ac0156031c885538e4aeb6f4c17f33`.

## 1. Takaoka-chō — reject code 45381 as the entity crosswalk for both targets

The exact-normalized-name audit returned e-Stat area code `45381` for both GeoNames IDs. MLIT's official administrative-code list identifies code `45381` as **Miyazaki Prefecture, Higashimorokata-gun, Takaoka-machi**; its parent code `45380` is Higashimorokata-gun. See the [official MLIT administrative-code list](https://nlftp.mlit.go.jp/ksj/jpgis/codelist/AdminAreaCd.html).

The current GeoNames source instead gives two distinct target points:

| GeoNames ID | GeoNames name | Source latitude | Source longitude |
|---|---|---:|---:|
| `1851030` | Takaoka-chō | 35.18333 | 138.65 |
| `1851031` | Takaoka-chō | 35.03333 | 137.08333 |

Those coordinates are in central Honshu, not the Miyazaki entity described by code `45381`. **Disposition: reject `45381` as the entity crosswalk candidate for IDs `1851030` and `1851031`.** This is a rejection of this specific name-derived candidate—not a claim that the two GeoNames IDs are duplicates, and not approval of a replacement administrative parent. Both records remain unresolved until their actual area-code/entity chains are independently identified.

## 2. Kawanishi-machi — two name matches conflict with the target's coordinate context

GeoNames ID `1859673` has source coordinate `36.1412, 136.14017`. The name-only audit returned two different historical municipality candidates:

- `06382`: MLIT's 1990 administrative-code list identifies this as Yamagata Prefecture, Higashiokitama-gun, Kawanishi-machi; its parent-area code is `06380`.
- `15481`: MLIT's administrative-code list identifies this as Niigata Prefecture, Nakauonuma-gun, Kawanishi-machi; its parent-area code is `15480`.

Official source pages: [MLIT 1990 administrative-code list](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_901001.html) and [MLIT administrative-code list](https://nlftp.mlit.go.jp/ksj/jpgis/codelist/AdminAreaCd.html).

These are named municipal entities in Yamagata and Niigata, while the GeoNames target coordinate lies substantially west of those candidate prefectures. **Disposition: neither code is approved; both are flagged as geographic-scope conflicts pending explicit verification against an authoritative boundary/identity source.** The candidate list must not be resolved by choosing whichever candidate sounds closest to the name.

## 3. Asahi-mura — three GeoNames IDs share the same five namesake codes

The audit records three different GeoNames IDs and three distinct source coordinates:

| GeoNames ID | Latitude | Longitude |
|---|---:|---:|
| `1865064` | 37.21667 | 138.38333 |
| `1865066` | 35.96667 | 139.88333 |
| `1865067` | 35.96667 | 138.0 |

The exact-normalized-name search returned the same five distinct official codes for each ID. The historical MLIT code lists identify these as different municipalities in five prefectural/district contexts:

| e-Stat code | Official MLIT entity description | e-Stat parent code |
|---|---|---|
| `06427` | Yamagata Prefecture, Higashitagawa-gun, Asahi-mura | `06420` |
| `08401` | Ibaraki Prefecture, Kashima-gun, Asahi-mura | `08400` |
| `15584` | Niigata Prefecture, Iwafune-gun, Asahi-mura | `15580` |
| `20451` | Nagano Prefecture, Higashichikuma-gun, Asahi-mura | `20440` |
| `21607` | Gifu Prefecture, Ono-gun, Asahi-mura | `21600` |

The prefectural and district labels are source-backed in MLIT's [1990 administrative-code list](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_901001.html), [1975 administrative-code list](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_751001.html), and [MLIT administrative-code list](https://nlftp.mlit.go.jp/ksj/jpgis/codelist/AdminAreaCd.html).

**Disposition: all 15 target-to-code candidate pairs remain unresolved.** The code/name list shows that these are real namesakes, but does not provide a GeoNames ID crosswalk. The three target coordinates are distinct, while the candidate generator is name-based and consequently offers all five codes for each target. An authoritative dated boundary or other direct entity-identity source is still needed to disambiguate them.

## Machine-readable dispositions

[Download/open the 19-row identity-collision review CSV](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-identity-collision-review-2026-10-11.csv). It records the source point, candidate area code, official MLIT code description, review status and reason for each Takaoka, Kawanishi and Asahi candidate pair.

## What changed operationally?

Nothing was written to operational hierarchy. The review explicitly rejects the two Takaoka name-only matches, flags both Kawanishi candidates for geometric/identity confirmation, and keeps all 15 Asahi candidates unresolved. The broader 126-record parent-path audit remains blocked. The GeoNames raw admin1 value `00` is preserved for all affected records. No database, migration, seed, import, production, deployment, or merge was performed.

This review is a candidate-triage step. It does not mark the Japanese catalog accepted; the official ISO 3166-1 comparison and original sample-selection reproduction remain separate blocked gates.
