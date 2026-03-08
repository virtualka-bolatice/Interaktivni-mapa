'use strict';

// ════════════════════════════════════════════════════════════════
//  map.js — Inicializace Leaflet mapy a podkladových vrstev
//
//  Podkladové mapy:
//    "Mapa"    = CartoDB Positron (světlý, minimalistický)
//    "Ortofoto"= ČÚZK ORTOFOTO_WM, záloha Esri World Imagery
// ════════════════════════════════════════════════════════════════

// ── CRS ──────────────────────────────────────────────────────────
let mapCRS;
try {
  mapCRS = new L.Proj.CRS(
    'EPSG:3857',
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
    { resolutions: [2800,1400,700,350,175,84,42,21,11.2,5.6,2.8,1.4,0.7,0.35,0.14,0.07] }
  );
} catch(e) {
  mapCRS = L.CRS.EPSG3857;
}

// ── MAPA ─────────────────────────────────────────────────────────
const map = L.map('map', {
  crs:          mapCRS,
  center:       [49.921, 17.968],
  zoom:         15,
  zoomControl:  false,
  maxZoom:      20,
  minZoom:      8,
});

L.control.zoom ({ position: 'bottomright' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(map);

// ── PODKLADOVÉ MAPY ──────────────────────────────────────────────
const TILES = {
  mapa: L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 20, minZoom: 8 }
  ),
  orto: L.tileLayer(
    'https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© <a href="https://www.cuzk.cz" target="_blank">ČÚZK</a> Ortofotomapa ČR', maxZoom: 20, minZoom: 8 }
  ),
};

const ORTO_FALLBACK = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: '© Esri World Imagery (záloha)', maxZoom: 20, minZoom: 8 }
);

let activeTile         = 'mapa';
let ortoFallbackActive = false;

// Automatický fallback pokud ČÚZK nereaguje
TILES.orto.on('tileerror', () => {
  if (!ortoFallbackActive && activeTile === 'orto') {
    console.warn('ČÚZK ortofoto nedostupné, přepínám na Esri zálohu');
    ortoFallbackActive = true;
    map.removeLayer(TILES.orto);
    ORTO_FALLBACK.addTo(map);
    badge('⚠️ ČÚZK ortofoto nedostupné — použit Esri World Imagery');
  }
});

TILES.mapa.addTo(map);

// ── PŘEPNUTÍ PODKLADU ────────────────────────────────────────────
function setTile(key) {
  if (activeTile === key) return;

  if (activeTile === 'orto' && ortoFallbackActive) map.removeLayer(ORTO_FALLBACK);
  else map.removeLayer(TILES[activeTile]);

  activeTile         = key;
  ortoFallbackActive = false;
  TILES[key].addTo(map);

  // QGIS vrstvy zpět navrch
  qgisLayers.forEach(l => { if (l.visible && l.leaflet) l.leaflet.bringToFront(); });
  poiGroup.bringToFront();

  document.querySelectorAll('.tbtn').forEach(b => b.className = 'tbtn off');
  document.getElementById('tbtn-' + key).className = 'tbtn on';
}
