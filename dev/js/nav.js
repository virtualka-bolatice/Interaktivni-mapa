'use strict';
// ════════════════════════════════════════════════════════════════
//  nav.js — Navigace, heading cone, follow mode, recenter
//  BEZ rotace mapy! Heading cone = modrý kužel dopředu.
//  resetMapBearing() = srovnání mapy na sever.
// ════════════════════════════════════════════════════════════════

const OSRM_BASE     = 'https://router.project-osrm.org/route/v1';
const NOM_BASE      = 'https://nominatim.openstreetmap.org/reverse';
const WALK_SPEED_MS = 1.25;
const ARRIVE_M      = 25;
const SNAP_DIST_M   = 30;

// ── Stav ─────────────────────────────────────────────────────────
let _navPickActive = false;
let _pendingLat = null, _pendingLng = null, _pendingName = null;
let _pickDotMarker = null;
let _fetchedDriveRoute = null, _fetchedWalkRoute = null, _fetchedTarget = null;
let _navMode = null, _navActive = false;
let _driveFullCoords = [], _walkFullCoords = [], _activeFullCoords = [];
let _layerDone = null, _layerTodo = null, _layerShadow = null;
let _destMarker = null, _posMarker = null;
let _headingCone = null, _coneVisible = true;
let _trackWatchId = null, _trackTarget = null;
let _remDist = 0, _avgSpeedMS = 13.9;
let _followMode = false, _lastHeading = null, _mapMoved = false, _lastValidHdg = 0;
// Nav kompas: 0=skrytý, 1=modrý(otočeno), 2=modrý(srovnáno), 3=oranžový(lock)
let _navCompassState = 0;
let _bearingLock     = false;
let _navStartTime = null, _navTotalDist = 0;  // statistiky pro arrival modal
const _ZOOM_NAV = 17;

// ════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════
function _geoToLatLng(geom) { return geom.coordinates.map(c => [c[1], c[0]]); }

function _haversine(a, b) {
  const R = 6371000, dLat = (b[0]-a[0])*Math.PI/180, dLng = (b[1]-a[1])*Math.PI/180;
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
  return 2*R*Math.asin(Math.sqrt(s1*s1 + Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*s2*s2));
}
function _polyLen(c) { let d=0; for(let i=1;i<c.length;i++) d+=_haversine(c[i-1],c[i]); return d; }

function _trimRoute(coords, lat, lng) {
  if (coords.length < 2) return { idx:0, trimmed:coords };
  let minD = Infinity, minI = 0;
  coords.forEach((c,i)=>{ const d=_haversine([lat,lng],c); if(d<minD){minD=d;minI=i;} });
  return { idx:minI, trimmed:coords.slice(minI) };
}

function _fmtDur(sec) {
  if (!sec||sec<0) return '–';
  const h=Math.floor(sec/3600), m=Math.ceil((sec%3600)/60);
  return h>0 ? `${h} h ${m} min` : `${m} min`;
}
function _fmtDist(m) { return !m?'': m<1000 ? `${Math.round(m)} m`:`${(m/1000).toFixed(1)} km`; }

