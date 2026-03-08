'use strict';

// ════════════════════════════════════════════════════════════════
//  layers.js — IS DMVS vrstvy
//
//  Čerpá ze seznamu DMVS_LAYERS definovaného v config.js.
//  Opacity slidery se zobrazí teprve po zapnutí vrstvy (toggle ON).
// ════════════════════════════════════════════════════════════════

const qgisLayers = [];
let totalBudovy  = 0;
let totalDoprava = 0;
let advancedMode = false;

// ── GEOMETRICKÉ POMOCNÉ FUNKCE ───────────────────────────────────
function calcPolygonArea(coords) {
  if (!coords || coords.length < 3) return 0;
  const R = 6371000; let area = 0; const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j  = (i + 1) % n;
    const xi = coords[i][0] * Math.PI / 180, yi = coords[i][1] * Math.PI / 180;
    const xj = coords[j][0] * Math.PI / 180, yj = coords[j][1] * Math.PI / 180;
    area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
  }
  return Math.abs(area * R * R / 2);
}

function formatArea(m2) {
  if (m2 < 1)     return '<1 m²';
  if (m2 < 10000) return Math.round(m2) + ' m²';
  return (m2 / 10000).toFixed(2) + ' ha';
}

function calcCentroid(coords) {
  return [
    coords.reduce((s, c) => s + c[1], 0) / coords.length,
    coords.reduce((s, c) => s + c[0], 0) / coords.length,
  ];
}

function formatDate(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return `${dt.getDate().toString().padStart(2,'0')}.${(dt.getMonth()+1).toString().padStart(2,'0')}.${dt.getFullYear()}`;
  } catch(e) { return String(d); }
}

function genBuildingId(centroid) {
  const str = centroid[0].toFixed(7) + centroid[1].toFixed(7);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h.toString().padStart(10, '0');
}

// ── BUDOVA POPUP ─────────────────────────────────────────────────
function buildingPopup(feature, cfg) {
  const geom = feature.geometry;
  let area = 0, centroid = [0, 0];

  if (geom.type === 'Polygon' && geom.coordinates[0]) {
    area     = calcPolygonArea(geom.coordinates[0]);
    centroid = calcCentroid(geom.coordinates[0]);
  } else if (geom.type === 'MultiPolygon' && geom.coordinates[0]?.[0]) {
    area     = calcPolygonArea(geom.coordinates[0][0]);
    centroid = calcCentroid(geom.coordinates[0][0]);
  }

  const props  = feature.properties || {};
  const id     = genBuildingId(centroid);
  const datVkl = formatDate(props.DatumVkladu || props.datum_vkladu || props.datumVkladu || null);
  const navUrl = `https://www.google.com/maps/search/?api=1&query=${centroid[0].toFixed(6)},${centroid[1].toFixed(6)}`;

  return `
    <div class="bpop">
      <div class="bpop-badge" style="background:${cfg.color}18;color:${cfg.color}">⬡ ${cfg.label}</div>
      <div class="bpop-title">Objekt IS DMVS</div>
      <div class="bpop-div"></div>
      ${area > 0 ? `<div class="bpop-row"><div class="bpop-i">📐</div><div class="bpop-v">Plocha: <strong>${formatArea(area)}</strong></div></div>` : ''}
      ${datVkl   ? `<div class="bpop-row"><div class="bpop-i">📅</div><div class="bpop-v">Datum vkladu: ${datVkl}</div></div>` : ''}
      <div class="bpop-id-wrap">
        <details><summary>ID stavby</summary><div class="bpop-id-val">${id}</div></details>
      </div>
    </div>
    <div class="bpop-foot">
      <button class="bpop-btn" onclick="window.open('${navUrl}','_blank')">🗺 Navigace</button>
    </div>`;
}

// ── HIGHLIGHT ────────────────────────────────────────────────────
let hlOrigStyle = null;

function highlight(e) {
  const o = e.target.options;
  hlOrigStyle = { color: o.color, weight: o.weight, fillColor: o.fillColor, fillOpacity: o.fillOpacity, opacity: o.opacity };
  const gt = e.target.feature?.geometry?.type || '';
  if (gt.includes('Line')) e.target.setStyle({ color: '#facc15', weight: 3, opacity: 1 });
  else                     e.target.setStyle({ fillColor: '#facc15', fillOpacity: .88, color: '#facc15' });
}

