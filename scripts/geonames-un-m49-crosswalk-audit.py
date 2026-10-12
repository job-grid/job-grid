#!/usr/bin/env python3
"""Compare GeoNames country codes to ISO alpha codes displayed in official UN M49.

UN M49 numeric codes are kept separate; they are not treated as ISO numeric-3 proof.
This is a read-only cross-check, not automatic code replacement or catalog acceptance.
"""
from __future__ import annotations
import argparse, csv, hashlib, html, json, re, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

GEONAMES_URL = "https://download.geonames.org/export/dump/countryInfo.txt"
M49_URL = "https://unstats.un.org/unsd/methodology/m49/overview/"
A2 = re.compile(r"^[A-Z]{2}$")
A3 = re.compile(r"^[A-Z]{3}$")
N3 = re.compile(r"^[0-9]{3}$")
ID = re.compile(r"^[0-9]+$")


def clean(v):
    return " ".join(html.unescape(v).replace("\xa0", " ").split())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table" and self.table is None:
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag in ("br", "p", "div") and self.cell is not None:
            self.cell.append(" ")

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.row is not None and self.cell is not None:
            self.row.append(clean("".join(self.cell)))
            self.cell = None
        elif tag == "tr" and self.table is not None and self.row is not None:
            if any(self.row):
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def parse_m49(source, minimum_rows=200):
    parser = Tables()
    parser.feed(source)
    required = {"country or area", "m49 code", "iso-alpha2 code", "iso-alpha3 code"}
    candidates = []
    for table in parser.tables:
        for i, row in enumerate(table):
            positions = {clean(x).casefold(): j for j, x in enumerate(row)}
            if not required.issubset(positions):
                continue
            output = []
            for data in table[i + 1:]:
                if max(positions.values()) >= len(data):
                    continue
                name = clean(data[positions["country or area"]])
                n = clean(data[positions["m49 code"]])
                a2 = clean(data[positions["iso-alpha2 code"]]).upper()
                a3 = clean(data[positions["iso-alpha3 code"]]).upper()
                if not (A2.fullmatch(a2) and A3.fullmatch(a3)):
                    continue  # regional aggregates do not have ISO alpha codes
                if not name or not N3.fullmatch(n):
                    raise ValueError("Invalid coded country/area row in UN M49 table.")
                output.append({"name": name, "m49_code": n, "alpha2": a2, "alpha3": a3})
            candidates.append(output)
    if not candidates:
        raise ValueError("Expected UN M49 country/area table was not found.")
    rows = max(candidates, key=len)
    if len(rows) < minimum_rows:
        raise ValueError(f"UN M49 coded rows={len(rows)}; expected at least {minimum_rows}.")
    for field in ("alpha2", "alpha3", "m49_code"):
        if any(n > 1 for n in Counter(r[field] for r in rows).values()):
            raise ValueError(f"Duplicate {field} identifiers in UN M49.")
    return rows


