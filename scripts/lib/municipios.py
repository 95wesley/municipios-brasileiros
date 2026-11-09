"""Shared helpers: CSV loading, text normalization and geographic distance.

The CSV files in ``csv/`` are the single source of truth. Every other format
(JSON, SQL, MCP, web map) is derived from them.
"""
from __future__ import annotations

import csv
import math
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV_DIR = ROOT / 'csv'
MUNICIPIOS_CSV = CSV_DIR / 'municipios.csv'
ESTADOS_CSV = CSV_DIR / 'estados.csv'

MUNICIPIOS_FIELDS = [
    'codigo_ibge', 'nome', 'latitude', 'longitude', 'capital',
    'codigo_uf', 'siafi_id', 'ddd', 'fuso_horario',
]
ESTADOS_FIELDS = ['codigo_uf', 'uf', 'nome', 'latitude', 'longitude', 'regiao']

EARTH_RADIUS_KM = 6371.0088


def read_raw(path):
    """Read a CSV file as strings, without type conversion.

    A UTF-8 BOM is removed if present.

    Returns:
        tuple: (fieldnames, list of dict rows with string values)
    """
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


def normalize(text):
    """Lower-case a string and strip accents, for accent-insensitive search."""
    decomposed = unicodedata.normalize('NFKD', text)
    without_accents = ''.join(c for c in decomposed if not unicodedata.combining(c))
    return without_accents.casefold().strip()


def to_municipio(raw):
    """Convert a raw municipios row into typed values.

    ``siafi_id`` stays a string so leading zeros are preserved.
    """
    return {
        'codigo_ibge': int(raw['codigo_ibge']),
        'nome': raw['nome'],
        'latitude': float(raw['latitude']),
        'longitude': float(raw['longitude']),
        'capital': int(raw['capital']),
        'codigo_uf': int(raw['codigo_uf']),
        'siafi_id': raw['siafi_id'],
        'ddd': int(raw['ddd']),
        'fuso_horario': raw['fuso_horario'],
    }


def to_estado(raw):
    """Convert a raw estados row into typed values."""
    return {
        'codigo_uf': int(raw['codigo_uf']),
        'uf': raw['uf'],
        'nome': raw['nome'],
        'latitude': float(raw['latitude']),
        'longitude': float(raw['longitude']),
        'regiao': raw['regiao'],
    }


def load_municipios(path=MUNICIPIOS_CSV):
    """Load all municipios as typed dicts."""
    _, rows = read_raw(path)
    return [to_municipio(row) for row in rows]


def load_estados(path=ESTADOS_CSV):
    """Load all states (UFs) as typed dicts."""
    _, rows = read_raw(path)
    return [to_estado(row) for row in rows]


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in kilometres between two coordinates."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))
