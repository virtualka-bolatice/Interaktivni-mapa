'use strict';

// ════════════════════════════════════════════════════════════════
//  nav.js — Navigace: mode picker, follow + heading, recenter
//
//  FLOW:
//    1. geolocate() → nav-pick-btn viditelný
//    2. toggleNavPick() → crosshair, klik → Nominatim → nav-confirm
//    3. confirmNav() → fetchRoutes() v pozadí → showModePicker() s časy
//    4. pickNavMode('driving'|'walking') → navigateTo() → trasa na mapě
//    5. Follow mode: mapa sleduje GPS, heading marker rotuje
//    6. Pohyb mapy → recenter-btn; klik → znovu centruje + follow on
//
//  Deaktivace: zakomentuj <script src="js/nav.js"> v index.html
// ════════════════════════════════════════════════════════════════

const OSRM_BASE     = 'https://router.project-osrm.org/route/v1';
const NOM_BASE      = 'https://nominatim.openstreetmap.org/reverse';
const WALK_SPEED_MS = 1.25;   // 4.5 km/h — realističtější než OSRM default
const ARRIVE_M      = 25;     // m — "cíl dosažen"

// ── Stav ─────────────────────────────────────────────────────────
let _navPickActive = false;
let _pendingLat    = null;
let _pendingLng    = null;
let _pendingName   = null;
let _pickDotMarker = null;

// Mode picker — předem načtené trasy
let _fetchedDriveRoute = null;
let _fetchedWalkRoute  = null;
let _fetchedTarget     = null;   // { lat, lng, name }

// Aktivní navigace
let _navMode           = null;   // 'driving' | 'walking'
let _navActive         = false;
let _driveFullCoords   = [];
let _walkFullCoords    = [];
let _activeFullCoords  = [];     // aktuálně aktivní trasa

// Vrstvy
let _layerDone    = null;   // šedá (projeto)
let _layerTodo    = null;   // barevná (zbývá)
let _layerShadow  = null;   // glow
let _destMarker   = null;
let _posMarker    = null;   // šipkový heading marker

// GPS tracking
let _trackWatchId = null;
let _trackTarget  = null;
let _remDist      = 0;
let _avgSpeedMS   = 13.9;   // m/s — průměrná auto rychlost z route

// Follow + heading
let _followMode   = false;
let _lastHeading  = null;
let _mapMoved     = false;  // uživatel pohnul mapou

// ════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════
function _geoToLatLng(geom) {
  return geom.coordinates.map(c => [c[1], c[0]]);
}

function _haversine(a, b) {
  const R = 6371000;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const s1   = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s1*s1 + Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*s2*s2));
}

function _polyLen(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += _haversine(coords[i-1], coords[i]);
  return d;
}

function _trimRoute(coords, lat, lng) {
  if (coords.length < 2) return { idx: 0, trimmed: coords };
  let minD = Infinity, minI = 0;
  const pos = [lat, lng];
  coords.forEach((c, i) => { const d = _haversine(pos, c); if (d < minD) { minD = d; minI = i; } });
  return { idx: minI, trimmed: coords.slice(minI) };
}

