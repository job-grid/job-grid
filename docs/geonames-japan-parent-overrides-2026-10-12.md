# Japan parent paths — source-backed catalog overrides (2026-10-12)

**Two current administrative paths are proposed for source-backed inclusion. CI revalidates each path from live, source-pinned official files; operational parent links remain at zero.** The historic 128-row exclusion CSV is not modified.

| GeoNames target | Official e-Stat target area | Direct parent | GeoNames parent |
|---|---|---|---|
| [Tawaramoto-chō, ID 1850471](https://www.geonames.org/1850471/tawaramoto-cho.html) | \`29363\`, 田原本町 | \`29360\`, Shiki-gun / 磯城郡 | [ID 1852501](https://www.geonames.org/1852501/shiki-gun.html), ADM2 |
| [Tatsuno-machi, ID 1850496](https://www.geonames.org/1850496/tatsuno-machi.html) | \`20382\`, 辰野町 | \`20380\`, Kamiina-gun / 上伊那郡 | [ID 1860552](https://www.geonames.org/1860552/kamiina-gun.html), ADM2 |

The CI validator verifies target source identity and raw code \`00\`; one exact English e-Stat code candidate and an open-ended period; the direct e-Stat parent reference; matching point containment in the official 1995 MLIT boundary; the exact complete Japanese parent alternate name on one GeoNames ADM2 candidate; and unique grandparent code consistency with no competing parent namesake. Any drift fails closed.

The effective exclusion overlay is regenerated from this manifest and the Kenya Imenti override: the three source-backed targets are removed from the exclusion list, while Kiambururu and 124 other Japanese records remain excluded. No operational parent edges, source mutations, migrations, seeds, imports, production or deployment changes occur.

## Sources
- [MLIT current administrative-area code list](https://nlftp.mlit.go.jp/ksj/jpgis/codelist/AdminAreaCd.html)
- [MLIT historic N03 boundary archive index](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_2.html)
- [e-Stat Tawaramoto-cho period](https://data.e-stat.go.jp/lod/sac/C29363-19700401) and [Shiki-gun parent](https://data.e-stat.go.jp/lod/sac/C29360-19700401)
- [e-Stat Tatsuno-machi period](https://data.e-stat.go.jp/lod/sac/C20382-19700401) and [Kamiina-gun parent](https://data.e-stat.go.jp/lod/sac/C20380-19700401)
