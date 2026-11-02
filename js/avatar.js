// ============================================================
// Profilképek
// - A kép a telefonon kicsinyítve (160×160 JPEG, ~10 KB) kerül a Firestore-ba:
//     avatars/{uid}   { data: 'data:image/jpeg;base64,…', updatedAt }
//     meta/avatars    { uid: updatedAt, … }  ← egyetlen "index" dokumentum
// - Oldalbetöltéskor csak az index olvasódik (1 olvasás); egy képet csak akkor
//   tölt le, ha még nincs meg a telefonon, vagy azóta cserélték.
// - A letöltött képek a telefonon (IndexedDB) tárolódnak → offline is látszanak.
// - Az admin a Beállításokban kikapcsolhatja (akkor mindenhol monogram),
//   és bárki képét törölheti (Felhasználók → felhasználó lapja).
// Használat: avatar(uid, name, 'sm') → HTML; a kép magától megjelenik / frissül.
// ============================================================
import { db, doc, getDoc, onSnapshot, writeBatch, serverTimestamp, deleteField } from './firebase.js';
import { cachedSettings, loadSettings } from './features.js';
import { esc } from './ui.js';

const SIZE = 160;            // px (a legnagyobb megjelenítés 64 px × 2,5 képsűrűség)
const MAX_CHARS = 38000;     // a Firestore szabály 40 000-nél húzza meg a határt
const INDEX_CACHE = 'qube_avatar_index';

const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : 0);

// ---------- Helyi tár (IndexedDB) ----------
const idb = new Promise((res) => {
    try {
        const r = indexedDB.open('qube-avatars', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('a');
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
    } catch { res(null); }
});
const tx = async (mode, fn) => {
    const d = await idb;
    if (!d) return null;
    return new Promise((res) => {
        try {
            const t = d.transaction('a', mode);
            const out = fn(t.objectStore('a'));
            t.oncomplete = () => res(out?.result ?? null);
            t.onerror = () => res(null);
        } catch { res(null); }
    });
};

// ---------- Állapot ----------
const mem = new Map();          // uid → { v, d }
let index = (() => { try { return JSON.parse(localStorage.getItem(INDEX_CACHE)) || {}; } catch { return {}; } })();
let enabled = cachedSettings()?.avatars?.enabled !== false;
const inflight = new Set();
let pendingOwn = null;          // a saját, épp feltöltött kép – ne kelljen visszatölteni

// A telefonon tárolt képek betöltése
const memReady = tx('readonly', (s) => {
    const keys = s.getAllKeys();
    const vals = s.getAll();
    return { get result() { return keys.result?.map((k, i) => [k, vals.result[i]]); } };
}).then((rows) => {
    (rows || []).forEach(([k, v]) => mem.set(k, v));
    document.querySelectorAll('[data-av]').forEach((el) => paintEl(el));
});

// ---------- Megjelenítés ----------
const initials = (name) => {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
};
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

const current = (uid) => {
    const m = mem.get(uid);
    return enabled && index[uid] && m && m.v === index[uid] ? m.d : null;
};

const inner = (uid, ini) => {
    const d = current(uid);
    return d ? `<img src="${d}" alt="" draggable="false">` : esc(ini);
};

function paintEl(el) {
    const uid = el.dataset.av;
    const d = current(uid);
    const img = el.querySelector('img');
    if (d) {
        if (img?.getAttribute('src') !== d) el.innerHTML = `<img src="${d}" alt="" draggable="false">`;
    } else if (img || el.textContent !== el.dataset.ini) {
        el.textContent = el.dataset.ini;
    }
}
const paint = (uid) => document.querySelectorAll(`[data-av="${CSS.escape(uid)}"]`).forEach(paintEl);

// Hiányzó / elavult kép letöltése (1 olvasás képenként, csak ha szükséges)
const need = async (uid) => {
    if (!enabled || !uid || inflight.has(uid)) return;
    const v = index[uid];
    const m = mem.get(uid);
    if (!v) {
        if (m) { mem.delete(uid); tx('readwrite', (s) => s.delete(uid)); paint(uid); }
        return;
    }
    if (m && m.v === v) return;
    if (!navigator.onLine) return;
    inflight.add(uid);
    try {
        const snap = await getDoc(doc(db, 'avatars', uid));
        if (snap.exists() && typeof snap.data().data === 'string') {
            const rec = { v: ms(snap.data().updatedAt) || v, d: snap.data().data };
            mem.set(uid, rec);
            tx('readwrite', (s) => s.put(rec, uid));
            paint(uid);
        }
    } catch (e) { console.warn('Profilkép nem tölthető be', uid, e); }
    finally { inflight.delete(uid); }
};

// ---------- Index figyelése (egyszer indul, az első avatar() hívásra) ----------
let started = false;
const start = () => {
    if (started) return;
    started = true;
    loadSettings().then((s) => {
        const on = s?.avatars?.enabled !== false;
        if (on !== enabled) { enabled = on; document.querySelectorAll('[data-av]').forEach(paintEl); }
    });
    onSnapshot(doc(db, 'meta', 'avatars'), (snap) => {
        if (!snap.exists() && snap.metadata?.fromCache) return; // offline: marad a tárolt
        const next = {};
        Object.entries(snap.exists() ? snap.data() : {}).forEach(([k, t]) => { const v = ms(t); if (v) next[k] = v; });
        index = next;
        try { localStorage.setItem(INDEX_CACHE, JSON.stringify(index)); } catch { /* tele */ }
        if (pendingOwn && index[pendingOwn.uid]) {
            const rec = { v: index[pendingOwn.uid], d: pendingOwn.d };
            mem.set(pendingOwn.uid, rec);
            tx('readwrite', (s) => s.put(rec, pendingOwn.uid));
            pendingOwn = null;
        }
        // a képernyőn lévők frissítése
        const seen = new Set();
        document.querySelectorAll('[data-av]').forEach((el) => {
            paintEl(el);
            if (!seen.has(el.dataset.av)) { seen.add(el.dataset.av); need(el.dataset.av); }
        });
    }, (e) => console.warn('Profilkép index nem tölthető be', e));

    // Újonnan megjelenő avatárok → kép letöltése, ha kell
    new MutationObserver((list) => {
        const uids = new Set();
        list.forEach((m) => m.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            if (n.dataset?.av) uids.add(n.dataset.av);
            n.querySelectorAll?.('[data-av]').forEach((el) => uids.add(el.dataset.av));
        }));
        uids.forEach(need);
    }).observe(document.body, { childList: true, subtree: true });
};

