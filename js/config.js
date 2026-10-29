// ============================================================
// QUBE – központi beállítások
// Minden, ami projektenként / környezetenként változhat, itt van.
// ============================================================

export const APP = {
    name: 'Qube',
    tagline: 'Gyári kódok, egy helyen',
    version: '2.1.1'
};

// ⚠️ Ide az ÚJ Firebase projekt webes konfigurációja kerül
// (Firebase konzol → Projektbeállítások → Saját alkalmazások → SDK config)
export const FIREBASE_CONFIG = {
    apiKey: 'IDE_JON_AZ_API_KEY',
    authDomain: 'PROJEKT-ID.firebaseapp.com',
    projectId: 'PROJEKT-ID',
    storageBucket: 'PROJEKT-ID.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000'
};

// ------------------------------------------------------------
// JOGOSULTSÁGOK
// Minden funkció egy jogosultság-kulcshoz kötött. Új modulnál ide kell
// felvenni az új kulcsot, és az admin felületen a szerepkörökhöz rendelni.
// Az 'admin' szerepkör mindig mindent elér (a security rules is így kezeli).
// ------------------------------------------------------------
export const PERMISSIONS = {
    'ic.use':       'IC generálás',
    'ic.manage':    'IC lista szerkesztése',
    'ic.stats':     'IC statisztika',
    'mes.use':      'MES terminál QR',
    'pack.use':     'Csomagoló kód',
    'users.view':   'Felhasználók megtekintése',
    'users.manage': 'Felhasználók kezelése (admin kivételével)'
};

// Alapértelmezett szerepkörök. Az admin felületen egy gombbal feltölthetők
// a Firestore-ba, utána ott szerkeszthetők és bővíthetők.
// rank: sorrend a listákban (nagyobb = magasabb szint)
export const DEFAULT_ROLES = {
    operator: {
        label: 'Operátor', rank: 10,
        permissions: ['ic.use', 'mes.use', 'pack.use']
    },
    shift_lead: {
        label: 'Műszakvezető', rank: 20,
        permissions: ['ic.use', 'ic.stats', 'mes.use', 'pack.use', 'users.view']
    },
    group_lead: {
        label: 'Csoportvezető', rank: 30,
        permissions: ['ic.use', 'ic.manage', 'ic.stats', 'mes.use', 'pack.use', 'users.view', 'users.manage']
    },
    admin: {
        label: 'Admin', rank: 100,
        permissions: Object.keys(PERMISSIONS)
    }
};

// Új felhasználó ezzel a szerepkörrel jön létre (a rules is ezt követeli meg)
export const NEW_USER_ROLE = 'operator';

// ------------------------------------------------------------
// MODULOK – a kezdőlap csempéi ebből épülnek.
// ready:false → "Hamarosan" csempe, nem kattintható.
// ------------------------------------------------------------
export const MODULES = [
    { id: 'ic',   title: 'IC generátor',  desc: 'Nyersanyag azonosítók', icon: '⚡', color: 'orange', href: 'ic.html',   perm: 'ic.use',     ready: true },
    { id: 'mes',  title: 'MES terminál',  desc: 'Belépés QR-ral',        icon: '💻', color: 'blue',   href: 'mes.html',  perm: 'mes.use',    ready: false },
    { id: 'pack', title: 'Csomagoló kód', desc: 'Csomagoló azonosítók',  icon: '📦', color: 'green',  href: 'pack.html', perm: 'pack.use',   ready: false },
    { id: 'admin',title: 'Felhasználók',  desc: 'Szerepkörök, fiókok',   icon: '👥', color: 'purple', href: 'admin.html',perm: 'users.view', ready: true }
];

// Törzsszám formátum: csak számjegyek, 3–10 karakter (igény szerint módosítható,
// a firestore.rules-ban is ugyanez a minta van!)
export const EMP_ID_PATTERN = /^[0-9]{3,10}$/;

// ------------------------------------------------------------
// IC GENERÁTOR
// ------------------------------------------------------------
export const IC = {
    areas: ['ESS', 'WSS'],          // területek (fix lista)
    maxAmount: 5000,                // max. mennyiség egy generálásnál
    codePattern: /^[A-Z0-9]{13}$/   // IC szám: 13 karakter (tisztítás után)
};

// Egyszeri átvétel a régi IC generátorból (admin → IC lista → Importálás).
// Ha az átvétel megvolt, nyugodtan törölhető (legacy: null).
export const LEGACY_IC_SOURCE = {
    projectId: 'ic-generator-93915',
    apiKey: 'AIzaSyAsthGIMXvc-pFXfc63tGEclGg5V6qCT0s',
    collection: 'ic_numbers'
};