function unhighlight(e) {
  if (hlOrigStyle) e.target.setStyle(hlOrigStyle);
}

// ── INICIALIZACE VRSTEV ──────────────────────────────────────────
function initQGISLayers() {
  const listEl = document.getElementById('qgis-list');

  const available = DMVS_LAYERS.filter(cfg => {
    const ok = window[cfg.varName] &&
               typeof window[cfg.varName] === 'object' &&
               Array.isArray(window[cfg.varName].features);
    if (!ok) console.warn(`layers.js: '${cfg.varName}' nenalezena — zkontroluj index.html + config.js`);
    return ok;
  });

  if (!available.length) {
    listEl.innerHTML = `<div class="qgis-empty">
      Žádná IS DMVS data.<br>
      Zkontroluj <code>&lt;script src="data/..."&gt;</code> v index.html<br>
      a <code>varName</code> v <code>js/config.js</code>.
    </div>`;
    document.getElementById('qgis-cnt').textContent = '0 vrstev';
    return;
  }

  const grpOrder = ['Budovy', 'Doprava', 'Ostatní'];
  const grouped  = {};
  available.forEach(cfg => {
    const g = cfg.group || 'Ostatní';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(cfg);
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.prio ?? 99) - (b.prio ?? 99)));

  let zIdx = 401, totalCount = 0;

  grpOrder.forEach(grp => {
    const items = grouped[grp];
    if (!items?.length) return;

    const gh = document.createElement('div');
    gh.className = 'ql-grp'; gh.textContent = grp;
    listEl.appendChild(gh);

    items.forEach(cfg => {
      const data     = window[cfg.varName];
      const features = (data.features || []).filter(f => f.geometry?.coordinates);
      if (!features.length) return;

      if (grp === 'Budovy')  totalBudovy  += features.length;
      else                   totalDoprava += features.length;

      const pane = 'pane_' + cfg.varName;
      map.createPane(pane);
      map.getPane(pane).style.zIndex = zIdx++;

      const styleObj = {
        pane,
        color:       cfg.color,
        weight:      cfg.weight      ?? 1,
        fillColor:   cfg.color,
        fillOpacity: cfg.fillOpacity ?? 0.35,
        opacity:     0.92,
        interactive: true,
      };

      const ll = L.geoJSON({ type: 'FeatureCollection', features }, {
        pane,
        style: () => ({ ...styleObj }),
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { ...styleObj, radius: 5 }),
        onEachFeature(feature, layer) {
          layer.on({ mouseover: highlight, mouseout: unhighlight });
          const props   = feature.properties || {};
          const hasData = Object.values(props).some(v => v !== null && v !== '');

          if (!hasData) {
            layer.bindPopup(() => buildingPopup(feature, cfg), { maxWidth: 280 });
          } else {
            const rows = Object.entries(props)
              .filter(([, v]) => v !== null && v !== '')
              .map(([k, v]) => `<tr>
                <td style="color:var(--muted);font-size:.67rem;padding:4px 8px 4px 4px;white-space:nowrap">${k}</td>
                <td style="padding:4px 4px 4px 0;font-size:.73rem">${String(v)}</td>
              </tr>`).join('');
            layer.bindPopup(`
              <div style="padding:10px 12px 8px">
                <div style="font-family:Syne,sans-serif;font-weight:700;font-size:.82rem;margin-bottom:7px;border-bottom:1px solid var(--border);padding-bottom:5px">${cfg.label}</div>
                <table style="border-collapse:collapse;width:100%">${rows}</table>
              </div>`, { maxHeight: 320, maxWidth: 280 });
          }
        },
      });

      const entry = { cfg, leaflet: ll, visible: false };
      qgisLayers.push(entry);
      buildLayerUI(entry, listEl);
      totalCount++;
    });
  });

  const s = totalCount === 1 ? '1 vrstva' : totalCount < 5 ? `${totalCount} vrstvy` : `${totalCount} vrstev`;
  document.getElementById('qgis-cnt').textContent  = s;
  document.getElementById('st-budovy').textContent  = totalBudovy.toLocaleString();
  document.getElementById('st-doprava').textContent = totalDoprava.toLocaleString();

  try {
    const all = qgisLayers.flatMap(l => l.leaflet.getLayers());
    if (all.length) map.fitBounds(L.featureGroup(all).getBounds().pad(.04));
  } catch(e) {}
}

