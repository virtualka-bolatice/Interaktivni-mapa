'use strict';

// ════════════════════════════════════════════════════════════════
//  poi.js — POI systém
// ════════════════════════════════════════════════════════════════

const DEMO_POI = { "type": "FeatureCollection", "features": [
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9655, 49.9201] }, "properties": { "nazev": "Obecní úřad Bolatice", "kategorie": "urad", "podkategorie": "urad_obec", "typ": "Obecní úřad", "adresa": "Hlučínská 95", "tel": "+420 553 653 802", "web": "https://www.bolatice.cz", "provoz": "Po,St 7:30–17:00" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9641, 49.9195] }, "properties": { "nazev": "Restaurace Na Radnici", "kategorie": "gastro", "podkategorie": "restaurace", "adresa": "Náměstí 12", "tel": "+420 601 111 222", "provoz": "Po–Ne 11:00–22:00" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9670, 49.9215] }, "properties": { "nazev": "Pizzeria Roma", "kategorie": "gastro", "podkategorie": "pizzeria", "adresa": "Hlučínská 22", "tel": "+420 602 333 444" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9635, 49.9220] }, "properties": { "nazev": "TJ Bolatice – hřiště", "kategorie": "sport", "podkategorie": "sport_ven", "adresa": "Sportovní 5", "popis": "Travnaté + umělé hřiště" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9680, 49.9185] }, "properties": { "nazev": "Kadeřnictví Jana", "kategorie": "sluzby", "podkategorie": "kadernictvi", "adresa": "Opavská 8", "tel": "+420 604 777 888", "provoz": "Po–Pá 8:00–17:00" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9660, 49.9230] }, "properties": { "nazev": "Lékárna Bolatice", "kategorie": "zdravi", "podkategorie": "lekarna", "adresa": "Hlučínská 55", "tel": "+420 553 123 456", "provoz": "Po–Pá 7:30–16:30" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9645, 49.9208] }, "properties": { "nazev": "Penny Market", "kategorie": "obchod", "podkategorie": "potraviny", "adresa": "Opavská 33", "web": "https://www.penny.cz", "provoz": "Po–Ne 7:00–21:00" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9700, 49.9200] }, "properties": { "nazev": "ZŠ Bolatice", "kategorie": "urad", "podkategorie": "skola", "adresa": "Školní 1", "tel": "+420 553 653 900", "web": "https://www.zsbolatice.cz" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9630, 49.9185] }, "properties": { "nazev": "MUDr. Kovářová", "kategorie": "zdravi", "podkategorie": "lekar", "typ": "Praktický lékař", "adresa": "Hlučínská 12", "tel": "+420 553 654 100", "provoz": "Po,St,Pá 7:30–12:00" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9665, 49.9195] }, "properties": { "nazev": "Hospoda u Petra", "kategorie": "gastro", "podkategorie": "hospoda", "adresa": "Náměstí 5", "tel": "+420 607 888 999", "provoz": "Po–Pá 14:00–23:00" }},
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [17.9672, 49.9202] }, "properties": { "nazev": "Kostel sv. Martina", "kategorie": "urad", "podkategorie": "cirkev", "adresa": "Kostelní 1", "popis": "Původ 13. stol., románský portál", "foto": "foto/kostel.jpg" }},
]};

// ── STAV APLIKACE ────────────────────────────────────────────────
const poiGroup = L.featureGroup().addTo(map);

const ST = {
  features:   [],
  catActive:  {},
  subActive:  {},
  searchQ:    '',
  filterMode: false,
  filterKey:  null,
};
Object.keys(CAT_CFG).forEach(k => ST.catActive[k] = true);

