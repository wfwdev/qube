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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#9d29b2' : '#ff5f00');
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
export const toast = (msg, type = 'info') => {
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
            <div class="avatar">${esc((u.name || '?').trim().charAt(0).toUpperCase())}</div>
            <div>
                <div class="fw-bold">${esc(u.name)}</div>
                <div class="text-muted small">Törzsszám: <b>${esc(u.empId)}</b></div>
                <span class="role-badge mt-1">${esc(sessionRef.roleLabel)}</span>
            </div>
        </div>
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

    clearTimeout(menuCloseTimer);
    menu.classList.add('open');
    $('#sideOverlay').classList.add('open');
    document.body.classList.add('menu-open');
    $('#menuBtn').classList.add('open');
    $('#menuBtn').setAttribute('aria-expanded', 'true');
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
// Alap: Kezdőlap · Felhasználók (ha joga van) · Profil
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
        : [home, sessionRef.can('users.view') && { id: 'admin', icon: '👥', label: 'Felhasználók', go: 'admin.html' }, onHome && info]
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
    renderNav();
    requestWakeLock();
};

// ---------- Service Worker + frissítés jelzés ----------
let swReg = null;

const applyUpdate = () => {
    const btn = $('#updateBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Frissítés…';
    const waiting = swReg?.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    // Ha 4 mp alatt nem vált át (pl. a várakozó verzió közben megszűnt), sima újratöltés
    setTimeout(() => location.reload(), waiting ? 4000 : 0);
};

const registerSW = () => {
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
            btn.classList.remove('hidden');
            btn.onclick = applyUpdate;
        };
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
        reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw?.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
            });
        });
        // Előtérbe kerüléskor frissítést keres
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
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