def parse_geonames(source):
    rows, malformed = [], 0
    for line_no, line in enumerate(source.splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        f = line.split("\t")
        if len(f) != 19 or not f[4].strip() or not ID.fullmatch(f[16].strip()):
            malformed += 1
            continue
        rows.append({"name": f[4].strip(), "geonames_id": f[16].strip(),
                     "alpha2": f[0].strip().upper(), "alpha3": f[1].strip().upper(),
                     "numeric3": f[2].strip(), "line": str(line_no)})
    if malformed:
        raise ValueError(f"GeoNames countryInfo malformed rows={malformed}.")
    if not rows:
        raise ValueError("GeoNames countryInfo has no rows.")
    return rows


def idx(rows, field):
    out = defaultdict(list)
    for row in rows:
        if row.get(field):
            out[row[field]].append(row)
    return out




EXPECTED_SOURCE_EXCEPTIONS = {
    "831053": {"name": "Kosovo", "alpha2": "XK", "alpha3": "XKX", "numeric3": "0", "role": "current_destination_area"},
    "1668284": {"name": "Taiwan", "alpha2": "TW", "alpha3": "TWN", "numeric3": "158", "role": "current_destination_area"},
    "8505033": {"name": "Serbia and Montenegro", "alpha2": "CS", "alpha3": "SCG", "numeric3": "891", "role": "historical_reference"},
    "8505032": {"name": "Netherlands Antilles", "alpha2": "AN", "alpha3": "ANT", "numeric3": "530", "role": "historical_reference"},
}


def validate_exception_dispositions(manifest, geo_rows):
    """Fail closed if live out-of-M49 GeoNames rows lack exact curated dispositions."""
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("records"), list):
        raise ValueError("Exception disposition manifest schema is invalid.")
    records = manifest["records"]
    by_id = {str(row.get("geonames_id", "")): row for row in records}
    if len(by_id) != len(records) or set(by_id) != set(EXPECTED_SOURCE_EXCEPTIONS):
        raise ValueError("Exception manifest must contain each of the four reviewed source IDs exactly once.")
    geo_by_id = {str(row["geonames_id"]): row for row in geo_rows}
    if len(geo_by_id) != len(geo_rows):
        raise ValueError("GeoNames countryInfo contains duplicate source IDs.")
    for geonames_id, expected in EXPECTED_SOURCE_EXCEPTIONS.items():
        record = by_id[geonames_id]
        source_codes = record.get("source_codes", {})
        actual = geo_by_id.get(geonames_id)
        if not actual:
            raise ValueError(f"Expected exception ID {geonames_id} is absent from live GeoNames countryInfo.")
        if actual["name"] != expected["name"] or any(
            str(actual[field]) != expected[field] for field in ("alpha2", "alpha3", "numeric3")
        ):
            raise ValueError(f"Live source identity/code tuple changed for exception ID {geonames_id}; review required.")
        if record.get("geonames_name") != expected["name"] or record.get("catalog_role") != expected["role"]:
            raise ValueError(f"Curated exception identity/role mismatch for ID {geonames_id}.")
        if any(str(source_codes.get(field, "")) != expected[field]
               for field in ("alpha2", "alpha3", "numeric3")):
            raise ValueError(f"Curated raw source-code tuple changed for ID {geonames_id}.")
        if not record.get("source_urls") or not any("unstats.un.org/unsd/methodology/m49" in u for u in record["source_urls"]):
            raise ValueError(f"Official UN M49 context source is required for exception ID {geonames_id}.")
        if record.get("sovereignty_claim") is not False:
            raise ValueError(f"Destination/historical catalog treatment must not imply a sovereignty claim: {geonames_id}.")
        if record.get("catalog_role") == "current_destination_area":
            if record.get("status") != "active" or record.get("selectable_as_destination") is not True:
                raise ValueError(f"Current destination area must stay searchable/selectable under the approved geography-default policy: {geonames_id}.")
            if not record.get("canonical_display_name"):
                raise ValueError(f"Current destination area needs a display label: {geonames_id}.")
            iso = record.get("iso_codes", {})
            if not isinstance(iso, dict):
                raise ValueError(f"ISO fields must be explicitly represented for {geonames_id}.")
            if geonames_id == "831053":
                if any(iso.get(k) is not None for k in ("alpha2", "alpha3", "numeric3")):
                    raise ValueError("Kosovo's GeoNames XK/XKX/0 source values must not be populated as ISO fields.")
                if "412" not in record.get("m49_disposition", ""):
                    raise ValueError("Kosovo disposition must preserve the distinct M49 statistical-code caveat.")
            if geonames_id == "1668284":
                if (iso.get("alpha2"), iso.get("alpha3"), iso.get("numeric3")) != ("TW", "TWN", "158"):
                    raise ValueError("Taiwan ISO tuple/source corroboration must be explicit and exact.")
                if not any("iso.org" in u and "newsletter.pdf" in u for u in record.get("source_urls", [])):
                    raise ValueError("Taiwan code corroboration must reference the official ISO newsletter evidence.")
                if "not downloaded" not in record.get("iso_code_policy", "").lower():
                    raise ValueError("Current ISO catalogue snapshot limitation must remain explicit for Taiwan.")
        elif record.get("catalog_role") == "historical_reference":
            if record.get("status") != "historical_inactive" or record.get("selectable_as_destination") is not False:
                raise ValueError(f"Historical entity must be inactive and nonselectable: {geonames_id}.")
            if not record.get("valid_to") or any(record.get("iso_codes", {}).get(k) is not None
                                                 for k in ("alpha2", "alpha3", "numeric3")):
                raise ValueError(f"Historical identifiers must not be exposed as current ISO fields: {geonames_id}.")
            if not record.get("historical_successor_context"):
                raise ValueError(f"Historical successor context is required for ID {geonames_id}.")
    return by_id




