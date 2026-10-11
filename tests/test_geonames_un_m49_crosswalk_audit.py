import importlib.util
import unittest
from pathlib import Path

script_path = Path(__file__).resolve().parents[1] / "scripts" / "geonames-un-m49-crosswalk-audit.py"
spec = importlib.util.spec_from_file_location("geonames_un_m49_crosswalk_audit", script_path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
parse_geonames, parse_m49, reconcile = audit.parse_geonames, audit.parse_m49, audit.reconcile


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


if __name__=="__main__":
    unittest.main()
