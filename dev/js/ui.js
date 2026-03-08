'use strict';

// ════════════════════════════════════════════════════════════════
//  ui.js — Sidebar, bottom sheet, mobilní search, geolokace, init
// ════════════════════════════════════════════════════════════════

// ── DETEKCE MOBILU ───────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 768; }

// ════════════════════════════════════════════════════════════════
//  SIDEBAR (desktop) / BOTTOM SHEET (mobile)
// ════════════════════════════════════════════════════════════════
let sbOpen    = true;
let bsExpanded = false;

function toggleSB() {
  if (isMobile()) {
    // Na mobilu: toggle zavřít/otevřít do peek stavu
    sbOpen = !sbOpen;
    document.getElementById('sidebar').classList.toggle('closed', !sbOpen);
    document.getElementById('sb-hbtn')?.classList.toggle('on', sbOpen);
    if (sbOpen) bsExpanded = false; // reset na peek
  } else {
    // Desktop: klasický slide
    sbOpen = !sbOpen;
    document.getElementById('sidebar').classList.toggle('closed', !sbOpen);
    const h = document.getElementById('sb-handle');
    if (h) { h.classList.toggle('closed', !sbOpen); h.textContent = sbOpen ? '◀' : '▶'; }
    document.getElementById('sb-hbtn')?.classList.toggle('on', sbOpen);
    updateLayoutPositions();
  }
}

// ── BOTTOM SHEET EXPAND/COLLAPSE ─────────────────────────────────
function toggleBS() {
  if (!isMobile()) return;
  bsExpanded = !bsExpanded;
  document.getElementById('sidebar').classList.toggle('bs-expanded', bsExpanded);
}

function expandBS() {
  if (!isMobile() || bsExpanded) return;
  bsExpanded = true;
  document.getElementById('sidebar').classList.add('bs-expanded');
}

function collapseBS() {
  if (!isMobile() || !bsExpanded) return;
  bsExpanded = false;
  document.getElementById('sidebar').classList.remove('bs-expanded');
}

// ── SWIPE GESTA na drag handle ───────────────────────────────────
function _initBSSwipe() {
  const handle = document.getElementById('mob-bs-top');
  if (!handle) return;

  let startY = 0, lastY = 0, moved = false;

  handle.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    lastY  = startY;
    moved  = false;
  }, { passive: true });

  handle.addEventListener('touchmove', e => {
    lastY = e.touches[0].clientY;
    moved = Math.abs(lastY - startY) > 5;
  }, { passive: true });

  handle.addEventListener('touchend', () => {
    if (!moved) return; // byl to tap → toggleBS se postará
    const diff = startY - lastY;
    if (diff > 30)  expandBS();
    if (diff < -30) collapseBS();
  }, { passive: true });

  // Swipe dolů na celém BS zavře ho
  const bs = document.getElementById('sidebar');
  let bsStartY = 0;
  bs.addEventListener('touchstart', e => { bsStartY = e.touches[0].clientY; }, { passive: true });
  bs.addEventListener('touchend', e => {
    const diff = bsStartY - e.changedTouches[0].clientY;
    if (diff < -60 && bsExpanded) collapseBS();
  }, { passive: true });
}

// ════════════════════════════════════════════════════════════════
//  MOBILNÍ HLEDÁNÍ
// ════════════════════════════════════════════════════════════════
function openMobSearch() {
  document.getElementById('mob-search').classList.add('open');
  setTimeout(() => document.getElementById('mob-search-inp')?.focus(), 150);
}

function closeMobSearch() {
  document.getElementById('mob-search').classList.remove('open');
  const inp = document.getElementById('mob-search-inp');
  if (inp) { inp.value = ''; doSearch(''); }
  const res = document.getElementById('mob-results');
  if (res) res.innerHTML = '';
}

