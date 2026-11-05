// ============================================================
// Közös felület: navbar, alsó menü, profil panel, toast, visszajelzés,
// modál (alsó lap), teljes képernyős üzenetek, frissítés-figyelés
// ============================================================
import { APP } from './config.js';

// ---------- Segédek ----------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
export const $ = (sel, root = document) => root.querySelector(sel);

const setting = (key, def) => {
    const v = localStorage.getItem(key);
    return v === null ? def : v === 'true';
};

// ---------- Téma: 'light' | 'dark' | 'auto' (a rendszer beállítását követi) ----------
// Az oldal tetején lévő inline script már az első kirajzolás előtt beállítja.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const themeMode = () => { const t = localStorage.getItem('theme'); return t === 'light' || t === 'dark' ? t : 'auto'; };
const applyTheme = () => {
    const m = themeMode();
    const dark = m === 'dark' || (m === 'auto' && systemDark.matches);
    document.body.classList.toggle('dark-mode', dark);
    // A fejléc mindkét módban ugyanaz → a böngésző sávja is mindig a fejléc színe
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ce4459');
};
const setThemeMode = (m) => {
    if (m === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', m);
    applyTheme();
};
systemDark.addEventListener?.('change', () => { if (themeMode() === 'auto') applyTheme(); });

// ---------- Visszajelzés: villanás, hang, rezgés ----------
let audioCtx = null;
const beep = (type) => {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = type === 'error' ? 220 : 1200;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (type === 'error' ? 0.35 : 0.12));
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
    } catch { /* nincs hang támogatás */ }
};

export const feedback = (type = 'light') => {
    if (setting('settingFlash', true)) {
        const o = $('#flashOverlay');
        if (o) {
            o.className = ''; void o.offsetWidth;
            o.classList.add(`flash-${type}`);
            setTimeout(() => (o.className = ''), 60);
        }
    }
    if (type !== 'light' && setting('settingAudio', true)) beep(type);
    if (setting('settingVibrate', true) && navigator.vibrate) {
        navigator.vibrate(type === 'error' ? [60, 40, 60] : type === 'success' ? 40 : 10);
    }
};

// ---------- Toast ----------
let toastTimer = null;
// Események a használati statisztikának (js/track.js) – ami a betöltése előtt
// történik, a pufferben megvárja
const emit = (kind, detail) => {
    const ev = { kind, detail, t: Date.now() };
    (window.__qubeEvents ||= []).push(ev);
    if (window.__qubeEvents.length > 50) window.__qubeEvents.shift();
    window.dispatchEvent(new CustomEvent('qube:event', { detail: ev }));
};

