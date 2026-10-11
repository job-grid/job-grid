#!/usr/bin/env python3
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from importlib.util import spec_from_file_location, module_from_spec

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "geonames-japan-mlit-polygon-evidence-audit.py"
SPEC = spec_from_file_location("mlit_polygon_audit", SCRIPT)
AUDIT = module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class RingAndPolygonTests(unittest.TestCase):
    def test_ring_inside_outside_and_boundary(self):
        square = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
        self.assertEqual(AUDIT.ring_location((5.0, 5.0), square), "INSIDE")
        self.assertEqual(AUDIT.ring_location((12.0, 5.0), square), "OUTSIDE")
        self.assertEqual(AUDIT.ring_location((10.0, 5.0), square), "BOUNDARY")

    def test_polygon_hole_is_not_treated_as_area(self):
        exterior = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
        hole = [(4, 4), (6, 4), (6, 6), (4, 6), (4, 4)]
        self.assertEqual(AUDIT.polygon_location((2, 2), [exterior, hole]), "INSIDE")
        self.assertEqual(AUDIT.polygon_location((5, 5), [exterior, hole]), "OUTSIDE")
        self.assertEqual(AUDIT.polygon_location((4, 5), [exterior, hole]), "BOUNDARY")

    def test_geojson_multi_polygon_containment(self):
        poly_a = [[(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]]
        poly_b = [[(5, 5), (6, 5), (6, 6), (5, 6), (5, 5)]]
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[p[0], p[1]] for p in ring] for ring in poly_a],
                [[[p[0], p[1]] for p in ring] for ring in poly_b],
            ],
        }
        self.assertEqual(AUDIT.geometry_location((0.5, 0.5), geometry), "INSIDE")
        self.assertEqual(AUDIT.geometry_location((5.5, 5.5), geometry), "INSIDE")
        self.assertEqual(AUDIT.geometry_location((3, 3), geometry), "OUTSIDE")


class GmlAuditTests(unittest.TestCase):
    def test_declared_shift_jis_xml_is_transcoded_before_expat_parsing(self):
        source = '<?xml version="1.0" encoding="Shift_JIS"?><root><label>山形</label></root>'
        raw_xml = source.encode("shift_jis")
        normalized = AUDIT.normalize_xml_bytes_for_expat(raw_xml)
        self.assertIn(b'encoding="UTF-8"', normalized)
        root = ET.fromstring(normalized)
        self.assertEqual(root.findtext("label"), "山形")

    def fixture_zip(self):
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <gml:FeatureCollection xmlns:gml="http://www.opengis.net/gml"
          xmlns:ksj="http://nlftp.mlit.go.jp/ksj/schemas/ksj-app">
          <gml:featureMember>
            <ksj:AdministrativeArea gml:id="test1">
              <ksj:N03_001>Yamagata</ksj:N03_001>
              <ksj:N03_003>Higashitagawa-gun</ksj:N03_003>
              <ksj:N03_004>Asahi-mura</ksj:N03_004>
              <ksj:N03_007>06427</ksj:N03_007>
              <ksj:AREA>
                <gml:Polygon>
                  <gml:exterior><gml:LinearRing><gml:posList srsDimension="2">
                    35 139 35 141 37 141 37 139 35 139
                  </gml:posList></gml:LinearRing></gml:exterior>
                </gml:Polygon>
              </ksj:AREA>
            </ksj:AdministrativeArea>
          </gml:featureMember>
        </gml:FeatureCollection>"""
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("N03-651001_06_GML.xml", xml)
        return buffer.getvalue()

    def test_gml_feature_attributes_and_lat_lon_axis_order(self):
        data = self.fixture_zip()
        records, members = AUDIT.parse_gml_archive(
            data,
            {"snapshot_date": "1965-10-01", "prefecture_code": "06", "archive_filename": "sample.zip"},
        )
        self.assertEqual(len(records), 1)
        self.assertIn("N03-651001_06_GML.xml", members)
        record = records[0]
        self.assertEqual(record["area_code"], "06427")
        self.assertEqual(record["prefecture_name"], "Yamagata")
        self.assertEqual(record["municipality_name"], "Asahi-mura")
        geometry = {"type": "Polygon", "coordinates": record["polygons"][0]}
        # MLIT v2.2 coordinates are B,L (latitude,longitude) and are normalized to x=longitude,y=latitude.
        self.assertEqual(AUDIT.geometry_location((140.0, 36.0), geometry), "INSIDE")
        self.assertEqual(AUDIT.geometry_location((138.0, 36.0), geometry), "OUTSIDE")

    def test_archive_with_unsupported_featuremember_gml_falls_back_to_shapefile(self):
        import shapefile

        shp_io, shx_io, dbf_io = io.BytesIO(), io.BytesIO(), io.BytesIO()
        writer = shapefile.Writer(
            shp=shp_io,
            shx=shx_io,
            dbf=dbf_io,
            shapeType=shapefile.POLYGON,
        )
        writer.field("N03_001", "C", size=40)
        writer.field("N03_002", "C", size=40)
        writer.field("N03_003", "C", size=40)
        writer.field("N03_004", "C", size=40)
        writer.field("N03_007", "C", size=5)
        writer.poly([[(139.0, 35.0), (141.0, 35.0), (141.0, 37.0), (139.0, 37.0), (139.0, 35.0)]])
        writer.record("Yamagata", "", "Higashitagawa-gun", "Asahi-mura", "06427")
        writer.close()

        unsupported_gml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <gml:FeatureCollection xmlns:gml="http://www.opengis.net/gml">
          <gml:curveMember><gml:Curve><gml:segments><gml:LineStringSegment>
            <gml:posList>35 139 35 141</gml:posList>
          </gml:LineStringSegment></gml:segments></gml:Curve></gml:curveMember>
        </gml:FeatureCollection>"""

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("N03-651001_06-g.xml", unsupported_gml)
            archive.writestr("N03-651001_06-g_AdministrativeBoundary.shp", shp_io.getvalue())
            archive.writestr("N03-651001_06-g_AdministrativeBoundary.shx", shx_io.getvalue())
            archive.writestr("N03-651001_06-g_AdministrativeBoundary.dbf", dbf_io.getvalue())

        records, members = AUDIT.parse_gml_archive(
            buffer.getvalue(),
            {"snapshot_date": "1965-10-01", "prefecture_code": "06", "archive_filename": "sample.zip"},
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["area_code"], "06427")
        self.assertEqual(records[0]["municipality_name"], "Asahi-mura")
        self.assertIn("N03-651001_06-g_AdministrativeBoundary.shp", members)
        geometry = {"type": "Polygon", "coordinates": records[0]["polygons"][0]}
        self.assertEqual(AUDIT.geometry_location((140.0, 36.0), geometry), "INSIDE")

    def test_candidate_target_selection_requires_all_six_exact_ids(self):
        rows = []
        for geonames_id in sorted(AUDIT.EXPECTED_TARGET_IDS, key=int):
            rows.append({
                "geonames_id": geonames_id,
                "geonames_name": "Example",
                "source_latitude": "35.0",
                "source_longitude": "139.0",
                "raw_admin1_code": "00",
                "raw_admin2_code": "",
                "candidates": [{"area_code": "06427"}],
            })
        audit = {"target_results": rows}
        selected = AUDIT.candidate_targets(audit)
        self.assertEqual(len(selected), 6)
        self.assertEqual(selected[0]["candidate_area_codes"], ["06427"])
        with self.assertRaises(RuntimeError):
            AUDIT.candidate_targets({"target_results": rows[:-1]})


