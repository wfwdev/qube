// ============================================================
// Munkamenet: névtelen Firebase azonosítás + profil (név, törzsszám)
// + szerepkör és jogosultságok + oldalvédelem.
//
// Gyorsítás: az utolsó ismert munkamenet (név, szerepkör, jogosultságok)
// a telefonon is el van tárolva, így oldalváltáskor azonnal megjelenik
// az oldal, az ellenőrzés a háttérben fut. Ha közben változott valami
// (szerepkör, letiltás), az oldal magától újratölt.
// A valódi védelmet ettől függetlenül a Firestore rules adja.
//
// Használat bármely oldalon:
//   import { ready } from './session.js';
//   const session = await ready;
//   if (session.can('ic.manage')) { ... }
// ============================================================
import {
    auth, db, signInAnonymously, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, onSnapshot, writeBatch, serverTimestamp
} from './firebase.js';
import { NEW_USER_ROLE, EMP_ID_PATTERN, PERMISSIONS, APP } from './config.js';
import { esc, $, feedback, toast, showScreen, hideScreen, renderChrome } from './ui.js';

const LAST_ACTIVE_INTERVAL = 12 * 60 * 60 * 1000; // ennyi időnként frissül a "utoljára aktív"
const CACHE_KEY = 'qube_session';

// ---------- Helyi munkamenet-cache ----------
const readCache = () => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
};
const writeCache = (c) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* tele / tiltva */ }
};
const clearCache = () => {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* nincs mit */ }
};

// Csak ezek számítanak "lényeges" változásnak (ilyenkor újratölt)
const signature = (c) => [c.uid, c.role, c.status, [...c.perms].sort().join(',')].join('|');

// ---------- Auth: meglévő azonosító, vagy új névtelen ----------
const getAuthUser = () => new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, async (user) => {
        stop();
        if (user) return resolve(user);
        try {
            const cred = await signInAnonymously(auth);
            resolve(cred.user);
        } catch (e) { reject(e); }
    });
});

// ---------- Képernyők ----------
const screenMessage = (icon, title, text, extra = '') => showScreen(`
    <div class="screen-card text-center">
        <div class="screen-icon">${icon}</div>
        <h4 class="fw-bold mb-2">${title}</h4>
        <p class="text-muted small mb-0">${text}</p>
        ${extra}
    </div>`);

const retryBtn = `<button class="btn btn-primary w-100 mt-4" onclick="location.reload()">Újrapróbálás</button>`;

const screenOnboarding = (uid) => {
    const s = showScreen(`
        <div class="screen-card">
            <div class="screen-icon">👋</div>
            <h4 class="fw-bold mb-1">Üdv a ${esc(APP.name)}-ban!</h4>
            <p class="text-muted small mb-4">Az azonosításhoz add meg a neved és a törzsszámod. Ezt csak egyszer kell megtenned ezen a telefonon.</p>
            <label class="form-label">Teljes név</label>
            <input type="text" id="obName" class="form-control form-control-lg mb-3" maxlength="60" autocomplete="name" placeholder="Pl. Kiss János">
            <label class="form-label">Törzsszám</label>
            <input type="text" id="obEmpId" class="form-control form-control-lg mb-4" inputmode="numeric" maxlength="10" placeholder="Pl. 10482">
            <button class="btn btn-primary btn-lg w-100" id="obSave">Tovább</button>
            <a class="d-block text-center small mt-3" href="info.html">📱 Telepítés és tudnivalók</a>
        </div>`);

    const btn = $('#obSave', s);
    btn.addEventListener('click', async () => {
        const name = $('#obName', s).value.trim().replace(/\s+/g, ' ');
        const empId = $('#obEmpId', s).value.trim();
        if (name.length < 3) { feedback('error'); return toast('Add meg a teljes neved!', 'error'); }
        if (!EMP_ID_PATTERN.test(empId)) { feedback('error'); return toast('Érvénytelen törzsszám!', 'error'); }
        if (!navigator.onLine) { feedback('error'); return toast('Az első regisztrációhoz internet kell.', 'error'); }

        btn.disabled = true; btn.textContent = 'Mentés…';
        try {
            await registerProfile(uid, name, empId);
            feedback('success');
            // A profil-figyelő innen viszi tovább a folyamatot
        } catch (e) {
            console.error(e);
            feedback('error'); toast('Nem sikerült a regisztráció. Próbáld újra!', 'error');
            btn.disabled = false; btn.textContent = 'Tovább';
        }
    });
};