export const toast = (msg, type = 'info') => {
    if (type === 'error') emit('warn', msg);
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `app-toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'app-toast'), 2600);
};

// ---------- Alsó lap (modál) ----------
export const openSheet = (html) => {
    const ov = $('#sheetOverlay');
    $('#sheetBody').innerHTML = html;
    ov.classList.add('open');
    return $('#sheetBody');
};
export const closeSheet = () => $('#sheetOverlay')?.classList.remove('open');

// ---------- Teljes képernyős állapotok (betöltés, onboarding, hiba) ----------
export const showScreen = (html) => {
    const s = $('#appScreen');
    s.innerHTML = html;
    s.classList.remove('hidden');
    document.body.classList.add('screen-open');
    return s;
};
export const hideScreen = () => {
    const s = $('#appScreen');
    if (s) { s.classList.add('hidden'); s.innerHTML = ''; }
    document.body.classList.remove('screen-open');
};

// ---------- Ébrentartás ----------
let wakeLock = null;
const requestWakeLock = async () => {
    if (!('wakeLock' in navigator) || !setting('settingWakeLock', false)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
};
const releaseWakeLock = async () => {
    try { await wakeLock?.release(); } catch { /* már elengedve */ }
    wakeLock = null;
};
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});

// ---------- Váz beszúrása (betöltéskor azonnal) ----------
const injectShell = () => {
    const title = document.body.dataset.title || APP.name;
    document.body.insertAdjacentHTML('afterbegin', `
    <div id="flashOverlay"></div>
    <nav class="app-navbar">
        <a class="navbar-brand-row" href="index.html" aria-label="Kezdőlap">
            <img class="navbar-logo" src="icons/logo.svg" alt="" width="34" height="34">
            <span class="navbar-title">${esc(title)}</span>
        </a>
        <div class="d-flex align-items-center gap-2">
            <button id="updateBtn" class="update-btn hidden">🔄 Frissítés</button>
            <button id="menuBtn" class="hamburger" aria-label="Menü" aria-expanded="false" aria-controls="sideMenu">
                <span></span><span></span><span></span>
            </button>
        </div>
    </nav>
    <div id="appScreen" class="app-screen">
        <div class="boot-loader"><div class="spinner"></div><div class="text-muted small mt-3">Betöltés…</div></div>
    </div>`);

    document.body.insertAdjacentHTML('beforeend', `
    <nav class="bottom-nav hidden" id="bottomNav"></nav>
    <div class="upd-bar" id="updBar" role="status" aria-live="polite"></div>
    <div class="side-overlay" id="sideOverlay"></div>
    <aside class="side-menu" id="sideMenu"></aside>
    <div class="overlay" id="sheetOverlay"><div class="modal-custom" id="sheetBody"></div></div>
    <div class="app-toast" id="toast"></div>`);

    applyTheme();
    $('#menuBtn').addEventListener('click', () => ($('#sideMenu').classList.contains('open') ? closeSideMenu() : openSideMenu()));
    $('#sideOverlay').addEventListener('click', closeSideMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSideMenu(); });
    $('#sheetOverlay').addEventListener('click', (e) => { if (e.target.id === 'sheetOverlay') closeSheet(); });
};

// ---------- Profil panel ----------
let sessionRef = null;

const switchRow = (id, title, sub) => `
    <label class="setting-row" for="${id}">
        <div><div class="fw-bold small">${title}</div><div class="text-muted tiny">${sub}</div></div>
        <div class="form-check form-switch fs-5 mb-0"><input class="form-check-input" type="checkbox" role="switch" id="${id}"></div>
    </label>`;

export const openSideMenu = () => {
    feedback();
    const u = sessionRef?.user;
    const menu = $('#sideMenu');
    const profile = u ? `
        <div class="profile-head">
            <button class="avatar-edit" id="avEdit" aria-label="Profilkép">
                <span class="avatar lg">${esc((u.name || '?').trim().charAt(0).toUpperCase())}</span>
                <span class="avatar-cam">📷</span>
            </button>
            <input type="file" id="avFile" accept="image/*" class="hidden">
            <div>
                <div class="fw-bold">${esc(u.name)}</div>
                <div class="text-muted small">Törzsszám: <b>${esc(u.empId)}</b></div>
                <span class="role-badge mt-1">${esc(sessionRef.roleLabel)}</span>
                ${sessionRef.isAdmin ? '' : sessionRef.requestedRole && sessionRef.requestedRole !== sessionRef.role
                    ? '<div class="text-muted tiny mt-1">⏳ Szerepkör-kérés jóváhagyásra vár</div>'
                    : '<button class="role-req-link" id="roleReq">Más szerepkör kell?</button>'}
            </div>
        </div>
        <div id="avPanel" class="av-panel hidden"></div>
        <label class="form-label mt-4">Megjelenített név</label>
        <div class="d-flex gap-2 mb-1">
            <input type="text" id="profileName" class="form-control" maxlength="60" value="${esc(u.name)}">
            <button class="btn btn-light px-3" id="profileSave">✓</button>
        </div>
        <div class="text-muted tiny mb-4">A törzsszámot csak az adminisztrátor módosíthatja.</div>` : '';

    menu.innerHTML = `
        ${profile}
        <h6 class="section-title">🎨 Megjelenés</h6>
        <div class="theme-switch mb-4" id="themeSwitch">
            <button data-theme="light">☀️<span>Világos</span></button>
            <button data-theme="dark">🌙<span>Sötét</span></button>
            <button data-theme="auto">📱<span>Automatikus</span></button>
        </div>

        <h6 class="section-title">⚙️ Beállítások</h6>
        ${switchRow('settingAudio', 'Hangjelzés', 'Csippanás sikeres műveletnél')}
        ${switchRow('settingVibrate', 'Rezgés', 'Csak Androidon')}
        ${switchRow('settingFlash', 'Képernyő villanás', 'Vizuális visszajelzés')}
        ${switchRow('settingWakeLock', 'Ébrentartás', 'A kijelző nem alszik el')}

        <div class="menu-links mt-3">
            <a href="feedback.html">💬 Hiba vagy ötlet beküldése</a>
        </div>
        <div class="text-center text-muted tiny mt-4 pb-5">${esc(APP.name)} v${esc(APP.version)} · ${esc(APP.build)}</div>`;

    // Téma választó
    const sw = $('#themeSwitch');
    const markTheme = () => sw.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === themeMode()));
    sw.addEventListener('click', (e) => {
        const b = e.target.closest('[data-theme]');
        if (!b) return;
        feedback(); setThemeMode(b.dataset.theme); markTheme();
    });
    markTheme();

    const defaults = { settingAudio: true, settingVibrate: true, settingFlash: true, settingWakeLock: false };
    Object.entries(defaults).forEach(([key, def]) => {
        const input = $(`#${key}`);
        input.checked = setting(key, def);
        input.addEventListener('change', () => {
            localStorage.setItem(key, input.checked);
            if (key === 'settingWakeLock') input.checked ? requestWakeLock() : releaseWakeLock();
            feedback();
        });
    });

    $('#profileSave')?.addEventListener('click', async () => {
        const name = $('#profileName').value.trim();
        if (name.length < 3) { feedback('error'); return toast('A név legalább 3 karakter legyen!', 'error'); }
        try {
            await sessionRef.updateName(name);
            sessionRef.user = { ...sessionRef.user, name };
            feedback('success'); toast('Név frissítve ✓', 'success');
            closeSideMenu();
        } catch (e) {
            console.error(e); feedback('error'); toast('Nem sikerült menteni.', 'error');
        }
    });

    if (u) setupAvatar(u);
    $('#roleReq')?.addEventListener('click', openRoleRequest);

    clearTimeout(menuCloseTimer);
    menu.classList.add('open');
    $('#sideOverlay').classList.add('open');
    document.body.classList.add('menu-open');
    $('#menuBtn').classList.add('open');
    $('#menuBtn').setAttribute('aria-expanded', 'true');
};

