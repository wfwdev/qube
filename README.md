# Qube

Gyári kódok, egy helyen. Telefonra telepíthető PWA (vanilla JS) a gyártósori munkához:
IC generálás, MES terminál belépés QR-ral, csomagoló kódok – szerepkör alapú jogosultsággal.

**Állapot:** v2.10.0 – alapmodul, IC generátor, MES terminál, csomagoló kód és munkaidő naptár kész.

## Felépítés

```
index.html          Kezdőlap (modul-csempék jogosultság szerint)
admin.html          Felhasználók és szerepkörök
style.css           Közös stílus (Bootstrap 5.3 CSS-re épül)
sw.js               Service Worker (offline, frissítés jelzés)
manifest.json       PWA leíró
firestore.rules     Firestore biztonsági szabályok
js/config.js        App név, jogosultságok, szerepkörök, modulok
js/firebase-config.js  Firebase kapcsolat adatai (a frissítések nem írják felül)
reset.html          Vészkijárat: régi verzió / gyorsítótár törlése
tools/check.mjs     Kiadás előtti ellenőrzés
.github/workflows/  Automatikus kiadás (ellenőrzés → GitHub Pages)
js/firebase.js      Firebase inicializálás (Auth + Firestore offline cache-sel)
js/session.js       Névtelen belépés, regisztráció, szerepkör, oldalvédelem
js/ui.js            Navbar, alsó menü, profil panel, toast, visszajelzések
js/home.js          Kezdőlap logika
js/admin.js         Felhasználó- és szerepkörkezelés
ic.html, js/ic.js   IC generátor (generálás, lista, statisztika)
mes.html, js/mes.js MES terminál belépő QR
pack.html, js/pack.js Csomagoló kód QR
info.html, js/info.js Felhasználói tudnivalók (belépés nélkül is elérhető)
settings.html, js/settings.js  Admin beállítások (funkciók ki/be)
js/features.js      Beállítások betöltése/mentése (Firestore: settings/app)
js/advent.js        Adventi naptár és hóesés
js/help.js          Modul súgók (❓ Súgó gomb az alsó menüben) – új modulnál ide kerül a leírás
feedback.html, js/feedback.js  Visszajelzés: hiba / ötlet beküldése, saját bejelentések, admin kezelés
js/feedback-store.js  Visszajelzés beküldése helyi sorral (offline is)
js/recovery.js      Admin vészkijárat (egyszer használatos vészkódok)
calendar.html, js/calendar.js  Munkaidő naptár (ünnepek, műszak, szabadság)
js/avatar.js        Profilképek (kicsinyítés, helyi tár, megjelenítés)
js/hu-calendar.js   Magyar ünnepnapok, munkanap-áthelyezések, műszakforgás számítása
```

## IC generátor

- **Generálás:** terület (ESS/WSS) → IC → mennyiség (max. 5000) → két QR, a régi rendszerrel azonos tartalommal.
- **Offline:** az IC lista a telefonon is tárolódik. A generálás naplója egy helyi sorba kerül, és net esetén automatikusan feltöltődik.
- **Lista** (`ic.manage`): IC felvétele, terület módosítása, törlés, importálás (soronként beillesztett számok).
- **Statisztika** (`ic.stats`): napi és havi összesítő, IC-nként. Firestore: `ic_stats/d_ÉÉÉÉ-HH-NN` és `ic_stats/m_ÉÉÉÉ-HH` összesítő dokumentumok, a részletes napló az `ic_logs` kollekcióban.

## Hogyan működik az azonosítás

- Nincs belépési oldal. Az app a háttérben **névtelen Firebase azonosítót** kap (Anonymous Auth).
- Első indításkor a dolgozó megadja a **nevét és törzsszámát**. Ez a `users/{uid}` dokumentumba kerül, a törzsszám pedig az `empIds/{törzsszám}` táblában foglalódik (egy törzsszám = egy fiók).
- Új fiók mindig **Operátor**. Szerepkört csak vezető/admin adhat.
- Ha valaki törli a böngészőadatokat vagy telefont cserél, új azonosítót kap. Ilyenkor a fiókja **„Összekapcsolásra vár”** állapotba kerül; az admin egy gombbal összekapcsolja a régi fiókkal (a szerepkör átjön, a régi fiók megszűnik).
- A jogosultságokat a **Firestore security rules** kényszeríti ki, nem csak a felület.