function _fmtDur(sec) {
  if (!sec || sec < 0) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function _fmtDist(m) {
  if (!m) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`;
}

// ════════════════════════════════════════════════════════════════
//  PICK MODE — výběr cíle kliknutím na mapu
// ════════════════════════════════════════════════════════════════
function _removePick() {
  if (_pickDotMarker) { try { map.removeLayer(_pickDotMarker); } catch(e){} _pickDotMarker = null; }
}

async function _onMapPick(e) {
  if (!_navPickActive) return;
  const { lat, lng } = e.latlng;
  _pendingLat = lat; _pendingLng = lng;
  _navPickActive = false;
  map.getContainer().style.cursor = '';
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  const lbl = document.getElementById('nav-pick-lbl');
  if (lbl) lbl.textContent = 'Změnit cíl';

  _removePick();
  _pickDotMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div style="width:18px;height:18px;background:#0ea5e9;border:3px solid #fff;border-radius:50%;
               box-shadow:0 0 14px #0ea5e9bb;animation:pick-pulse 1s ease infinite"></div>`,
      className: '', iconSize: [18,18], iconAnchor: [9,9],
    }),
    zIndexOffset: 1000,
  }).addTo(map);

  const nc = document.getElementById('nc-dest-name');
  if (nc) nc.textContent = '⏳ Hledám adresu…';
  document.getElementById('nav-confirm')?.classList.add('on');

  try {
    const r = await fetch(
      `${NOM_BASE}?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=0`,
      { headers: { 'Accept-Language': 'cs' } }
    );
    _pendingName = r.ok
      ? ((await r.json()).display_name || '').split(',').slice(0, 2).join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch(e) {
    _pendingName = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  if (nc) nc.textContent = _pendingName;
}

function toggleNavPick() {
  if (_navPickActive) {
    _navPickActive = false;
    map.off('click', _onMapPick);
    map.getContainer().style.cursor = '';
    document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
    const lbl = document.getElementById('nav-pick-lbl');
    if (lbl) lbl.textContent = 'Vybrat cíl na mapě';
    return;
  }
  _navPickActive = true;
  document.getElementById('nav-confirm')?.classList.remove('on');
  _removePick();
  map.getContainer().style.cursor = 'crosshair';
  document.getElementById('nav-pick-btn')?.classList.add('pick-active');
  const lbl = document.getElementById('nav-pick-lbl');
  if (lbl) lbl.textContent = 'Klikni na cíl…';
  map.once('click', _onMapPick);
  badge('🎯 Klikni na mapu pro výběr cíle');
}

// ════════════════════════════════════════════════════════════════
//  CONFIRM → zobraz picker se spinnerem → fetch → vyplň časy
// ════════════════════════════════════════════════════════════════
async function confirmNav() {
  if (_pendingLat === null) return;
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('on');

  const geoPos = (typeof getGeoLatLng === 'function') ? getGeoLatLng() : null;
  if (!geoPos) { badge('📍 Nejdříve zapni polohu'); return; }

  const tLat = _pendingLat, tLng = _pendingLng, tName = _pendingName;
  _fetchedTarget  = { lat: tLat, lng: tLng, name: tName };
  _fetchedDriveRoute = null;
  _fetchedWalkRoute  = null;

  // Zobraz picker ihned — spinner stav
  _openModePicker(tName);

  const coord  = `${geoPos.lng},${geoPos.lat};${tLng},${tLat}`;
  const params = '?overview=full&geometries=geojson&steps=false';

  try {
    const [dr, wr] = await Promise.allSettled([
      fetch(`${OSRM_BASE}/driving/${coord}${params}`),
      fetch(`${OSRM_BASE}/walking/${coord}${params}`),
    ]);
    _fetchedDriveRoute = dr.status === 'fulfilled' && dr.value.ok
      ? ((await dr.value.json()).routes?.[0] ?? null) : null;
    _fetchedWalkRoute  = wr.status === 'fulfilled' && wr.value.ok
      ? ((await wr.value.json()).routes?.[0] ?? null) : null;
  } catch(e) {
    console.error('nav fetch:', e);
  }

  if (!_fetchedDriveRoute && !_fetchedWalkRoute) {
    cancelModePicker();
    badge('❌ Trasa nenalezena — zkontroluj připojení');
    return;
  }

  // Přepočet chůze: reálná rychlost 4.5 km/h
  const wc  = _fetchedWalkRoute ? _geoToLatLng(_fetchedWalkRoute.geometry) : [];
  const wd  = _polyLen(wc);
  const wt  = wd > 0 ? Math.round(wd / WALK_SPEED_MS) : (_fetchedWalkRoute?.duration ?? null);

  // Vyplň časy — přepne ze spinnerů na karty
  _fillModePicker(
    _fetchedDriveRoute?.duration  ?? null,
    _fetchedDriveRoute?.distance  ?? null,
    wt,
    wd || (_fetchedWalkRoute?.distance ?? null),
  );
}

function cancelNavPick() {
  _navPickActive = false;
  _pendingLat = _pendingLng = _pendingName = null;
  map.off('click', _onMapPick);
  map.getContainer().style.cursor = '';
  _removePick();
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  const lbl = document.getElementById('nav-pick-lbl');
  if (lbl) lbl.textContent = 'Vybrat cíl na mapě';
}

// ════════════════════════════════════════════════════════════════
//  MODE PICKER UI
// ════════════════════════════════════════════════════════════════

// 1. Otevři picker ve spinner stavu
function _openModePicker(name) {
  const el = document.getElementById('nav-mode-picker');
  if (!el) return;

  document.getElementById('nmp-dest-name').textContent = name || 'Cíl';

  // Zobraz spinner, schovej karty
  const loading = document.getElementById('nmp-loading');
  const opts    = document.getElementById('nmp-opts');
  if (loading) loading.style.display = 'flex';
  if (opts)    opts.style.display    = 'none';

  // Reset tlačítek
  ['nmp-drive', 'nmp-walk'].forEach(id => {
    document.getElementById(id)?.removeAttribute('disabled');
  });

  el.classList.add('on');
}

// 2. Vyplň časy (přepne ze spinnerů na karty)
function _fillModePicker(driveDur, driveDist, walkDur, walkDist) {
  const loading = document.getElementById('nmp-loading');
  const opts    = document.getElementById('nmp-opts');
  if (loading) loading.style.display = 'none';
  if (opts)    opts.style.display    = 'flex';

  // Časy
  const dt = document.getElementById('nmp-drive-time');
  const wt = document.getElementById('nmp-walk-time');
  const dd = document.getElementById('nmp-drive-dist');
  const wd = document.getElementById('nmp-walk-dist');

  if (dt) dt.textContent = driveDur  ? _fmtDur(driveDur)   : '–';
  if (wt) wt.textContent = walkDur   ? _fmtDur(walkDur)    : '–';
  if (dd) dd.textContent = driveDist ? _fmtDist(driveDist)  : '';
  if (wd) wd.textContent = walkDist  ? _fmtDist(walkDist)   : '';

  // Zašedi nedostupnou volbu
  if (!_fetchedDriveRoute && document.getElementById('nmp-drive'))
    document.getElementById('nmp-drive').disabled = true;
  if (!_fetchedWalkRoute && document.getElementById('nmp-walk'))
    document.getElementById('nmp-walk').disabled  = true;
}

function cancelModePicker() {
  const el = document.getElementById('nav-mode-picker');
  el?.classList.remove('on');
  _fetchedDriveRoute = _fetchedWalkRoute = _fetchedTarget = null;

  // Reset do výchozího stavu pro příští otevření
  const loading = document.getElementById('nmp-loading');
  const opts    = document.getElementById('nmp-opts');
  if (loading) loading.style.display = 'flex';
  if (opts)    opts.style.display    = 'none';
  ['nmp-drive', 'nmp-walk'].forEach(id => document.getElementById(id)?.removeAttribute('disabled'));

  // Znovu zobraz nav-pick-btn pokud je geo aktivní
  if (typeof getGeoLatLng === 'function' && getGeoLatLng()) {
    document.getElementById('nav-pick-btn')?.classList.add('on');
  }
}

async function pickNavMode(mode) {
  document.getElementById('nav-mode-picker')?.classList.remove('on');
  _navMode = mode;
  const t = _fetchedTarget;
  if (!t) return;

  // DŮLEŽITÉ: zachyť trasy PŘED voláním _startNav,
  // protože clearNav() uvnitř je vymaže dřív, než je použijeme
  const savedDrive = _fetchedDriveRoute;
  const savedWalk  = _fetchedWalkRoute;

  await _startNav(t.lat, t.lng, t.name, mode, savedDrive, savedWalk);
}

// ════════════════════════════════════════════════════════════════
//  START NAVIGACE
// ════════════════════════════════════════════════════════════════
async function _startNav(tLat, tLng, tName, mode, driveRoute, walkRoute) {
  // Zachyť trasy jako opravdové lokální proměnné (null pokud undefined)
  // MUSÍ být před clearNav(), který nuluje všechny globální proměnné
  const _dr = (driveRoute ?? _fetchedDriveRoute) ?? null;
  const _wr = (walkRoute  ?? _fetchedWalkRoute)  ?? null;

  clearNav();  // nuluje _navMode, _fetchedDriveRoute, _fetchedWalkRoute, atd.

  // Obnov _navMode — clearNav() ho smazal, potřebujeme ho pro _onTrack a _redrawProgress
  _navMode = mode;

  if (typeof hideGeoVisuals === 'function') hideGeoVisuals();

  const route = mode === 'driving' ? _dr : _wr;
  if (!route) {
    badge('❌ Trasa nenalezena — vyber cíl znovu');
    return;
  }

  if (!map.getPane('navPane')) {
    map.createPane('navPane');
    map.getPane('navPane').style.zIndex = 350;
  }

  const coords = _geoToLatLng(route.geometry);
  if (mode === 'driving') {
    _driveFullCoords = coords;
    _walkFullCoords  = _wr ? _geoToLatLng(_wr.geometry) : [];
  } else {
    _walkFullCoords  = coords;
    _driveFullCoords = _dr ? _geoToLatLng(_dr.geometry) : [];
  }
  _activeFullCoords = coords;

  const dist = _polyLen(coords);
  const dur  = mode === 'driving'
    ? route.duration
    : Math.round(dist / WALK_SPEED_MS);

  if (route.duration && route.distance) {
    _avgSpeedMS = route.distance / route.duration;
  }

  // Vykresli trasu
  _drawActiveRoute(coords, mode);

  // Marker cíle
  _destMarker = L.marker([tLat, tLng], {
    icon: L.divIcon({
      html: `<div style="width:22px;height:22px;background:#f97316;border:3px solid #fff;
               border-radius:50%;box-shadow:0 0 14px #f97316aa;
               display:flex;align-items:center;justify-content:center;font-size:.72rem;">🎯</div>`,
      className: '', iconSize: [22,22], iconAnchor: [11,11],
    }),
    pane: 'navPane', zIndexOffset: 500,
  }).addTo(map).bindPopup(`<div style="padding:6px 10px;font-size:.75rem;font-family:DM Sans,sans-serif">
    🎯 <strong>${tName || 'Cíl'}</strong></div>`);

  // Widget
  _showNavWidget(mode, tName, dur, dist);

  // body.nav-on — skryje badge + nav-pick-btn
  document.body.classList.add('nav-on');
  _navActive = true;

  // Fit bounds
  try { map.fitBounds(L.latLngBounds(coords).pad(.12)); } catch(e) {}

  // Follow zapnutý defaultně
  _setFollow(true);

  // Sleduj pohyb mapy → zobraz recenter
  map.on('dragstart', _onMapDrag);

  // Spusť tracking
  _startTracking(tLat, tLng, tName);

  document.getElementById('fab-nav')?.classList.add('on');
  // geo-status schovat až po získání první polohy (ui.js _onGeoUpdate to řídí)
  // badge schován body.nav-on — použijeme nav-geo-status
}

// Volatelná z POI popupu (zpětná kompatibilita)
async function navigateTo(tLat, tLng, tName) {
  const geoPos = (typeof getGeoLatLng === 'function') ? getGeoLatLng() : null;
  if (!geoPos) { badge('📍 Nejdříve zapni polohu'); return; }

  _pendingLat  = tLat;
  _pendingLng  = tLng;
  _pendingName = tName;

  // Fetch tras a ukáž picker
  _fetchedTarget     = { lat: tLat, lng: tLng, name: tName };
  _fetchedDriveRoute = null; _fetchedWalkRoute = null;
  _openModePicker(tName);

  const coord  = `${geoPos.lng},${geoPos.lat};${tLng},${tLat}`;
  const params = '?overview=full&geometries=geojson&steps=false';
  try {
    const [dr, wr] = await Promise.allSettled([
      fetch(`${OSRM_BASE}/driving/${coord}${params}`),
      fetch(`${OSRM_BASE}/walking/${coord}${params}`),
    ]);
    _fetchedDriveRoute = dr.status === 'fulfilled' && dr.value.ok ? ((await dr.value.json()).routes?.[0] ?? null) : null;
    _fetchedWalkRoute  = wr.status === 'fulfilled' && wr.value.ok ? ((await wr.value.json()).routes?.[0] ?? null) : null;
  } catch(e) { cancelModePicker(); badge('❌ Chyba trasy'); return; }

  const wc = _fetchedWalkRoute ? _geoToLatLng(_fetchedWalkRoute.geometry) : [];
  const wd = _polyLen(wc);
  const wt = wd > 0 ? Math.round(wd / WALK_SPEED_MS) : (_fetchedWalkRoute?.duration ?? null);
  // Uloži reference před fillModePicker, pickNavMode je pak dostane přes parametry
  _fillModePicker(
    _fetchedDriveRoute?.duration ?? null, _fetchedDriveRoute?.distance ?? null,
    wt, wd || (_fetchedWalkRoute?.distance ?? null));
  // _fetchedDriveRoute/_fetchedWalkRoute zůstanou nastavené pro pickNavMode
}

// ════════════════════════════════════════════════════════════════
//  KRESLENÍ TRASY
// ════════════════════════════════════════════════════════════════
function _drawActiveRoute(coords, mode) {
  [_layerShadow, _layerDone, _layerTodo].forEach(l => { if(l) try{ map.removeLayer(l); }catch(e){} });

  const color = mode === 'driving' ? '#3b82f6' : '#10b981';
  const w     = mode === 'driving' ? 5 : 3;
  const dash  = mode === 'walking' ? '7,5' : undefined;

  _layerShadow = L.polyline(coords, {
    pane: 'navPane', color: mode === 'driving' ? '#1e40af' : '#065f46',
    weight: w + 4, opacity: .2, lineCap: 'round', lineJoin: 'round',
  }).addTo(map);

  _layerTodo = L.polyline(coords, {
    pane: 'navPane', color, weight: w, opacity: .92,
    lineCap: 'round', lineJoin: 'round',
    ...(dash ? { dashArray: dash } : {}),
  }).addTo(map);

  _layerDone = null;
}

function _redrawProgress(doneCoords, todoCoords) {
  const mode  = _navMode;
  const color = mode === 'driving' ? '#3b82f6' : '#10b981';
  const w     = mode === 'driving' ? 5 : 3;
  const dash  = mode === 'walking' ? '7,5' : undefined;

  if (_layerDone) try{ map.removeLayer(_layerDone); }catch(e){}
  if (_layerTodo) try{ map.removeLayer(_layerTodo); }catch(e){}
  if (_layerShadow) try{ map.removeLayer(_layerShadow); }catch(e){}

  if (doneCoords.length > 1) {
    _layerDone = L.polyline(doneCoords, {
      pane: 'navPane', color: '#475569', weight: w, opacity: .45,
      lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
  }
  if (todoCoords.length > 1) {
    _layerShadow = L.polyline(todoCoords, {
      pane: 'navPane', color: mode === 'driving' ? '#1e40af' : '#065f46',
      weight: w + 4, opacity: .2, lineCap: 'round', lineJoin: 'round',
    }).addTo(map);

    _layerTodo = L.polyline(todoCoords, {
      pane: 'navPane', color, weight: w, opacity: .92,
      lineCap: 'round', lineJoin: 'round',
      ...(dash ? { dashArray: dash } : {}),
    }).addTo(map);
  }
}

// ════════════════════════════════════════════════════════════════
//  WIDGET
// ════════════════════════════════════════════════════════════════
function _showNavWidget(mode, name, durSec, distM) {
  document.getElementById('nav-mode-ico').textContent  = mode === 'driving' ? '🚗' : '🚶';
  document.getElementById('nav-dest-name').textContent = name || 'Cíl';
  document.getElementById('nav-active-time').textContent = _fmtDur(durSec);
  document.getElementById('nav-dist').textContent      = distM ? _fmtDist(distM) : '';
  document.getElementById('nav-widget').classList.add('on');
}

function _updateWidget(remSec, remDist) {
  const tv = document.getElementById('nav-active-time');
  if (tv) tv.textContent = remSec > 0 ? _fmtDur(remSec) : '✓';
  const dv = document.getElementById('nav-dist');
  if (dv) dv.textContent = remDist > 0 ? `${_fmtDist(remDist)} zbývá` : 'V cíli';
}

// ════════════════════════════════════════════════════════════════
//  FOLLOW MODE + HEADING
// ════════════════════════════════════════════════════════════════
function _setFollow(on) {
  _followMode = on;
  _mapMoved   = false;
  const btn   = document.getElementById('nav-follow-btn');
  const rc    = document.getElementById('nav-recenter-btn');
  const rc2   = document.getElementById('nav-recenter-btn2');
  if (btn) btn.classList.toggle('follow-on', on);
  if (rc)  rc.classList.toggle('on', !on);
  if (rc2) rc2.classList.toggle('on', !on);
  if (on) {
    // Ihned vycentruj
    const pos = (typeof getGeoLatLng === 'function') ? getGeoLatLng() : null;
    if (pos) map.setView(pos, Math.max(map.getZoom(), 16));
  }
}

function toggleNavFollow() { _setFollow(!_followMode); }

function navRecenter() {
  _setFollow(true);
}

function _onMapDrag() {
  if (!_navActive) return;
  if (_followMode) {
    _followMode = false;
    _mapMoved   = true;
    const btn  = document.getElementById('nav-follow-btn');
    if (btn) btn.classList.remove('follow-on');
    document.getElementById('nav-recenter-btn')?.classList.add('on');
    document.getElementById('nav-recenter-btn2')?.classList.add('on');
  }
}

// ── Heading marker (šipka směru jízdy) ───────────────────────────
// Použijeme SVG šipku rotovanou podle heading
function _buildHeadingIcon(heading, mode) {
  const color = mode === 'driving' ? '#3b82f6' : '#10b981';
  const deg   = (heading ?? 0);
  return L.divIcon({
    html: `<div style="
      width:20px;height:20px;
      display:flex;align-items:center;justify-content:center;
      transform: rotate(${deg}deg);
      filter: drop-shadow(0 0 4px ${color}aa);
    ">
      <svg viewBox="0 0 20 20" width="20" height="20">
        <polygon points="10,1 16,17 10,13 4,17" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      </svg>
    </div>`,
    className: '', iconSize: [20,20], iconAnchor: [10,10],
  });
}

function _updatePosMarker(lat, lng, heading) {
  const ico = _buildHeadingIcon(heading, _navMode);
  if (!_posMarker) {
    _posMarker = L.marker([lat, lng], { icon: ico, pane: 'navPane', zIndexOffset: 900 })
      .addTo(map);
  } else {
    _posMarker.setLatLng([lat, lng]);
    _posMarker.setIcon(ico);
  }
}

// ════════════════════════════════════════════════════════════════
//  GPS TRACKING
// ════════════════════════════════════════════════════════════════
function _startTracking(tLat, tLng, tName) {
  _stopTracking();
  _trackTarget = { lat: tLat, lng: tLng, name: tName };
  if (!navigator.geolocation) return;
  _trackWatchId = navigator.geolocation.watchPosition(
    pos => _onTrack(pos),
    err => console.warn('nav track:', err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
  );
}

function _stopTracking() {
  if (_trackWatchId !== null) { navigator.geolocation.clearWatch(_trackWatchId); _trackWatchId = null; }
  _trackTarget = null;
}

function _onTrack(pos) {
  if (!_navActive) return;
  const lat     = pos.coords.latitude;
  const lng     = pos.coords.longitude;
  const heading = pos.coords.heading;   // null pokud nedostupný
  _lastHeading  = heading;

  _updatePosMarker(lat, lng, heading);

  // Follow: centruj mapu
  if (_followMode) {
    map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true, duration: 0.5 });
  }

  // Cíl dosažen?
  if (_trackTarget) {
    const d = _haversine([lat, lng], [_trackTarget.lat, _trackTarget.lng]);
    if (d <= ARRIVE_M) {
      badge(`🎉 Cíl dosažen: ${_trackTarget.name || 'Cíl'}`);
      _stopTracking();
      return;
    }
  }

  // Trim trasy
  if (_activeFullCoords.length > 1) {
    const { idx, trimmed } = _trimRoute(_activeFullCoords, lat, lng);
    const done = _activeFullCoords.slice(0, idx + 1);

    _redrawProgress(done, trimmed);

    // Přepočet zbývající vzdálenosti + času
    const remDist = _polyLen(trimmed);
    const remSec  = _navMode === 'driving'
      ? Math.round(remDist / (_avgSpeedMS || 13.9))
      : Math.round(remDist / WALK_SPEED_MS);
    _remDist = remDist;
    _updateWidget(remSec, remDist);
  }
}

// ════════════════════════════════════════════════════════════════
//  CLEAR
// ════════════════════════════════════════════════════════════════
function clearNav() {
  _stopTracking();
  _navActive    = false;
  _followMode   = false;
  _navMode      = null;
  _fetchedDriveRoute = _fetchedWalkRoute = _fetchedTarget = null;

  [_layerShadow, _layerDone, _layerTodo, _destMarker, _posMarker].forEach(l => {
    if (l) { try { map.removeLayer(l); } catch(e){} }
  });
  _layerShadow = _layerDone = _layerTodo = null;
  _destMarker  = _posMarker = null;
  _driveFullCoords = []; _walkFullCoords = []; _activeFullCoords = [];
  _remDist = 0;

  map.off('dragstart', _onMapDrag);

  _removePick();
  _navPickActive = false;
  map.off('click', _onMapPick);
  map.getContainer().style.cursor = '';

  document.getElementById('nav-widget')?.classList.remove('on');
  document.getElementById('fab-nav')?.classList.remove('on');
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-mode-picker')?.classList.remove('on');
  document.getElementById('nav-recenter-btn')?.classList.remove('on');
  document.getElementById('nav-recenter-btn2')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  document.getElementById('nav-follow-btn')?.classList.remove('follow-on');
  document.body.classList.remove('nav-on');

  const lbl = document.getElementById('nav-pick-lbl');
  if (lbl) lbl.textContent = 'Vybrat cíl na mapě';
  _pendingLat = _pendingLng = _pendingName = null;
}
