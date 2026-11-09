/* Brazilian municipalities explorer: 2D map, multi-state filter, search and geolocation.
 *
 * All data is loaded from the repository's JSON files, and all distance
 * calculations run in the browser. No coordinates are sent to any server.
 */
(function () {
    'use strict';

    // Data files live one level up, at the repository root.
    const MUNICIPIOS_URL = '../json/municipios.json';
    const ESTADOS_URL = '../json/estados.json';

    const OSM_TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    const BRAZIL_CENTER = [-14.2, -51.9];
    const BRAZIL_ZOOM = 4;

    const TIMEZONE_COLORS = {
        'America/Sao_Paulo': '#2563eb',
        'America/Porto_Velho': '#f97316',
        'America/Rio_Branco': '#16a34a',
        'America/Noronha': '#a855f7',
    };
    const DEFAULT_COLOR = '#94a3b8';
    const CAPITAL_COLOR = '#facc15';
    const EARTH_RADIUS_KM = 6371.0088;
    const MAX_SEARCH_RESULTS = 8;

    // State outlines come from the official IBGE boundary API (public, CORS enabled).
    // Only the state code is sent in the request.
    const STATE_SHAPE_URL = (codigoUf) => (
        `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${codigoUf}`
        + '?formato=application/vnd.geo+json&qualidade=intermediaria'
    );
    const OUTLINE_STYLE = {
        color: '#1d4ed8',
        weight: 2,
        opacity: 0.9,
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
    };
    const SHAPE_PANE = 'statesPane';

    // Icons for the panel toggle button (inline SVG, so they follow the text colour).
    const MINUS_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
    const PLUS_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

    // Above this many points, markers are drawn smaller to keep the map readable.
    const DENSE_THRESHOLD = 1000;

    const state = {
        municipios: [],
        estadosByCode: new Map(),
        estadosByUf: new Map(),
        ufOptions: [],          // [{ uf, nome, regiao }], sorted by UF code
        selectedUfs: new Set(), // empty set means "all states"
        fieldFilter: { field: 'nome', value: '' }, // empty value means "no field filter"
        ufVisibleOptions: [],   // options currently shown in the dropdown
        ufActiveIndex: -1,      // keyboard highlight in the dropdown
        searchMatches: [],      // municipality suggestions for the search box
        searchActive: -1,       // keyboard highlight in the suggestions
        map: null,
        mapLayer: null,
        userMarker: null,
        userCircle: null,
        stateLayers: new Map(),  // UF -> Leaflet layer with that state's outline
        shapeLoading: new Set(), // UFs whose outline is being fetched
    };

    const el = {
        status: document.getElementById('status'),
        searchForm: document.getElementById('search-form'),
        searchInput: document.getElementById('search-input'),
        searchList: document.getElementById('search-list'),
        ufField: document.getElementById('uf-field'),
        ufBox: document.getElementById('uf-box'),
        ufChips: document.getElementById('uf-chips'),
        ufInput: document.getElementById('uf-input'),
        ufList: document.getElementById('uf-list'),
        ufClear: document.getElementById('uf-clear'),
        fieldSelect: document.getElementById('field-select'),
        fieldInput: document.getElementById('field-input'),
        locateBtn: document.getElementById('locate-btn'),
        map: document.getElementById('map'),
        info: document.getElementById('info'),
        infoName: document.getElementById('info-name'),
        infoDetails: document.getElementById('info-details'),
        infoClose: document.getElementById('info-close'),
        toolbar: document.querySelector('.toolbar'),
        togglePanel: document.getElementById('toggle-panel'),
    };

    // ---------- helpers ----------

    function setStatus(message) {
        el.status.textContent = message;
    }

    /** Remove accents and case so that "maceio" matches "Maceió". */
    function normalize(text) {
        return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }

    /** Great-circle distance in kilometres (haversine formula). */
    function haversineKm(lat1, lon1, lat2, lon2) {
        const toRad = (deg) => (deg * Math.PI) / 180;
        const dPhi = toRad(lat2 - lat1);
        const dLambda = toRad(lon2 - lon1);
        const a = Math.sin(dPhi / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
    }

    function colorFor(municipio) {
        if (municipio.capital) return CAPITAL_COLOR;
        return TIMEZONE_COLORS[municipio.fuso_horario] || DEFAULT_COLOR;
    }

    function ufOf(municipio) {
        const estado = state.estadosByCode.get(municipio.codigo_uf);
        return estado ? estado.uf : '';
    }

    /** True when the field filter has a value to match against. */
    function hasFieldFilter() {
        return state.fieldFilter.value.trim() !== '';
    }

    /** True when any filter (UF selection or field filter) narrows the municipalities. */
    function hasActiveFilter() {
        return state.selectedUfs.size > 0 || hasFieldFilter();
    }

    /** Check one municipality against the field filter. Matching is accent-insensitive. */
    function matchesFieldFilter(m) {
        if (!hasFieldFilter()) return true;
        const { field } = state.fieldFilter;
        const wanted = normalize(state.fieldFilter.value);

        switch (field) {
            case 'codigo_ibge':
                return String(m.codigo_ibge).startsWith(wanted);
            case 'ddd':
                return String(m.ddd) === wanted;
            case 'fuso_horario':
                return normalize(m.fuso_horario).includes(wanted);
            case 'nome':
            default:
                return normalize(m.nome).includes(wanted);
        }
    }

    /** Municipalities that pass both the UF selection and the field filter. */
    function visibleMunicipios() {
        return state.municipios.filter((m) => (
            (state.selectedUfs.size === 0 || state.selectedUfs.has(m.uf))
            && matchesFieldFilter(m)
        ));
    }

    function sortedSelectedUfs() {
        return [...state.selectedUfs].sort();
    }

    /** Brute-force nearest municipality. Fast enough for ~5,570 points. */
    function nearestMunicipio(lat, lon, candidates) {
        let best = null;
        let bestDistance = Infinity;
        for (const m of candidates) {
            const d = haversineKm(lat, lon, m.latitude, m.longitude);
            if (d < bestDistance) {
                bestDistance = d;
                best = m;
            }
        }
        return best ? { municipio: best, distanceKm: bestDistance } : null;
    }

    // ---------- data loading ----------

    async function fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while loading ${url}`);
        }
        return response.json();
    }

    async function loadData() {
        const [estados, municipios] = await Promise.all([
            fetchJson(ESTADOS_URL),
            fetchJson(MUNICIPIOS_URL),
        ]);

        for (const estado of estados) {
            state.estadosByCode.set(estado.codigo_uf, estado);
            state.estadosByUf.set(estado.uf, estado);
        }

        // Attach the UF abbreviation to each municipality for filtering and labels.
        state.municipios = municipios.map((m) => ({
            ...m,
            uf: ufOf(m),
        }));
    }

    // ---------- UI setup ----------

    function populateControls() {
        state.ufOptions = [...state.estadosByUf.values()]
            .sort((a, b) => a.codigo_uf - b.codigo_uf)
            .map((e) => ({ uf: e.uf, nome: e.nome, regiao: e.regiao }));

    }

    function initMap() {
        state.map = L.map(el.map, { preferCanvas: true, zoomControl: false })
            .setView(BRAZIL_CENTER, BRAZIL_ZOOM);
        L.control.zoom({ position: 'topright' }).addTo(state.map);

        L.tileLayer(OSM_TILES_URL, {
            maxZoom: 19,
            attribution: OSM_ATTRIBUTION,
        }).addTo(state.map);

        // Outlines sit below the markers and never block clicks on the map.
        state.map.createPane(SHAPE_PANE);
        const shapePane = state.map.getPane(SHAPE_PANE);
        shapePane.style.zIndex = 350;
        shapePane.style.pointerEvents = 'none';

        state.mapLayer = L.layerGroup().addTo(state.map);

        // Clicking the map selects the nearest visible municipality to the click.
        state.map.on('click', (event) => {
            const result = nearestMunicipio(event.latlng.lat, event.latlng.lng, visibleMunicipios());
            if (result) selectMunicipio(result.municipio);
        });

        refreshMarkers();
    }

    function refreshMarkers() {
        const visible = visibleMunicipios();
        const dense = visible.length > DENSE_THRESHOLD;
        const baseRadius = dense ? 2 : 3.5;

        state.mapLayer.clearLayers();
        for (const m of visible) {
            L.circleMarker([m.latitude, m.longitude], {
                radius: m.capital ? baseRadius + 1.5 : baseRadius,
                color: colorFor(m),
                fillColor: colorFor(m),
                fillOpacity: 0.9,
                weight: dense ? 0 : 1,
            })
                .on('click', () => selectMunicipio(m))
                .addTo(state.mapLayer);
        }
    }

    /** Frame the map on the selected states, or on Brazil when no filter is active. */
    function fitToSelection() {
        if (!hasActiveFilter()) {
            state.map.setView(BRAZIL_CENTER, BRAZIL_ZOOM);
            return;
        }
        const bounds = L.latLngBounds([]);
        for (const m of visibleMunicipios()) {
            bounds.extend([m.latitude, m.longitude]);
        }
        // Include the outlines of the selected states, when they are loaded.
        for (const layer of state.stateLayers.values()) {
            bounds.extend(layer.getBounds());
        }
        if (!bounds.isValid()) return;
        state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
    }

    // ---------- UF multi-select ----------

    function filteredUfOptions(query) {
        const needle = normalize(query);
        if (!needle) return state.ufOptions;
        return state.ufOptions.filter((option) => (
            normalize(option.uf).includes(needle) || normalize(option.nome).includes(needle)
        ));
    }

    function renderChips() {
        el.ufChips.replaceChildren();
        for (const uf of sortedSelectedUfs()) {
            const chip = document.createElement('span');
            chip.className = 'uf-chip';
            chip.textContent = uf;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'uf-chip-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remover ${uf}`);
            remove.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleUf(uf);
            });

            chip.appendChild(remove);
            el.ufChips.appendChild(chip);
        }
        el.ufClear.classList.toggle('hidden', state.selectedUfs.size === 0);
    }

    function renderUfList() {
        state.ufVisibleOptions = filteredUfOptions(el.ufInput.value);
        if (state.ufActiveIndex >= state.ufVisibleOptions.length) state.ufActiveIndex = -1;

        el.ufList.replaceChildren();

        if (state.ufVisibleOptions.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'uf-empty';
            empty.textContent = 'Nenhuma UF encontrada';
            el.ufList.appendChild(empty);
            return;
        }

        state.ufVisibleOptions.forEach((option, index) => {
            const checked = state.selectedUfs.has(option.uf);
            const item = document.createElement('li');
            item.className = 'uf-option';
            item.classList.toggle('checked', checked);
            item.classList.toggle('active', index === state.ufActiveIndex);
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(checked));
            item.dataset.uf = option.uf;

            const box = document.createElement('span');
            box.className = 'check';
            box.textContent = checked ? '✓' : '';

            const code = document.createElement('span');
            code.className = 'uf-code';
            code.textContent = option.uf;

            const name = document.createElement('span');
            name.className = 'uf-name';
            name.textContent = option.nome;

            item.append(box, code, name);
            // mousedown keeps focus in the input while the option is toggled.
            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                toggleUf(option.uf);
            });
            el.ufList.appendChild(item);
        });
    }

    function openUfList() {
        renderUfList();
        el.ufList.classList.remove('hidden');
        el.ufInput.setAttribute('aria-expanded', 'true');
    }

    function closeUfList() {
        el.ufList.classList.add('hidden');
        el.ufInput.setAttribute('aria-expanded', 'false');
        state.ufActiveIndex = -1;
    }

    function applyUfFilter() {
        refreshMarkers();
        syncStateOutlines();
        fitToSelection();

        const count = visibleMunicipios().length;
        const selected = sortedSelectedUfs();
        const parts = [];
        if (selected.length > 0) parts.push(`em ${selected.join(', ')}`);
        if (hasFieldFilter()) parts.push(`com ${FIELD_LABELS[state.fieldFilter.field]} “${state.fieldFilter.value.trim()}”`);

        setStatus(parts.length === 0
            ? `${state.municipios.length} municípios.`
            : `${count} municípios ${parts.join(' ')}.`);
    }

    /** Human-readable labels for the field filter options. */
    const FIELD_LABELS = {
        nome: 'cidade',
        codigo_ibge: 'código IBGE',
        ddd: 'DDD',
        fuso_horario: 'fuso horário',
    };

    /** Add or remove one UF from the selection and refresh every related view. */
    function toggleUf(uf) {
        if (state.selectedUfs.has(uf)) {
            state.selectedUfs.delete(uf);
        } else {
            state.selectedUfs.add(uf);
        }
        el.ufInput.value = '';
        renderChips();
        renderUfList();
        applyUfFilter();
    }

    function clearUfSelection() {
        state.selectedUfs.clear();
        el.ufInput.value = '';
        renderChips();
        renderUfList();
        applyUfFilter();
    }

    function moveActive(step) {
        const count = state.ufVisibleOptions.length;
        if (count === 0) return;
        const next = state.ufActiveIndex + step;
        state.ufActiveIndex = (next + count) % count;
        renderUfList();
        const active = el.ufList.querySelector('.uf-option.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function onUfKeydown(event) {
        const listOpen = !el.ufList.classList.contains('hidden');

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!listOpen) openUfList();
            moveActive(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter') {
            // Enter toggles the highlighted UF, or the only match, and never submits the form.
            event.preventDefault();
            const options = state.ufVisibleOptions;
            const typedCode = el.ufInput.value.trim().toUpperCase();
            const exact = options.find((option) => option.uf === typedCode);
            if (exact) {
                // A typed UF code such as "AM" always wins over partial name matches.
                toggleUf(exact.uf);
            } else if (listOpen && state.ufActiveIndex >= 0) {
                toggleUf(options[state.ufActiveIndex].uf);
            } else if (options.length === 1) {
                toggleUf(options[0].uf);
            }
        } else if (event.key === 'Backspace' && el.ufInput.value === '' && state.selectedUfs.size > 0) {
            // Empty input + Backspace removes the last chip.
            toggleUf(sortedSelectedUfs().pop());
        } else if (event.key === 'Escape') {
            closeUfList();
        }
    }

    // ---------- state outlines ----------

    /** Keep one outline per selected state: draw new ones, remove deselected ones. */
    function syncStateOutlines() {
        for (const [uf, layer] of state.stateLayers) {
            if (!state.selectedUfs.has(uf)) {
                layer.remove();
                state.stateLayers.delete(uf);
            }
        }
        for (const uf of state.selectedUfs) {
            if (!state.stateLayers.has(uf) && !state.shapeLoading.has(uf)) {
                loadStateOutline(uf);
            }
        }
    }

    async function loadStateOutline(uf) {
        const estado = state.estadosByUf.get(uf);
        if (!estado) return;

        state.shapeLoading.add(uf);
        try {
            const response = await fetch(STATE_SHAPE_URL(estado.codigo_uf));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const geojson = await response.json();

            // The user may have deselected the state while the outline was loading.
            if (!state.selectedUfs.has(uf)) return;

            const layer = L.geoJSON(geojson, {
                pane: SHAPE_PANE,
                style: OUTLINE_STYLE,
                interactive: false,
            }).addTo(state.map);
            state.stateLayers.set(uf, layer);
            fitToSelection();
        } catch (error) {
            setStatus(`Não foi possível carregar o contorno de ${uf}. Os pontos continuam no mapa.`);
        } finally {
            state.shapeLoading.delete(uf);
        }
    }

    // ---------- municipality search suggestions ----------

    /** Up to MAX_SEARCH_RESULTS municipalities: names starting with the query first. */
    function searchSuggestions(query) {
        const needle = normalize(query.split(' - ')[0]);
        if (!needle) return [];

        const startsWith = [];
        const contains = [];
        for (const m of state.municipios) {
            const name = normalize(m.nome);
            if (name.startsWith(needle)) {
                startsWith.push(m);
            } else if (name.includes(needle)) {
                contains.push(m);
            }
        }
        return [...startsWith, ...contains].slice(0, MAX_SEARCH_RESULTS);
    }

    function openSearchList() {
        renderSearchList();
        el.searchList.classList.remove('hidden');
        el.searchInput.setAttribute('aria-expanded', 'true');
    }

    function closeSearchList() {
        el.searchList.classList.add('hidden');
        el.searchInput.setAttribute('aria-expanded', 'false');
        state.searchActive = -1;
    }

    function renderSearchList() {
        state.searchMatches = searchSuggestions(el.searchInput.value);
        if (state.searchActive >= state.searchMatches.length) state.searchActive = -1;

        el.searchList.replaceChildren();
        state.searchMatches.forEach((m, index) => {
            const item = document.createElement('li');
            item.className = 'search-option';
            item.classList.toggle('active', index === state.searchActive);
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(index === state.searchActive));

            const name = document.createElement('span');
            name.className = 'search-name';
            name.textContent = m.nome;

            const uf = document.createElement('span');
            uf.className = 'uf-name';
            uf.textContent = m.uf;

            item.append(name, uf);
            // mousedown fires before blur, so the choice registers before the list closes.
            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                chooseSuggestion(m);
            });
            el.searchList.appendChild(item);
        });
    }

    function chooseSuggestion(m) {
        el.searchInput.value = `${m.nome} - ${m.uf}`;
        closeSearchList();
        selectMunicipio(m);
        setStatus(`Mostrando ${m.nome} – ${m.uf}.`);
    }

    function moveSearchActive(step) {
        const count = state.searchMatches.length;
        if (count === 0) return;
        state.searchActive = (state.searchActive + step + count) % count;
        renderSearchList();
        const active = el.searchList.querySelector('.search-option.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function onSearchKeydown(event) {
        const listOpen = !el.searchList.classList.contains('hidden');

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!listOpen) openSearchList();
            moveSearchActive(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter' && listOpen && state.searchActive >= 0) {
            // Enter picks the highlighted suggestion instead of submitting the form.
            event.preventDefault();
            chooseSuggestion(state.searchMatches[state.searchActive]);
        } else if (event.key === 'Escape') {
            closeSearchList();
        }
    }

    // ---------- selection ----------

    function showInfo(m) {
        el.infoName.textContent = `${m.nome} – ${m.uf}`;

        const rows = [
            ['Código IBGE', m.codigo_ibge],
            ['Estado', state.estadosByCode.get(m.codigo_uf)?.nome ?? '—'],
            ['Região', state.estadosByCode.get(m.codigo_uf)?.regiao ?? '—'],
            ['DDD', m.ddd],
            ['Fuso horário', m.fuso_horario],
            ['Latitude', m.latitude.toFixed(4)],
            ['Longitude', m.longitude.toFixed(4)],
        ];
        if (m.capital) rows.push(['Capital', 'Sim']);
        if (m.distanceKm !== undefined) rows.push(['Distância', `${m.distanceKm.toFixed(1)} km`]);

        el.infoDetails.replaceChildren();
        for (const [label, value] of rows) {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = String(value);
            el.infoDetails.append(dt, dd);
        }
        el.info.classList.remove('hidden');
    }

    function selectMunicipio(m, distanceKm) {
        showInfo(distanceKm !== undefined ? { ...m, distanceKm } : m);
        state.map.flyTo([m.latitude, m.longitude], Math.max(state.map.getZoom(), 9));
    }

    // ---------- geolocation ----------

    const GEO_ERRORS = {
        1: 'Permissão de localização negada.',
        2: 'Posição indisponível no momento.',
        3: 'Tempo esgotado ao obter a localização.',
    };

    function showUserLocation(lat, lon, accuracy) {
        if (state.userMarker) state.userMarker.remove();
        if (state.userCircle) state.userCircle.remove();

        state.userMarker = L.marker([lat, lon]).addTo(state.map)
            .bindPopup('Você está aqui');
        state.userCircle = L.circle([lat, lon], {
            radius: accuracy,
            color: '#2563eb',
            fillOpacity: 0.1,
        }).addTo(state.map);
    }

    function locateUser() {
        if (!('geolocation' in navigator)) {
            setStatus('Seu navegador não suporta geolocalização.');
            return;
        }
        setStatus('Obtendo sua localização…');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                const result = nearestMunicipio(latitude, longitude, visibleMunicipios());
                if (!result) {
                    setStatus('Nenhum município disponível com o filtro atual.');
                    return;
                }

                showUserLocation(latitude, longitude, accuracy);
                selectMunicipio(result.municipio, result.distanceKm);
                setStatus(
                    `Município mais próximo: ${result.municipio.nome} – ${result.municipio.uf} `
                    + `(${result.distanceKm.toFixed(1)} km)`
                );
            },
            (error) => {
                setStatus(GEO_ERRORS[error.code] || 'Não foi possível obter sua localização.');
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
        );
    }

    // ---------- events ----------

    function findByQuery(query) {
        const needle = normalize(query);
        if (!needle) return null;

        // Accepts "Nome - UF" (as written by a suggestion), or a plain name.
        const [namePart, ufPart] = query.split(' - ');
        const ufHint = ufPart ? ufPart.trim().toUpperCase() : '';
        const wanted = normalize(namePart);

        const candidates = state.municipios.filter((m) => (
            (!ufHint || m.uf === ufHint) && normalize(m.nome).includes(wanted)
        ));
        // Exact matches win over partial matches.
        return candidates.find((m) => normalize(m.nome) === wanted) || candidates[0] || null;
    }

    function bindEvents() {
        el.searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const match = findByQuery(el.searchInput.value);
            if (match) {
                selectMunicipio(match);
                setStatus(`Mostrando ${match.nome} – ${match.uf}.`);
            } else {
                setStatus('Município não encontrado.');
            }
        });

        // Municipality suggestions.
        el.searchInput.addEventListener('focus', () => {
            if (el.searchInput.value.trim()) openSearchList();
        });
        el.searchInput.addEventListener('input', () => {
            state.searchActive = 0;
            openSearchList();
            if (state.searchMatches.length === 0) state.searchActive = -1;
        });
        el.searchInput.addEventListener('keydown', onSearchKeydown);

        // UF multi-select.
        el.ufInput.addEventListener('focus', openUfList);
        el.ufInput.addEventListener('input', () => {
            state.ufActiveIndex = -1;
            openUfList();
        });
        el.ufInput.addEventListener('keydown', onUfKeydown);
        el.ufBox.addEventListener('click', () => el.ufInput.focus());
        el.ufClear.addEventListener('click', clearUfSelection);
        document.addEventListener('mousedown', (event) => {
            if (!el.ufField.contains(event.target)) closeUfList();
            if (!el.searchForm.contains(event.target)) closeSearchList();
        });

        // Field filter: the select chooses the field, the input supplies the value.
        el.fieldSelect.addEventListener('change', () => {
            state.fieldFilter.field = el.fieldSelect.value;
            applyUfFilter();
        });
        el.fieldInput.addEventListener('input', () => {
            state.fieldFilter.value = el.fieldInput.value;
            applyUfFilter();
        });
        el.fieldInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.preventDefault();
        });

        el.locateBtn.addEventListener('click', locateUser);
        el.infoClose.addEventListener('click', () => el.info.classList.add('hidden'));

        el.togglePanel.addEventListener('click', () => {
            const collapsed = el.toolbar.classList.toggle('collapsed');
            el.togglePanel.innerHTML = collapsed ? PLUS_ICON : MINUS_ICON;
            el.togglePanel.setAttribute('aria-expanded', String(!collapsed));
            el.togglePanel.setAttribute('aria-label', collapsed ? 'Expandir painel' : 'Minimizar painel');
            el.togglePanel.title = collapsed ? 'Expandir' : 'Minimizar';
        });
    }

    // ---------- start ----------

    async function init() {
        try {
            await loadData();
        } catch (error) {
            setStatus(
                `Não foi possível carregar os dados (${error.message}). `
                + 'Sirva a pasta do repositório com um servidor local, por exemplo: python -m http.server'
            );
            return;
        }

        populateControls();
        initMap();
        bindEvents();
        setStatus(`${state.municipios.length} municípios carregados.`);
    }

    init();
})();
