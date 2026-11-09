"""Regenerate the derived files (json/, sql/, normalized csv/) from csv/.

The CSV files are the source of truth. Run from the repository root:

    python scripts/build.py
"""
from __future__ import annotations

import csv
import io
import json

from lib.municipios import (
    ESTADOS_CSV,
    MUNICIPIOS_CSV,
    ROOT,
    read_raw,
    to_estado,
    to_municipio,
)

MUNICIPIOS_SQL_HEADER = """CREATE TABLE municipios(
    codigo_ibge INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    latitude FLOAT(8) NOT NULL,
    longitude FLOAT(8) NOT NULL,
    capital BOOLEAN NOT NULL,
    codigo_uf INT NOT NULL,
    siafi_id VARCHAR(4) NOT NULL UNIQUE,
    ddd INT NOT NULL,
    fuso_horario VARCHAR(32) NOT NULL,
    PRIMARY KEY (codigo_ibge),
    FOREIGN KEY (codigo_uf) REFERENCES estados (codigo_uf)
);

INSERT INTO municipios VALUES
"""

ESTADOS_SQL_HEADER = """CREATE TABLE estados(
    codigo_uf INT NOT NULL,
    uf VARCHAR(2) NOT NULL,
    nome VARCHAR(100) NOT NULL,
    latitude FLOAT(8) NOT NULL,
    longitude FLOAT(8) NOT NULL,
    regiao VARCHAR(12) NOT NULL,
    PRIMARY KEY (codigo_uf)
);

INSERT INTO estados VALUES
"""


def sql_string(value):
    """Quote a value as an SQL string literal, escaping single quotes."""
    return "'" + value.replace("'", "''") + "'"


def render_csv(fieldnames, rows):
    """Render raw rows back to CSV text (UTF-8, no BOM, LF line endings)."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def render_json(records):
    """Render typed records as pretty-printed JSON (UTF-8, no BOM)."""
    return json.dumps(records, ensure_ascii=False, indent=4) + '\n'


def render_sql_municipios(raw_rows):
    """Render the municipios INSERT statement from raw CSV rows."""
    values = []
    for row in raw_rows:
        capital = 'TRUE' if row['capital'] == '1' else 'FALSE'
        values.append(
            f"({row['codigo_ibge']},{sql_string(row['nome'])},"
            f"{row['latitude']},{row['longitude']},{capital},"
            f"{row['codigo_uf']},{sql_string(row['siafi_id'])},"
            f"{row['ddd']},{sql_string(row['fuso_horario'])})"
        )
    return MUNICIPIOS_SQL_HEADER + ',\n'.join(values) + ';\n'


def render_sql_estados(raw_rows):
    """Render the estados INSERT statement from raw CSV rows."""
    values = []
    for row in raw_rows:
        values.append(
            f"({row['codigo_uf']},{sql_string(row['uf'])},"
            f"{sql_string(row['nome'])},{row['latitude']},{row['longitude']},"
            f"{sql_string(row['regiao'])})"
        )
    return ESTADOS_SQL_HEADER + ',\n'.join(values) + ';\n'


def render_all():
    """Build the content of every derived file.

    Returns:
        dict: mapping of repository-relative path to expected file content.

    Raises:
        ValueError, KeyError: if a CSV row contains invalid data.
    """
    mun_fields, mun_raw = read_raw(MUNICIPIOS_CSV)
    est_fields, est_raw = read_raw(ESTADOS_CSV)

    municipios = [to_municipio(row) for row in mun_raw]
    estados = [to_estado(row) for row in est_raw]

    return {
        'csv/municipios.csv': render_csv(mun_fields, mun_raw),
        'csv/estados.csv': render_csv(est_fields, est_raw),
        'json/municipios.json': render_json(municipios),
        'json/estados.json': render_json(estados),
        'sql/municipios.sql': render_sql_municipios(mun_raw),
        'sql/estados.sql': render_sql_estados(est_raw),
    }


def main():
    for relative_path, content in render_all().items():
        target = ROOT / relative_path
        with open(target, 'w', encoding='utf-8', newline='\n') as f:
            f.write(content)
        print(f'written: {relative_path}')


if __name__ == '__main__':
    main()
