"""Unit tests for the shared helpers and the generated files.

Run from the repository root:

    python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from build import render_all, sql_string  # noqa: E402
from lib.municipios import (  # noqa: E402
    haversine_km,
    load_estados,
    load_municipios,
    normalize,
    to_municipio,
)


class NormalizeTests(unittest.TestCase):
    def test_removes_accents_and_case(self):
        self.assertEqual(normalize('Maceió'), 'maceio')

    def test_strips_surrounding_spaces(self):
        self.assertEqual(normalize('  São Paulo '), 'sao paulo')


class DistanceTests(unittest.TestCase):
    def test_same_point_is_zero(self):
        self.assertAlmostEqual(haversine_km(-9.66, -35.73, -9.66, -35.73), 0.0)

    def test_known_distance_maceio_to_recife(self):
        # About 203 km in a straight line (the road distance is longer).
        distance = haversine_km(-9.6658, -35.7353, -8.0476, -34.8770)
        self.assertTrue(195 < distance < 210, distance)


class SqlTests(unittest.TestCase):
    def test_single_quote_is_escaped(self):
        self.assertEqual(sql_string("D'Oeste"), "'D''Oeste'")


class DataTests(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(len(load_municipios()), 5570)
        self.assertEqual(len(load_estados()), 27)

    def test_siafi_keeps_leading_zeros(self):
        municipio = to_municipio({
            'codigo_ibge': '4219853', 'nome': 'Zortéa', 'latitude': '-27.4521',
            'longitude': '-51.552', 'capital': '0', 'codigo_uf': '42',
            'siafi_id': '0950', 'ddd': '49', 'fuso_horario': 'America/Sao_Paulo',
        })
        self.assertEqual(municipio['siafi_id'], '0950')

    def test_generated_files_match_csv(self):
        for relative_path, expected in render_all().items():
            with self.subTest(file=relative_path):
                with open(ROOT / relative_path, encoding='utf-8', newline='') as f:
                    self.assertEqual(f.read(), expected)


if __name__ == '__main__':
    unittest.main()