// ════════════════════════════════════════════════════════════════
//  LAYOUT POSITIONS — sidebar-aware posuny
// ════════════════════════════════════════════════════════════════
function updateLayoutPositions() {
  if (isMobile()) return; // mobil nemá layout shift

  const offset = sbOpen ? 285 : 0;

  const scale = document.querySelector('.leaflet-bottom.leaflet-left');
  if (scale) scale.style.marginLeft = offset + 'px';

  const stats = document.getElementById('stats-panel');
  if (stats) {
    stats.style.left      = sbOpen ? `calc(50% + ${offset / 2}px)` : '50%';
    stats.style.transform = 'translateX(-50%)';
  }

  const ov = document.getElementById('poi-overview');
  if (ov) {
    ov.style.left      = sbOpen ? `calc(50% + ${offset / 2}px)` : '50%';
    ov.style.transform = 'translateX(-50%)';
  }

  const msr = document.getElementById('msr-panel');
  if (msr) {
    msr.style.left      = sbOpen ? `calc(50% + ${offset / 2}px)` : '50%';
    msr.style.transform = 'translateX(-50%)';
  }
}

// ════════════════════════════════════════════════════════════════
//  GEOLOKACE
// ════════════════════════════════════════════════════════════════
let geoMarker = null;

function geolocate() {
  const btn = document.getElementById('fab-geo');
  if (!navigator.geolocation) { alert('Geolokace není dostupná.'); return; }

  btn.classList.add('on');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
      if (geoMarker) map.removeLayer(geoMarker);

      const ico = L.divIcon({
        html: `<div style="width:13px;height:13px;background:#3b82f6;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px #3b82f6aa"></div>`,
        className: '', iconSize: [13,13], iconAnchor: [6.5, 6.5],
      });

      geoMarker = L.marker([lat, lng], { icon: ico }).addTo(map)
        .bindPopup(`<div style="padding:8px 10px;font-size:.75rem">📍 Vaše poloha<br>
          <span style="color:var(--muted);font-size:.68rem">±${Math.round(acc)} m</span></div>`);

      L.circle([lat, lng], {
        radius: acc, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: .07, weight: 1,
      }).addTo(map);

      map.setView([lat, lng], 16);
      btn.classList.remove('on');
    },
    err => {
      btn.classList.remove('on');
      alert('Chyba geolokace: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ════════════════════════════════════════════════════════════════
//  BADGE + LOADING
// ════════════════════════════════════════════════════════════════
let _badgeTimer;
function badge(msg) {
  const el = document.getElementById('dbadge');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('fade');
  clearTimeout(_badgeTimer);
  _badgeTimer = setTimeout(() => el.classList.add('fade'), 5000);
}

function ld(msg) {
  const el = document.getElementById('ld-sub');
  if (el) el.textContent = msg;
}

// ════════════════════════════════════════════════════════════════
//  INICIALIZACE
// ════════════════════════════════════════════════════════════════
window.addEventListener('load', async () => {
  ld('Registruji IS DMVS vrstvy…');
  initQGISLayers();

  ld('Načítám POI data…');
  await loadPOI();

  poiGroup.bringToFront();
  updateLayoutPositions();

  // Inicializace swipe gest pro bottom sheet
  _initBSSwipe();

  // Na mobilu začni se sidebar schovaným (bs v closed stavu)
  // → pak ho otevřeme do peek
  if (isMobile()) {
    sbOpen = true; // peek je "otevřený" stav
    document.getElementById('sidebar').classList.remove('closed');
  }

  ld('Hotovo ✓');
  document.getElementById('loading').classList.add('out');
  setTimeout(() => document.getElementById('loading').remove(), 500);
});

// Re-layout při resize (přepnutí orientace apod.)
window.addEventListener('resize', () => {
  updateLayoutPositions();
  if (!isMobile() && bsExpanded) {
    bsExpanded = false;
    document.getElementById('sidebar').classList.remove('bs-expanded');
  }
});
