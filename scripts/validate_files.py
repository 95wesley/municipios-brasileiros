"""Validate the dataset in csv/ and check that derived files are up to date.

Run from anywhere:

    python scripts/validate_files.py

Exit code is 1 when errors are found. Warnings do not fail the run.
"""
from __future__ import annotations

import re
import sys
from collections import Counter

from build import render_all
from lib.municipios import (
    ESTADOS_CSV,
    ESTADOS_FIELDS,
    MUNICIPIOS_CSV,
    MUNICIPIOS_FIELDS,
    ROOT,
    haversine_km,
    normalize,
    read_raw,
    to_estado,
    to_municipio,
)

EXPECTED_UFS = 27
EXPECTED_MUNICIPIOS = 5570
VALID_REGIOES = {'Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste'}

# Bounding box of Brazil (latitude, longitude), with a small margin.
LAT_RANGE = (-34.0, 6.0)
LON_RANGE = (-75.0, -32.0)

# Municipalities farther than this from their state's reference point are
# reported as warnings (large states like Amazonas can be legitimately far).
MAX_DISTANCE_FROM_UF_KM = 1500


def check_files_structure(errors):
    """Check CSV headers and that no cell is empty."""
    mun_fields, mun_raw = read_raw(MUNICIPIOS_CSV)
    est_fields, est_raw = read_raw(ESTADOS_CSV)

    if mun_fields != MUNICIPIOS_FIELDS:
        errors.append(f'municipios.csv: unexpected header {mun_fields}')
    if est_fields != ESTADOS_FIELDS:
        errors.append(f'estados.csv: unexpected header {est_fields}')

    for name, rows in (('municipios.csv', mun_raw), ('estados.csv', est_raw)):
        for line_number, row in enumerate(rows, start=2):
            if None in row:
                errors.append(f'{name} line {line_number}: too many columns')
            for column, value in row.items():
                if column is None:
                    continue
                if value is None or value.strip() == '':
                    errors.append(f'{name} line {line_number}: empty "{column}"')

    return mun_raw, est_raw


def check_estados(estados, errors):
    """Check the 27 UFs: count, uniqueness, codes, region names."""
    if len(estados) != EXPECTED_UFS:
        errors.append(f'estados: expected {EXPECTED_UFS} rows, found {len(estados)}')

    for code, count in Counter(e['codigo_uf'] for e in estados).items():
        if count > 1:
            errors.append(f'estados: duplicated codigo_uf {code}')
    for uf, count in Counter(e['uf'] for e in estados).items():
        if count > 1:
            errors.append(f'estados: duplicated uf {uf}')

    for estado in estados:
        if not re.fullmatch(r'[A-Z]{2}', estado['uf']):
            errors.append(f"estados: invalid uf '{estado['uf']}'")
        if estado['regiao'] not in VALID_REGIOES:
            errors.append(f"estados: invalid regiao '{estado['regiao']}' for {estado['uf']}")
        if not (LAT_RANGE[0] <= estado['latitude'] <= LAT_RANGE[1]
                and LON_RANGE[0] <= estado['longitude'] <= LON_RANGE[1]):
            errors.append(f"estados: coordinates outside Brazil for {estado['uf']}")


