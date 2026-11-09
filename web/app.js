/* Brazilian municipalities explorer: 3D globe, 2D map and geolocation.
 *
 * All data is loaded from the repository's JSON files, and all distance
 * calculations run in the browser. No coordinates are sent to any server.
 */
(function () {
    'use strict';

    // Data files live one level up, at the repository root.
    const MUNICIPIOS_URL = '../json/municipios.json';
    const ESTADOS_URL = '../json/estados.json';

    // Earth texture served by three-globe (pinned version).
    const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
    const OSM_TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    const TIMEZONE_COLORS = {
        'America/Sao_Paulo': '#2563eb',
        'America/Porto_Velho': '#f97316',
        'America/Rio_Branco': '#16a34a',
        'America/Noronha': '#a855f7',
    };
    const DEFAULT_COLOR = '#94a3b8';
    const CAPITAL_COLOR = '#facc15';
    const EARTH_RADIUS_KM = 6371.0088;

    const state = {
        municipios: [],
        estadosByCode: new Map(),
        estadosByUf: new Map(),
        globe: null,
        map: null,
        mapLayer: null,
        userMarker: null,
        userCircle: null,
        selected: null,
        ufFilter: '',
        mode: 'globe',
    };

    const el = {
        status: document.getElementById('status'),
        searchForm: document.getElementById('search-form'),
        searchInput: document.getElementById('search-input'),
        datalist: document.getElementById('municipios-list'),
        ufFilter: document.getElementById('uf-filter'),
        modeGlobe: document.getElementById('mode-globe'),
        modeMap: document.getElementById('mode-map'),
        locateBtn: document.getElementById('locate-btn'),
        globe: document.getElementById('globe'),
        map: document.getElementById('map'),
        info: document.getElementById('info'),
        infoName: document.getElementById('info-name'),
        infoDetails: document.getElementById('info-details'),
        infoClose: document.getElementById('info-close'),
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

    /** Escape text before inserting it into HTML strings. */
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[char]);
    }

    function ufOf(municipio) {
        const estado = state.estadosByCode.get(municipio.codigo_uf);
        return estado ? estado.uf : '';
    }

    function visibleMunicipios() {
        if (!state.ufFilter) return state.municipios;
        return state.municipios.filter((m) => m.uf === state.ufFilter);
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
        const ufs = [...state.estadosByUf.keys()].sort();
        for (const uf of ufs) {
            const option = document.createElement('option');
            option.value = uf;
            option.textContent = uf;
            el.ufFilter.appendChild(option);
        }

        // Datalist powers the browser's built-in autocomplete.
        const fragment = document.createDocumentFragment();
        for (const m of state.municipios) {
            const option = document.createElement('option');
            option.value = `${m.nome} - ${m.uf}`;
            fragment.appendChild(option);
        }
        el.datalist.appendChild(fragment);
    }

    function initGlobe() {
        state.globe = Globe()(el.globe)
            .globeImageUrl(EARTH_TEXTURE_URL)
            .backgroundColor('rgba(0,0,0,0)')
            .atmosphereColor('#60a5fa')
            .atmosphereAltitude(0.18)
            .pointLat('latitude')
            .pointLng('longitude')
            .pointColor(colorFor)
            .pointAltitude((m) => (m.capital ? 0.06 : 0.01))
            .pointRadius((m) => (m.capital ? 0.4 : 0.18))
            .pointLabel((m) => `<b>${escapeHtml(m.nome)}</b> – ${escapeHtml(m.uf)}`)
            .onPointClick((m) => selectMunicipio(m))
            .ringColor(() => 'rgba(250, 204, 21, 0.9)')
            .ringMaxRadius(3)
            .ringPropagationSpeed(2)
            .ringRepeatPeriod(900);

        state.globe.pointOfView({ lat: -14, lng: -52, altitude: 2.2 }, 0);
        refreshGlobe();
    }

    function initMap() {
        state.map = L.map(el.map, { preferCanvas: true, zoomControl: true })
            .setView([-14.2, -51.9], 4);

        L.tileLayer(OSM_TILES_URL, {
            maxZoom: 19,
            attribution: OSM_ATTRIBUTION,
        }).addTo(state.map);

        state.mapLayer = L.layerGroup().addTo(state.map);

        // Clicking the map selects the nearest municipality to the click.
        state.map.on('click', (event) => {
            const result = nearestMunicipio(event.latlng.lat, event.latlng.lng, visibleMunicipios());
            if (result) selectMunicipio(result.municipio);
        });

        refreshMap();
    }

    function refreshGlobe() {
        state.globe.pointsData(visibleMunicipios());
    }

    function refreshMap() {
        if (!state.map) return;
        state.mapLayer.clearLayers();
        for (const m of visibleMunicipios()) {
            L.circleMarker([m.latitude, m.longitude], {
                radius: m.capital ? 4 : 2,
                color: colorFor(m),
                fillColor: colorFor(m),
                fillOpacity: 0.85,
                weight: 0,
            })
                .on('click', () => selectMunicipio(m))
                .addTo(state.mapLayer);
        }
    }

    function refreshAll() {
        refreshGlobe();
        refreshMap();
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
        state.selected = m;
        showInfo(distanceKm !== undefined ? { ...m, distanceKm } : m);

        // Pulse ring on the globe and a centered view on both maps.
        state.globe.ringsData([m]);
        state.globe.pointOfView({ lat: m.latitude, lng: m.longitude, altitude: 0.6 }, 1000);

        if (state.map) {
            state.map.flyTo([m.latitude, m.longitude], Math.max(state.map.getZoom(), 9));
        }
    }

    // ---------- modes ----------

    function setMode(mode) {
        state.mode = mode;
        const isGlobe = mode === 'globe';
        el.globe.classList.toggle('hidden', !isGlobe);
        el.map.classList.toggle('hidden', isGlobe);
        el.modeGlobe.classList.toggle('active', isGlobe);
        el.modeMap.classList.toggle('active', !isGlobe);
        el.modeGlobe.setAttribute('aria-pressed', String(isGlobe));
        el.modeMap.setAttribute('aria-pressed', String(!isGlobe));

        if (!isGlobe) {
            if (!state.map) initMap();
            state.map.invalidateSize();
        }
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
        if (!state.map) initMap();

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

        // Accepts "Nome - UF" from the datalist, or a plain name.
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

        el.ufFilter.addEventListener('change', () => {
            state.ufFilter = el.ufFilter.value;
            refreshAll();
            setStatus(state.ufFilter
                ? `${visibleMunicipios().length} municípios em ${state.ufFilter}.`
                : `${state.municipios.length} municípios.`);
        });

        el.modeGlobe.addEventListener('click', () => setMode('globe'));
        el.modeMap.addEventListener('click', () => setMode('map'));
        el.locateBtn.addEventListener('click', locateUser);
        el.infoClose.addEventListener('click', () => el.info.classList.add('hidden'));
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
        initGlobe();
        bindEvents();
        setStatus(`${state.municipios.length} municípios carregados.`);
    }

    init();
})();