function _routeBearing(posLat, posLng) {
  if (_activeFullCoords.length<2) return _lastValidHdg;
  const {idx} = _trimRoute(_activeFullCoords, posLat, posLng);
  const ahead = Math.min(idx+6, _activeFullCoords.length-1);
  if (ahead<=idx) return _lastValidHdg;
  const [lat2,lng2] = _activeFullCoords[ahead];
  const dLng=(lng2-posLng)*Math.PI/180, φ1=posLat*Math.PI/180, φ2=lat2*Math.PI/180;
  const y=Math.sin(dLng)*Math.cos(φ2), x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(dLng);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

function _snapPosToRoute(lat, lng) {
  if (!_activeFullCoords.length) return {lat,lng,snapped:false};
  let minDist=Infinity, bestLat=lat, bestLng=lng;
  for (let i=0; i<_activeFullCoords.length-1; i++) {
    const [a0,a1]=_activeFullCoords[i], [b0,b1]=_activeFullCoords[i+1];
    const dx=b0-a0, dy=b1-a1, len2=dx*dx+dy*dy;
    const t = len2>0 ? Math.max(0,Math.min(1,((lat-a0)*dx+(lng-a1)*dy)/len2)) : 0;
    const sLat=a0+t*dx, sLng=a1+t*dy;
    const d=_haversine([lat,lng],[sLat,sLng]);
    if(d<minDist){minDist=d; bestLat=sLat; bestLng=sLng;}
  }
  return minDist<=SNAP_DIST_M ? {lat:bestLat,lng:bestLng,snapped:true} : {lat,lng,snapped:false};
}

function _smoothHeading(prev, next) {
  if (prev===null||prev===undefined||isNaN(prev)) return next??0;
  if (next===null||next===undefined||isNaN(next)) return prev;
  let diff=next-prev;
  if(diff> 180) diff-=360;
  if(diff<-180) diff+=360;
  return (prev+0.25*diff+360)%360;
}

// ════════════════════════════════════════════════════════════════
//  HEADING CONE — gradient DivIcon, pevná velikost ~38px (≈1 cm)
//  Používá SVG radialGradient: středem intenzivní, kraji průhledné.
//  Nepotřebuje geomatematiku — jde o vizuální element na markeru.
// ════════════════════════════════════════════════════════════════
const _CONE_PX = 52;   // výška kužele v pixelech
const _CONE_W  = 72;   // šířka kužele v pixelech

function _makeConeIcon(hdgDeg) {
  // Unikátní ID gradienty (vícenásobné SVG na stránce)
  const gid = 'cg' + Date.now();
  return L.divIcon({
    html: `<div class="hdg-cone-wrap" style="transform:rotate(${hdgDeg??0}deg);transform-origin:50% 100%;width:${_CONE_W}px;height:${_CONE_PX}px">
<svg width="${_CONE_W}" height="${_CONE_PX}" viewBox="0 0 ${_CONE_W} ${_CONE_PX}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${gid}" cx="50%" cy="100%" r="95%" fx="50%" fy="100%">
      <stop offset="0%"   stop-color="#60a5fa" stop-opacity="0.75"/>
      <stop offset="35%"  stop-color="#3b82f6" stop-opacity="0.45"/>
      <stop offset="70%"  stop-color="#1d4ed8" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#1e40af" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="M${_CONE_W/2},${_CONE_PX} Q${_CONE_W*0.12},${_CONE_PX*0.35} 2,0 Q${_CONE_W/2},-6 ${_CONE_W-2},0 Q${_CONE_W*0.88},${_CONE_PX*0.35} ${_CONE_W/2},${_CONE_PX} Z"
        fill="url(#${gid})"/>
</svg></div>`,
    className: '',
    iconSize:   [_CONE_W, _CONE_PX],
    iconAnchor: [_CONE_W/2, _CONE_PX],   // kotva = spodek středu = pozice uživatele
  });
}

function _updateHeadingCone(lat, lng, hdgDeg) {
  if (!_coneVisible) return;
  if (!_headingCone) {
    _headingCone = L.marker([lat, lng], {
      icon:           _makeConeIcon(hdgDeg),
      zIndexOffset:   -200,
      interactive:    false,
      rotateWithView: false,
    }).addTo(map);
  } else {
    _headingCone.setLatLng([lat, lng]);
    // Aktualizuj rotaci přímo v DOM — bez rebuild ikony
    const el = _headingCone.getElement();
    if (el) {
      const wrap = el.querySelector('.hdg-cone-wrap');
      if (wrap) wrap.style.transform = `rotate(${hdgDeg??0}deg)`;
      else _headingCone.setIcon(_makeConeIcon(hdgDeg));
    }
  }
}

function _removeHeadingCone() {
  if (_headingCone) { try{map.removeLayer(_headingCone);}catch(e){} _headingCone=null; }
}

// Veřejné API pro ui.js (geo bez navigace)
function navUpdateHeadingCone(lat, lng, heading) {
  if (_navActive) return;
  if (lat===null||heading===null||isNaN(heading)) { _removeHeadingCone(); return; }
  _lastValidHdg = _smoothHeading(_lastValidHdg, heading);
  _updateHeadingCone(lat, lng, _lastValidHdg);
}
function navRemoveHeadingCone() { if (!_navActive) _removeHeadingCone(); }

// ── Kompas SVG (nav widget) — rotuje s headingem ─────────────────
function _updateCompassIcon(hdgDeg) {
  const svg = document.getElementById('nav-compass-svg');
  if (svg) svg.style.transform = `rotate(${hdgDeg??0}deg)`;
}

// ── fab-north SVG — rotuje s bearingem mapy ───────────────────────
function _updateNorthFabIcon(bearingDeg) {
  const svg = document.getElementById('fab-north-svg');
  if (svg) svg.style.transform = `rotate(${-bearingDeg}deg)`;
}

// ── fab-north (vpravo dole, MIMO navigaci) ───────────────────────
// Jediná funkce: srovnat mapu, pak tlačítko zmizí samo přes _syncNorthBtn
function resetMapBearing() {
  if (typeof map.setBearing === 'function') {
    map.setBearing(0, { animate: true, duration: 0.4 });
  }
}

// ── Sync: udržuje map-rotated + rotuje kompas ikony ──────────────
function _syncNorthBtn() {
  const bearing = (typeof map.getBearing === 'function') ? (map.getBearing()||0) : 0;
  const rotated = Math.abs(bearing) > 1.5;
  document.body.classList.toggle('map-rotated', rotated);
  _updateNorthFabIcon(bearing);
  // Nav kompas: auto-zobraz (modrý) když se mapa otočí a kompas je skrytý
  if (_navActive && _navCompassState === 0 && rotated) {
    _navCompassState = 1;
    _applyNavCompassState();
  }
}

map.on('rotate',  _syncNorthBtn);
map.on('moveend', _syncNorthBtn);

// ── Nav widget kompas — 3 kliknutí ───────────────────────────────
// Stav 0: skrytý
// Stav 1: modrý (mapa otočena, zobrazeno auto nebo po resetu)
// Stav 2: modrý (mapa srovnána, čeká na lock)
// Stav 3: oranžový (bearing lock – mapa sleduje heading)
function _applyNavCompassState() {
  const btn = document.getElementById('nav-persp-btn');
  if (!btn) return;
  if (_navCompassState === 0) {
    btn.style.opacity = '0';
    btn.style.transition = 'opacity .4s ease';
    setTimeout(() => { if (_navCompassState === 0) btn.style.display = 'none'; }, 420);
  } else if (_navCompassState === 1 || _navCompassState === 2) {
    btn.style.display = '';
    btn.style.transition = 'opacity .25s ease, background .18s, border-color .18s, color .18s';
    btn.style.opacity = '1';
    btn.style.background = 'rgba(59,130,246,.15)';
    btn.style.borderColor = '#3b82f6';
    btn.style.color = '#3b82f6';
  } else if (_navCompassState === 3) {
    btn.style.display = '';
    btn.style.opacity = '1';
    btn.style.background = 'rgba(249,115,22,.15)';
    btn.style.borderColor = '#f97316';
    btn.style.color = '#f97316';
  }
}

function toggleNavCompass() {
  if (_navCompassState === 1) {
    // Klik 1: srovnej mapu, přejdi do stavu 2 (modrý, čeká na lock)
    if (typeof map.setBearing === 'function') map.setBearing(0, { animate: true, duration: 0.4 });
    _navCompassState = 2;
    _applyNavCompassState();
  } else if (_navCompassState === 2) {
    // Klik 2: zapni bearing lock → oranžový
    _bearingLock = true;
    if (typeof map.setBearing === 'function') map.setBearing(_lastValidHdg, { animate: true, duration: 0.4 });
    _navCompassState = 3;
    _applyNavCompassState();
  } else if (_navCompassState === 3) {
    // Klik 3: vypni lock, srovnej, skryj
    _bearingLock = false;
    if (typeof map.setBearing === 'function') map.setBearing(0, { animate: true, duration: 0.4 });
    _navCompassState = 0;
    _applyNavCompassState();
  }
}

// ════════════════════════════════════════════════════════════════
//  PICK MODE
// ════════════════════════════════════════════════════════════════
function _removePick() {
  if(_pickDotMarker){try{map.removeLayer(_pickDotMarker);}catch(e){}_pickDotMarker=null;}
}

async function _onMapPick(e) {
  if (!_navPickActive) return;
  const {lat,lng} = e.latlng;
  _pendingLat=lat; _pendingLng=lng; _navPickActive=false;
  map.getContainer().style.cursor='';
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  const lbl=document.getElementById('nav-pick-lbl');
  if(lbl) lbl.textContent='Změnit cíl';
  _removePick();
  _pickDotMarker = L.marker([lat,lng],{
    icon: L.divIcon({
      html:`<div style="width:18px;height:18px;background:#0ea5e9;border:3px solid #fff;border-radius:50%;box-shadow:0 0 14px #0ea5e9bb;animation:pick-pulse 1s ease infinite"></div>`,
      className:'', iconSize:[18,18], iconAnchor:[9,9]
    }), zIndexOffset:1000
  }).addTo(map);
  const nc=document.getElementById('nc-dest-name');
  if(nc) nc.textContent='⏳ Hledám adresu…';
  document.getElementById('nav-confirm')?.classList.add('on');
  try {
    const r=await fetch(`${NOM_BASE}?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=0`,{headers:{'Accept-Language':'cs'}});
    _pendingName=r.ok?((await r.json()).display_name||'').split(',').slice(0,2).join(', ')||`${lat.toFixed(5)}, ${lng.toFixed(5)}`:`${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch(e) { _pendingName=`${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
  if(nc) nc.textContent=_pendingName;
}

function toggleNavPick() {
  if (_navPickActive) {
    _navPickActive=false; map.off('click',_onMapPick); map.getContainer().style.cursor='';
    document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
    const lbl=document.getElementById('nav-pick-lbl'); if(lbl) lbl.textContent='Vybrat cíl na mapě';
    return;
  }
  _navPickActive=true;
  document.getElementById('nav-confirm')?.classList.remove('on');
  _removePick();
  map.getContainer().style.cursor='crosshair';
  document.getElementById('nav-pick-btn')?.classList.add('pick-active');
  const lbl=document.getElementById('nav-pick-lbl'); if(lbl) lbl.textContent='Klikni na cíl…';
  map.once('click',_onMapPick);
  badge('🎯 Klikni na mapu pro výběr cíle');
}

// ════════════════════════════════════════════════════════════════
//  CONFIRM → picker → fetch → časy
// ════════════════════════════════════════════════════════════════
async function confirmNav() {
  if(_pendingLat===null) return;
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('on');
  const geoPos=(typeof getGeoLatLng==='function')?getGeoLatLng():null;
  if(!geoPos){badge('📍 Nejdříve zapni polohu');return;}
  const tLat=_pendingLat, tLng=_pendingLng, tName=_pendingName;
  _fetchedTarget={lat:tLat,lng:tLng,name:tName};
  _fetchedDriveRoute=null; _fetchedWalkRoute=null;
  _openModePicker(tName);
  const coord=`${geoPos.lng},${geoPos.lat};${tLng},${tLat}`, params='?overview=full&geometries=geojson&steps=false';
  try {
    const [dr,wr]=await Promise.allSettled([fetch(`${OSRM_BASE}/driving/${coord}${params}`),fetch(`${OSRM_BASE}/walking/${coord}${params}`)]);
    _fetchedDriveRoute=dr.status==='fulfilled'&&dr.value.ok?((await dr.value.json()).routes?.[0]??null):null;
    _fetchedWalkRoute=wr.status==='fulfilled'&&wr.value.ok?((await wr.value.json()).routes?.[0]??null):null;
  } catch(e){console.error('nav fetch:',e);}
  if(!_fetchedDriveRoute&&!_fetchedWalkRoute){cancelModePicker();badge('❌ Trasa nenalezena — zkontroluj připojení');return;}
  const wc=_fetchedWalkRoute?_geoToLatLng(_fetchedWalkRoute.geometry):[];
  const wd=_polyLen(wc), wt=wd>0?Math.round(wd/WALK_SPEED_MS):(_fetchedWalkRoute?.duration??null);
  _fillModePicker(_fetchedDriveRoute?.duration??null,_fetchedDriveRoute?.distance??null,wt,wd||(_fetchedWalkRoute?.distance??null));
}

function cancelNavPick() {
  _navPickActive=false; _pendingLat=_pendingLng=_pendingName=null;
  map.off('click',_onMapPick); map.getContainer().style.cursor=''; _removePick();
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  const lbl=document.getElementById('nav-pick-lbl'); if(lbl) lbl.textContent='Vybrat cíl na mapě';
}

// ════════════════════════════════════════════════════════════════
//  MODE PICKER UI
// ════════════════════════════════════════════════════════════════
function _openModePicker(name) {
  const el=document.getElementById('nav-mode-picker'); if(!el) return;
  document.getElementById('nmp-dest-name').textContent=name||'Cíl';
  const loading=document.getElementById('nmp-loading'), opts=document.getElementById('nmp-opts');
  if(loading) loading.style.display='flex'; if(opts) opts.style.display='none';
  ['nmp-drive','nmp-walk'].forEach(id=>document.getElementById(id)?.removeAttribute('disabled'));
  el.classList.add('on');
}
function _fillModePicker(driveDur,driveDist,walkDur,walkDist) {
  const loading=document.getElementById('nmp-loading'), opts=document.getElementById('nmp-opts');
  if(loading) loading.style.display='none'; if(opts) opts.style.display='flex';
  document.getElementById('nmp-drive-time').textContent=driveDur?_fmtDur(driveDur):'–';
  document.getElementById('nmp-walk-time').textContent=walkDur?_fmtDur(walkDur):'–';
  document.getElementById('nmp-drive-dist').textContent=driveDist?_fmtDist(driveDist):'';
  document.getElementById('nmp-walk-dist').textContent=walkDist?_fmtDist(walkDist):'';
  if(!_fetchedDriveRoute) document.getElementById('nmp-drive')?.setAttribute('disabled',true);
  if(!_fetchedWalkRoute)  document.getElementById('nmp-walk')?.setAttribute('disabled',true);
}
function cancelModePicker() {
  document.getElementById('nav-mode-picker')?.classList.remove('on');
  _fetchedDriveRoute=_fetchedWalkRoute=_fetchedTarget=null;
  const loading=document.getElementById('nmp-loading'), opts=document.getElementById('nmp-opts');
  if(loading) loading.style.display='flex'; if(opts) opts.style.display='none';
  ['nmp-drive','nmp-walk'].forEach(id=>document.getElementById(id)?.removeAttribute('disabled'));
  if(typeof getGeoLatLng==='function'&&getGeoLatLng()) document.getElementById('nav-pick-btn')?.classList.add('on');
}
async function pickNavMode(mode) {
  document.getElementById('nav-mode-picker')?.classList.remove('on');
  _navMode=mode;
  const t=_fetchedTarget; if(!t) return;
  const savedDrive=_fetchedDriveRoute, savedWalk=_fetchedWalkRoute;
  await _startNav(t.lat,t.lng,t.name,mode,savedDrive,savedWalk);
}

// ════════════════════════════════════════════════════════════════
//  START NAVIGACE
// ════════════════════════════════════════════════════════════════
async function _startNav(tLat,tLng,tName,mode,driveRoute,walkRoute) {
  const _dr=(driveRoute??_fetchedDriveRoute)??null;
  const _wr=(walkRoute??_fetchedWalkRoute)??null;
  clearNav();
  _navMode=mode; _coneVisible=true;
  const route=mode==='driving'?_dr:_wr;
  if(!route){badge('❌ Trasa nenalezena — vyber cíl znovu');return;}
  const coords=_geoToLatLng(route.geometry);
  if(!coords||coords.length<2){badge('❌ Neplatná geometrie trasy');return;}
  if(mode==='driving'){_driveFullCoords=coords; _walkFullCoords=_wr?_geoToLatLng(_wr.geometry):[];}
  else{_walkFullCoords=coords; _driveFullCoords=_dr?_geoToLatLng(_dr.geometry):[];}
  _activeFullCoords=coords;
  const dist=_polyLen(coords);
  const dur=mode==='driving'?route.duration:Math.round(dist/WALK_SPEED_MS);
  if(route.duration&&route.distance) _avgSpeedMS=route.distance/route.duration;

  // Kresli trasu — BEZ custom pane (fix kritický bug s leaflet-rotate)
  _drawActiveRoute(coords,mode);

  // Cílový marker
  _destMarker=L.marker([tLat,tLng],{
    icon:L.divIcon({
      html:`<div style="width:26px;height:26px;background:#f97316;border:3px solid #fff;border-radius:50%;box-shadow:0 0 16px #f97316bb;display:flex;align-items:center;justify-content:center;font-size:.8rem">🎯</div>`,
      className:'', iconSize:[26,26], iconAnchor:[13,13]
    }), zIndexOffset:800
  }).addTo(map).bindPopup(`<div style="padding:6px 10px;font-size:.75rem;font-family:DM Sans,sans-serif">🎯 <strong>${tName||'Cíl'}</strong></div>`);

  _showNavWidget(mode,tName,dur,dist);
  document.body.classList.add('nav-on');
  _navActive=true;
  _navStartTime = Date.now();
  _navTotalDist = dist;
  // VŽDY skryj geo vizuály — marker + přesnostní kruh — navigace přebírá polohu
  if (typeof hideGeoVisuals === 'function') hideGeoVisuals();
  if (typeof navRemoveHeadingCone === 'function') navRemoveHeadingCone();
  try{map.fitBounds(L.latLngBounds(coords).pad(.12));}catch(e){}
  _setFollow(true);
  map.on('dragstart',_onMapDrag);
  _startTracking(tLat,tLng,tName);
  document.getElementById('fab-nav')?.classList.add('on');
  // Reset stavu nav kompasu — skrytý na začátku navigace
  _navCompassState = 0; _bearingLock = false;
  const _npBtn = document.getElementById('nav-persp-btn');
  if (_npBtn) { _npBtn.style.display='none'; _npBtn.style.opacity=''; }
  // Geo FAB zašedí — navigace přebírá tracking
  document.getElementById('fab-geo')?.classList.add('nav-taking-over');
}

// Z POI popupu
async function navigateTo(tLat,tLng,tName) {
  const geoPos=(typeof getGeoLatLng==='function')?getGeoLatLng():null;
  if(!geoPos){
    badge('📍 Nejdříve zapni polohu');
    const btn=document.getElementById('fab-geo');
    if(btn){btn.classList.remove('geo-flash');void btn.offsetWidth;btn.classList.add('geo-flash');setTimeout(()=>btn.classList.remove('geo-flash'),2200);}
    return;
  }
  _pendingLat=tLat; _pendingLng=tLng; _pendingName=tName;
  _fetchedTarget={lat:tLat,lng:tLng,name:tName};
  _fetchedDriveRoute=null; _fetchedWalkRoute=null;
  _openModePicker(tName);
  const coord=`${geoPos.lng},${geoPos.lat};${tLng},${tLat}`, params='?overview=full&geometries=geojson&steps=false';
  try {
    const [dr,wr]=await Promise.allSettled([fetch(`${OSRM_BASE}/driving/${coord}${params}`),fetch(`${OSRM_BASE}/walking/${coord}${params}`)]);
    _fetchedDriveRoute=dr.status==='fulfilled'&&dr.value.ok?((await dr.value.json()).routes?.[0]??null):null;
    _fetchedWalkRoute=wr.status==='fulfilled'&&wr.value.ok?((await wr.value.json()).routes?.[0]??null):null;
  } catch(e){cancelModePicker();badge('❌ Chyba trasy');return;}
  const wc=_fetchedWalkRoute?_geoToLatLng(_fetchedWalkRoute.geometry):[];
  const wd=_polyLen(wc), wt=wd>0?Math.round(wd/WALK_SPEED_MS):(_fetchedWalkRoute?.duration??null);
  _fillModePicker(_fetchedDriveRoute?.duration??null,_fetchedDriveRoute?.distance??null,wt,wd||(_fetchedWalkRoute?.distance??null));
}

// ════════════════════════════════════════════════════════════════
//  KRESLENÍ TRASY
//  DŮLEŽITÉ: Nepoužíváme vlastní pane — leaflet-rotate může
//  způsobit problémy s custom panes (překryv, viditelnost).
//  Polylines jdou přímo do overlayPane (výchozí, zIndex 400).
// ════════════════════════════════════════════════════════════════

function _drawActiveRoute(coords,mode) {
  [_layerShadow,_layerDone,_layerTodo].forEach(l=>{if(l)try{map.removeLayer(l);}catch(e){}});
  const color=mode==='driving'?'#3b82f6':'#10b981';
  const w=mode==='driving'?5:3;
  const dash=mode==='walking'?'7,5':undefined;
  // Glow shadow
  _layerShadow=L.polyline(coords,{
    color:mode==='driving'?'#1e40af':'#065f46',
    weight:w+6,opacity:.18,lineCap:'round',lineJoin:'round',interactive:false,
  }).addTo(map);
  // Hlavní linie trasy
  _layerTodo=L.polyline(coords,{
    color,weight:w,opacity:.92,
    lineCap:'round',lineJoin:'round',interactive:false,
    ...(dash?{dashArray:dash}:{}),
  }).addTo(map);
  _layerDone=null;
}

function _redrawProgress(doneCoords,todoCoords) {
  const mode=_navMode, color=mode==='driving'?'#3b82f6':'#10b981';
  const w=mode==='driving'?5:3, dash=mode==='walking'?'7,5':undefined;
  if(_layerDone)try{map.removeLayer(_layerDone);}catch(e){}
  if(_layerTodo)try{map.removeLayer(_layerTodo);}catch(e){}
  if(_layerShadow)try{map.removeLayer(_layerShadow);}catch(e){}
  if(doneCoords.length>1){
    _layerDone=L.polyline(doneCoords,{
      color:'#475569',weight:w,opacity:.4,
      lineCap:'round',lineJoin:'round',interactive:false,
    }).addTo(map);
  }
  if(todoCoords.length>1){
    _layerShadow=L.polyline(todoCoords,{
      color:mode==='driving'?'#1e40af':'#065f46',
      weight:w+6,opacity:.18,lineCap:'round',lineJoin:'round',interactive:false,
    }).addTo(map);
    _layerTodo=L.polyline(todoCoords,{
      color,weight:w,opacity:.92,
      lineCap:'round',lineJoin:'round',interactive:false,
      ...(dash?{dashArray:dash}:{}),
    }).addTo(map);
  }
}

// ════════════════════════════════════════════════════════════════
//  WIDGET
// ════════════════════════════════════════════════════════════════
function _showNavWidget(mode,name,durSec,distM) {
  document.getElementById('nav-mode-ico').textContent=mode==='driving'?'🚗':'🚶';
  document.getElementById('nav-dest-name').textContent=name||'Cíl';
  document.getElementById('nav-active-time').textContent=_fmtDur(durSec);
  document.getElementById('nav-dist').textContent=distM?_fmtDist(distM):'';
  document.getElementById('nav-widget').classList.add('on');
}
function _updateWidget(remSec,remDist) {
  const tv=document.getElementById('nav-active-time'); if(tv) tv.textContent=remSec>0?_fmtDur(remSec):'✓';
  const dv=document.getElementById('nav-dist'); if(dv) dv.textContent=remDist>0?`${_fmtDist(remDist)} zbývá`:'V cíli';
}

// ════════════════════════════════════════════════════════════════
//  NAVIGAČNÍ MARKER — auto nebo chodec
//  rotateWithView:false → leaflet-rotate ho neotáčí automaticky
//  Rotaci headingu aplikujeme ručně přes style.transform
// ════════════════════════════════════════════════════════════════
function _buildNavMarkerIcon(hdgDeg, mode) {
  const isDriving = (mode || _navMode) === 'driving';
  const rot = hdgDeg ?? 0;

  if (isDriving) {
    // Auto — pohled shora, výrazné barvy, světla, špička = přední část
    return L.divIcon({
      html:`<div class="nav-pos-marker" style="transform:rotate(${rot}deg);transform-origin:50% 50%;width:36px;height:52px">
<svg viewBox="0 0 36 52" width="36" height="52" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="cs"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1d4ed8" flood-opacity=".55"/></filter>
    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <!-- karoserie základna -->
  <path d="M5,14 Q5,6 13,5 L23,5 Q31,6 31,14 L31,40 Q31,46 23,46 L13,46 Q5,46 5,40 Z"
        fill="url(#cg)" filter="url(#cs)"/>
  <!-- přední sklo — výrazně modré -->
  <path d="M12,16 L13,10 Q13.5,8.5 18,8.5 Q22.5,8.5 23,10 L24,16 Z"
        fill="#bfdbfe" opacity=".85"/>
  <!-- přední sklo střed přechod -->
  <path d="M14,16 L14.5,10.5 Q18,9.5 21.5,10.5 L22,16 Z"
        fill="rgba(255,255,255,.35)"/>
  <!-- zadní okno -->
  <path d="M13,37 L23,37 L23.5,42 Q23,43.5 18,43.5 Q13,43.5 12.5,42 Z"
        fill="#93c5fd" opacity=".5"/>
  <!-- čelní světla — sytě žluté -->
  <rect x="5"  y="7"  width="5.5" height="3.5" rx="1.8" fill="#fef08a"/>
  <rect x="25.5" y="7" width="5.5" height="3.5" rx="1.8" fill="#fef08a"/>
  <!-- čelní světla vnitřní záblesk -->
  <rect x="6"  y="7.5" width="2" height="2" rx="1" fill="white" opacity=".7"/>
  <rect x="27" y="7.5" width="2" height="2" rx="1" fill="white" opacity=".7"/>
  <!-- zadní světla — sytě červené -->
  <rect x="5"  y="40.5" width="5" height="3" rx="1.5" fill="#ef4444"/>
  <rect x="26" y="40.5" width="5" height="3" rx="1.5" fill="#ef4444"/>
  <!-- levé kolo -->
  <rect x="2"  y="13" width="5" height="9" rx="2.5" fill="#1e293b"/>
  <rect x="2"  y="31" width="5" height="9" rx="2.5" fill="#1e293b"/>
  <!-- pravé kolo -->
  <rect x="29" y="13" width="5" height="9" rx="2.5" fill="#1e293b"/>
  <rect x="29" y="31" width="5" height="9" rx="2.5" fill="#1e293b"/>
  <!-- obrys blysk -->
  <path d="M5,14 Q5,6 13,5 L23,5 Q31,6 31,14 L31,40 Q31,46 23,46 L13,46 Q5,46 5,40 Z"
        fill="none" stroke="rgba(255,255,255,.30)" stroke-width="1"/>
</svg></div>`,
      className: '', iconSize: [36,52], iconAnchor: [18,26],
    });
  } else {
    // Chodec — pouze hlava (zelené kolečko), střed = pozice uživatele
    return L.divIcon({
      html:`<div class="nav-pos-marker" style="transform:rotate(${rot}deg);transform-origin:50% 50%;width:26px;height:26px">
<svg viewBox="0 0 26 26" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="ws"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#065f46" flood-opacity=".6"/></filter>
    <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <circle cx="13" cy="13" r="11.5" fill="url(#wg)" filter="url(#ws)"/>
  <circle cx="13" cy="13" r="11.5" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>
  <ellipse cx="10" cy="10" rx="3.8" ry="2.8" fill="rgba(255,255,255,.28)"/>
</svg></div>`,
      className: '', iconSize: [26,26], iconAnchor: [13,13],
    });
  }
}

function _updatePosMarker(lat, lng, hdgDeg) {
  if (!_posMarker) {
    _posMarker = L.marker([lat, lng], {
      icon:           _buildNavMarkerIcon(hdgDeg, _navMode),
      zIndexOffset:   1200,
      rotateWithView: false,  // My rotujeme ručně přes heading
      interactive:    false,
    }).addTo(map);
  } else {
    _posMarker.setLatLng([lat, lng]);
    // Aktualizuj rotaci přímým DOM zápisem — bez rebuild ikony (plynulé)
    const el = _posMarker.getElement();
    if (el) {
      const inner = el.querySelector('.nav-pos-marker');
      if (inner) inner.style.transform = `rotate(${hdgDeg??0}deg)`;
      else _posMarker.setIcon(_buildNavMarkerIcon(hdgDeg, _navMode));
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  FOLLOW MODE
// ════════════════════════════════════════════════════════════════
function _setFollow(on) {
  _followMode=on; _mapMoved=false;
  const btn=document.getElementById('nav-follow-btn');
  const rc=document.getElementById('nav-recenter-btn');
  const rc2=document.getElementById('nav-recenter-btn2');
  if(btn) btn.classList.toggle('follow-on',on);
  if(rc)  rc.classList.toggle('on',!on);
  if(rc2) rc2.classList.toggle('on',!on);
  if(on){const pos=(typeof getGeoLatLng==='function')?getGeoLatLng():null; if(pos) map.setView([pos.lat,pos.lng],Math.max(map.getZoom(),_ZOOM_NAV));}
}
function toggleNavFollow() { _setFollow(!_followMode); }
function navRecenter()      { _setFollow(true); }
function _onMapDrag() {
  if(!_navActive) return;
  if(_followMode){
    _followMode=false; _mapMoved=true;
    document.getElementById('nav-follow-btn')?.classList.remove('follow-on');
    document.getElementById('nav-recenter-btn')?.classList.add('on');
    document.getElementById('nav-recenter-btn2')?.classList.add('on');
  }
}

// ════════════════════════════════════════════════════════════════
//  GPS TRACKING
// ════════════════════════════════════════════════════════════════
function _startTracking(tLat,tLng,tName) {
  _stopTracking(); _trackTarget={lat:tLat,lng:tLng,name:tName};
  if(!navigator.geolocation) return;
  _trackWatchId=navigator.geolocation.watchPosition(pos=>_onTrack(pos),err=>console.warn('nav track:',err.message),{enableHighAccuracy:true,maximumAge:0,timeout:12000});
}
function _stopTracking() {
  if(_trackWatchId!==null){navigator.geolocation.clearWatch(_trackWatchId);_trackWatchId=null;}
  _trackTarget=null;
}

function _onTrack(pos) {
  if(!_navActive) return;
  const rawLat=pos.coords.latitude, rawLng=pos.coords.longitude;

  // Heading
  let heading=pos.coords.heading;
  if(!heading||isNaN(heading)||(pos.coords.speed!==null&&pos.coords.speed<0.5)) heading=_routeBearing(rawLat,rawLng);
  heading=_smoothHeading(_lastValidHdg,heading);
  _lastValidHdg=heading; _lastHeading=heading;

  // Snap na trasu
  const snapped=_snapPosToRoute(rawLat,rawLng);
  const lat=snapped.lat, lng=snapped.lng;

  _updateCompassIcon(heading);
  _updatePosMarker(lat,lng,heading);
  _updateHeadingCone(lat,lng,heading);

  // Bearing lock: mapa sleduje heading
  if (_bearingLock && typeof map.setBearing === 'function') {
    map.setBearing(heading, { animate: false });
  }

  if(_followMode) map.setView([lat,lng],Math.max(map.getZoom(),_ZOOM_NAV),{animate:true,duration:0.4});

  // Cíl
  if(_trackTarget){
    const d=_haversine([rawLat,rawLng],[_trackTarget.lat,_trackTarget.lng]);
    if(d<=ARRIVE_M){
      _stopTracking();
      _removeHeadingCone();
      _showArrivedModal(_trackTarget.name);
      return;
    }
  }

  // Progress
  if(_activeFullCoords.length>1){
    const {idx,trimmed}=_trimRoute(_activeFullCoords,lat,lng);
    const done=_activeFullCoords.slice(0,idx+1);
    _redrawProgress(done,trimmed);
    const remDist=_polyLen(trimmed);
    const remSec=_navMode==='driving'?Math.round(remDist/(_avgSpeedMS||13.9)):Math.round(remDist/WALK_SPEED_MS);
    _remDist=remDist; _updateWidget(remSec,remDist);
  }
}

// ════════════════════════════════════════════════════════════════
//  PŘÍJEZDOVÝ MODAL — statistiky po dosažení cíle
// ════════════════════════════════════════════════════════════════
function _showArrivedModal(destName) {
  const elapsed = _navStartTime ? Math.round((Date.now() - _navStartTime) / 1000) : null;
  const dist    = _navTotalDist || 0;

  document.getElementById('nar-dest-name').textContent = destName || 'Cíl';
  document.getElementById('nar-time').textContent = elapsed ? _fmtDur(elapsed) : '–';
  document.getElementById('nar-dist').textContent = dist > 0 ? _fmtDist(dist) : '–';
  document.getElementById('nar-mode').textContent = _navMode === 'driving' ? '🚗 Auto' : '🚶 Pěšky';

  const modal = document.getElementById('nav-arrived-modal');
  if (modal) modal.classList.add('on');
}

function closeArrivedModal() {
  document.getElementById('nav-arrived-modal')?.classList.remove('on');
  clearNav();
}

// ════════════════════════════════════════════════════════════════
//  CLEAR
// ════════════════════════════════════════════════════════════════
function clearNav() {
  _stopTracking();
  _navActive=false; _followMode=false; _navMode=null;
  _fetchedDriveRoute=_fetchedWalkRoute=_fetchedTarget=null;
  _lastValidHdg=0; _lastHeading=null;
  _bearingLock=false; _navCompassState=0;
  _navStartTime=null; _navTotalDist=0;
  _updateCompassIcon(0);
  _removeHeadingCone();
  [_layerShadow,_layerDone,_layerTodo,_destMarker,_posMarker].forEach(l=>{if(l)try{map.removeLayer(l);}catch(e){}});
  _layerShadow=_layerDone=_layerTodo=null; _destMarker=_posMarker=null;
  _driveFullCoords=[]; _walkFullCoords=[]; _activeFullCoords=[]; _remDist=0;
  map.off('dragstart',_onMapDrag);
  _removePick(); _navPickActive=false; map.off('click',_onMapPick);
  map.getContainer().style.cursor='';
  document.getElementById('nav-widget')?.classList.remove('on');
  document.getElementById('nav-arrived-modal')?.classList.remove('on');
  document.getElementById('fab-nav')?.classList.remove('on');
  document.getElementById('nav-confirm')?.classList.remove('on');
  document.getElementById('nav-mode-picker')?.classList.remove('on');
  document.getElementById('nav-recenter-btn')?.classList.remove('on');
  document.getElementById('nav-recenter-btn2')?.classList.remove('on');
  document.getElementById('nav-pick-btn')?.classList.remove('pick-active');
  document.getElementById('nav-follow-btn')?.classList.remove('follow-on');
  // Skryj nav compass okamžitě
  const _cp = document.getElementById('nav-persp-btn');
  if (_cp) { _cp.style.display='none'; _cp.style.opacity=''; _cp.style.background=''; _cp.style.borderColor=''; _cp.style.color=''; }
  // Obnov geo FAB + znovu zobraz geo marker
  document.getElementById('fab-geo')?.classList.remove('nav-taking-over');
  document.body.classList.remove('nav-on');  // nav-on pryč PŘED showGeoVisuals
  if (typeof showGeoVisuals === 'function') showGeoVisuals();
  if (typeof map.setBearing === 'function') map.setBearing(0);
  document.body.classList.remove('map-rotated');
  const lbl=document.getElementById('nav-pick-lbl'); if(lbl) lbl.textContent='Vybrat cíl na mapě';
  _pendingLat=_pendingLng=_pendingName=null;
}
