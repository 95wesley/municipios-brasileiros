# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Explorer: compact light panel matching the OpenStreetMap style; dark theme removed.
- Explorer: 3D globe removed; the page is now a single 2D map.
- Explorer: colour legend removed; the selected municipality card sits above the map attribution.
- Explorer: the search panel can be collapsed with the – button.
- README: map screenshot, quick-start table and dataset summary.

## [2.0.0]

### Breaking changes

- `json/municipios.json`: `siafi_id` is now a string (`"0401"`) instead of an integer (`401`).
  The integer form lost the leading zeros.
- JSON files are now pretty-printed with 4 spaces and no longer start with a UTF-8 BOM.
- `csv/estados.csv` no longer starts with a UTF-8 BOM.

### Added

- `scripts/build.py`: regenerates `json/`, `sql/` and normalized `csv/` from `csv/`, which is the single source of truth.
- `scripts/validate_files.py` rewritten: checks counts (5,570 municipalities, 27 UFs), uniqueness,
  foreign keys, IBGE code prefixes, one capital per UF, coordinate ranges, time zones, duplicated names,
  and that derived files are up to date. Runs with the standard library only.
- `scripts/lib/municipios.py`: shared helpers (CSV loading, accent-insensitive search, haversine distance).
- `mcp/server.py`: MCP server with tools for searching, listing, and finding the nearest municipality, plus dataset validation.
- `web/`: static 3D globe (globe.gl) and 2D map (Leaflet + OpenStreetMap) with search, UF filter and browser geolocation.
- GitHub Actions workflow that runs the validation on every push and pull request.

### Fixed

- `siafi_id` leading zeros preserved (998 municipalities affected in JSON).
- `README.md`: removed a non-existent `Região` column from the municipios examples, corrected the estados CSV header,
  fixed the broken CI badge and the pull request link typo.

## [1.0.0]

- Initial snapshot before versioning: SQL, CSV and JSON files for 5,570 municipalities and 27 UFs.
  No git tag was created for this version.
