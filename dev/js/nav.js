'use strict';

// ════════════════════════════════════════════════════════════════
//  nav.js — Navigace: výběr cíle, OSRM trasa, live tracking
//
//  FLOW:
//    1. geolocate() v ui.js → zobrazí #nav-pick-btn
//    2. Klik → pick mode (crosshair), klik na mapu → Nominatim
//    3. Potvrzovací bar → confirmNav() → OSRM fetch (driving+walking)
//    4. Live GPS watch: trimuje ujetou část trasy, aktualizuje časy
//
//  Odhadovaná rychlost chůze: 4.5 km/h (reálnější než OSRM default 5 km/h)
//  Deaktivace: zakomentuj <script src="js/nav.js"> v index.html
// ════════════════════════════════════════════════════════════════

const OSRM_BASE   = 'https://router.project-osrm.org/route/v1';
const NOM_BASE    = 'https://nominatim.openstreetmap.org/reverse';

// Rychlost chůze: 4.5 km/h → 1.25 m/s — OSRM walking profil jezdí
// default 5 km/h, ale reálná městská chůze je 4–4.5 km/h
const WALK_SPEED_MS = 1.25;

// ── Stav ─────────────────────────────────────────────────────────
let _navPickActive    = false;
let _pendingLat       = null;
let _pendingLng       = null;
let _pendingName      = null;
let _pickDotMarker    = null;

// Vrstvy trasy
let _driveFullCoords  = [];   // [[lat,lng], …] – kompletní trasa auto
let _walkFullCoords   = [];   // [[lat,lng], …] – kompletní trasa pěšky
let _driveLayerDone   = null; // šedá (projeto) – auto
let _driveLayerTodo   = null; // modrá (zbývá)  – auto
let _walkLayerDone    = null; // šedá (projeto) – pěšky
let _walkLayerTodo    = null; // zelená (zbývá) – pěšky
let _driveShadow      = null; // glow shadow auto
let _navDestMarker    = null;
let _navPosMarker     = null; // aktuální poloha marker (přesný)

// GPS watching
let _watchId          = null;   // navigator.geolocation.watchPosition ID
let _lastPos          = null;   // { lat, lng } — poslední známá poloha
let _navDriveRemDist  = 0;
let _navWalkRemDist   = 0;
let _navMode          = null;   // null | 'drive' | 'walk'
let _navActive        = false;

// ── ROUTING ─────────────────────────────────────────────────────────

// Převod GeoJSON souřadnic [lng,lat] → [[lat,lng], …]
function _geoToLatLng(geom) {
  return geom.coordinates.map(c => [c[1], c[0]]);
}

// Vzdálenost dvou LatLng v metrech (Haversine)
function _haversine(a, b) {
  const R = 6371000;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const sinA  = Math.sin(dLat / 2);
  const sinB  = Math.sin(dLng / 2);
  const c = sinA * sinA + Math.cos(a[0] * Math.PI / 180) *
            Math.cos(b[0] * Math.PI / 180) * sinB * sinB;
  return 2 * R * Math.asin(Math.sqrt(c));
}

// Délka polyline v metrech
function _polyLen(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += _haversine(coords[i-1], coords[i]);
  return d;
}

// Nalezne nejbližší bod na polyline k dané poloze
// Vrátí { idx: index segmentu, trimmedCoords: zbývající souřadnice }
function _trimRoute(coords, posLat, posLng) {
  if (coords.length < 2) return { idx: 0, trimmedCoords: coords };
  const pos = [posLat, posLng];
  let minD  = Infinity, minI = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = _haversine(pos, coords[i]);
    if (d < minD) { minD = d; minI = i; }
  }
  // Vrátíme zbývající část — od nejbližšího bodu dál
  return { idx: minI, trimmedCoords: coords.slice(minI) };
}

