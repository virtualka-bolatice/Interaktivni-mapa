'use strict';

// ════════════════════════════════════════════════════════════════
//  nav.js — Navigace v mapě pomocí OSRM routing API
//
//  Použití: volá se z poi.js po kliknutí "🧭 Navigovat" v popupu.
//  Vykreslí trasu přímo na mapě (nad basemapou, pod POI).
//
//  Chceš-li funkci deaktivovat:
//    1. zakomentuj <script src="js/nav.js"> v index.html
//    2. tlačítko "🧭 Navigovat" v poi.js buildPOIPopup() zmizí automaticky
//       (nebo odstraň ten řádek ručně)
//
//  OSRM demo server (bez API klíče):
//    https://router.project-osrm.org
//    Profily: driving | walking | cycling
// ════════════════════════════════════════════════════════════════

const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

let _navRouteLayers = [];    // Leaflet vrstvy trasy
let _navMarker      = null;  // marker cíle
let _navActive      = false;

// ── HLAVNÍ FUNKCE — zavolej ze POI popupu ────────────────────────
async function navigateTo(targetLat, targetLng, targetName) {
  if (!navigator.geolocation) {
    badge('❌ Geolokace není dostupná v tomto prohlížeči');
    return;
  }

  badge('📍 Zjišťuji tvou polohu…');

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: oLat, longitude: oLng } = pos.coords;

      clearNav(); // vymaž předchozí trasu

      badge('🧭 Načítám trasu…');

      try {
        // Paralelní fetch: auto + pěšky
        const coord = `${oLng},${oLat};${targetLng},${targetLat}`;
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

        const usedRoute = driveRoute || walkRoute;

        // Pane pro trasu — pod POI, nad basemapou
        if (!map.getPane('navPane')) {
          map.createPane('navPane');
          map.getPane('navPane').style.zIndex = 350;
        }

        // Vykreslení trasy (modré s glow efektem)
        if (driveRoute) {
          // Pozadí (shadow)
          const shadow = L.geoJSON(driveRoute.geometry, {
            pane: 'navPane',
            style: { color: '#1e40af', weight: 9, opacity: .3, lineCap: 'round', lineJoin: 'round' },
          }).addTo(map);
          _navRouteLayers.push(shadow);

          // Hlavní čára
          const main = L.geoJSON(driveRoute.geometry, {
            pane: 'navPane',
            style: { color: '#3b82f6', weight: 5, opacity: .9, lineCap: 'round', lineJoin: 'round' },
          }).addTo(map);
          _navRouteLayers.push(main);
        }

        // Pěší trasa (tečkovaná, zelená) — pokud se liší
        if (walkRoute && (!driveRoute || walkRoute.distance < driveRoute.distance * 0.7)) {
          const walkLine = L.geoJSON(walkRoute.geometry, {
            pane: 'navPane',
            style: { color: '#10b981', weight: 3, opacity: .7, dashArray: '6,5', lineCap: 'round' },
          }).addTo(map);
          _navRouteLayers.push(walkLine);
        }

        // Marker cíle
        const destIcon = L.divIcon({
          html: `<div style="width:16px;height:16px;background:#f97316;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px #f97316aa;"></div>`,
          className: '', iconSize: [16,16], iconAnchor: [8,8],
        });
        _navMarker = L.marker([targetLat, targetLng], { icon: destIcon, pane: 'navPane' })
          .addTo(map)
          .bindPopup(`<div style="padding:6px 10px;font-size:.75rem;font-family:DM Sans,sans-serif">🎯 <strong>${targetName}</strong></div>`);

        _navActive = true;

        // Zobraz widget
        _showNavWidget({
          name:          targetName,
          driveDuration: driveRoute?.duration,
          driveDistance: driveRoute?.distance,
          walkDuration:  walkRoute?.duration,
        });

        // Fit bounds na trasu
        try {
          const bounds = L.featureGroup(_navRouteLayers).getBounds();
          map.fitBounds(bounds.pad(.12));
        } catch(e) {}

        // Ukáž FAB pro zrušení navigace
        document.getElementById('fab-nav')?.classList.add('on');

        badge('✅ Trasa načtena');

      } catch(err) {
        console.error('nav.js error:', err);
        badge('❌ Chyba načtení trasy');
      }
    },
    err => {
      badge('❌ Poloha nedostupná: ' + (err.message || 'neznámá chyba'));
    },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

// ── ZOBRAZENÍ WIDGETU ────────────────────────────────────────────
function _showNavWidget({ name, driveDuration, driveDistance, walkDuration }) {
  document.getElementById('nav-dest-name').textContent  = name || 'Cíl';
  document.getElementById('nav-drive-time').textContent = driveDuration ? _fmtDur(driveDuration) : '–';
  document.getElementById('nav-walk-time').textContent  = walkDuration  ? _fmtDur(walkDuration)  : '–';
  document.getElementById('nav-dist').textContent       = driveDistance ? _fmtDist(driveDistance) : '';
  document.getElementById('nav-widget').classList.add('on');
}

// ── VYMAZÁNÍ TRASY ───────────────────────────────────────────────
function clearNav() {
  _navRouteLayers.forEach(l => { try { map.removeLayer(l); } catch(e) {} });
  _navRouteLayers = [];

  if (_navMarker) { try { map.removeLayer(_navMarker); } catch(e) {} _navMarker = null; }

  _navActive = false;
  document.getElementById('nav-widget').classList.remove('on');
  document.getElementById('fab-nav')?.classList.remove('on');
}

// ── FORMÁTOVÁNÍ ──────────────────────────────────────────────────
function _fmtDur(sec) {
  if (!sec) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function _fmtDist(m) {
  if (!m) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