// ── UI ŘÁDEK VRSTVY ──────────────────────────────────────────────
function buildLayerUI(entry, container) {
  const { cfg } = entry;
  const opPct   = Math.round((cfg.fillOpacity ?? 0.35) * 100);
  const eid     = entry._uid = 'l' + qgisLayers.length; // unikátní kratký ID

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="ql-row" id="qlrow-${eid}">
      <div class="ql-sw" style="background:${cfg.color}"></div>
      <span class="ql-nm dim" id="qln-${eid}">${cfg.label}</span>
      <div class="tog sm" id="qtog-${eid}"></div>
    </div>
    ${cfg.fillOpacity > 0 ? `
    <div class="ql-opacity" id="qop-${eid}">
      <input type="range" min="0" max="100" value="${opPct}" id="qopr-${eid}">
      <span id="qopv-${eid}">${opPct}%</span>
    </div>` : ''}`;

  // Toggle layer on/off
  wrap.querySelector('.ql-row').addEventListener('click', () => toggleLayer(entry));

  // Opacity slider event (čistý JS, bez inline oninput)
  const slider = wrap.querySelector(`#qopr-${eid}`);
  if (slider) {
    slider.addEventListener('input', () => {
      setLayerOpacity(entry, slider.value / 100);
      const valEl = wrap.querySelector(`#qopv-${eid}`);
      if (valEl) valEl.textContent = slider.value + '%';
    });
  }

  container.appendChild(wrap);
}

function toggleLayer(entry) {
  entry.visible = !entry.visible;
  const eid = entry._uid;

  document.getElementById('qtog-'  + eid)?.classList.toggle('on',  entry.visible);
  document.getElementById('qln-'   + eid)?.classList.toggle('dim', !entry.visible);
  document.getElementById('qlrow-' + eid)?.classList.toggle('layer-on', entry.visible);

  // Opacity slider — zobraz pouze když je vrstva zapnutá
  const opEl = document.getElementById('qop-' + eid);
  if (opEl) opEl.classList.toggle('show', entry.visible);

  if (entry.visible) { entry.leaflet.addTo(map); entry.leaflet.bringToFront(); }
  else               { map.removeLayer(entry.leaflet); }
}

function setLayerOpacity(entry, opacity) {
  if (entry) entry.leaflet.setStyle({ fillOpacity: opacity });
}

// ── POKROČILÝ REŽIM ──────────────────────────────────────────────
function toggleAdvanced() {
  advancedMode = !advancedMode;

  // Tlačítko stav
  document.getElementById('adv-btn').classList.toggle('on', advancedMode);
  document.getElementById('adv-pill').textContent = advancedMode ? 'ZAPNUTO' : 'VYPNUTO';

  // IS DMVS sekce
  document.getElementById('qgis-sec').classList.toggle('visible', advancedMode);

  // Kategorie + výsledky — skryj v pokročilém
  document.getElementById('poi-cats-sec')?.classList.toggle('sec-hidden', advancedMode);
  document.getElementById('poi-res-sec')?.classList.toggle('sec-hidden', advancedMode);

  // Stats panel — jen pokročilý
  document.getElementById('stats-panel')?.classList.toggle('adv-show', advancedMode);

  // POI přehled — jen základní
  document.getElementById('poi-overview')?.classList.toggle('adv-hide', advancedMode);

  if (advancedMode) {
    document.getElementById('sb-scroll').scrollTop = 0;
  } else {
    // Vypni všechny DMVS vrstvy při opuštění pokročilého režimu
    qgisLayers.forEach(entry => {
      if (!entry.visible) return;
      entry.visible = false;
      map.removeLayer(entry.leaflet);
      const eid = entry._uid;
      document.getElementById('qtog-'  + eid)?.classList.remove('on');
      document.getElementById('qln-'   + eid)?.classList.add('dim');
      document.getElementById('qlrow-' + eid)?.classList.remove('layer-on');
      const opEl = document.getElementById('qop-' + eid);
      if (opEl) opEl.classList.remove('show');
    });
  }
}
