#!/usr/bin/env python3
"""Conservative title-only Job Grid category suggestions for ISCO-08.

This is a triage helper, not an authoritative classification. Complete-word
matches are used; ambiguous and unmatched titles are retained for review.
The script never approves category assignments or activates occupations.
"""
from __future__ import annotations
import csv
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data/occupations/isco-08-unit-groups.csv"
JSON_PATH = ROOT / "public/data/occupations-isco08-review.json"
MANIFEST_PATH = ROOT / "data/occupations/isco-08-source-manifest.json"
README_PATH = ROOT / "data/occupations/README.md"
HTML_PATH = ROOT / "occupations-preview.html"
RULE_VERSION = "title_phrase_rules_v2"

RULES: dict[str, list[tuple[int, str, str]]] = {
    "agriculture-farming": [
        (5, r"\b(?:agriculture|agricultural|farm|farmer|farmers|farming|crop growers?|livestock|forestry|fishery|fisheries|horticulture|aquaculture|hunters?|trappers?|animal producers?|dairy producers?|tree and shrub crop growers|agricultural technicians?)\b",
         "Explicit agriculture, crop, livestock, forestry or fisheries wording"),
    ],
    "construction-building": [
        (5, r"\b(?:construction|bricklayers?|masons?|stonemasons?|concrete placers?|concrete finishers?|roofers?|plasterers?|tilers?|scaffolders?|glaziers?|house builders?|building inspectors?|building painters?|painters and related workers|spray painters and varnishers|carpenters?|joiners?|civil engineering labourers?|civil engineering laborers?)\b",
         "Explicit building, construction or building-trade wording"),
    ],
    "skilled-trades-repair": [
        (5, r"\b(?:electricians?|plumbers?|welders?|fitters?|machinists?|blacksmiths?|toolmakers?|mechanics?|locksmiths?|refrigeration mechanics?|air conditioning mechanics?|metal fabricators?|pipe fitters?|repairers?|repair technicians?|equipment repair|maintenance mechanics?|electronics mechanics?|electronic servicers?)\b",
         "Explicit trade, equipment repair or mechanical/electrical wording"),
    ],
    "driving-transport": [
        (5, r"\b(?:drivers?|driving instructors?|locomotive engine drivers?|railway brake|railway signal|aircraft pilots?|air traffic controllers?|ships?['’]?\s+deck officers?|pilots?|transport conductors?|transport clerks?|transport planners?|transport dispatchers?|fleet managers?|fleet coordinators?)\b",
         "Explicit driver, rail, aviation, maritime or transport-operation wording"),
    ],
    "warehouse-logistics": [
        (5, r"\b(?:warehouse|freight handlers?|cargo handlers?|logistics|inventory clerks?|stock clerks?|mail carriers?|sorting clerks?|clearing and forwarding|supply,? distribution and related managers?|supply chain|shipping clerks?|receiving clerks?|material handlers?|materials handlers?|distribution managers?)\b",
         "Explicit warehousing, freight, inventory or supply-chain wording"),
    ],
    "cleaning-housekeeping": [
        (6, r"\b(?:cleaners? and helpers in offices,? hotels? and other establishments|building structure cleaners?)\b",
         "Explicit cleaning-worker title"),
        (5, r"\b(?:cleaners?|cleaning|laundry|launderers?|janitors?|sanitation workers?|sweepers?|garbage collectors?|refuse collectors?|housekeepers?|housekeeping supervisors?)\b",
         "Explicit cleaning, laundry or housekeeping wording"),
    ],
    "security-safety": [
        (5, r"\b(?:security|police|firefighters?|fire services?|prison guards?|armed forces|military|protective services|customs and border inspectors?|detectives?|occupational safety|safety officers?|safety inspectors?|emergency response|lifeguards?)\b",
         "Explicit security, protective-service or occupational-safety wording"),
    ],
    "hospitality-tourism": [
        (5, r"\b(?:hotels?|tourism|tour guides?|travel consultants?|accommodation managers?|guest services?|concierges?|resorts?|cruise attendants?|travel attendants?|travel stewards?|conference and event planners?|recreation|cultural centre managers?|reservation agents?|bookmakers?|croupiers?)\b",
         "Explicit hospitality, travel, tourism or guest-service wording"),
    ],
    "food-service-catering": [
        (5, r"\b(?:chefs?|cooks?|waiters?|bartenders?|catering|restaurants?|food prepar(?:er|ers|ation)|bakers?|butchers?|pastry cooks?|confectionery|food and beverage|fishmongers?|food service|food graders?)\b",
         "Explicit food preparation, catering or restaurant-service wording"),
    ],
    "retail-sales": [
        (5, r"\b(?:salespersons?|sales representatives?|shopkeepers?|shop sales assistants?|retail|wholesale|cashiers?|buyers?|trade brokers?|stall and market salespersons?|commercial sales|sales managers?|sales workers?|selling)\b",
         "Explicit retail, shop or commercial-sales wording"),
    ],
    "customer-service": [
        (5, r"\b(?:contact centres?|contact centers?|call centres?|call centers?|customer service|customer support|telephone switchboard operators?|inquiry clerks?|enquiry clerks?|client information workers?|help desk representatives?)\b",
         "Explicit contact-centre, customer-service or enquiry wording"),
    ],
    "general-labour": [
        (5, r"\b(?:odd[- ]job persons?|general labourers?|general laborers?|street and related services workers?|refuse sorters?|water and firewood collectors?|elementary workers? not elsewhere classified|hand packers?)\b",
         "Explicit general-labour or elementary-worker wording"),
    ],
    "manufacturing-factory": [
        (5, r"\b(?:manufacturing|mining managers?|machine operators?|chemical processing|power production plant operators?|incinerators?|water treatment plant operators?|petroleum|natural gas refining|assemblers?|textile machine operators?|wood processing|production plant controllers?|factory workers?|metal production|manufacturing supervisors?)\b",
         "Explicit manufacturing, mining, processing, plant-operation or assembly wording"),
    ],
    "domestic-household-work": [
        (7, r"\b(?:domestic cleaners?|domestic housekeepers?|domestic helpers?|domestic workers?|home-based personal care workers?|household workers?|private households?)\b",
         "Explicit domestic, household or home-based-care wording"),
    ],
    "health-care-caregiving": [
        (5, r"\b(?:medical practitioners?|physicians?|doctors?|nurses?|nursing|midwifery|midwives?|dentists?|dental|pharmacists?|pharmacy|health services|health professionals?|clinical|paramedical|physiotherap\w*|veterinarians?|child care services managers?|personal care workers?|health care|medical assistants?|community health workers?|dispensing opticians?|ambulance workers?)\b",
         "Explicit health, clinical, nursing, veterinary or care-work wording"),
    ],
    "education-training": [
        (5, r"\b(?:teachers?|teaching|education|lecturers?|educators?|vocational education|special needs teachers?|school teachers?)\b",
         "Explicit teaching or education wording"),
    ],
    "office-administration": [
        (5, r"\b(?:office clerks?|office supervisors?|secretar(?:y|ies)|administrative secretaries|administrative|clerical|records clerks?|human resource managers?|personnel and careers professionals?|court clerks?|registry clerks?|government social benefits officials?|government licensing officials?)\b",
         "Explicit office, clerical, secretarial, personnel or administration wording"),
    ],
    "it-technology": [
        (6, r"\b(?:information and communications technology|ict|software|computer|programmers?|database|systems analysts?|system administrators?|telecommunications engineers?|web developers?|network administrators?|data processing|computer technicians?|cybersecurity)\b",
         "Explicit ICT, software, computing, data or telecommunications wording"),
    ],
    "finance-accounting": [
        (6, r"\b(?:accountants?|accounting|finance|financial|bankers?|banking|actuaries?|insurance|tax|credit and loans|investment advisers?|investment advisors?|securities and finance|payroll)\b",
         "Explicit accounting, banking, finance, insurance, tax or investment wording"),
    ],
    "engineering": [
        (5, r"\b(?:engineers?|engineering|architects?|architecture|surveyors?|surveying|draughtspersons?|cartographers?|urban planners?|town planners?|technical designers?|physicists?|astronomers?|chemists?|geologists?|geophysicists?|meteorologists?)\b",
         "Explicit engineering, architecture, surveying or technical-science wording"),
    ],
    "beauty-personal-care": [
        (5, r"\b(?:hairdressers?|barbers?|beauticians?|beauty|make[- ]up|pet groomers?)\b",
         "Explicit hairdressing, beauty or grooming wording"),
    ],
    "maintenance-facilities": [
        (5, r"\b(?:real estate agents?|property managers?|building caretakers?|caretakers?|facilities|pest control|fumigators?|groundskeepers?|estate agents?|building care)\b",
         "Explicit property, building-care, facilities or pest-control wording"),
    ],
    "marketing-communications": [
        (5, r"\b(?:marketing|advertising|public relations|journalists?|journalism|writers?|authors?|publishing|translators?|interpreters?|linguists?|graphic and multimedia designers?|photographers?|communications professionals?|broadcast)\b",
         "Explicit marketing, media, publishing or communications wording"),
    ],
    "professional-services": [
        (5, r"\b(?:legislators?|government officials?|lawyers?|legal|judges?|magistrates?|attorneys?|economists?|psychologists?|sociologists?|anthropologists?|religious|clergy|social workers?|social welfare managers?|policy and planning managers?|policy managers?|traditional chiefs?|professional services managers?|parliament)\b",
         "Explicit legal, policy, government, social-science or professional-service wording"),
    ],
}