// ── PICK MODE ───────────────────────────────────────────────────

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

  // Dočasný marker
  _removePick();
  _pickDotMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div style="width:18px;height:18px;background:#0ea5e9;border:3px solid #fff;border-radius:50%;
               box-shadow:0 0 14px #0ea5e9bb;animation:pick-pulse 1s ease infinite"></div>`,
      className: '', iconSize: [18,18], iconAnchor: [9,9],
    }),
    zIndexOffset: 1000,
  }).addTo(map);

  // Nominatim reverse geocoding
  const nc = document.getElementById('nc-dest-name');
  if (nc) nc.textContent = '⏳ Hledám adresu…';
  document.getElementById('nav-confirm')?.classList.add('on');

  try {
    const r = await fetch(
      `${NOM_BASE}?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=0`,
      { headers: { 'Accept-Language': 'cs' } }
    );
    if (r.ok) {
      const d = await r.json();
      _pendingName = d.display_name
        ? d.display_name.split(',').slice(0, 2).join(', ')
        : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } else {
      _pendingName = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
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

function confirmNav() {
  if (_pendingLat === null) return;
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('on');
  navigateTo(_pendingLat, _pendingLng, _pendingName);
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

// ── NAVIGACE (volatelná i z POI popupu) ──────────────────────────
async function navigateTo(targetLat, targetLng, targetName) {
  const geoPos = (typeof getGeoLatLng === 'function') ? getGeoLatLng() : null;
  if (!geoPos) {
    badge('📍 Nejdříve zapni polohu (📍 tlačítko)');
    return;
  }
  const oLat = geoPos.lat, oLng = geoPos.lng;

  clearNav();
  // Skryj geo marker/kruh — poloha stále aktivní pro tracking
  if (typeof hideGeoVisuals === 'function') hideGeoVisuals();
  badge('🧭 Načítám trasu…');

  try {
    if (!map.getPane('navPane')) {
      map.createPane('navPane');
      map.getPane('navPane').style.zIndex = 350;
    }

    const coord  = `${oLng},${oLat};${targetLng},${targetLat}`;
    const params = '?overview=full&geometries=geojson&steps=false';

    const [driveRes, walkRes] = await Promise.allSettled([
      fetch(`${OSRM_BASE}/driving/${coord}${params}`),
      fetch(`${OSRM_BASE}/walking/${coord}${params}`),
    ]);

    const driveData = driveRes.status === 'fulfilled' && driveRes.value.ok
      ? await driveRes.value.json() : null;
    const walkData  = walkRes.status  === 'fulfilled' && walkRes.value.ok
      ? await walkRes.value.json()  : null;

    if (!driveData?.routes?.length && !walkData?.routes?.length) {
      badge('❌ Trasa nenalezena — zkontroluj připojení');
      return;
    }

    const driveRoute = driveData?.routes?.[0];
    const walkRoute  = walkData?.routes?.[0];

    // ── Převod geometrie na [[lat,lng]] ──
    if (driveRoute) _driveFullCoords = _geoToLatLng(driveRoute.geometry);
    if (walkRoute)  _walkFullCoords  = _geoToLatLng(walkRoute.geometry);

    // ── Urči pěší vzdálenost (přepočet na reálnou rychlost) ──
    // OSRM walking vrací duration pro ~5 km/h, my chceme 4.5 km/h
    // Přepočet: dist / WALK_SPEED_MS
    const walkDist = walkRoute ? _polyLen(_walkFullCoords) : 0;
    const walkDuration = walkDist > 0 ? Math.round(walkDist / WALK_SPEED_MS) : walkRoute?.duration;

    _navDriveRemDist = driveRoute ? _polyLen(_driveFullCoords) : 0;
    _navWalkRemDist  = walkDist;

    // ── Vykresli trasy ──
    _drawRoute();

    // ── Marker cíle ──
    _navDestMarker = L.marker([targetLat, targetLng], {
      icon: L.divIcon({
        html: `<div style="
          width:22px;height:22px;background:#f97316;border:3px solid #fff;
          border-radius:50%;box-shadow:0 0 14px #f97316aa;
          display:flex;align-items:center;justify-content:center;font-size:.7rem;">🎯</div>`,
        className: '', iconSize: [22,22], iconAnchor: [11,11],
      }),
      pane: 'navPane',
      zIndexOffset: 500,
    }).addTo(map)
      .bindPopup(`<div style="padding:6px 10px;font-size:.75rem;font-family:DM Sans,sans-serif">
        🎯 <strong>${targetName || 'Cíl'}</strong></div>`);

    // ── Widget ──
    _showNavWidget({
      name:          targetName,
      driveDuration: driveRoute?.duration,
      driveDistance: driveRoute?.distance,
      walkDuration,
    });

    // ── Fit bounds ──
    try {
      const allCoords = [..._driveFullCoords, ..._walkFullCoords];
      if (allCoords.length) map.fitBounds(L.latLngBounds(allCoords).pad(.12));
    } catch(e) {}

    // ── Spusť live tracking ──
    _startTracking(targetLat, targetLng, targetName);

    document.getElementById('fab-nav')?.classList.add('on');
    _navActive = true;
    badge('✅ Trasa načtena — navigace spuštěna');

  } catch(err) {
    console.error('nav.js:', err);
    badge('❌ Chyba trasy');
  }
}

// ── VYKRESLENÍ TRASY ─────────────────────────────────────────────
function _drawRoute() {
  // Smaž staré vrstvy
  [_driveShadow, _driveLayerDone, _driveLayerTodo, _walkLayerDone, _walkLayerTodo].forEach(l => {
    if (l) { try { map.removeLayer(l); } catch(e){} }
  });

  // Shadow (glow) pro auto trasu
  if (_driveFullCoords.length) {
    _driveShadow = L.polyline(_driveFullCoords, {
      pane: 'navPane', color: '#1e40af', weight: 9, opacity: .2,
      lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
  }

  // Projeto (šedé) — viditelné jen pokud tracker vytvořil "done" část
  _driveLayerDone = null;
  _walkLayerDone  = null;

  // Zbývá auto (modrá)
  if (_driveFullCoords.length) {
    _driveLayerTodo = L.polyline(_driveFullCoords, {
      pane: 'navPane', color: '#3b82f6', weight: 5, opacity: .92,
      lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
  }

  // Zbývá pěšky (zelená tečkovaná) — jen pokud výrazně kratší
  const driveLen = _polyLen(_driveFullCoords);
  const walkLen  = _polyLen(_walkFullCoords);
  if (_walkFullCoords.length && (!driveLen || walkLen < driveLen * 0.75)) {
    _walkLayerTodo = L.polyline(_walkFullCoords, {
      pane: 'navPane', color: '#10b981', weight: 3, opacity: .75,
      dashArray: '7,5', lineCap: 'round',
    }).addTo(map);
  }
}

// ── LIVE TRACKING ────────────────────────────────────────────────
// Strategie:
//   • watchPosition každý ~3 s (enableHighAccuracy: true)
//   • při každé aktualizaci: najdi nejbližší bod na trase,
//     vyrenderuj "projeto" šedě, "zbývá" barevně
//   • aktualizuj zbývající vzdálenost a čas v widgetu
//   • polohu marker přesuň na novou GPS pozici
//   • při přiblížení na ≤ 25 m od cíle — oznámení + zastaví tracking

const _TRACK_INTERVAL_MS = 3000;  // ms — watchPosition min interval hint
const _ARRIVE_THRESHOLD  = 25;    // m — "cíl dosažen"

let _trackTarget = null;   // { lat, lng, name }

function _startTracking(tLat, tLng, tName) {
  _stopTracking();
  _trackTarget = { lat: tLat, lng: tLng, name: tName };

  if (!navigator.geolocation) return;

  _watchId = navigator.geolocation.watchPosition(
    pos => _onTrackUpdate(pos),
    err => console.warn('nav tracking geo err:', err.message),
    {
      enableHighAccuracy: true,
      maximumAge:         _TRACK_INTERVAL_MS,
      timeout:            10000,
    }
  );
}

function _stopTracking() {
  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }
  _trackTarget = null;
}

function _onTrackUpdate(pos) {
  if (!_navActive) return;
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  _lastPos  = { lat, lng };

  // ── Aktualizuj polohu marker ──
  _updatePosMarker(lat, lng, pos.coords.accuracy);

  // ── Zkontroluj cíl ──
  if (_trackTarget) {
    const distToDest = _haversine([lat, lng], [_trackTarget.lat, _trackTarget.lng]);
    if (distToDest <= _ARRIVE_THRESHOLD) {
      badge(`🎉 Cíl dosažen: ${_trackTarget.name || 'Cíl'}`);
      _stopTracking();
      return;
    }
  }

  // ── Trim auto trasy ──
  if (_driveFullCoords.length > 1) {
    const { idx, trimmedCoords } = _trimRoute(_driveFullCoords, lat, lng);
    const doneCoords = _driveFullCoords.slice(0, idx + 1);
    const todoCoords = trimmedCoords;

    // Redraw "done" (šedá)
    if (_driveLayerDone) { try { map.removeLayer(_driveLayerDone); } catch(e){} }
    if (doneCoords.length > 1) {
      _driveLayerDone = L.polyline(doneCoords, {
        pane: 'navPane', color: '#475569', weight: 5, opacity: .5,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(map);
    }

    // Redraw "todo" (modrá)
    if (_driveLayerTodo) { try { map.removeLayer(_driveLayerTodo); } catch(e){} }
    if (todoCoords.length > 1) {
      _driveLayerTodo = L.polyline(todoCoords, {
        pane: 'navPane', color: '#3b82f6', weight: 5, opacity: .92,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(map);
    }

    // Shadow update (jen "todo")
    if (_driveShadow) { try { map.removeLayer(_driveShadow); } catch(e){} }
    if (todoCoords.length > 1) {
      _driveShadow = L.polyline(todoCoords, {
        pane: 'navPane', color: '#1e40af', weight: 9, opacity: .2,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(map);
    }

    // Zbývající vzdálenost + čas auto
    _navDriveRemDist = _polyLen(todoCoords);
    const driveRemTime = _navDriveRemDist > 0
      ? Math.round(_navDriveRemDist / (driveRoute_avgSpeed() || 13.9)) // fallback 50 km/h
      : 0;
    _updateWidgetTimes(driveRemTime, null);
  }

  // ── Trim pěší trasy ──
  if (_walkFullCoords.length > 1) {
    const { idx: wi, trimmedCoords: wTodo } = _trimRoute(_walkFullCoords, lat, lng);
    const wDone = _walkFullCoords.slice(0, wi + 1);

    if (_walkLayerDone) { try { map.removeLayer(_walkLayerDone); } catch(e){} }
    if (wDone.length > 1) {
      _walkLayerDone = L.polyline(wDone, {
        pane: 'navPane', color: '#475569', weight: 3, opacity: .4,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(map);
    }
    if (_walkLayerTodo) { try { map.removeLayer(_walkLayerTodo); } catch(e){} }
    if (wTodo.length > 1) {
      _walkLayerTodo = L.polyline(wTodo, {
        pane: 'navPane', color: '#10b981', weight: 3, opacity: .75,
        dashArray: '7,5', lineCap: 'round',
      }).addTo(map);
    }

    // Zbývající čas pěšky (reálná rychlost 4.5 km/h)
    _navWalkRemDist = _polyLen(wTodo);
    const walkRemTime = _navWalkRemDist > 0
      ? Math.round(_navWalkRemDist / WALK_SPEED_MS)
      : 0;
    _updateWidgetTimes(null, walkRemTime);
  }
}

// Odhadovaná průměrná rychlost auta z původní trasy (m/s)
// Používáme jen jako fallback pokud nemáme přímý přístup k route duration
let _driveAvgSpeedMS = 13.9; // 50 km/h default
function driveRoute_avgSpeed() { return _driveAvgSpeedMS; }

// Aktualizuje jen příslušné hodnoty v widgetu (null = nemeň)
function _updateWidgetTimes(driveSec, walkSec) {
  if (driveSec !== null) {
    const el = document.getElementById('nav-drive-time');
    if (el) el.textContent = driveSec > 0 ? _fmtDur(driveSec) : '✓';
  }
  if (walkSec !== null) {
    const el = document.getElementById('nav-walk-time');
    if (el) el.textContent = walkSec > 0 ? _fmtDur(walkSec) : '✓';
  }
  const distEl = document.getElementById('nav-dist');
  if (distEl) {
    const remD = _navDriveRemDist || _navWalkRemDist;
    if (remD > 0) distEl.textContent = _fmtDist(remD) + ' zbývá';
    else          distEl.textContent = 'V cíli';
  }
}

// ── POLOHA MARKER ────────────────────────────────────────────────
function _updatePosMarker(lat, lng, acc) {
  if (!_navPosMarker) {
    const ico = L.divIcon({
      html: `<div style="width:14px;height:14px;background:#3b82f6;border:3px solid #fff;
               border-radius:50%;box-shadow:0 0 10px #3b82f6aa"></div>`,
      className: '', iconSize: [14,14], iconAnchor: [7,7],
    });
    _navPosMarker = L.marker([lat, lng], { icon: ico, pane: 'navPane', zIndexOffset: 800 })
      .addTo(map)
      .bindPopup(`<div style="padding:6px 10px;font-size:.72rem">📍 Moje poloha<br>
        <span style="color:var(--muted);font-size:.64rem">±${Math.round(acc)} m</span></div>`);
  } else {
    _navPosMarker.setLatLng([lat, lng]);
  }
}

// ── WIDGET ───────────────────────────────────────────────────────
function _showNavWidget({ name, driveDuration, driveDistance, walkDuration }) {
  document.getElementById('nav-dest-name').textContent  = name || 'Cíl';
  document.getElementById('nav-drive-time').textContent = driveDuration ? _fmtDur(driveDuration) : '–';
  document.getElementById('nav-walk-time').textContent  = walkDuration  ? _fmtDur(walkDuration)  : '–';
  document.getElementById('nav-dist').textContent       = driveDistance ? _fmtDist(driveDistance) : '';
  document.getElementById('nav-widget').classList.add('on');

  // Ulož průměrnou rychlost auta pro live tracking
  if (driveDuration && driveDistance) {
    _driveAvgSpeedMS = driveDistance / driveDuration; // m/s
  }
}

// ── CLEAR ────────────────────────────────────────────────────────
function clearNav() {
  _stopTracking();
  _navActive = false;

  [_driveShadow, _driveLayerDone, _driveLayerTodo,
   _walkLayerDone, _walkLayerTodo, _navDestMarker, _navPosMarker].forEach(l => {
    if (l) { try { map.removeLayer(l); } catch(e){} }
  });
  _driveShadow = _driveLayerDone = _driveLayerTodo = null;
  _walkLayerDone = _walkLayerTodo = null;
  _navDestMarker = _navPosMarker = null;
  _driveFullCoords = []; _walkFullCoords = [];
  _navDriveRemDist = _navWalkRemDist = 0;

  _removePick();
  _navPickActive = false;
  map.off('click', _onMapPick);
  map.getContainer().style.cursor = '';

  document.getElementById('nav-widget')?.classList.remove('on');
  document.getElementById('fab-nav')?.classList.remove('on');
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  const lbl = document.getElementById('nav-pick-lbl');
  if (lbl) lbl.textContent = 'Vybrat cíl na mapě';
  _pendingLat = _pendingLng = _pendingName = null;
}

// ── FORMÁTOVÁNÍ ──────────────────────────────────────────────────
function _fmtDur(sec) {
  if (!sec || sec < 0) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function _fmtDist(m) {
  if (!m) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
