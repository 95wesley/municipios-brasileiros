"""MCP server exposing queries over the Brazilian municipalities dataset.

Requires Python 3.10+ and the official ``mcp`` SDK (see requirements.txt).

Run directly (stdio transport):

    python mcp/server.py

Or register it with Claude Code:

    claude mcp add municipios -- python /absolute/path/to/mcp/server.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS_DIR))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from lib.municipios import haversine_km, load_estados, load_municipios, normalize  # noqa: E402
from validate_files import run_checks  # noqa: E402

mcp = FastMCP('municipios-brasileiros')

ESTADOS = load_estados()
ESTADOS_BY_CODE = {e['codigo_uf']: e for e in ESTADOS}
ESTADOS_BY_UF = {e['uf']: e for e in ESTADOS}


def enrich(municipio):
    """Add the UF, state name and region to a municipio record."""
    estado = ESTADOS_BY_CODE[municipio['codigo_uf']]
    return {
        **municipio,
        'uf': estado['uf'],
        'estado': estado['nome'],
        'regiao': estado['regiao'],
    }


MUNICIPIOS = [enrich(m) for m in load_municipios()]
MUNICIPIOS_BY_IBGE = {m['codigo_ibge']: m for m in MUNICIPIOS}


def error(message):
    """Build a standard error payload for tools."""
    return {'error': message}


@mcp.tool()
def search_municipio(name: str, uf: str | None = None, limit: int = 20) -> list[dict]:
    """Search municipalities by name (accent- and case-insensitive).

    Args:
        name: Full or partial municipality name, e.g. "maceio" or "Maceió".
        uf: Optional state abbreviation to restrict results, e.g. "AL".
        limit: Maximum number of results.
    """
    query = normalize(name)
    if not query:
        return []

    matches = []
    for m in MUNICIPIOS:
        if uf and m['uf'] != uf.upper():
            continue
        normalized_name = normalize(m['nome'])
        if query in normalized_name:
            # Names that start with the query come first.
            rank = 0 if normalized_name.startswith(query) else 1
            matches.append((rank, m['nome'], m))

    matches.sort(key=lambda item: (item[0], item[1]))
    return [m for _, _, m in matches[:limit]]


@mcp.tool()
def get_municipio(codigo_ibge: int) -> dict:
    """Get one municipality by its 7-digit IBGE code."""
    municipio = MUNICIPIOS_BY_IBGE.get(codigo_ibge)
    if municipio is None:
        return error(f'municipality with codigo_ibge {codigo_ibge} not found')
    return municipio


@mcp.tool()
def list_municipios_by_uf(uf: str) -> list[dict] | dict:
    """List all municipalities of a state, sorted by name.

    Args:
        uf: State abbreviation, e.g. "SP".
    """
    code = uf.upper()
    if code not in ESTADOS_BY_UF:
        return error(f'unknown UF {uf}')
    return sorted(
        (m for m in MUNICIPIOS if m['uf'] == code),
        key=lambda m: normalize(m['nome']),
    )


@mcp.tool()
def get_estado(uf: str) -> dict:
    """Get a state (UF) with its reference coordinates and municipality count."""
    code = uf.upper()
    estado = ESTADOS_BY_UF.get(code)
    if estado is None:
        return error(f'unknown UF {uf}')
    total = sum(1 for m in MUNICIPIOS if m['uf'] == code)
    return {**estado, 'total_municipalities': total}


@mcp.tool()
def list_capitals() -> list[dict]:
    """List the capital of every state."""
    return [m for m in MUNICIPIOS if m['capital'] == 1]


@mcp.tool()
def nearest_municipios(latitude: float, longitude: float,
                       radius_km: float = 50, limit: int = 10) -> list[dict]:
    """Find municipalities within a radius of a coordinate, nearest first.

    Each result includes a ``distance_km`` field.

    Args:
        latitude: Latitude in decimal degrees (negative in the south).
        longitude: Longitude in decimal degrees (negative in the west).
        radius_km: Search radius in kilometres.
        limit: Maximum number of results.
    """
    results = []
    for m in MUNICIPIOS:
        distance = haversine_km(latitude, longitude, m['latitude'], m['longitude'])
        if distance <= radius_km:
            results.append({**m, 'distance_km': round(distance, 2)})
    results.sort(key=lambda m: m['distance_km'])
    return results[:limit]


@mcp.tool()
def nearest_municipio(latitude: float, longitude: float) -> dict:
    """Find the single municipality closest to a coordinate.

    Each result includes a ``distance_km`` field.
    """
    best = min(
        MUNICIPIOS,
        key=lambda m: haversine_km(latitude, longitude, m['latitude'], m['longitude']),
    )
    distance = haversine_km(latitude, longitude, best['latitude'], best['longitude'])
    return {**best, 'distance_km': round(distance, 2)}


@mcp.tool()
def dataset_statistics() -> dict:
    """Summary counts: total municipalities and states, per region, per time zone and per UF."""
    return {
        'total_municipalities': len(MUNICIPIOS),
        'total_states': len(ESTADOS),
        'by_region': dict(Counter(m['regiao'] for m in MUNICIPIOS)),
        'by_timezone': dict(Counter(m['fuso_horario'] for m in MUNICIPIOS)),
        'by_uf': dict(Counter(m['uf'] for m in MUNICIPIOS)),
    }


@mcp.tool()
def validate_dataset() -> dict:
    """Run the dataset checks (missing values, duplicates, consistency, derived files)."""
    errors, warnings, stats = run_checks()
    return {
        'ok': not errors,
        'errors': errors,
        'warnings': warnings,
        'stats': stats,
    }


@mcp.resource('municipios://estados')
def estados_resource() -> str:
    """All 27 states as JSON."""
    return json.dumps(ESTADOS, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    mcp.run()