def load_inputs():
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise SystemExit("FAIL: occupation CSV has no header")
        fields = list(reader.fieldnames)
        rows = [{key: (value or "") for key, value in row.items()} for row in reader]
    catalog = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    return fields, rows, catalog

def assign(title: str, category_names: dict[str, str]) -> dict[str, Any]:
    found = []
    for slug, rules in RULES.items():
        hits = [
            {"score": score, "reason": explanation}
            for score, expression, explanation in rules
            if re.search(expression, title, flags=re.IGNORECASE)
        ]
        if hits:
            best = max(hits, key=lambda hit: hit["score"])
            found.append({
                "slug": slug, "name": category_names[slug],
                "score": best["score"], "reason": best["reason"],
            })
    found.sort(key=lambda item: (-item["score"], item["slug"]))
    if not found:
        return {
            "slug": "", "name": "", "status": "manual_review_required",
            "reason": "No sufficiently specific whole-word title rule matched; retain for manual review.",
            "options": [], "kind": "no_rule",
        }
    top_score = found[0]["score"]
    close = [item for item in found if top_score - item["score"] < 2]
    if len(close) > 1 or top_score < 5:
        choices = close if len(close) > 1 else found
        choice_text = ", ".join(
            f'{item["name"]} (rule score {item["score"]})' for item in choices[:4]
        )
        return {
            "slug": "", "name": "", "status": "manual_review_required",
            "reason": f"More than one plausible category or no strong winner ({choice_text}); retain for manual review.",
            "options": choices[:4], "kind": "ambiguous" if len(close) > 1 else "weak",
        }
    return {
        "slug": found[0]["slug"], "name": found[0]["name"],
        "status": "proposed_rule_match", "reason": found[0]["reason"],
        "options": [], "kind": "proposed",
    }

