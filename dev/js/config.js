'use strict';

// ════════════════════════════════════════════════════════════════
//  config.js — KONFIGURACE MAPY
//
//  Tento soubor edituj po každém novém exportu z QGIS / qgis2web.
//  Ostatní soubory (layers.js, poi.js…) měnit nepotřebuješ.
// ════════════════════════════════════════════════════════════════


// ── IS DMVS VRSTVY ───────────────────────────────────────────────
//
//  Každý řádek = jedna vrstva exportovaná z qgis2web.
//
//  varName   → název JS proměnné v souboru (vždy json_ + basename)
//              Příklad: soubor "ZPS...budova_3.js"
//                       proměnná "json_ZPS...budova_3"
//  label     → zobrazovaný název v panelu
//  group     → skupina v panelu: 'Budovy' | 'Doprava' | 'Ostatní'
//  color     → hex barva vrstvy
//  weight    → tloušťka linie (px)
//  fillOpacity → průhlednost výplně (0 = jen obrys, 0.45 = plná)
//  ltype     → 'polygon' | 'line' (ovlivňuje highlight a popup)
//  prio      → pořadí v panelu (1 = nahoře)
//
// ─────────────────────────────────────────────────────────────────
const DMVS_LAYERS = [

  // ── BUDOVY ──────────────────────────────────────────────────────
  {
    varName:     'json_ZPSKonstrukn_prvky_objektZkladn_konstrukn_prvek010000029902_hranice_budovy_1',
    label:       'Hranice budov',
    group:       'Budovy',
    color:       '#7c3aed',
    weight:      1.5,
    fillOpacity: 0,
    ltype:       'line',
    prio:        1,
  },
  {
    varName:     'json_Budovy_2',
    label:       'Budovy',
    group:       'Budovy',
    color:       '#8b5cf6',
    weight:      1,
    fillOpacity: 0.45,
    ltype:       'polygon',
    prio:        2,
  },
  {
    varName:     'json_ZPSBudovyObjekt_budovy010000000103_budova_2',
    label:       'Budovy (typ 104)',
    group:       'Budovy',
    color:       '#a78bfa',
    weight:      1,
    fillOpacity: 0.45,
    ltype:       'polygon',
    prio:        3,
  },
  {
    varName:     'json_ZPSBudovyObjekt_budovy010000000105_budova_21',
    label:       'Budovy (typ 105)',
    group:       'Budovy',
    color:       '#c4b5fd',
    weight:      1,
    fillOpacity: 0.4,
    ltype:       'polygon',
    prio:        4,
  },

  // ── DOPRAVA ─────────────────────────────────────────────────────
  {
    varName:     'json_Parkoviste_plocha_5',
    label:       'Parkoviště',
    group:       'Doprava',
    color:       '#64748b',
    weight:      0.8,
    fillOpacity: 0.4,
    ltype:       'polygon',
    prio:        1,
  },
    {
    varName:     'json_ZPSDopravn_stavbySilnin_doprava010000001105_parkovit_odstavn_plocha_3',
    label:       'Parkoviště',
    group:       'Doprava',
    color:       '#64748b',
    weight:      0.8,
    fillOpacity: 0.4,
    ltype:       'polygon',
    prio:        1,
  },
  {
    varName:     'json_ZPSDopravn_stavbySilnin_doprava010000000503_provozn_plocha_pozemn_komunikace_11',
    label:       'Provozní plocha',
    group:       'Doprava',
    color:       '#475569',
    weight:      0.8,
    fillOpacity: 0.35,
    ltype:       'polygon',
    prio:        2,
  },
  {
    varName:     'json_DIdopravn_stavbydrn_doprava010000001903_obvod_drhy_12',
    label:       'Obvod dráhy',
    group:       'Doprava',
    color:       '#92400e',
    weight:      1.5,
    fillOpacity: 0,
    ltype:       'line',
    prio:        3,
  },
  {
    varName:     'json_DIdopravn_stavbysilnin_doprava010000000303_obvod_pozemn_komunikace_13',
    label:       'Obvod komunikace',
    group:       'Doprava',
    color:       '#d97706',
    weight:      1.5,
    fillOpacity: 0,
    ltype:       'line',
    prio:        4,
  },
  {
    varName:     'json_ZPSDopravn_stavbySilnin_doprava010000000703_chodnk_15',
    label:       'Chodníky',
    group:       'Doprava',
    color:       '#94a3b8',
    weight:      0.8,
    fillOpacity: 0.3,
    ltype:       'polygon',
    prio:        5,
  },
  {
    varName:     'json_ZPSDopravn_stavbyDrn_doprava010000031203_souhrnn_plocha_elezninch_drah_19',
    label:       'Plocha žel. drah',
    group:       'Doprava',
    color:       '#78350f',
    weight:      1,
    fillOpacity: 0.45,
    ltype:       'polygon',
    prio:        6,
  },
  {
    varName:     'json_ZPSDopravn_stavbySilnin_doprava010000000903_cyklostezka_31',
    label:       'Cyklostezky',
    group:       'Doprava',
    color:       '#059669',
    weight:      2,
    fillOpacity: 0,
    ltype:       'line',
    prio:        7,
  },

  // ── SEM PŘIDÁVEJ NOVÉ VRSTVY ────────────────────────────────────
  // {
  //   varName:     'json_NAZEV_SOUBORU_BEZ_PRIPONY',
  //   label:       'Zobrazovaný název',
  //   group:       'Budovy',   // nebo 'Doprava' / 'Ostatní'
  //   color:       '#3b82f6',
  //   weight:      1,
  //   fillOpacity: 0.4,
  //   ltype:       'polygon',  // nebo 'line'
  //   prio:        10,
  // },
];