def validate_complete_reconciliation(geo_rows, m49_rows, dispositions):
    """Require an exact one-to-one set between live out-of-M49 tuples and dispositions."""
    m49_pairs = {(r["alpha2"], r["alpha3"]) for r in m49_rows}
    live_unmatched = {str(r["geonames_id"]) for r in geo_rows
                      if (r["alpha2"], r["alpha3"]) not in m49_pairs}
    disposition_ids = set(dispositions)
    if live_unmatched != disposition_ids:
        missing = sorted(live_unmatched - disposition_ids)
        stale = sorted(disposition_ids - live_unmatched)
        raise ValueError(
            "Exception disposition ledger must exactly equal live GeoNames tuples absent from M49; "
            f"undocumented={missing}; stale_or_now_matched={stale}."
        )
    return {"live_unmatched_source_ids": len(live_unmatched), "disposition_rows": len(disposition_ids)}



def build_country_destination_candidates(geo_rows, m49_rows, dispositions, sources, require_full_source_counts=True):
    """Build a source-reconciled candidate package; it is never operationally enabled."""
    m49_by_pair = {(r["alpha2"], r["alpha3"]): r for r in m49_rows}
    records = []
    for source_row in geo_rows:
        source_id = str(source_row["geonames_id"])
        pair = (source_row["alpha2"], source_row["alpha3"])
        m49_row = m49_by_pair.get(pair)
        if m49_row:
            if source_row["numeric3"] != m49_row["m49_code"]:
                raise ValueError(f"GeoNames numeric code conflicts with the UN numeric code for exact alpha-pair ID {source_id}.")
            records.append({
                "record_key": "geonames:" + source_id,
                "geonames_id": source_id,
                "canonical_display_name_candidate": m49_row["name"],
                "geonames_source_name": source_row["name"],
                "catalog_role": "country_area_destination",
                "entity_kind": "m49_country_or_area",
                "record_status_candidate": "active",
                "proposed_selectable_as_destination": True,
                "operational_selectable": False,
                "sovereignty_claim": False,
                "iso_code_candidates": {"alpha2": m49_row["alpha2"], "alpha3": m49_row["alpha3"], "numeric3": m49_row["m49_code"]},
                "iso_code_evidence_status": "UN_M49_ISO_ALPHA_PAIR_EXACT__NUMERIC_ASSIGNED_BY_UN_AND_MATCHES_GEONAMES__DIRECT_ISO_COLLECTION_REFRESH_PENDING",
                "iso_numeric3_candidate_from_geonames": source_row["numeric3"],
                "m49_current_code": m49_row["m49_code"],
                "m49_current_row_present": True,
                "source_codes_preserved": {"alpha2": source_row["alpha2"], "alpha3": source_row["alpha3"], "numeric3": source_row["numeric3"]},
                "source_identity_status": "EXACT_ALPHA2_ALPHA3_PAIR",
                "disposition_status": "MATCHED",
                "valid_to": None,
                "historical_successor_context": [],
                "classification_note": "Selectable as an operational destination is proposed as a geography feature, not an assertion of sovereignty or immigration eligibility. ISO numeric-3 has not been independently refreshed from a live ISO source in this audit."
            })
            continue
        decision = dispositions.get(source_id)
        if not decision:
            raise ValueError(f"Cannot build candidate package with an undocumented source-code exception: {source_id}.")
        current = decision["catalog_role"] == "current_destination_area"
        records.append({
            "record_key": "geonames:" + source_id,
            "geonames_id": source_id,
            "canonical_display_name_candidate": decision["canonical_display_name"],
            "geonames_source_name": source_row["name"],
            "catalog_role": decision["catalog_role"],
            "entity_kind": "geographic_destination_area" if current else "historical_reference",
            "record_status_candidate": decision["status"],
            "proposed_selectable_as_destination": decision["selectable_as_destination"],
            "operational_selectable": False,
            "sovereignty_claim": False,
            "iso_code_candidates": decision["iso_codes"],
            "iso_code_evidence_status": (
                "ISO_NEWSLETTER_CORROBORATION__DIRECT_ISO_COLLECTION_REFRESH_PENDING"
                if source_id == "1668284" else
                "NO_CURRENT_ISO_TUPLE_ASSIGNED__GEONAMES_CODES_RETAINED_SOURCE_ONLY"
                if source_id == "831053" else
                "HISTORICAL_SOURCE_CODES_ONLY__NOT_CURRENT_ISO_FIELDS"
            ),
            "iso_numeric3_candidate_from_geonames": source_row["numeric3"],
            "m49_current_code": None,
            "m49_current_row_present": False,
            "m49_context_note": decision["m49_disposition"],
            "source_codes_preserved": {"alpha2": source_row["alpha2"], "alpha3": source_row["alpha3"], "numeric3": source_row["numeric3"]},
            "source_identity_status": "SOURCE_CODE_TUPLE_PRESERVED__EXCEPTION_DISPOSITION_DOCUMENTED",
            "disposition_status": "DOCUMENTED",
            "valid_to": decision.get("valid_to"),
            "historical_successor_context": decision.get("historical_successor_context", []),
            "classification_note": decision.get("relationship_policy", decision.get("iso_code_policy", "Conservative geography-only disposition; no sovereignty claim."))
        })
    ids = [r["geonames_id"] for r in records]
    if len(ids) != len(set(ids)) or len(records) != len(geo_rows):
        raise ValueError("Candidate package must contain each source countryInfo ID exactly once.")
    current = [r for r in records if r["record_status_candidate"] == "active"]
    historic = [r for r in records if r["record_status_candidate"] == "historical_inactive"]
    if sum(r["m49_current_row_present"] for r in records) != len(m49_rows):
        raise ValueError("Not all UN M49 coded country/area rows joined to exactly one candidate source record.")
    if require_full_source_counts and (len(geo_rows) != 252 or len(m49_rows) != 248 or len(current) != 250 or len(historic) != 2):
        raise ValueError("Unexpected live country/area package counts; full-source reconciliation needs review.")
    return {
        "schema_version": 1,
        "package_type": "country-area-destination-catalog-candidate",
        "generated_at_utc": now(),
        "status": "SOURCE_RECONCILED_CANDIDATE_ONLY__NOT_IMPORTED",
        "sources": sources,
        "counts": {
            "source_country_info_rows": len(geo_rows),
            "un_m49_coded_country_area_rows": len(m49_rows),
            "m49_exact_pair_rows": sum(r["m49_current_row_present"] for r in records),
            "current_destination_candidates": len(current),
            "historical_reference_rows_nonselectable": len(historic),
            "total_source_records_accounted_for": len(records),
            "source_tuple_exceptions_documented": sum(r["disposition_status"] == "DOCUMENTED" for r in records),
            "operational_selectable_rows": sum(r["operational_selectable"] for r in records),
            "unresolved_country_area_identities": 0
        },
        "policy": {
            "iso_alpha2_alpha3": "Use the exact alpha-code pair exposed in the UN M49 table only where that row exists; special-area records preserve their separately evidenced fields.",
            "iso_numeric3": "Candidate is populated from the UN M49 numeric value for exact alpha-2/alpha-3 matches only when the GeoNames numeric tuple also agrees; source provenance is recorded. Kosovo remains null, Taiwan uses separately corroborated ISO newsletter evidence, historical rows remain null, and a current ISO OBP/Country Codes Collection refresh is still pending.",
            "historical_rows": "Retained for history/reference, never selectable as a current destination.",
            "destination_vs_sovereignty": "The destination selector is a geographic product behavior, not a sovereignty or immigration-eligibility decision.",
            "selectability_applied_to_live_system": False,
            "database_or_production_changes": False
        },
        "records": sorted(records, key=lambda r: (r["catalog_role"] == "historical_reference", r["canonical_display_name_candidate"].casefold(), r["geonames_id"]))
    }