def main() -> None:
    fields, rows, catalog = load_inputs()
    if len(rows) != 436 or len(catalog.get("groups", [])) != 436:
        raise SystemExit("FAIL: expected exactly 436 unit-group records")
    category_names = {item["slug"]: item["name"] for item in catalog.get("jobGridCategories", [])}
    if not category_names or not set(RULES).issubset(category_names):
        raise SystemExit("FAIL: a mapping rule uses an unknown Job Grid category slug")
    by_code = {row.get("isco08_code", "").strip(): row for row in rows}
    groups_by_code = {group.get("code", "").strip(): group for group in catalog["groups"]}
    if len(by_code) != 436 or set(by_code) != set(groups_by_code):
        raise SystemExit("FAIL: CSV and JSON do not contain the same 436 codes")

    stats = {"proposed": 0, "ambiguous": 0, "weak": 0, "no_rule": 0}
    distribution = {}
    for code, row in by_code.items():
        group = groups_by_code[code]
        result = assign(row.get("canonical_title_en", ""), category_names)
        row["proposed_job_grid_category_slug"] = result["slug"]
        row["proposed_category_name"] = result["name"]
        row["mapping_method"] = RULE_VERSION
        row["mapping_status"] = result["status"]
        row["mapping_reason"] = result["reason"]
        options = [
            {"slug": item["slug"], "name": item["name"], "score": item["score"]}
            for item in result["options"]
        ]
        row["mapping_options"] = json.dumps(options, ensure_ascii=False, separators=(",", ":"))
        group["proposedCategorySlug"] = result["slug"] or None
        group["proposedCategoryName"] = result["name"] or None
        group["mappingMethod"] = RULE_VERSION
        group["mappingStatus"] = result["status"]
        group["mappingReason"] = result["reason"]
        group["suggestedCategoryOptions"] = options
        group["mappingConfidence"] = "suggestion_only" if result["slug"] else "manual_review"
        stats[result["kind"]] += 1
        if result["slug"]:
            distribution[result["slug"]] = distribution.get(result["slug"], 0) + 1

    manual_count = stats["ambiguous"] + stats["weak"] + stats["no_rule"]
    catalog["mapping_summary"] = {
        "proposed_category_mappings": stats["proposed"],
        "manual_mapping_review_required": manual_count,
        "ambiguous_manual_review_required": stats["ambiguous"],
        "weak_or_unmatched_manual_review_required": stats["weak"] + stats["no_rule"],
        "mapping_method": RULE_VERSION,
        "mapping_approved": False,
        "source_verified_records": 436,
    }
    catalog["mapping_audit"] = {
        "method": RULE_VERSION,
        "basis": "occupation title only; whole-word/phrase matches; no substring matching",
        "proposed_suggestions": stats["proposed"],
        "manual_review_total": manual_count,
        "ambiguous_manual_review": stats["ambiguous"],
        "weak_match_manual_review": stats["weak"],
        "no_rule_manual_review": stats["no_rule"],
        "distribution_by_category_slug": dict(sorted(distribution.items())),
        "approved": False,
        "note": "This is a triage suggestion set, not an authoritative mapping. Human approval is required before import or activation.",
    }

    if any(
        row.get("job_grid_category_slug", "").strip()
        or row.get("category_mapping_status") != "pending"
        or row.get("source_verification_status") != "verified_source_match"
        or row.get("publicly_active") != "false"
        for row in rows
    ):
        raise SystemExit("FAIL: a formal category slug, verification state or active flag changed")

    fields = list(dict.fromkeys(fields + ["mapping_options"]))
    with CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, quoting=csv.QUOTE_ALL, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    JSON_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest.update({
        "category_mapping_status": "suggested_not_approved",
        "category_mapping_method": RULE_VERSION,
        "proposed_category_mappings": stats["proposed"],
        "manual_mapping_review_required": manual_count,
        "ambiguous_manual_review_required": stats["ambiguous"],
        "weak_or_unmatched_manual_review_required": stats["weak"] + stats["no_rule"],
        "production_import_authorized": False,
        "public_visibility_authorized": False,
        "note": "Official ILO code/title matching is complete. Conservative title-rule suggestions remain unapproved; unclear records require human review. No occupation is active or a vacancy.",
    })
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    readme = README_PATH.read_text(encoding="utf-8")
    readme = re.sub(
        r"\n{2,}## Conservative category mapping audit \\(latest\\)\n.*?(?=\n## |\Z)",
        "",
        readme,
        flags=re.DOTALL,
    )
    readme = re.sub(
        r"\n{2,}## Proposed Job Grid category mappings\n.*?(?=\n## |\Z)",
        "",
        readme,
        flags=re.DOTALL,
    )
    readme = re.sub(
        r"^Every record is labelled.*$",
        f"Every record is labelled verified_source_match for official ILO code/title/hierarchy fields. "
        f"Conservative title-rule suggestions: {stats['proposed']}; manual review required: {manual_count}. "
        "Formal category fields remain unset and all records remain inactive.",
        readme,
        count=1,
        flags=re.MULTILINE,
    )
    readme = re.sub(
        r"## Next steps\n.*?(?=\n## |\Z)",
        "## Next steps\n\n"
        f"1. Review the {stats['proposed']} title-rule category suggestions and resolve the "
        f"{stats['ambiguous'] + stats['weak'] + stats['no_rule']} records retained for human review.\n"
        "2. Review the 496 starter-title crosswalk candidate list; every candidate remains pending human review.\n"
        "3. Add occupation aliases only when supported by an official source or a reviewed decision.\n"
        "4. Prepare a data-only migration only after PR #45 and the live recovery/security gates are resolved and explicitly approved.",
        readme,
        count=1,
        flags=re.DOTALL,
    )
    readme += (
        "\n\n## Conservative category mapping audit (latest)\n\n"
        f"- Rule set: {RULE_VERSION} (whole-word/phrase matches on occupation title only).\n"
        f"- Suggested category matches: {stats['proposed']}.\n"
        f"- Manual review required: {manual_count} ({stats['ambiguous']} ambiguous, "
        f"{stats['weak']} weak, {stats['no_rule']} with no rule match).\n"
        "- The earlier substring-oriented suggestions were replaced because matching bus inside "
        "business or roof inside proofreading can create false matches.\n"
        "- Suggestions remain unapproved. The formal job_grid_category_slug is blank and "
        "category_mapping_status remains pending for every record.\n"
    )
    README_PATH.write_text(readme, encoding="utf-8")

    html = HTML_PATH.read_text(encoding="utf-8")
    old = "Job Grid category suggestions are generated by title-keyword rules and still need human review."
    new = "Job Grid category suggestions use conservative whole-word title rules; ambiguous and unmatched titles are sent to manual review."
    html = html.replace(old, new)
    HTML_PATH.write_text(html, encoding="utf-8")

    print(json.dumps({
        "result": "PASS",
        "method": RULE_VERSION,
        "total": len(rows),
        "suggested_category_matches": stats["proposed"],
        "manual_review_required": manual_count,
        "ambiguous_manual_review": stats["ambiguous"],
        "weak_match_manual_review": stats["weak"],
        "no_rule_manual_review": stats["no_rule"],
        "mapping_approved": False,
        "formal_category_slugs_assigned": 0,
        "publicly_active_records": 0,
        "distribution_by_category_slug": dict(sorted(distribution.items())),
    }, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
