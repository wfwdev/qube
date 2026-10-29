// ============================================================
// Munkamenet: névtelen Firebase azonosítás + profil (név, törzsszám)
// + szerepkör és jogosultságok + oldalvédelem.
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
            // A profil-figyelő (watchProfile) innen viszi tovább a folyamatot
        } catch (e) {
            console.error(e);
            feedback('error'); toast('Nem sikerült a regisztráció. Próbáld újra!', 'error');
            btn.disabled = false; btn.textContent = 'Tovább';
        }
    });
};

const screenMessage = (icon, title, text, extra = '') => showScreen(`
    <div class="screen-card text-center">
        <div class="screen-icon">${icon}</div>
        <h4 class="fw-bold mb-2">${title}</h4>
        <p class="text-muted small mb-0">${text}</p>
        ${extra}
    </div>`);

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
        return { label: 'Admin', perms: new Set(Object.keys(PERMISSIONS)), missing: false };
    }
    try {
        const snap = await getDoc(doc(db, 'roles', roleId));
        if (!snap.exists()) return { label: roleId, perms: new Set(), missing: true };
        const r = snap.data();
        return { label: r.label || roleId, perms: new Set(r.permissions || []), missing: false };
    } catch (e) {
        console.warn('Szerepkör betöltése sikertelen', e);
        return { label: roleId, perms: new Set(), missing: true };
    }
};

// ---------- Fő folyamat ----------
const init = async () => {
    let fbUser;
    try {
        fbUser = await getAuthUser();
    } catch (e) {
        console.error(e);
        screenMessage('📡', 'Nincs kapcsolat', 'Az első indításhoz internetkapcsolat szükséges. Csatlakozz, majd próbáld újra.',
            `<button class="btn btn-primary w-100 mt-4" onclick="location.reload()">Újrapróbálás</button>`);
        return new Promise(() => {}); // nem oldódik fel
    }

    const uid = fbUser.uid;
    const userRef = doc(db, 'users', uid);

    return new Promise((resolve) => {
        let session = null;
        let onboardingShown = false;
        let building = false;

        onSnapshot(userRef, async (snap) => {
            // ---- Már fut a munkamenet: csak a lényeges változásokra reagálunk
            if (session) {
                if (!snap.exists()) return location.reload();
                const d = snap.data();
                if (d.role !== session.role || d.status !== 'active') return location.reload();
                session.user = { ...session.user, ...d };
                return;
            }

            // ---- Még nincs profil → regisztráció
            if (!snap.exists()) {
                if (!onboardingShown) { onboardingShown = true; screenOnboarding(uid); }
                return;
            }

            const d = snap.data();
            if (d.status === 'conflict') {
                return screenMessage('🔗', 'Összekapcsolásra vár',
                    `A(z) <b>${esc(d.empId)}</b> törzsszám már regisztrálva van egy másik eszközön. Szólj a műszak- vagy csoportvezetődnek, hogy kapcsolja össze a fiókodat. Ha megtörtént, ez az oldal magától továbblép.`);
            }
            if (d.status === 'disabled') {
                return screenMessage('⛔', 'Fiók letiltva', 'A fiókodat egy vezető letiltotta. Kérdés esetén keresd a csoportvezetődet.');
            }
            if (d.status === 'merged') {
                return screenMessage('📱', 'Fiók áthelyezve', 'Ez a fiók egy másik eszközre lett áthelyezve. Ezen a telefonon már nem használható.');
            }
            if (d.status !== 'active') return; // ismeretlen állapot: várunk

            // ---- Aktív fiók → munkamenet felépítése (egyszer)
            if (building) return;
            building = true;
            const role = await loadRole(d.role);
            session = {
                uid,
                user: { ...d },
                role: d.role,
                roleLabel: role.label,
                roleMissing: role.missing,
                perms: role.perms,
                isAdmin: d.role === 'admin',
                can: (p) => d.role === 'admin' || role.perms.has(p),
                updateName: (name) => updateDoc(userRef, { name })
            };

            // Utoljára aktív – ritkítva, hogy ne írjunk minden megnyitáskor
            const last = d.lastActive?.toMillis?.() || 0;
            if (Date.now() - last > LAST_ACTIVE_INTERVAL) {
                updateDoc(userRef, { lastActive: serverTimestamp() }).catch(() => {});
            }

            renderChrome(session);

            // Oldalvédelem
            const need = document.body.dataset.perm;
            if (need && !session.can(need)) {
                screenMessage('🔒', 'Nincs jogosultságod', 'Ehhez az oldalhoz a szerepköröd nem ad hozzáférést.',
                    `<a class="btn btn-primary w-100 mt-4" href="index.html">Vissza a kezdőlapra</a>`);
                return; // a resolve elmarad → az oldal kódja nem fut le
            }

            hideScreen();
            resolve(session);
        }, (err) => {
            console.error(err);
            screenMessage('⚠️', 'Hiba történt', 'Nem sikerült betölteni a profilodat. Ellenőrizd a kapcsolatot, majd próbáld újra.',
                `<button class="btn btn-primary w-100 mt-4" onclick="location.reload()">Újrapróbálás</button>`);
        });
    });
};

export const ready = init();