// HTML egy avatárhoz. size: '' (48 px) | 'sm' (38 px) | 'xs' (26 px) | 'lg' (72 px)
export const avatar = (uid, name, size = '') => {
    start();
    const ini = initials(name);
    return `<span class="avatar ${size}" data-av="${esc(uid)}" data-ini="${esc(ini)}" style="--av-h:${hue(uid || name)}">${inner(uid, ini)}</span>`;
};

export const hasAvatar = (uid) => enabled && !!index[uid];
export const avatarsEnabled = () => enabled;
export { memReady as avatarCacheReady };

// ---------- Kép előkészítése (a telefonon) ----------
const loadImage = (file) => new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Nem kép')); };
    img.src = url;
});

// Középre vágott négyzet, 160×160 JPEG; a minőséget addig csökkenti, amíg belefér
export const prepareImage = async (file) => {
    if (!file || !/^image\//.test(file.type)) throw new Error('Nem kép');
    if (file.size > 25 * 1024 * 1024) throw new Error('Túl nagy');
    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('Nem kép');
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    for (let q = 0.85; q >= 0.4; q -= 0.1) {
        const d = c.toDataURL('image/jpeg', q);
        if (d.startsWith('data:image/jpeg;base64,') && d.length <= MAX_CHARS) return d;
    }
    throw new Error('Túl nagy');
};

// ---------- Mentés / törlés ----------
// Egy lépésben (batch) a kép és az index – a szabályok csak együtt engedik
export const saveMyAvatar = async (uid, data) => {
    const b = writeBatch(db);
    b.set(doc(db, 'avatars', uid), { data, updatedAt: serverTimestamp() });
    b.set(doc(db, 'meta', 'avatars'), { [uid]: serverTimestamp() }, { merge: true });
    pendingOwn = { uid, d: data };
    await b.commit();
};

// Saját kép törlése, vagy admin: bárkié
export const removeAvatar = async (uid) => {
    const b = writeBatch(db);
    b.delete(doc(db, 'avatars', uid));
    b.set(doc(db, 'meta', 'avatars'), { [uid]: deleteField() }, { merge: true });
    await b.commit();
    delete index[uid];
    need(uid);
};