const screenForStatus = (d) => {
    if (d.status === 'conflict') {
        return screenMessage('🔗', 'Összekapcsolás folyamatban', 'Kérem, várjon.');
    }
    if (d.status === 'disabled') {
        return screenMessage('⛔', 'Fiók letiltva', 'A fiókodat egy vezető letiltotta. Kérdés esetén keresd a csoportvezetődet.');
    }
    if (d.status === 'merged') {
        return screenMessage('📱', 'Fiók áthelyezve', 'Ez a fiók egy másik eszközre lett áthelyezve. Ezen a telefonon már nem használható.');
    }
    return screenMessage('⏳', 'Egy pillanat…', 'A fiókod állapota ellenőrzés alatt.');
};

// ---------- Regisztráció ----------
// Törzsszám foglalás: empIds/{törzsszám} → { uid }.
// Ha a törzsszám már másé, a fiók 'conflict' állapotba kerül, és egy
// vezető kapcsolja össze a régi fiókkal (pl. telefoncsere, adattörlés után).
const registerProfile = async (uid, name, empId) => {
    const base = {
        name, empId,
        role: NEW_USER_ROLE,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
    };
    const empRef = doc(db, 'empIds', empId);
    const userRef = doc(db, 'users', uid);
    const empSnap = await getDoc(empRef);

    if (empSnap.exists() && empSnap.data().uid !== uid) {
        await setDoc(userRef, { ...base, status: 'conflict' });
        return;
    }
    try {
        const batch = writeBatch(db);
        if (!empSnap.exists()) batch.set(empRef, { uid });
        batch.set(userRef, { ...base, status: 'active' });
        await batch.commit();
    } catch (e) {
        // Közben valaki más lefoglalta ezt a törzsszámot
        await setDoc(userRef, { ...base, status: 'conflict' });
    }
};

// ---------- Szerepkör betöltése ----------
const loadRole = async (roleId) => {
    if (roleId === 'admin') {
        return { label: 'Admin', perms: Object.keys(PERMISSIONS), missing: false };
    }
    try {
        const snap = await getDoc(doc(db, 'roles', roleId));
        if (!snap.exists()) return { label: roleId, perms: [], missing: true };
        const r = snap.data();
        return { label: r.label || roleId, perms: r.permissions || [], missing: false };
    } catch (e) {
        console.warn('Szerepkör betöltése sikertelen', e);
        return null; // nem tudjuk – ilyenkor marad a korábbi állapot
    }
};

// ---------- Munkamenet objektum ----------
// c: { uid, name, empId, role, roleLabel, roleMissing, status, perms: [] }
const buildSession = (c) => {
    const perms = new Set(c.perms);
    return {
        uid: c.uid,
        user: { name: c.name, empId: c.empId },
        role: c.role,
        roleLabel: c.roleLabel,
        roleMissing: !!c.roleMissing,
        perms,
        isAdmin: c.role === 'admin',
        can: (p) => c.role === 'admin' || perms.has(p),
        updateName: async (name) => {
            await updateDoc(doc(db, 'users', c.uid), { name });
            const cur = readCache();
            if (cur?.uid === c.uid) writeCache({ ...cur, name });
        }
    };
};

// Megjeleníti az oldalt (true), vagy a "nincs jogosultság" képernyőt (false)
const showPage = (session) => {
    renderChrome(session);
    const need = document.body.dataset.perm;
    if (need && !session.can(need)) {
        screenMessage('🔒', 'Nincs jogosultságod', 'Ehhez az oldalhoz a szerepköröd nem ad hozzáférést.',
            `<a class="btn btn-primary w-100 mt-4" href="index.html">Vissza a kezdőlapra</a>`);
        return false;
    }
    hideScreen();
    return true;
};