def check_municipios(municipios, estados, errors, warnings):
    """Check every municipio: keys, formats, ranges and relations."""
    estados_by_code = {e['codigo_uf']: e for e in estados}

    if len(municipios) != EXPECTED_MUNICIPIOS:
        errors.append(f'municipios: expected {EXPECTED_MUNICIPIOS} rows, found {len(municipios)}')

    for field in ('codigo_ibge', 'siafi_id'):
        for value, count in Counter(m[field] for m in municipios).items():
            if count > 1:
                errors.append(f'municipios: duplicated {field} {value}')

    names_per_uf = Counter((normalize(m['nome']), m['codigo_uf']) for m in municipios)
    for (name, code), count in names_per_uf.items():
        if count > 1:
            errors.append(f'municipios: duplicated name "{name}" in UF {code}')

    coordinate_pairs = Counter((m['latitude'], m['longitude']) for m in municipios)
    for (lat, lon), count in coordinate_pairs.items():
        if count > 1:
            warnings.append(f'municipios: {count} municipalities share coordinates ({lat}, {lon})')

    capitals_per_uf = Counter()

    for m in municipios:
        label = f"{m['codigo_ibge']} {m['nome']}"
        code = str(m['codigo_ibge'])

        if not re.fullmatch(r'\d{7}', code):
            errors.append(f'{label}: codigo_ibge must have 7 digits')
        if code[:2] != str(m['codigo_uf']):
            errors.append(f'{label}: codigo_ibge prefix does not match codigo_uf {m["codigo_uf"]}')
        if m['codigo_uf'] not in estados_by_code:
            errors.append(f'{label}: codigo_uf {m["codigo_uf"]} not found in estados')
        if not re.fullmatch(r'\d{4}', m['siafi_id']):
            errors.append(f"{label}: siafi_id '{m['siafi_id']}' must have 4 digits")
        if m['capital'] not in (0, 1):
            errors.append(f'{label}: capital must be 0 or 1')
        if m['capital'] == 1:
            capitals_per_uf[m['codigo_uf']] += 1
        if not 11 <= m['ddd'] <= 99:
            errors.append(f"{label}: invalid DDD {m['ddd']}")
        if not m['fuso_horario'].startswith('America/'):
            errors.append(f"{label}: unexpected time zone '{m['fuso_horario']}'")
        if not (LAT_RANGE[0] <= m['latitude'] <= LAT_RANGE[1]
                and LON_RANGE[0] <= m['longitude'] <= LON_RANGE[1]):
            errors.append(f'{label}: coordinates outside Brazil')

        estado = estados_by_code.get(m['codigo_uf'])
        if estado is not None:
            distance = haversine_km(m['latitude'], m['longitude'],
                                    estado['latitude'], estado['longitude'])
            if distance > MAX_DISTANCE_FROM_UF_KM:
                warnings.append(
                    f"{label}: {distance:.0f} km from the reference point of {estado['uf']}"
                )

    for estado in estados:
        count = capitals_per_uf.get(estado['codigo_uf'], 0)
        if count != 1:
            errors.append(f"estados: {estado['uf']} has {count} capitals, expected 1")


def check_derived_files(errors):
    """Check that json/ and sql/ match what build.py generates from csv/."""
    try:
        expected_files = render_all()
    except (ValueError, KeyError) as exc:
        errors.append(f'cannot generate derived files: {exc}')
        return

    for relative_path, expected in expected_files.items():
        target = ROOT / relative_path
        if not target.exists():
            errors.append(f'{relative_path} is missing; run python scripts/build.py')
            continue
        with open(target, encoding='utf-8', newline='') as f:
            current = f.read()
        if current != expected:
            errors.append(f'{relative_path} is out of date; run python scripts/build.py')


def run_checks():
    """Run every check.

    Returns:
        tuple: (errors, warnings, stats) where stats is a dict of counts.
    """
    errors, warnings = [], []
    mun_raw, est_raw = check_files_structure(errors)

    try:
        estados = [to_estado(row) for row in est_raw]
        municipios = [to_municipio(row) for row in mun_raw]
    except (ValueError, KeyError) as exc:
        errors.append(f'invalid value in CSV: {exc}')
        return errors, warnings, {}

    check_estados(estados, errors)
    check_municipios(municipios, estados, errors, warnings)

    if not errors:
        check_derived_files(errors)

    stats = {
        'municipalities': len(municipios),
        'states': len(estados),
        'capitals': sum(m['capital'] for m in municipios),
        'by_timezone': dict(Counter(m['fuso_horario'] for m in municipios)),
    }
    return errors, warnings, stats


def main():
    errors, warnings, stats = run_checks()

    for warning in warnings:
        print(f'WARNING: {warning}')
    for error in errors:
        print(f'ERROR: {error}')

    print(f'Stats: {stats}')
    if errors:
        print(f'FAILED with {len(errors)} error(s).')
        return 1
    print('OK: dataset is valid and derived files are up to date.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