class LinkResolverTests(unittest.TestCase):
    def test_download_link_must_be_resolved_from_official_table_row(self):
        html = b"""<table><tr><td>Yamagata</td><td>N03-651001_06_GML.zip</td>
          <td><a href="/ksj/gml/data/N03/N03-65/N03-651001_06_GML.zip">download</a></td></tr></table>"""
        links, details = AUDIT.find_direct_links(html)
        self.assertEqual(
            links["N03-651001_06_GML.zip"],
            "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-65/N03-651001_06_GML.zip",
        )
        self.assertEqual(details["catalog_rows_with_zip_links"], 1)

    def test_filename_only_widget_link_is_not_mistaken_for_archive_download(self):
        html = b"""<table><tr><td>N03-651001_06_GML.zip</td>
          <td><a href="N03-651001_06_GML.zip">filename</a>
          <button onclick="downloadFile('N03-651001_06_GML.zip')">download</button></td></tr></table>"""
        links, _details = AUDIT.find_direct_links(html)
        self.assertNotIn("N03-651001_06_GML.zip", links)

    def test_exact_archive_path_wins_over_bare_filename_widget_link(self):
        html = b"""<table><tr><td>N03-651001_06_GML.zip</td>
          <td><a href="N03-651001_06_GML.zip">filename</a>
          <a href="/ksj/gml/data/N03/N03-65/N03-651001_06_GML.zip">download</a></td></tr></table>"""
        links, _details = AUDIT.find_direct_links(html)
        self.assertEqual(
            links["N03-651001_06_GML.zip"],
            "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-65/N03-651001_06_GML.zip",
        )

    def test_no_guessed_url_is_returned_if_official_table_has_no_link(self):
        html = b"<table><tr><td>N03-651001_06_GML.zip</td></tr></table>"
        links, _details = AUDIT.find_direct_links(html)
        self.assertNotIn("N03-651001_06_GML.zip", links)


if __name__ == "__main__":
    unittest.main(verbosity=2)