// ── POI KATEGORIE ────────────────────────────────────────────────
//
//  Přidej / odeber subkategorie dle potřeby.
//  Pole `foto` v GeoJSON odkazuje na soubor relativní k index.html.
//
const CAT_CFG = {
  gastro: { label:'Gastronomie',       color:'#f97316', icon:'🍽️', subs:{
    restaurace: { label:'Restaurace', icon:'🍽️', color:'#fb923c' },
    hospoda:    { label:'Hospoda',    icon:'🍺', color:'#f97316' },
    kavarna:    { label:'Kavárna',    icon:'☕', color:'#d97706' },
    pizzeria:   { label:'Pizzeria',   icon:'🍕', color:'#ef4444' },
    fast_food:  { label:'Fast food',  icon:'🍔', color:'#fbbf24' },
  }},
  zdravi: { label:'Zdravotnictví',     color:'#06b6d4', icon:'🏥', subs:{
    lekar:       { label:'Praktický lékař', icon:'👨‍⚕️', color:'#06b6d4' },
    zubar:       { label:'Zubař',           icon:'🦷',   color:'#22d3ee' },
    lekarna:     { label:'Lékárna',         icon:'💊',   color:'#67e8f9' },
    specialista: { label:'Specialista',     icon:'🩺',   color:'#0ea5e9' },
  }},
  sport:  { label:'Sport & volný čas', color:'#10b981', icon:'⚽', subs:{
    sport_ven: { label:'Venkovní sport', icon:'⚽', color:'#10b981' },
    sport_hal: { label:'Hala',           icon:'🏋️', color:'#059669' },
    detske:    { label:'Dětské hřiště',  icon:'🛝', color:'#34d399' },
  }},
  urad:   { label:'Úřady & instituce', color:'#3b82f6', icon:'🏛️', subs:{
    urad_obec: { label:'Obecní úřad', icon:'🏛️', color:'#3b82f6' },
    skola:     { label:'Škola',       icon:'🏫', color:'#60a5fa' },
    cirkev:    { label:'Kostel',      icon:'⛪', color:'#93c5fd' },
    posta:     { label:'Pošta',       icon:'📮', color:'#6366f1' },
  }},
  obchod: { label:'Obchody',           color:'#f59e0b', icon:'🛒', subs:{
    potraviny: { label:'Potraviny', icon:'🛒', color:'#f59e0b' },
    smisene:   { label:'Smíšené',  icon:'🏪', color:'#fbbf24' },
  }},
  sluzby: { label:'Služby',            color:'#8b5cf6', icon:'🔧', subs:{
    kadernictvi: { label:'Kadeřnictví', icon:'✂️', color:'#a78bfa' },
    kosmetika:   { label:'Kosmetika',   icon:'💄', color:'#c084fc' },
    auto:        { label:'Auto-moto',   icon:'🔧', color:'#f97316' },
    finance:     { label:'Banka',       icon:'🏦', color:'#60a5fa' },
    ubytovani:   { label:'Ubytování',   icon:'🏨', color:'#34d399' },
    ostatni:     { label:'Ostatní',     icon:'⚙️', color:'#94a3b8' },
  }},
};