## Szerepkörök és jogosultságok

Alapértelmezett szerepkörök: Operátor, Műszakvezető, Csoportvezető, Admin. Az admin felületen szerkeszthetők, és új szerepkör is felvehető.

Minden funkció egy jogosultság-kulcshoz kötött (`js/config.js` → `PERMISSIONS`). Új modulnál:
1. új kulcs a `PERMISSIONS`-be,
2. új csempe a `MODULES`-ba,
3. az oldal `<body data-perm="...">` attribútuma,
4. szabály a `firestore.rules`-ba a modul kollekciójához.

Az `admin` szerepkör mindig mindent elér.

## Telepítés (egyszeri)

### 1. Firebase projekt
1. [Firebase konzol](https://console.firebase.google.com) → új projekt.
2. **Authentication** → Get started → Sign-in method → **Anonymous** bekapcsolása.
3. **Authentication → Settings → Authorized domains** → add hozzá: `<github-felhasználó>.github.io`.
4. **Firestore Database** → Create database (régió: `europe-west3` vagy `eur3`), production módban.
5. **Firestore → Rules** → másold be a `firestore.rules` tartalmát → Publish.
6. Projektbeállítások → Saját alkalmazások → **Web app** hozzáadása → a config objektumot másold a `js/firebase-config.js`-be.

### 2. GitHub Pages
1. Töltsd fel a repót.
2. Settings → Pages → Branch: `main`, mappa: `/ (root)` → Save.

### 3. Első admin
1. Nyisd meg az appot a telefonon, **telepítsd a kezdőképernyőre**, és onnan indítva regisztrálj.
   (iPhone-on a telepített app külön tárhelyet használ, mint a Safari – ezért előbb telepíts, utána regisztrálj.)
2. Firebase konzol → Firestore → `users` → a saját dokumentumodnál a `role` mezőt írd át `admin`-ra.
3. Az appban: Felhasználók → Szerepkörök → **Alapértelmezett szerepkörök feltöltése**.

## MES terminál

- A MES felhasználónév és jelszó **csak a telefonon** tárolódik (Qube-fiókonként külön), a szerverre nem kerül fel.
- QR tartalma: `felhasználónév` + TAB + `jelszó` + ENTER – a terminál magától kitölti és belép.
- A QR eltűnési ideje egyénileg állítható (15 mp – 2 perc, vagy csak bezáráskor). Amíg látszik, a kijelző nem alszik el; háttérbe tett appnál eltűnik.

## Csomagoló kód

- Egy számkód, **csak a telefonon** tárolva (Qube-fiókonként külön).
- A QR pontosan a számot tartalmazza (nincs utána TAB / ENTER / F4). Az eltűnési idő egyénileg állítható.

## Admin vészkijárat

Ha az admin új eszközről „Összekapcsolás folyamatban” állapotba kerül, a képernyő alján az **🔑 Admin vészkód** gombbal egy kóddal visszaveheti a fiókját (a régi eszköz fiókja „áthelyezve” lesz).
- Kódok: **Beállítások → Admin vészkijárat → Új vészkódok generálása** (5 db, csak egyszer láthatók, mindegyik egyszer használható; új generálás a régieket érvényteleníti).
- A szerverre csak a kódok SHA-256 lenyomata kerül (`recoveryCodes`), amit nem-admin nem olvashat; az ellenőrzést a Firestore szabályok végzik.

## Munkaidő naptár

- **Ünnepnapok:** a Munka törvénykönyve szerinti munkaszüneti napok, a húsvéthoz kötöttek évente kiszámolva; 2026-tól Szenteste is.
- **Munkanap-áthelyezések:** a 2026-os rendelet beépítve (`js/hu-calendar.js` → `BUILTIN_SWAPS`). Új évet az admin a **Beállítások → Munkanap-áthelyezések** részen vesz fel (beépített is kikapcsolható). Firestore: `settings/app.calendar.swapList`.
- **Műszak:** 3 műszak (DE 06–14, DU 14–22, É 22–06) heti forgással, vagy nappalos. Csak a telefonon tárolódik.
- **Szabadság:** napra koppintva bejelölhető, jóváhagyás nincs; mindenki látja a többiekét (`leave/{uid}`). Az éves keret csak a tulajdonosé (`leaveQuota/{uid}`).

## Profilképek

- Feltöltés: fejléc ☰ menü → a monogramra/képre koppintva. A telefon 160×160-as JPEG-re kicsinyíti (kb. 5–15 KB), előnézet után menthető.
- Firestore: `avatars/{uid}` (a kép base64-ben, max. 40 000 karakter) és `meta/avatars` (index: ki mikor cserélte). Oldalbetöltéskor csak az index olvasódik; egy kép csak akkor töltődik le, ha még nincs meg a telefonon (IndexedDB) vagy cserélték.
- Szabályok: mindenki csak a sajátját írhatja, kép és index csak együtt változhat, 20 mp-enként legfeljebb egy csere, csak JPEG.
- Admin: **Beállítások → Profilképek** (ki/be; kikapcsolva mindenhol monogram), bárki képe törölhető a **Felhasználók** oldalon.
- Új eszközre áthelyezett fióknál a képet újra fel kell tölteni (a kép a fiókazonosítóhoz tartozik).

## Súgó és visszajelzés

- **Modul súgó:** minden modul alsó menüjében ❓ Súgó. Új modulnál: új bejegyzés a `js/help.js` `HELP` objektumába, és a modul JS-ében `registerHelp('modul-id')`.
- **Visszajelzés:** mindenki beküldhet hibát vagy ötletet (kezdőlap csempe, fejléc ☰ menü, modul súgó). Offline is: helyi sorba kerül, net esetén felmegy. A beküldő a **Sajátjaim** fülön látja az állapotot és a választ; az admin a **Beérkezett** fülön kezeli (állapot: Új / Folyamatban / Kész / Elutasítva, válasz, törlés). Firestore: `feedback`.

## Beállítások (csak admin)

A kezdőlapon a **Beállítások** csempe csak az adminnak látszik (`admin.only` – szerepkörhöz nem rendelhető). Firestore: `settings/app`, mindenki olvassa, csak admin írja.

- **Adventi naptár:** be/ki, hóesés be/ki, a 24 napi üzenet szerkeszthető, előnézet bármelyik napra. December 1–24. között naponta egy újabb ablak nyitható, 25–31. között mind. A kinyitott ablakok telefononként tárolódnak.

## Kiadás (frissítés)

A kiadást a GitHub végzi automatikusan (`.github/workflows/deploy.yml`):

1. Feltöltöd a módosított fájlokat.
2. A GitHub lefuttatja az ellenőrzést (`tools/check.mjs`): szintaxis, importok, hiányzó vagy összekevert fájlok, Firebase adatok.
3. **Ha hibát talál, nem kerül ki semmi** – élesben a korábbi, működő verzió marad. A hiba oka: repó → **Actions** fül → a piros sor.
4. Ha minden rendben, a verziószámot automatikusan beírja (commit azonosító), és kiteszi. A telefonokon megjelenik a **Frissítés** gomb.

Verziót kézzel emelni **nem kell**. Új fájlnál vedd fel az `sw.js` `APP_SHELL` listájába (az ellenőrzés szól, ha kimaradt).

Egyszeri beállítás: **Settings → Pages → Source: GitHub Actions**.

### Ha egy telefon beragad
- 12 mp után (programhiba esetén 2–3 mp után) megjelenik a **Gyorsítótár törlése** gomb.
- Vészkijárat: `…/qube/reset.html` megnyitása – törli a régi verziót, a bejelentkezés és a fel nem töltött generálások megmaradnak.

---
**Fejlesztette:** Kovács Gábor