// Profilkép a menüben: koppintás → választás → előnézet → mentés (js/avatar.js)
const setupAvatar = async (u) => {
    let A;
    try { A = await import('./avatar.js'); } catch { return; }
    const uid = sessionRef.uid;
    const edit = $('#avEdit');
    if (!edit) return;
    edit.querySelector('.avatar').outerHTML = A.avatar(uid, u.name, 'lg');
    const panel = $('#avPanel');
    const file = $('#avFile');
    const showMenu = () => {
        if (!A.avatarsEnabled()) {
            panel.innerHTML = '<div class="text-muted tiny">A profilképek jelenleg ki vannak kapcsolva.</div>';
        } else {
            panel.innerHTML = `
                <button class="btn btn-light w-100 mb-2" id="avPick">📷 ${A.hasAvatar(uid) ? 'Kép cseréje' : 'Profilkép feltöltése'}</button>
                ${A.hasAvatar(uid) ? '<button class="btn btn-outline-danger w-100 mb-2" id="avDel">Kép törlése</button>' : ''}
                <div class="text-muted tiny">A képet mindenki látja, aki használja az appot. Feltöltés előtt a telefon kicsinyíti.</div>`;
            $('#avPick', panel).addEventListener('click', () => file.click());
            $('#avDel', panel)?.addEventListener('click', async () => {
                if (!navigator.onLine) { feedback('error'); return toast('Ehhez internet kell.', 'error'); }
                try { await A.removeAvatar(uid); feedback('success'); toast('Profilkép törölve', 'success'); showMenu(); }
                catch (e) { console.error(e); feedback('error'); toast('Nem sikerült törölni.', 'error'); }
            });
        }
        panel.classList.remove('hidden');
    };
    edit.addEventListener('click', () => {
        feedback();
        if (panel.classList.contains('hidden')) showMenu(); else panel.classList.add('hidden');
    });
    file.addEventListener('change', async () => {
        const f = file.files[0];
        file.value = '';
        if (!f) return;
        let data;
        try { data = await A.prepareImage(f); }
        catch { feedback('error'); return toast('Ezt a képet nem sikerült beolvasni.', 'error'); }
        panel.innerHTML = `
            <div class="text-center mb-2"><img class="av-preview" src="${data}" alt="Előnézet"></div>
            <div class="d-flex gap-2">
                <button class="btn btn-light flex-grow-1" id="avCancel">Mégsem</button>
                <button class="btn btn-primary flex-grow-1" id="avSave">Mentés</button>
            </div>`;
        $('#avCancel', panel).addEventListener('click', showMenu);
        $('#avSave', panel).addEventListener('click', async (e) => {
            if (!navigator.onLine) { feedback('error'); return toast('A feltöltéshez internet kell.', 'error'); }
            e.currentTarget.disabled = true;
            try { await A.saveMyAvatar(uid, data); feedback('success'); toast('Profilkép mentve ✓', 'success'); panel.classList.add('hidden'); }
            catch (err) {
                console.error(err); feedback('error');
                toast(err?.code === 'permission-denied' ? 'Most nem menthető – próbáld fél perc múlva.' : 'Nem sikerült menteni.', 'error');
                showMenu();
            }
        });
    });
};

