import importlib.util
import json
import unittest
from pathlib import Path

script_path = Path(__file__).resolve().parents[1] / "scripts" / "geonames-un-m49-crosswalk-audit.py"
spec = importlib.util.spec_from_file_location("geonames_un_m49_crosswalk_audit", script_path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
parse_geonames, parse_m49, reconcile = audit.parse_geonames, audit.parse_m49, audit.reconcile
validate_exception_dispositions = audit.validate_exception_dispositions
EXCEPTION_MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "docs" / "geonames-un-m49-exception-dispositions-2026-10-12.json").read_text(encoding="utf-8"))


def row(a2, a3, n3, name, gid):
    return "\t".join([a2,a3,n3,"",name,"","","","","","","","","","","",gid,"",""])


class CrosswalkTests(unittest.TestCase):
    def test_m49_parse_ignores_aggregate_without_iso_codes(self):
        source = """<table><tr><th>Country or Area</th><th>M49 Code</th><th>ISO-alpha2 Code</th><th>ISO-alpha3 Code</th></tr>
        <tr><td>Kenya</td><td>404</td><td>KE</td><td>KEN</td></tr>
        <tr><td>World</td><td>001</td><td></td><td></td></tr>
        <tr><td>United Kingdom</td><td>826</td><td>GB</td><td>GBR</td></tr></table>"""
        out = parse_m49(source, minimum_rows=2)
        self.assertEqual([x["alpha2"] for x in out], ["KE","GB"])

    def test_nonstandard_geo_pair_is_reviewed_not_changed(self):
        geo = parse_geonames("\n".join([row("KE","KEN","404","Kenya","1"),
            row("GB","GBR","826","United Kingdom","2"),row("XK","XKX","0","Kosovo","3")]))
        m49 = [{"name":"Kenya","m49_code":"404","alpha2":"KE","alpha3":"KEN"},
               {"name":"United Kingdom","m49_code":"826","alpha2":"GB","alpha3":"GBR"}]
        report, details = reconcile(geo,m49,{})
        self.assertEqual(report["counts"]["geonames_exact_alpha2_alpha3_pair_matches"],2)
        xk = next(x for x in details if x["source_side"]=="GeoNames countryInfo" and x["name"]=="Kosovo")
        self.assertEqual(xk["match_status"],"GEONAMES_CODE_PAIR_NOT_PRESENT_IN_UN_M49")
        self.assertFalse(report["interpretation"]["automatic_code_replacement_authorized"])
        self.assertFalse(report["interpretation"]["un_m49_numeric_code_is_iso_numeric3"])

    def test_alpha2_match_with_conflicting_alpha3_is_flagged(self):
        geo = parse_geonames(row("KE","KEX","404","Kenya","1"))
        m49 = [{"name":"Kenya","m49_code":"404","alpha2":"KE","alpha3":"KEN"}]
        report, details = reconcile(geo,m49,{})
        self.assertEqual(report["counts"]["geonames_alpha2_match_alpha3_conflicts"],1)
        self.assertTrue(any(x["match_status"]=="ALPHA2_MATCH_ALPHA3_CONFLICT" for x in details))

    def test_parser_fails_closed_when_expected_table_missing(self):
        with self.assertRaises(ValueError):
            parse_m49("<html><p>no table</p></html>",minimum_rows=1)


    def test_four_un_m49_exceptions_have_explicit_conservative_dispositions(self):
        rows = [
            row("XK","XKX","0","Kosovo","831053"),
            row("TW","TWN","158","Taiwan","1668284"),
            row("CS","SCG","891","Serbia and Montenegro","8505033"),
            row("AN","ANT","530","Netherlands Antilles","8505032"),
        ]
        geo = parse_geonames("\n".join(rows))
        decisions = validate_exception_dispositions(EXCEPTION_MANIFEST, geo)
        self.assertEqual(set(decisions), {"831053","1668284","8505033","8505032"})
        self.assertTrue(decisions["831053"]["selectable_as_destination"])
        self.assertTrue(decisions["1668284"]["selectable_as_destination"])
        self.assertFalse(decisions["8505033"]["selectable_as_destination"])
        self.assertFalse(decisions["8505032"]["selectable_as_destination"])
        self.assertIsNone(decisions["831053"]["iso_codes"]["alpha2"])
        self.assertEqual(decisions["1668284"]["iso_codes"]["alpha2"], "TW")

    def test_missing_exception_disposition_fails_closed(self):
        rows = [
            row("XK","XKX","0","Kosovo","831053"),
            row("TW","TWN","158","Taiwan","1668284"),
            row("CS","SCG","891","Serbia and Montenegro","8505033"),
            row("AN","ANT","530","Netherlands Antilles","8505032"),
        ]
        geo = parse_geonames("\n".join(rows))
        copy = json.loads(json.dumps(EXCEPTION_MANIFEST))
        copy["records"] = copy["records"][:-1]
        with self.assertRaisesRegex(ValueError, "exactly once"):
            validate_exception_dispositions(copy, geo)

    def test_documented_exceptions_pass_without_rewriting_codes(self):
        rows = [
            row("KE","KEN","404","Kenya","1"),
            row("GB","GBR","826","United Kingdom","2"),
            row("XK","XKX","0","Kosovo","831053"),
            row("TW","TWN","158","Taiwan","1668284"),
            row("CS","SCG","891","Serbia and Montenegro","8505033"),
            row("AN","ANT","530","Netherlands Antilles","8505032"),
        ]
        geo = parse_geonames("\n".join(rows))
        m49 = [
            {"name":"Kenya","m49_code":"404","alpha2":"KE","alpha3":"KEN"},
            {"name":"United Kingdom","m49_code":"826","alpha2":"GB","alpha3":"GBR"},
        ]
        decisions = validate_exception_dispositions(EXCEPTION_MANIFEST, geo)
        report, detail = reconcile(geo, m49, {}, decisions)
        self.assertEqual(report["status"], "PASS_ALPHA_CODE_CROSSCHECK_WITH_DOCUMENTED_EXCEPTIONS")
        self.assertEqual(report["counts"]["documented_exception_rows"], 4)
        self.assertEqual(report["counts"]["undocumented_exception_rows"], 0)
        self.assertEqual(report["counts"]["current_destination_area_exceptions"], 2)
        self.assertEqual(report["counts"]["historical_reference_exceptions"], 2)
        self.assertFalse(report["interpretation"]["automatic_code_replacement_authorized"])
        for r in detail:
            if r.get("source_side") == "GeoNames countryInfo" and r.get("geonames_id") in decisions:
                self.assertEqual(r["exception_source_codes_preserved"], True)


if __name__=="__main__":
    unittest.main()