// ── IKONY ────────────────────────────────────────────────────────
function makeIcon(emoji, color, sz = 33) {
  const s = sz;
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s+8}" viewBox="0 0 ${s} ${s+8}">
      <defs><filter id="fs"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${color}" flood-opacity=".45"/></filter></defs>
      <circle cx="${s/2}" cy="${s/2}" r="${s/2-1.5}" fill="${color}" filter="url(#fs)" opacity=".95"/>
      <circle cx="${s/2}" cy="${s/2}" r="${s/2-5}" fill="rgba(255,255,255,.12)"/>
      <text x="${s/2}" y="${s/2+5}" text-anchor="middle" font-size="${Math.round(s*.38)}">${emoji}</text>
      <line x1="${s/2}" y1="${s-1.5}" x2="${s/2}" y2="${s+6}" stroke="${color}" stroke-width="1.8" opacity=".45"/>
    </svg>`,
    className: '', iconSize: [s, s+8], iconAnchor: [s/2, s+8], popupAnchor: [0, -(s+8)],
  });
}

// ── NAČTENÍ DAT ──────────────────────────────────────────────────
async function loadPOI() {
  let gj = null, src = '[DEMO]';

  for (const path of ['data/bolatice_poi.geojson', 'data/poi.geojson']) {
    try {
      const r = await fetch(path);
      if (r.ok) { gj = await r.json(); src = path; break; }
    } catch(e) {}
  }

  if (!gj) gj = DEMO_POI;

  badge(src === '[DEMO]'
    ? '📍 Demo data — vytvoř data/bolatice_poi.geojson v QGIS'
    : `✅ POI načteno: ${src}`);

  ST.features = (gj.features || []).filter(f => f.geometry?.type === 'Point' && f.geometry.coordinates);

  ST.features.forEach(f => {
    const p = f.properties;
    if (p.kategorie === 'sluzby' && p.podkategorie && !CAT_CFG.sluzby.subs[p.podkategorie]) {
      CAT_CFG.sluzby.subs[p.podkategorie] = { label: p.podkategorie, icon: '⚙️', color: '#94a3b8' };
    }
  });

  buildSubUI();
  renderPOI();
  updateCounts();
  renderResults();
  renderMobSubcats();
  document.getElementById('st-poi').textContent = ST.features.length;
}

// ── SUBKATEGORIE SLUŽBY ──────────────────────────────────────────
function buildSubUI() {
  const el = document.getElementById('sub-sluzby');
  el.innerHTML = '';
  for (const [k, sub] of Object.entries(CAT_CFG.sluzby.subs)) {
    if (ST.subActive[k] === undefined) ST.subActive[k] = true;
    const d = document.createElement('div');
    d.className   = 'sub-chip' + (ST.subActive[k] ? ' active' : '');
    d.id          = 'subchip-' + k;
    d.style.color = sub.color;
    d.innerHTML   = `<div class="sub-dot"></div><span>${sub.icon} ${sub.label}</span>`;
    d.onclick     = () => toggleSub(k);
    el.appendChild(d);
  }
}

function toggleSubList() {
  document.getElementById('sub-sluzby').classList.toggle('x');
}

// ── RENDEROVÁNÍ ──────────────────────────────────────────────────
function renderPOI() {
  poiGroup.clearLayers();
  ST.features.forEach(f => {
    const p   = f.properties;
    const cat = CAT_CFG[p.kategorie];
    if (!cat || !ST.catActive[p.kategorie]) return;
    if (p.kategorie === 'sluzby' && p.podkategorie && ST.subActive[p.podkategorie] === false) return;
    if (ST.searchQ) {
      const q = ST.searchQ.toLowerCase();
      if (![(p.nazev||''),(p.adresa||''),(p.typ||'')].some(s => s.toLowerCase().includes(q))) return;
    }

    let color = cat.color, icon = cat.icon;
    const sc  = cat.subs?.[p.podkategorie];
    if (sc) { color = sc.color; icon = sc.icon; }

    const [lng, lat] = f.geometry.coordinates;
    const m          = L.marker([lat, lng], { icon: makeIcon(icon, color) });
    m.feature        = f;
    m.bindPopup(buildPOIPopup(p, color, icon, lat, lng), { maxWidth: 295 });
    poiGroup.addLayer(m);
  });
}

// ── POI POPUP ────────────────────────────────────────────────────
function prow(i, v) {
  return `<div class="ppop-row"><div class="ppop-i">${i}</div><div class="ppop-v">${v}</div></div>`;
}

function buildPOIPopup(p, color, icon, lat, lng) {
  const cat  = CAT_CFG[p.kategorie];
  const sc   = cat?.subs?.[p.podkategorie];
  const typ  = p.typ || sc?.label || cat?.label || '';
  const foto = p.foto
    ? `<img class="ppop-photo" src="${p.foto}" alt="${p.nazev || ''}"
         onclick="openLB(this.src)"
         onerror="this.parentNode.innerHTML='<div class=ppop-ph>${icon}</div>'">`
    : '';

  let rows = '';
  if (p.adresa) rows += prow('📍', p.adresa);
  if (p.tel)    rows += prow('📞', `<a href="tel:${p.tel}">${p.tel}</a>`);
  if (p.provoz) rows += prow('🕐', p.provoz);
  if (p.web)    rows += prow('🌐', `<a href="${p.web}" target="_blank">${p.web.replace(/https?:\/\//,'')}</a>`);
  if (p.email)  rows += prow('✉️', `<a href="mailto:${p.email}">${p.email}</a>`);
  if (p.ico)    rows += prow('🏢', 'IČO: ' + p.ico);
  if (p.popis)  rows += prow('ℹ️', p.popis);

  const navGoogle = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.nazev||'') + ' Bolatice')}`;
  // Bezpečně escapuj název pro inline onclick
  const safeName = (p.nazev||'Cíl').replace(/'/g, "\\'").replace(/"/g, '&quot;');

  return `
    ${foto}
    <div class="ppop-head">
      <div class="ppop-badge" style="background:${color}18;color:${color}">${icon} ${typ}</div>
      <div class="ppop-name">${p.nazev || 'Bez názvu'}</div>
    </div>
    ${rows ? `<div class="ppop-div"></div><div style="padding-bottom:6px">${rows}</div>` : ''}
    <div class="ppop-foot">
      <button class="ppop-btn nav" onclick="navigateTo(${lat},${lng},'${safeName}')">🧭 Navigovat</button>
      <button class="ppop-btn" onclick="window.open('${navGoogle}','_blank')">🗺 Google</button>
      ${p.web ? `<button class="ppop-btn" onclick="window.open('${p.web}','_blank')">🌐 Web</button>` : ''}
    </div>`;
}

// ── LIGHTBOX ─────────────────────────────────────────────────────
function openLB(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lightbox').classList.add('on');
}
function closeLB() {
  document.getElementById('lightbox').classList.remove('on');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLB(); } });

// ── POČTY + POI PŘEHLED ──────────────────────────────────────────
function updateCounts() {
  const c = {};
  Object.keys(CAT_CFG).forEach(k => c[k] = 0);
  ST.features.forEach(f => { const k = f.properties.kategorie; if (k in c) c[k]++; });

  Object.entries(c).forEach(([k, v]) => {
    const el = document.getElementById('cnt-' + k);
    if (el) el.textContent = v;
  });

  renderPOIOverview(c);
  renderMobCatIcons(c);
}

// ── POI PŘEHLED WIDGET (základní režim) ──────────────────────────
function renderPOIOverview(counts) {
  const el = document.getElementById('poi-overview');
  if (!el) return;

  const c = counts || (() => {
    const cc = {}; Object.keys(CAT_CFG).forEach(k => cc[k] = 0);
    ST.features.forEach(f => { const k = f.properties.kategorie; if (k in cc) cc[k]++; });
    return cc;
  })();

  const total = Object.values(c).reduce((s, v) => s + v, 0);

  el.innerHTML = `
    <span class="poi-ov-total">📍 ${total} míst</span>
    ${Object.entries(CAT_CFG).map(([k, cat]) => c[k] > 0 ? `
      <span class="poi-ov-cat" style="color:${cat.color}" title="${cat.label}">
        ${cat.icon}<span>${c[k]}</span>
      </span>` : ''
    ).join('')}`;
}

// ── MOBILNÍ KATEGORIE IKONY v peek pruhu ─────────────────────────
function renderMobCatIcons(counts) {
  const el = document.getElementById('mob-cat-icons');
  if (!el) return;

  const c = counts || (() => {
    const cc = {}; Object.keys(CAT_CFG).forEach(k => cc[k] = 0);
    ST.features.forEach(f => { const k = f.properties.kategorie; if (k in cc) cc[k]++; });
    return cc;
  })();

  el.innerHTML = Object.entries(CAT_CFG).map(([k, cat]) => {
    const isActive  = ST.catActive[k];
    const isDimmed  = ST.filterMode && ST.filterKey !== k;
    return `<div class="mob-cat-ico${isActive ? ' active' : ''}${isDimmed ? ' dimmed' : ''}"
                 style="--cat-color:${cat.color}"
                 onclick="toggleCat('${k}')">
      <div class="mob-cat-bubble">${cat.icon}</div>
      <div class="mob-cat-lbl">${cat.label.split(/[ &]/)[0]}</div>
      <div class="mob-cat-cnt">${c[k]}</div>
    </div>`;
  }).join('');
}


// ── MOBILNÍ SUBKATEGORIE — pills nad výsledky ────────────────────
// Zobrazí se jen pokud je aktivní solo-filtr kategorie se subkategoriemi
function renderMobSubcats() {
  const el = document.getElementById('mob-subcat-wrap');
  if (!el) return;
  el.innerHTML = '';

  // Zobrazit jen pokud filtrujeme solo kategorii se subkategoriemi
  if (!ST.filterMode || !ST.filterKey) return;
  const cat = CAT_CFG[ST.filterKey];
  if (!cat?.subs || Object.keys(cat.subs).length === 0) return;

  for (const [k, sub] of Object.entries(cat.subs)) {
    if (ST.subActive[k] === undefined) ST.subActive[k] = true;
    const pill = document.createElement('span');
    pill.className = 'mob-sub-pill' + (ST.subActive[k] ? ' active' : '');
    pill.style.color = sub.color || cat.color;
    pill.innerHTML = `<span class="mob-sub-pill-ico">${sub.icon}</span>${sub.label}`;
    pill.onclick = () => toggleSub(k);
    el.appendChild(pill);
  }
}

// ── VÝSLEDKY ─────────────────────────────────────────────────────
function renderResults() {
  _renderResultsInto('res-list', 'res-cnt');
}

function renderMobResults() {
  _renderResultsInto('mob-results', null);
}

function _renderResultsInto(listId, cntId) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';

  const visible = ST.features.filter(f => {
    const p = f.properties;
    if (!ST.catActive[p.kategorie]) return false;
    if (p.kategorie === 'sluzby' && p.podkategorie && ST.subActive[p.podkategorie] === false) return false;
    if (ST.searchQ) {
      const q = ST.searchQ.toLowerCase();
      if (![(p.nazev||''),(p.adresa||''),(p.typ||'')].some(s => s.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  if (cntId) {
    const ce = document.getElementById(cntId);
    if (ce) ce.textContent = visible.length;
  }

  visible.forEach(f => {
    const p   = f.properties;
    const cat = CAT_CFG[p.kategorie];
    let color = cat?.color || '#888', icon = cat?.icon || '📍';
    const sc  = cat?.subs?.[p.podkategorie];
    if (sc) { color = sc.color; icon = sc.icon; }

    const [lng, lat] = f.geometry.coordinates;
    const d = document.createElement('div');
    d.className = 'res-row';
    d.innerHTML = `
      <div class="res-ico" style="background:${color}18">${icon}</div>
      <div class="res-info">
        <div class="res-name">${p.nazev || 'Bez názvu'}</div>
        <div class="res-sub">${p.typ || sc?.label || cat?.label || ''}${p.adresa ? ' · ' + p.adresa : ''}</div>
      </div>`;
    d.onclick = () => {
      map.setView([lat, lng], 17);
      poiGroup.eachLayer(m => {
        if (m.feature?.properties?.nazev === p.nazev) m.openPopup();
      });
      closeMobSearch();
    };
    list.appendChild(d);
  });
}

// ── FILTROVÁNÍ KATEGORIÍ — exclusive-filter ──────────────────────
function toggleCat(k) {
  if (!ST.filterMode) {
    ST.filterMode = true; ST.filterKey = k;
    Object.keys(CAT_CFG).forEach(c => {
      ST.catActive[c] = (c === k);
      document.getElementById('chip-' + c)?.classList.toggle('active', c === k);
      document.getElementById('chip-' + c)?.classList.toggle('dimmed', c !== k);
    });
  } else if (ST.filterKey === k) {
    ST.filterMode = false; ST.filterKey = null;
    Object.keys(CAT_CFG).forEach(c => {
      ST.catActive[c] = true;
      document.getElementById('chip-' + c)?.classList.add('active');
      document.getElementById('chip-' + c)?.classList.remove('dimmed');
    });
  } else {
    ST.filterKey = k;
    Object.keys(CAT_CFG).forEach(c => {
      ST.catActive[c] = (c === k);
      document.getElementById('chip-' + c)?.classList.toggle('active', c === k);
      document.getElementById('chip-' + c)?.classList.toggle('dimmed', c !== k);
    });
  }
  renderPOI();
  renderResults();
  renderMobCatIcons();
  renderMobSubcats();
}

function toggleSub(k) {
  ST.subActive[k] = !ST.subActive[k];
  document.getElementById('subchip-' + k)?.classList.toggle('active', ST.subActive[k]);
  // Sync mobile pill
  document.querySelectorAll('.mob-sub-pill').forEach(p => {
    if (p.dataset.key === k) p.classList.toggle('active', ST.subActive[k]);
  });
  renderPOI(); renderResults();
}

function doSearch(q) {
  ST.searchQ = q.trim();
  renderPOI();
  renderResults();
}