def reconcile(geo, m49, sources, dispositions=None):
    m49_pairs = {(r["alpha2"], r["alpha3"]): r for r in m49}
    geo_pairs = {(r["alpha2"], r["alpha3"]): r for r in geo
                 if A2.fullmatch(r["alpha2"]) and A3.fullmatch(r["alpha3"])}
    ma2, ma3 = idx(m49, "alpha2"), idx(m49, "alpha3")
    ga2, ga3 = idx(geo, "alpha2"), idx(geo, "alpha3")
    detail = []
    exact, missing, a2conf, a3conf, numeric_equal, numeric_mismatch = 0, 0, 0, 0, 0, 0
    for r in geo:
        pair = (r["alpha2"], r["alpha3"])
        m = m49_pairs.get(pair)
        if m:
            exact += 1
            if r["numeric3"] != m["m49_code"]:
                state, numeric_mismatch = "ALPHA_PAIR_MATCH_NUMERIC3_CONFLICT", numeric_mismatch + 1
            else:
                state = "MATCHED_ALPHA2_ALPHA3_PAIR"
                numeric_equal += 1
        elif A2.fullmatch(pair[0]) and ma2.get(pair[0]):
            state, a2conf = "ALPHA2_MATCH_ALPHA3_CONFLICT", a2conf + 1
        elif A3.fullmatch(pair[1]) and ma3.get(pair[1]):
            state, a3conf = "ALPHA3_MATCH_ALPHA2_CONFLICT", a3conf + 1
        else:
            state, missing = "GEONAMES_CODE_PAIR_NOT_PRESENT_IN_UN_M49", missing + 1
        detail.append({"source_side":"GeoNames countryInfo", "name":r["name"],
            "geonames_id":r["geonames_id"], "alpha2":r["alpha2"], "alpha3":r["alpha3"],
            "numeric3":r["numeric3"], "comparison_m49_code":m["m49_code"] if m else "",
            "comparison_name":m["name"] if m else "", "match_status":state})
    mexact, mmissing = 0, 0
    for r in m49:
        pair = (r["alpha2"], r["alpha3"])
        g = geo_pairs.get(pair)
        if g:
            state, mexact = "MATCHED_ALPHA2_ALPHA3_PAIR", mexact + 1
        elif ga2.get(pair[0]):
            state, mmissing = "ALPHA2_MATCH_ALPHA3_CONFLICT", mmissing + 1
        elif ga3.get(pair[1]):
            state, mmissing = "ALPHA3_MATCH_ALPHA2_CONFLICT", mmissing + 1
        else:
            state, mmissing = "UN_M49_PAIR_NOT_PRESENT_IN_GEONAMES_COUNTRY_INFO", mmissing + 1
        detail.append({"source_side":"UN M49", "name":r["name"], "geonames_id":"",
            "alpha2":r["alpha2"], "alpha3":r["alpha3"], "numeric3":"",
            "comparison_m49_code":r["m49_code"], "comparison_name":g["name"] if g else "",
            "match_status":state})

    def dup(rows, field):
        c = Counter(r[field] for r in rows if r.get(field))
        return sum(n > 1 for n in c.values())
    pairs = Counter((r["alpha2"], r["alpha3"]) for r in geo)
    dup_pairs = sum(n > 1 for n in pairs.values())
    duplicates = dup_pairs + dup(geo,"alpha2") + dup(geo,"alpha3") + dup(m49,"alpha2") + dup(m49,"alpha3")
    disposition_by_id = dispositions or {}
    documented = 0
    undocumented = 0
    current_destination_exceptions = 0
    historical_exceptions = 0
    for row in detail:
        if row.get("source_side") != "GeoNames countryInfo" or row.get("match_status") == "MATCHED_ALPHA2_ALPHA3_PAIR":
            continue
        decision = disposition_by_id.get(str(row.get("geonames_id", "")))
        if decision:
            row["exception_disposition_status"] = "DOCUMENTED"
            row["catalog_role"] = decision["catalog_role"]
            row["catalog_status"] = decision["status"]
            row["selectable_as_destination"] = decision["selectable_as_destination"]
            row["canonical_display_name"] = decision["canonical_display_name"]
            row["exception_source_codes_preserved"] = True
            documented += 1
            if decision["catalog_role"] == "current_destination_area":
                current_destination_exceptions += 1
            elif decision["catalog_role"] == "historical_reference":
                historical_exceptions += 1
        else:
            row["exception_disposition_status"] = "UNDOCUMENTED_REQUIRES_REVIEW"
            undocumented += 1
    structural = duplicates > 0
    code_conflicts = a2conf + a3conf + mmissing + numeric_mismatch
    unresolved = undocumented + code_conflicts
    verified = all(x.get("http_status") == 200 and re.fullmatch(r"[a-f0-9]{64}", x.get("sha256",""))
                   for x in sources.values())
    if structural:
        status = "BLOCKED_STRUCTURAL_SOURCE_ISSUES"
    elif numeric_mismatch:
        status = "BLOCKED_NUMERIC_CODE_CONFLICTS"
    elif unresolved:
        status = "BLOCKED_UNDOCUMENTED_OR_CONFLICTING_CODE_ROWS"
    elif missing and dispositions:
        status = "PASS_ALPHA_CODE_CROSSCHECK_WITH_DOCUMENTED_EXCEPTIONS"
    elif missing or code_conflicts:
        status = "PASS_ALPHA_CODE_CROSSCHECK_WITH_REVIEW_ITEMS"
    else:
        status = "PASS_ALPHA_CODE_CROSSCHECK"
    report = {
      "schema_version":1, "audit":"geonames-country-info-vs-official-un-m49-iso-alpha-codes",
      "generated_at_utc":now(), "status":status,
      "sources":sources,
      "counts":{
        "geonames_country_info_rows":len(geo), "un_m49_country_area_rows":len(m49),
        "geonames_exact_alpha2_alpha3_pair_matches":exact, "un_m49_exact_alpha2_alpha3_pair_matches":mexact,
        "geonames_pairs_not_present_in_un_m49":missing, "geonames_alpha2_match_alpha3_conflicts":a2conf,
        "geonames_alpha3_match_alpha2_conflicts":a3conf, "un_m49_pairs_missing_or_conflicting":mmissing,
        "geonames_numeric3_equals_un_m49_numeric_code_on_exact_pairs":int(numeric_equal),
        "alpha2_alpha3_matched_but_numeric_code_conflicts":numeric_mismatch,
        "numeric3_equals_m49_code_diagnostic_only":int(numeric_equal), "duplicate_code_groups":duplicates,
        "documented_exception_rows":documented, "undocumented_exception_rows":undocumented,
        "current_destination_area_exceptions":current_destination_exceptions,
        "historical_reference_exceptions":historical_exceptions,
        "periodic_direct_iso_source_refresh_items":sum(1 for item in (dispositions or {}).values() if item.get("geonames_id") == "1668284"),
        "unresolved_code_review_items":unresolved,
        "review_items":unresolved},
      "interpretation":{
        "source_retrieval_metadata_verified":verified,
        "identity_join":"exact alpha-2 + alpha-3 pair; names are not identity keys",
        "un_m49_numeric_code_is_iso_numeric3":"CANDIDATE_WHERE_EXACT_ALPHA_PAIR_AND_GEONAMES_NUMERIC_MATCH",
        "numeric_code_basis":"ISO states the numeric country code is assigned by the UN; for an exact UN M49 alpha-2/alpha-3 match, the M49 numeric value is the UN-issued numeric-code candidate when GeoNames' numeric value agrees.",
        "direct_iso_country_codes_collection_snapshot":"NOT_CAPTURED_BY_THIS_AUDIT",
        "automatic_code_replacement_authorized":False,
        "source_code_exception_dispositions":"PASS" if dispositions and undocumented == 0 else "NOT_PERFORMED",
        "catalog_acceptance":"CODE_EXCEPTIONS_ACCOUNTED_FOR; PLACE_HIERARCHY_AND_WORLDWIDE_DESTINATION_COVERAGE_REMAIN_OPEN",
        "worldwide_destination_completeness":"NOT_ESTABLISHED",
        "database_or_production_changes":False},
      "limitations":[
        "UN M49 is an official UN reference that displays ISO-assigned alpha-2/alpha-3 codes; it is not an ISO Country Codes Collection download.",
        "M49 numeric identifiers are not treated as proof of ISO numeric-3 conformity.",
        "The four non-matching tuples are accounted for by a versioned conservative disposition file; source tuples are not rewritten.",
        "Taiwan's ISO tuple has older official ISO-newsletter corroboration; a live ISO OBP/collection snapshot is not included in this audit.",
        "Code reconciliation does not establish administrative parentage or worldwide destination completeness."]}
    return report, detail


