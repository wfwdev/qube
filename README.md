# Qube

Gyári kódok, egy helyen. Telefonra telepíthető PWA (vanilla JS) a gyártósori munkához:
IC generálás, MES terminál belépés QR-ral, csomagoló kódok – szerepkör alapú jogosultsággal.

**Állapot:** v2.0.0 – alapmodul kész (azonosítás, felhasználók, szerepkörök). A modulok (IC, MES, csomagoló) a következő lépésekben jönnek.

## Felépítés

```
index.html          Kezdőlap (modul-csempék jogosultság szerint)
admin.html          Felhasználók és szerepkörök
style.css           Közös stílus (Bootstrap 5.3 CSS-re épül)
sw.js               Service Worker (offline, frissítés jelzés)
manifest.json       PWA leíró
firestore.rules     Firestore biztonsági szabályok
js/config.js        App név, Firebase config, jogosultságok, szerepkörök, modulok
js/firebase.js      Firebase inicializálás (Auth + Firestore offline cache-sel)
js/session.js       Névtelen belépés, regisztráció, szerepkör, oldalvédelem
js/ui.js            Navbar, alsó menü, profil panel, toast, visszajelzések
js/home.js          Kezdőlap logika
js/admin.js         Felhasználó- és szerepkörkezelés
```

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
6. Projektbeállítások → Saját alkalmazások → **Web app** hozzáadása → a config objektumot másold a `js/config.js` → `FIREBASE_CONFIG`-ba.

### 2. GitHub Pages
1. Töltsd fel a repót.
2. Settings → Pages → Branch: `main`, mappa: `/ (root)` → Save.

### 3. Első admin
1. Nyisd meg az appot a telefonon, **telepítsd a kezdőképernyőre**, és onnan indítva regisztrálj.
   (iPhone-on a telepített app külön tárhelyet használ, mint a Safari – ezért előbb telepíts, utána regisztrálj.)
2. Firebase konzol → Firestore → `users` → a saját dokumentumodnál a `role` mezőt írd át `admin`-ra.
3. Az appban: Felhasználók → Szerepkörök → **Alapértelmezett szerepkörök feltöltése**.

## Frissítés kiadása

Az `sw.js`-ben emeld a `VERSION`-t (és a `js/config.js`-ben az `APP.version`-t). A telefonokon a fejlécben megjelenik a **Frissítés** gomb.
Új fájl esetén vedd fel az `sw.js` `APP_SHELL` listájába is, hogy offline is elérhető legyen.

---
**Fejlesztette:** Kovács Gábor