// ---------- Fő folyamat ----------
const init = () => new Promise((resolve) => {
    // 1) Azonnali indulás a helyi cache-ből (ha van)
    const cached = readCache();
    let shown = null; // a megjelenített munkamenet cache-adata
    if (cached?.status === 'active' && Array.isArray(cached.perms)) {
        shown = cached;
        const session = buildSession(cached);
        if (showPage(session)) resolve(session);
    }

    // 2) Ellenőrzés a háttérben (Firebase)
    verify(cached, (fresh) => {
        if (shown) {
            // Már fut az oldal: csak lényeges változásnál töltünk újra
            if (signature(fresh) !== signature(shown)) { writeCache(fresh); location.reload(); }
            else writeCache(fresh); // pl. név, szerepkör-megnevezés frissült
            return;
        }
        shown = fresh;
        writeCache(fresh);
        const session = buildSession(fresh);
        if (showPage(session)) resolve(session);
    });
});

const verify = async (cached, onActive) => {
    let fbUser;
    try {
        fbUser = await getAuthUser();
    } catch (e) {
        console.error(e);
        if (cached) return; // a cache-ből már fut, majd legközelebb ellenőrzünk
        const code = e?.code || 'ismeretlen';
        const hint = `<div class="text-muted tiny mt-3">Hibakód: ${esc(code)}</div>`;
        if (code === 'auth/network-request-failed' || !navigator.onLine) {
            screenMessage('📡', 'Nincs kapcsolat', 'Az első indításhoz internetkapcsolat szükséges. Csatlakozz, majd próbáld újra.', retryBtn + hint);
        } else {
            // Beállítási hiba (pl. hiányzó Firebase config, kikapcsolt névtelen belépés)
            screenMessage('⚙️', 'Beállítási hiba', 'Az alkalmazás nem tud csatlakozni a szerverhez. Szólj az adminnak.', retryBtn + hint);
        }
        return;
    }

    const uid = fbUser.uid;
    const userRef = doc(db, 'users', uid);
    if (cached && cached.uid !== uid) clearCache(); // másik fiók → régi cache érvénytelen

    let onboardingShown = false;
    let checking = false;
    let latest = null;
    let touched = false; // "utoljára aktív" már frissítve ebben a munkamenetben
    let lastRoleId = null;
    let lastRole = null;

    onSnapshot(userRef, async (snap) => {
        if (!snap.exists()) {
            clearCache();
            if (!onboardingShown) { onboardingShown = true; screenOnboarding(uid); }
            return;
        }
        const d = snap.data();

        if (d.status !== 'active') {
            clearCache();
            screenForStatus(d);
            return;
        }

        // Ha épp ellenőrzés fut, a legfrissebb állapotot utána dolgozzuk fel
        latest = d;
        if (checking) return;
        checking = true;
        try {
          while (latest) {
            const d = latest;
            latest = null;
            // A szerepkört csak akkor kérjük le újra, ha megváltozott
            if (d.role !== lastRoleId || !lastRole) {
                const r = await loadRole(d.role);
                if (r) { lastRole = r; lastRoleId = d.role; }
            }
            const base = (cached?.uid === uid && cached.role === d.role) ? cached : null;
            const role = (lastRoleId === d.role && lastRole) || (base ? { label: base.roleLabel, perms: base.perms, missing: base.roleMissing } : { label: d.role, perms: [], missing: true });

            // Utoljára aktív – ritkítva, hogy ne írjunk minden megnyitáskor
            const last = d.lastActive?.toMillis?.() || 0;
            if (!touched && Date.now() - last > LAST_ACTIVE_INTERVAL) {
                touched = true;
                updateDoc(userRef, { lastActive: serverTimestamp() }).catch(() => {});
            }

            onActive({
                uid,
                name: d.name,
                empId: d.empId,
                role: d.role,
                roleLabel: role.label,
                roleMissing: !!role.missing,
                status: d.status,
                perms: [...role.perms]
            });
          }
        } finally {
            checking = false;
        }
    }, (err) => {
        console.error(err);
        if (cached) return;
        screenMessage('⚠️', 'Hiba történt', 'Nem sikerült betölteni a profilodat. Ellenőrizd a kapcsolatot, majd próbáld újra.',
            retryBtn + `<div class="text-muted tiny mt-3">Hibakód: ${esc(err?.code || 'ismeretlen')}</div>`);
    });
};

export const ready = init();