def check_manifest(manifest_path, geopath, m49path):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_key = {x.get("key"): x for x in manifest.get("sources", [])}
    result = {}
    for key, path, url in (
        ("geoNames_country_info", geopath, GEONAMES_URL),
        ("un_m49_overview", m49path, M49_URL)):
        e = by_key.get(key)
        raw = path.read_bytes()
        if not e or e.get("source_url") != url or e.get("http_status") != 200:
            raise ValueError(f"Invalid source retrieval metadata: {key}.")
        if e.get("sha256") != digest(raw) or e.get("size_bytes") != len(raw):
            raise ValueError(f"SHA-256/size mismatch: {key}.")
        result[key] = {"source_url":url, "retrieved_at_utc":e.get("retrieved_at_utc"),
          "http_status":e.get("http_status"), "http_last_modified_header":e.get("http_last_modified_header"),
          "etag":e.get("etag"), "size_bytes":len(raw), "sha256":digest(raw)}
    return result


def write_report(report, rows, out, catalog_package=None):
    out.mkdir(parents=True, exist_ok=True)
    (out/"country-area-code-crosswalk-aggregate.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    (out/"country-area-code-crosswalk-rows.json").write_text(json.dumps(rows,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    fields=[
        "source_side","name","geonames_id","alpha2","alpha3","numeric3",
        "comparison_m49_code","comparison_name","match_status",
        "exception_disposition_status","catalog_role","catalog_status",
        "selectable_as_destination","canonical_display_name","exception_source_codes_preserved",
    ]
    with (out/"country-area-code-crosswalk-rows.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)
    if catalog_package is not None:
        (out/"country-area-destination-catalog-candidate.json").write_text(
            json.dumps(catalog_package,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        catalog_fields=[
            "record_key","geonames_id","canonical_display_name_candidate","geonames_source_name",
            "catalog_role","entity_kind","record_status_candidate","proposed_selectable_as_destination",
            "operational_selectable","sovereignty_claim","iso_alpha2_candidate","iso_alpha3_candidate","iso_numeric3_candidate",
            "iso_code_evidence_status","source_alpha2","source_alpha3","source_numeric3","iso_numeric3_candidate_from_geonames",
            "m49_current_code","m49_current_row_present","source_identity_status","disposition_status","valid_to","classification_note"
        ]
        with (out/"country-area-destination-catalog-candidate.csv").open("w",newline="",encoding="utf-8") as f:
            writer=csv.DictWriter(f,fieldnames=catalog_fields); writer.writeheader()
            for r in catalog_package["records"]:
                writer.writerow({
                    "record_key":r["record_key"],"geonames_id":r["geonames_id"],
                    "canonical_display_name_candidate":r["canonical_display_name_candidate"],
                    "geonames_source_name":r["geonames_source_name"],"catalog_role":r["catalog_role"],
                    "entity_kind":r["entity_kind"],"record_status_candidate":r["record_status_candidate"],
                    "proposed_selectable_as_destination":r["proposed_selectable_as_destination"],
                    "operational_selectable":r["operational_selectable"],"sovereignty_claim":r["sovereignty_claim"],
                    "iso_alpha2_candidate":r["iso_code_candidates"].get("alpha2"),"iso_alpha3_candidate":r["iso_code_candidates"].get("alpha3"),
                    "iso_numeric3_candidate":r["iso_code_candidates"].get("numeric3"),"iso_code_evidence_status":r["iso_code_evidence_status"],
                    "source_alpha2":r["source_codes_preserved"]["alpha2"],"source_alpha3":r["source_codes_preserved"]["alpha3"],
                    "source_numeric3":r["source_codes_preserved"]["numeric3"],
                    "iso_numeric3_candidate_from_geonames":r["iso_numeric3_candidate_from_geonames"],
                    "m49_current_code":r["m49_current_code"],"m49_current_row_present":r["m49_current_row_present"],
                    "source_identity_status":r["source_identity_status"],"disposition_status":r["disposition_status"],
                    "valid_to":r["valid_to"],"classification_note":r["classification_note"]
                })


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--country-info",required=True,type=Path)
    p.add_argument("--m49-html",required=True,type=Path)
    p.add_argument("--source-manifest",required=True,type=Path)
    p.add_argument("--exception-dispositions",required=True,type=Path)
    p.add_argument("--output-dir",required=True,type=Path)
    a=p.parse_args(argv)
    try:
        sources=check_manifest(a.source_manifest,a.country_info,a.m49_html)
        geo=parse_geonames(a.country_info.read_text(encoding="utf-8-sig"))
        m49=parse_m49(a.m49_html.read_text(encoding="utf-8"))
        exception_manifest=json.loads(a.exception_dispositions.read_text(encoding="utf-8"))
        dispositions=validate_exception_dispositions(exception_manifest,geo)
        reconciliation_gate=validate_complete_reconciliation(geo,m49,dispositions)
        report,rows=reconcile(geo,m49,sources,dispositions)
        catalog_package=build_country_destination_candidates(geo,m49,dispositions,sources)
    except (OSError,UnicodeError,json.JSONDecodeError,ValueError) as exc:
        print(f"BLOCKED_COUNTRY_AREA_CODE_AUDIT: {type(exc).__name__}: {exc}",file=sys.stderr); return 2
    write_report(report,rows,a.output_dir,catalog_package)
    print(json.dumps({"status":report["status"],"counts":report["counts"]},indent=2))
    return 1 if report["status"].startswith("BLOCKED_") else 0

if __name__=="__main__":
    raise SystemExit(main())
