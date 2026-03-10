# 🗺 Interaktivní mapa obce Bolatice

Webová interaktivní mapa obce Bolatice vznikla jako výstup diplomové práce na oboru **Geodézie a kartografie**. Kombinuje data z informačního systému digitální mapy veřejné správy (IS DMVS) s vlastní vrstvou bodů zájmu (POI) a navigačními funkcemi.

Mapa je přístupná přímo v prohlížeči bez nutnosti instalace — funguje na počítači i mobilním zařízení.

---

## Obsah

- [Spuštění](#spuštění)
- [Ovládání — počítač](#ovládání--počítač)
- [Ovládání — mobilní zařízení](#ovládání--mobilní-zařízení)
- [Funkce mapy](#funkce-mapy)
  - [Podkladové mapy](#podkladové-mapy)
  - [Body zájmu (POI)](#body-zájmu-poi)
  - [Navigace](#navigace)
  - [Měření](#měření)
  - [Pokročilý režim — IS DMVS](#pokročilý-režim--is-dmvs)
- [Struktura souborů](#struktura-souborů)

---

## Spuštění

Stačí otevřít soubor `index.html` v moderním prohlížeči (Chrome, Firefox, Edge, Safari). Doporučuje se připojení k internetu — mapa stahuje podkladové dlaždice a geokóduje adresy pro navigaci.

```
index.html          ← hlavní soubor, otevřít v prohlížeči
css/app.css
js/
  config.js         ← konfigurace vrstev a kategorií (editovatelný)
  map.js
  layers.js
  poi.js
  nav.js
  ui.js
  measure.js
data/               ← exporty z qgis2web + GeoJSON bodů zájmu
foto/               ← fotografie POI
```

---

## Ovládání — počítač

### Pohyb v mapě

| Akce | Ovládání |
|------|----------|
| Posun | Klik a tažení |
| Přiblížení / oddálení | `Scroll` nebo tlačítka `+` / `−` (vpravo dole) |
| Přiblížení na oblast | `Shift` + tažení — vykreslí výběrový obdélník |
| Rotace mapy | `Shift` + tažení pravým tlačítkem myši |
| Reset severu | Tlačítko kompasu (zobrazí se při otočené mapě) |

### Postranní panel

Kliknutím na tlačítko **☰** v záhlaví se panel otevírá a zavírá. Při zavřeném panelu se mapa rozšíří na celou šířku okna.

### Popupy

Kliknutím na jakýkoli objekt na mapě (budovu, POI, vrstvu) se zobrazí informační popup s dostupnými daty a odkazem na Google Maps.

---

## Ovládání — mobilní zařízení

### Portrétní orientace (na výšku)

Ovládací panel je **spodní výsuvný panel** (bottom sheet):

| Akce | Gesto |
|------|-------|
| Rozbalit panel | Tažení prouhu nahoru nebo kliknutí na kategorii |
| Skrýt panel | Tažení dolů |
| Posun v mapě | Dotyk a tažení (v oblasti mapy nad panelem) |
| Přiblížení | Sevření / rozevření dvěma prsty (pinch-to-zoom) |
| Rotace mapy | Otočení dvěma prsty |

### Krajinná orientace (na šířku)

Panel se automaticky přesune do **levého bočního sloupce**. Mapa zabírá zbývající plochu vpravo. Panel lze skrýt tlačítkem **☰** v záhlaví — mapa se plynule rozšíří.

Při přechodu do krajinné orientace se seznam kategorií automaticky sbalí do rozklikávací lišty **📍 KATEGORIE** — rozbalí se kliknutím.

---

## Funkce mapy

### Podkladové mapy

Přepínání v záhlaví tlačítky **Mapa** / **Ortofoto**:

- **Mapa** — CartoDB Voyager, přehledná vektorová mapa s popiskami
- **Ortofoto** — letecké snímky ČÚZK (Ortofotomapa ČR); při nedostupnosti serveru ČÚZK se automaticky přepne na záložní Esri World Imagery

---

### Body zájmu (POI)

POI jsou rozděleny do kategorií viditelných v bočním panelu:

| Kategorie | Subkategorie |
|-----------|--------------|
| 🍽 Gastronomie | Restaurace, Hospoda, Kavárna, Pizzeria, Fast food |
| 🏥 Zdravotnictví | Praktický lékař, Zubař, Lékárna, Specialista |
| ⚽ Sport & volný čas | Venkovní sport, Hala, Dětské hřiště |
| 🏛 Úřady & instituce | Obecní úřad, Škola, Kostel, Pošta |
| 🛒 Obchody | Potraviny, Smíšené |
| 🔧 Služby | Kadeřnictví, Kosmetika, Auto-moto, Banka, Ubytování, Ostatní |

**Filtrování:**
- Kliknutí na kategorii → zobrazí pouze tuto kategorii (ostatní se skryjí)
- Druhé kliknutí na tutéž kategorii → zobrazí vše
- Kliknutí na jinou kategorii → přepne výběr

**Vyhledávání:**
Do pole *Hledat v mapě* lze psát název místa nebo kategorie — výsledky se zobrazují v reálném čase. Na mobilním zařízení je vyhledávání dostupné přes ikonu 🔍 v záhlaví.

**Popup POI** obsahuje:
- Název, kategorii a subkategorii
- Fotografii (pokud je dostupná)
- Tlačítka: 🧭 **Navigovat** · 🗺 **Otevřít v Google Maps** · 🌐 **Webová stránka**

---

### Navigace

Navigace využívá open-source routovací server **OSRM** a polohu zařízení (GPS).

#### Spuštění navigace

1. Zapnout GPS tlačítkem 📍 (FAB vpravo dole) — mapa se vycentruje na aktuální polohu
2. Kliknout **Vybrat cíl na mapě** → kurzor se změní na zaměřovač
3. Kliknout na cíl v mapě → zobrazí se potvrzovací lišta s adresou
4. Potvrdit tlačítkem **Navigovat** → otevře se výběr dopravního prostředku s odhadovanými časy
5. Vybrat **🚗 Auto** nebo **🚶 Pěší** → trasa se vykreslí na mapě

#### Průběh navigace

- Modrá linie = celá trasa, světlejší linie = již ujetý úsek
- Navigační widget (vlevo nahoře) zobrazuje cíl, zbývající čas a vzdálenost
- Šipka / ikona chodce se otáčí dle aktuálního směru jízdy
- Modrobílý kužel před ikonou znázorňuje výhled

| Tlačítko | Funkce |
|----------|--------|
| **Vycentrovat** | Vrátí mapu na aktuální polohu (zobrazí se po ručním posunu) |
| **🧭** | Zapne/vypne kužel pohledu |
| **✕** | Ukončí navigaci |

Po dosažení cíle (do 25 m) se zobrazí příjezdový modal se statistikami jízdy (čas, vzdálenost, způsob dopravy).

#### Ukončení navigace

Tlačítkem **✕** v navigačním widgetu nebo FAB tlačítkem 🔴 v pravém dolním rohu.

---

### Měření

Aktivace tlačítkem 📐 (FAB vpravo dole).

| Akce | Ovládání |
|------|----------|
| Přidat bod | Kliknutí na mapu |
| Uzavřít plochu | `Enter` nebo kliknutí blízko prvního bodu |
| Zrušit měření | `Escape` nebo tlačítko Vymazat |

Panel měření (vlevo dole) průběžně zobrazuje celkovou délku a odhadovanou plochu. Po uzavření polygonu se zobrazí přesná plocha a obvod.

---

### Pokročilý režim — IS DMVS

Aktivace tlačítkem **⚙️ Pokročilý režim** v bočním panelu.

Zobrazí vrstvy z **Informačního systému digitální mapy veřejné správy** rozdělené do skupin:

**Budovy**
- Hranice budov
- Budovy (různé typy dle klasifikace IS DMVS)

**Doprava**
- Parkoviště a odstavné plochy
- Provozní plochy pozemních komunikací
- Obvod dráhy / obvod pozemní komunikace
- Chodníky
- Plocha železničních drah
- Cyklostezky

Každou vrstvu lze zapnout/vypnout přepínačem. Po zapnutí se zobrazí posuvník průhlednosti (0–100 %).

Kliknutím na objekt se otevře popup s dostupnými atributy z IS DMVS (plocha, datum vkladu, ID stavby).

Po opuštění pokročilého režimu se vrstvy automaticky vypnou a obnoví se předchozí stav kategorií POI. Rotace mapy je v pokročilém režimu zablokována a mapa se automaticky vyrovná na sever.

---

## Struktura souborů

```
index.html              hlavní HTML soubor
css/
  app.css               všechny styly
js/
  config.js             ← EDITOVATELNÝ: seznam DMVS vrstev + kategorie POI
  map.js                inicializace Leaflet mapy, podkladové mapy
  layers.js             IS DMVS vrstvy, popupy, pokročilý režim
  poi.js                POI systém, filtry, vyhledávání, popupy
  nav.js                navigace OSRM, GPS tracking, heading kužel
  ui.js                 sidebar, bottom sheet, geolokace, layout
  measure.js            měření vzdáleností a ploch
data/
  *.js                  exporty vrstev z qgis2web
  bolatice_poi.geojson  body zájmu (GeoJSON)
foto/                   fotografie POI
```

### Přidání nové DMVS vrstvy

1. Zkopírovat `.js` soubor exportovaný z qgis2web do složky `data/`
2. Přidat `<script src="data/nazev.js">` do `index.html`
3. Přidat záznam do pole `DMVS_LAYERS` v `js/config.js`

### Přidání / úprava kategorií POI

Editovat objekt `CAT_CFG` v `js/config.js` — bez zásahu do ostatních souborů.

---

## Použité technologie

- [Leaflet](https://leafletjs.com/) — interaktivní mapa
- [leaflet-rotate](https://github.com/Raruto/leaflet-rotate) — rotace mapy
- [OSRM](https://project-osrm.org/) — open-source routování
- [Nominatim](https://nominatim.org/) — geokódování adres
- [ČÚZK WMS](https://www.cuzk.cz/) — ortofotomapa ČR
- [qgis2web](https://github.com/tomchadwin/qgis2web) — export vrstev z QGIS

---

*Interaktivní mapa obce Bolatice — diplomová práce, obor Geodézie a kartografie.*