// Szerepkör-kérés: a vezetők a Felhasználók → "Új / kérés" alatt hagyják jóvá
const openRoleRequest = async () => {
    feedback();
    if (!navigator.onLine) return toast('Ehhez internet kell.', 'error');
    const list = (await sessionRef.listRoles()).filter((r) => r.id !== sessionRef.role);
    if (!list.length) return toast('Nincs más választható szerepkör.');
    closeSideMenu();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-1">Szerepkör kérése</h5>
        <p class="text-muted small mb-3">Jelenleg: <b>${esc(sessionRef.roleLabel)}</b>. Válaszd ki, milyen munkakörben dolgozol – egy vezető jóváhagyja, és utána automatikusan megkapod a hozzá tartozó modulokat.</p>
        <select id="rrRole" class="form-select form-select-lg mb-3">${list.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}</select>
        <div class="d-flex gap-2">
            <button class="btn btn-light flex-grow-1" id="rrCancel">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="rrSend">Kérés küldése</button>
        </div>`);
    $('#rrCancel', sheet).addEventListener('click', closeSheet);
    $('#rrSend', sheet).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
            await sessionRef.requestRole($('#rrRole', sheet).value);
            emit('app', 'role-request');
            feedback('success'); toast('Kérés elküldve – egy vezető hamarosan jóváhagyja.', 'success'); closeSheet();
        } catch (err) { console.error(err); feedback('error'); toast('Nem sikerült elküldeni.', 'error'); e.currentTarget.disabled = false; }
    });
};

let menuCloseTimer = null;
export const closeSideMenu = () => {
    $('#sideMenu')?.classList.remove('open');
    $('#sideOverlay')?.classList.remove('open');
    // A fejléc a menü kicsúszásáig maradjon felül – különben a menü fehér teteje átvillan rajta
    clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(() => {
        if (!$('#sideMenu')?.classList.contains('open')) document.body.classList.remove('menu-open');
    }, 380);
    $('#menuBtn')?.classList.remove('open');
    $('#menuBtn')?.setAttribute('aria-expanded', 'false');
};

// ---------- Alsó menü ----------
// Alap: Kezdőlap · Felhasználók (ha joga van) · Beállítások (admin) · Infó (kezdőlapon)
// Egy oldal saját füleket tehet bele (setPageTabs) → Kezdőlap · fülek · Profil
let pageTabs = null;     // [{ id, icon, label }]
let helpAction = null;   // ha be van állítva: ❓ Súgó gomb a jobb szélen
let activeTab = null;
let onTabSelect = null;

const renderNav = () => {
    if (!sessionRef) return;
    const page = document.body.dataset.page;
    const home = { id: 'home', icon: '🏠', label: 'Kezdőlap', go: 'index.html' };
    const info = { id: 'info', icon: 'ℹ️', label: 'Infó', go: 'info.html' };
    // Az Infó csak a kezdőlapon van (a jobb szélen); a profil a fejléc ☰ menüjében
    const onHome = page === 'home';
    const items = (pageTabs
        ? [home, ...pageTabs.map((t) => ({ ...t, tab: true }))]
        : [
            home,
            sessionRef.can('users.view') && { id: 'admin', icon: '👥', label: 'Felhasználók', go: 'admin.html' },
            sessionRef.isAdmin && { id: 'settings', icon: '⚙️', label: 'Beállítások', go: 'settings.html' },
            onHome && info
        ]
    ).filter(Boolean);
    if (helpAction) items.push({ id: 'help', icon: '❓', label: 'Súgó', action: helpAction });

    const isActive = (i) => (i.tab ? i.id === activeTab : !pageTabs && i.id === page);
    const nav = $('#bottomNav');
    nav.innerHTML = items.map((i) =>
        `<button data-nav="${esc(i.id)}" class="${isActive(i) ? 'active' : ''}"><span class="nav-ico">${i.icon}</span>${esc(i.label)}</button>`
    ).join('');
    nav.querySelectorAll('button').forEach((b) => {
        const item = items.find((i) => i.id === b.dataset.nav);
        b.addEventListener('click', () => {
            if (item.tab) return selectPageTab(item.id);
            if (item.action) return item.action();
            location.href = item.go;
        });
    });
    nav.classList.remove('hidden');
};

export const selectPageTab = (id) => {
    if (id !== activeTab) feedback();
    activeTab = id;
    $('#bottomNav')?.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.nav === id));
    onTabSelect?.(id);
};

// tabs: [{ id, icon, label }], onSelect(id) – az első fül lesz aktív
export const setPageTabs = (tabs, onSelect) => {
    pageTabs = tabs;
    onTabSelect = onSelect;
    activeTab = tabs[0]?.id || null;
    renderNav();
    onSelect?.(activeTab);
};

// Modul súgó gomb az alsó menü jobb szélén (lásd js/help.js)
export const setHelp = (fn) => { helpAction = fn; renderNav(); };

export const renderChrome = (session) => {
    sessionRef = session;
    // Használati statisztika (csak bejelentkezett felhasználónál)
    if (session?.uid) import('./track.js').then((m) => m.startTracking(session)).catch(() => {});
    renderNav();
    requestWakeLock();
};

// ---------- Service Worker + frissítés jelzés ----------
// Új verziónál: a fejléc kis gombja + alul egy sáv a "mi új" összefoglalóval.
// A felhasználó dönt: Frissítés most, vagy Később (2 órára elrejti a sávot;
// a fejléc gomb végig látszik, és onnan bármikor frissíthet).
let swReg = null;
const SNOOZE_KEY = 'qube_upd_snooze';      // { until, at }
const FIRST_KEY = 'qube_upd_first';        // mikor jelent meg először (cache név → idő)
const SEEN_VER_KEY = 'qube_seen_version';  // a legutóbb futtatott verzió ("Frissítve" jelzéshez)
const SNOOZE_MS = 2 * 60 * 60 * 1000;

const verNum = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const lsJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

// A változásnapló a már letöltött (várakozó) verzió gyorsítótárából – internet sem kell hozzá
const readChangelog = async (fromNew) => {
    const url = new URL('changelog.json', location.href).href;
    try {
        if (!fromNew) return await (await fetch(url)).json();
        let best = null;
        for (const name of await caches.keys()) {
            if (!name.startsWith('qube-') || name === 'qube-cdn-v1') continue;
            const res = await (await caches.open(name)).match(url, { ignoreSearch: true });
            if (!res) continue;
            const log = await res.json().catch(() => null);
            if (log?.[0]?.v && (!best || newer(log[0].v, best[0].v))) best = log;
        }
        return best;
    } catch { return null; }
};
const changesSince = (log, from) => (Array.isArray(log) ? log : []).filter((x) => newer(x.v, from));

const changesHtml = (list) => list.length ? list.map((x) => `
    <div class="upd-ver"><b>v${esc(x.v)}</b>${x.date ? ` <span class="text-muted tiny">${esc(x.date)}</span>` : ''}</div>
    <ul class="upd-list">${(x.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')
    : '<p class="text-muted small">Javítások és fejlesztések.</p>';

const openChanges = (list, withButton) => {
    feedback();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">${withButton ? '✨ Mi újság az új verzióban?' : '✨ Újdonságok'}</h5>
        <div class="upd-changes">${changesHtml(list)}</div>
        ${withButton ? `
        <div class="d-flex gap-2 mt-3">
            <button class="btn btn-light flex-grow-1" id="updSheetLater">Később</button>
            <button class="btn btn-primary flex-grow-1" id="updSheetGo">Frissítés most</button>
        </div>
        <div class="text-muted tiny text-center mt-2">Pár másodperc, az adataid megmaradnak.</div>`
        : '<button class="btn btn-primary w-100 mt-3" id="updSheetOk">Rendben</button>'}`);
    $('#updSheetGo', sheet)?.addEventListener('click', () => { closeSheet(); applyUpdate(); });
    $('#updSheetLater', sheet)?.addEventListener('click', () => { closeSheet(); snooze(); });
    $('#updSheetOk', sheet)?.addEventListener('click', closeSheet);
};

const hideBar = () => {
    const bar = $('#updBar');
    bar?.classList.remove('show');
    document.body.classList.remove('upd-on');
};

const snooze = () => {
    emit('app', 'update-later');
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ until: Date.now() + SNOOZE_MS }));
    hideBar();
    barShown = false; // a "Később" lejárta után (előtérbe kerüléskor) újra jöhet
    toast('Rendben – a fejlécben lévő gombbal bármikor frissíthetsz.');
};

const snoozed = () => (lsJson(SNOOZE_KEY, {}).until || 0) > Date.now();

const applyUpdate = () => {
    const btn = $('#updateBtn');
    emit('app', 'update-click');
    btn.disabled = true;
    btn.textContent = '⏳ Frissítés…';
    const go = $('#updGo');
    if (go) { go.disabled = true; go.textContent = '⏳ Frissítés…'; }
    localStorage.removeItem(SNOOZE_KEY);
    const waiting = swReg?.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    // Ha 4 mp alatt nem vált át (pl. a várakozó verzió közben megszűnt), sima újratöltés
    setTimeout(() => location.reload(), waiting ? 4000 : 0);
};

// Alsó sáv: "Új verzió érhető el" – nem takar ki semmit, nem kötelező
let barShown = false;
const showBar = async () => {
    if (barShown || snoozed() || document.body.classList.contains('screen-open')) return;
    barShown = true;
    const log = await readChangelog(true);
    const list = changesSince(log, APP.version);
    const newV = list[0]?.v || log?.[0]?.v || '';
    const items = list.flatMap((x) => x.items || []);

    // mióta vár
    const firsts = lsJson(FIRST_KEY, {});
    const key = newV || 'ismeretlen';
    if (!firsts[key]) { firsts[key] = Date.now(); localStorage.setItem(FIRST_KEY, JSON.stringify(firsts)); }
    const days = Math.floor((Date.now() - firsts[key]) / 86400000);

    const bar = $('#updBar');
    bar.innerHTML = `
        <button class="upd-info" id="updInfo">
            <span class="upd-ico">✨</span>
            <span class="upd-txt">
                <b>Új verzió${newV ? ` (v${esc(newV)})` : ''}</b>
                <small>${items.length ? `${items.length} újdonság · ` : ''}${days >= 1 ? `${days} napja elérhető · ` : ''}Mi új? ›</small>
            </span>
        </button>
        <button class="upd-later" id="updLater" aria-label="Később">Később</button>
        <button class="upd-go" id="updGo">Frissítés</button>`;
    $('#updInfo').addEventListener('click', () => openChanges(list, true));
    $('#updLater').addEventListener('click', () => { feedback(); snooze(); });
    $('#updGo').addEventListener('click', () => { feedback(); applyUpdate(); });
    // kis késleltetéssel csúszik be, hogy ne az oldal betöltésével együtt ugorjon
    setTimeout(() => { bar.classList.add('show'); document.body.classList.add('upd-on'); }, 1200);
};

// Frissítés után: rövid "Frissítve" jelzés, koppintásra a változások
const announceUpdated = async () => {
    const prev = localStorage.getItem(SEEN_VER_KEY);
    localStorage.setItem(SEEN_VER_KEY, APP.version);
    if (!prev || !newer(APP.version, prev)) return;
    const list = changesSince(await readChangelog(false), prev);
    const bar = $('#updBar');
    bar.innerHTML = `
        <button class="upd-info" id="updInfo">
            <span class="upd-ico">✅</span>
            <span class="upd-txt"><b>Frissítve: v${esc(APP.version)}</b><small>${list.length ? 'Nézd meg, mi új ›' : 'Minden naprakész'}</small></span>
        </button>
        <button class="upd-later" id="updLater" aria-label="Bezárás">✕</button>`;
    bar.classList.add('ok');
    $('#updInfo').addEventListener('click', () => { hideBar(); openChanges(list, false); });
    $('#updLater').addEventListener('click', hideBar);
    setTimeout(() => { bar.classList.add('show'); document.body.classList.add('upd-on'); }, 800);
    setTimeout(() => { if (!bar.classList.contains('ok')) return; hideBar(); setTimeout(() => bar.classList.remove('ok'), 400); }, 9000);
};

const registerSW = () => {
    announceUpdated();
    if (!('serviceWorker' in navigator)) return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
        swReg = reg;
        const showUpdate = () => {
            const btn = $('#updateBtn');
            if (btn.classList.contains('hidden')) emit('app', 'update-shown');
            btn.classList.remove('hidden');
            btn.onclick = () => { feedback(); readChangelog(true).then((log) => openChanges(changesSince(log, APP.version), true)); };
            showBar();
        };
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
        reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw?.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
            });
        });
        // Előtérbe kerüléskor frissítést keres (és ha a "Később" lejárt, újra szól)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            reg.update().catch(() => {});
            if (reg.waiting && !barShown) showBar();
        });
    }).catch((e) => console.warn('SW regisztráció sikertelen', e));
};

// ---------- Betöltés-figyelő ----------
// Ha az oldal 12 mp után is a "Betöltés…" állapotban áll, kiírja a hibát,
// és lehetőséget ad a gyorsítótár törlésére.
let lastError = '';
// Programhiba esetén nem várunk 12 mp-et
window.addEventListener('error', (e) => { lastError = e.message || String(e.error || ''); setTimeout(checkStuck, 2500); });
window.addEventListener('unhandledrejection', (e) => { lastError = String(e.reason?.code || e.reason?.message || e.reason || ''); setTimeout(checkStuck, 2500); });

const resetApp = async () => {
    try {
        const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches?.keys?.() || [];
        await Promise.all(keys.map((k) => caches.delete(k)));
        localStorage.removeItem('qube_session');
    } catch { /* amit lehetett, töröltünk */ }
    location.reload();
};

function checkStuck() {
    const scr = $('#appScreen');
    // Csak akkor szól, ha a betöltő tényleg látszik (nem töltött be, és nincs más üzenet)
    if (!scr || scr.classList.contains('hidden') || !scr.querySelector('.boot-loader')) return;
    showScreen(`
        <div class="screen-card text-center">
            <div class="screen-icon">🐢</div>
            <h4 class="fw-bold mb-2">Nem sikerült betölteni</h4>
            <p class="text-muted small mb-0">Lassú vagy megszakadt a kapcsolat, esetleg egy régi verzió ragadt a telefonon.</p>
            <button class="btn btn-primary w-100 mt-4" id="wdReload">Újrapróbálás</button>
            <button class="btn btn-light w-100 mt-2" id="wdReset">Gyorsítótár törlése és újratöltés</button>
            <div class="text-muted tiny mt-3">${esc(APP.name)} v${esc(APP.version)} · ${esc(APP.build)}${lastError ? ` · ${esc(lastError).slice(0, 160)}` : ''}</div>
        </div>`);
    $('#wdReload').addEventListener('click', () => location.reload());
    $('#wdReset').addEventListener('click', resetApp);
}
const startWatchdog = () => setTimeout(checkStuck, 12000);

injectShell();
registerSW();
startWatchdog();
