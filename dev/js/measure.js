'use strict';

// ════════════════════════════════════════════════════════════════
//  measure.js — Měření vzdáleností a ploch
//
//  Ovládání:
//    • klikání na mapu přidává body
//    • Enter nebo tlačítko "Uzavřít plochu" → uzavře polygon
//    • klik blízko prvního bodu (snap) → uzavře polygon
//    • Escape → zruší měření
// ════════════════════════════════════════════════════════════════

let msrOn           = false;
let mPts            = [];
let mPolyline       = null;
let mPolygonLayer   = null;
let mDots           = [];
let msrClosed       = false;

// ── VÝPOČTY ──────────────────────────────────────────────────────
function msrCalcArea(pts) {
  if (pts.length < 3) return 0;
  const R = 6371000;
  let area = 0;
  const n  = pts.length;
  for (let i = 0; i < n; i++) {
    const j  = (i + 1) % n;
    const xi = pts[i].lng * Math.PI / 180, yi = pts[i].lat * Math.PI / 180;
    const xj = pts[j].lng * Math.PI / 180, yj = pts[j].lat * Math.PI / 180;
    area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
  }
  return Math.abs(area * R * R / 2);
}

function msrFormatLen(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function msrFormatArea(m2) {
  if (m2 < 1)        return '<1 m²';
  if (m2 < 10000)    return Math.round(m2) + ' m²';
  if (m2 < 1000000)  return (m2 / 10000).toFixed(2) + ' ha';
  return (m2 / 1000000).toFixed(3) + ' km²';
}

// ── AKTUALIZACE UI ───────────────────────────────────────────────
function msrUpdate() {
  let total = 0;
  for (let i = 1; i < mPts.length; i++) total += mPts[i-1].distanceTo(mPts[i]);
  const lenStr = msrFormatLen(total);

  document.getElementById('msr-val').textContent = lenStr;

  if (msrClosed && mPts.length >= 3) {
    document.getElementById('msr-area').textContent = msrFormatArea(msrCalcArea(mPts));
    document.getElementById('msr-hint').textContent = `obvod: ${lenStr}`;
  } else if (mPts.length >= 3) {
    document.getElementById('msr-area').textContent = msrFormatArea(msrCalcArea(mPts)) + ' est.';
    document.getElementById('msr-hint').textContent = 'Enter → uzavřít plochu';
  } else {
    document.getElementById('msr-area').textContent = '—';
    document.getElementById('msr-hint').textContent = 'klikej body na mapě';
  }
}

// ── KRESLENÍ ─────────────────────────────────────────────────────
function msrDraw() {
  if (mPolyline)     { map.removeLayer(mPolyline);     mPolyline     = null; }
  if (mPolygonLayer) { map.removeLayer(mPolygonLayer); mPolygonLayer = null; }

  if (msrClosed && mPts.length >= 3) {
    mPolygonLayer = L.polygon(mPts, {
      color: '#7c3aed', weight: 2, dashArray: null,
      fillColor: '#f97316', fillOpacity: .18,
    }).addTo(map);
  } else if (mPts.length > 1) {
    mPolyline = L.polyline(mPts, { color: '#7c3aed', weight: 2, dashArray: '5,4', opacity: .9 }).addTo(map);
  }
}

// ── CLICK HANDLER ────────────────────────────────────────────────
function mClick(e) {
  if (!msrOn || msrClosed) return;

  // Snap-to-start: klik blízko prvního bodu → uzavři
  if (mPts.length >= 3) {
    const d = map.latLngToContainerPoint(mPts[0]).distanceTo(map.latLngToContainerPoint(e.latlng));
    if (d < 14) { closeMsrPolygon(); return; }
  }

  mPts.push(e.latlng);
  mDots.push(
    L.circleMarker(e.latlng, { radius: 4, color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 1, weight: 2 }).addTo(map)
  );
  msrDraw();
  msrUpdate();
}

function msrKeyHandler(e) {
  if (e.key === 'Enter')  { e.preventDefault(); closeMsrPolygon(); }
  if (e.key === 'Escape') { clearMsr(); }
}

// ── VEŘEJNÉ FUNKCE ───────────────────────────────────────────────
function toggleMsr() {
  msrOn = !msrOn;
  document.getElementById('fab-msr').classList.toggle('on', msrOn);
  document.getElementById('msr-panel').classList.toggle('on', msrOn);

  if (msrOn) {
    map.doubleClickZoom.disable();
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', mClick);
    document.addEventListener('keydown', msrKeyHandler);
  } else {
    clearMsr();
  }
}

function closeMsrPolygon() {
  if (mPts.length < 3) return;
  msrClosed = true;
  map.off('click', mClick);
  document.removeEventListener('keydown', msrKeyHandler);
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  msrDraw();
  msrUpdate();
  document.getElementById('fab-msr').classList.remove('on');
  msrOn = false;
}

function clearMsr() {
  mPts      = [];
  msrClosed = false;

  if (mPolyline)     { map.removeLayer(mPolyline);     mPolyline     = null; }
  if (mPolygonLayer) { map.removeLayer(mPolygonLayer); mPolygonLayer = null; }
  mDots.forEach(m => map.removeLayer(m));
  mDots = [];

  document.getElementById('msr-val').textContent  = '0 m';
  document.getElementById('msr-area').textContent = '—';
  document.getElementById('msr-hint').textContent = 'klikej body · Enter → uzavřít';
  document.getElementById('msr-panel').classList.remove('on');
  document.getElementById('fab-msr').classList.remove('on');

  map.off('click', mClick);
  document.removeEventListener('keydown', msrKeyHandler);
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  msrOn = false;
}
