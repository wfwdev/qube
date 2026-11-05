// ============================================================
// Vezérlőpult (Beállítások) – csak admin (data-perm="admin.only")
// Áttekintő lista + aloldalak (#advent, #swaps, #recovery) – a telefon
// "vissza" gombja is működik. A Firestore szabály is csak adminnak engedi
// a settings írását.
// ============================================================
import { ready } from './session.js';
import { loadSettings, saveAdvent, saveSwaps, saveAvatarsEnabled, saveAnalyticsEnabled, DEFAULT_ADVENT_MESSAGES } from './features.js';
import { BUILTIN_SWAPS, parseIso, fmtLong, fmtDay, dow, iso, today } from './hu-calendar.js';
import { openAdvent, adventDay, adventTeaser, az } from './advent.js';
import { esc, $, feedback, toast, openSheet, closeSheet } from './ui.js';
import { registerHelp } from './help.js';
import { APP } from './config.js';
import { db, collection, doc, getDoc, query, where, getCountFromServer } from './firebase.js';
import { countCodes, regenerateCodes } from './recovery.js';

const session = await ready;

const initial = await loadSettings();
let advent = initial.advent;
let adminSwaps = { ...initial.calendar.swaps };  // admin kiegészítés: work | rest | none

const fail = (e) => { console.error(e); feedback('error'); toast('Nem sikerült menteni.', 'error'); };

// ---------- Kapcsolók ----------
const enabledChk = $('#advEnabled');
const snowChk = $('#advSnow');

const renderStatus = () => {
    const day = adventDay();
    $('#sumAdvent').textContent = !advent.enabled ? 'Kikapcsolva'
        : day ? `Aktív – ${day}. ablak` : adventTeaser() ? 'Bekapcsolva – előzetes látszik' : 'Bekapcsolva – nov. 15-től látszik';
    $('#advStatus').textContent = !advent.enabled
        ? 'Kikapcsolva – a felhasználók nem látják.'
        : day ? `Most aktív: ${az(day)} ${day}. ablakig lehet nyitni.`
        : adventTeaser() ? 'Előzetes: a felhasználók már látják a 🎄 ikont a nevük mellett. December 1-jén nyílik.'
        : 'Bekapcsolva – november 15-től egy 🎄 ikon jelzi a felhasználóknak, december 1-jén nyílik.';
};

// Mentés; hiba esetén visszaállítja az előző állapotot
const save = async (prev, msg = 'Mentve ✓') => {
    try { await saveAdvent(advent); feedback('success'); toast(msg, 'success'); renderStatus(); return true; }
    catch (e) {
        fail(e);
        advent = prev;
        enabledChk.checked = advent.enabled; snowChk.checked = advent.snow;
        renderStatus(); renderMsgs();
        return false;
    }
};

enabledChk.checked = advent.enabled;
snowChk.checked = advent.snow;
enabledChk.addEventListener('change', () => {
    const prev = advent; advent = { ...advent, enabled: enabledChk.checked };
    save(prev, enabledChk.checked ? 'Adventi naptár bekapcsolva 🎄' : 'Adventi naptár kikapcsolva');
});
snowChk.addEventListener('change', () => { const prev = advent; advent = { ...advent, snow: snowChk.checked }; save(prev); });

// ---------- Előnézet ----------
const sel = $('#advPreviewDay');
sel.innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i + 1}. nap (dec. ${i + 1}.)</option>`).join('');
sel.value = String(adventDay() || 1);
$('#advPreview').addEventListener('click', () => {
    feedback();
    openAdvent({ day: Number(sel.value), messages: advent.messages, key: null, preview: true });
});

// ---------- Napi üzenetek ----------
const renderMsgs = () => {
    $('#advMsgs').innerHTML = advent.messages.map((m, i) => `
        <button class="msg-row" data-i="${i}">
            <span class="msg-day">${i + 1}</span>
            <span class="msg-text">${esc(m)}</span>
            ${m !== DEFAULT_ADVENT_MESSAGES[i] ? '<span class="msg-edited" title="Módosítva">✎</span>' : ''}
        </button>`).join('');
};

$('#advMsgs').addEventListener('click', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const i = Number(row.dataset.i);
    feedback();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">${i + 1}. nap üzenete</h5>
        <textarea id="msgText" class="form-control mb-1" rows="4" maxlength="300">${esc(advent.messages[i])}</textarea>
        <div class="text-muted tiny mb-3"><span id="msgCount"></span>/300 karakter · emoji is használható</div>
        <button class="btn btn-light w-100 mb-2" id="msgReset">Alapértelmezett szöveg</button>
        <div class="d-flex gap-2">
            <button class="btn btn-light flex-grow-1" id="msgClose">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="msgSave">Mentés</button>
        </div>`);
    const ta = $('#msgText', sheet);
    const count = () => { $('#msgCount', sheet).textContent = ta.value.length; };
    ta.addEventListener('input', count); count();
    $('#msgReset', sheet).addEventListener('click', () => { ta.value = DEFAULT_ADVENT_MESSAGES[i]; count(); });
    $('#msgClose', sheet).addEventListener('click', closeSheet);
    $('#msgSave', sheet).addEventListener('click', async () => {
        const text = ta.value.trim();
        if (!text) { feedback('error'); return toast('Az üzenet nem lehet üres.', 'error'); }
        const prev = advent;
        const messages = [...advent.messages];
        messages[i] = text;
        advent = { ...advent, messages };
        if (await save(prev)) { renderMsgs(); closeSheet(); }
    });
});

renderStatus();
renderMsgs();

// ============================================================
// ADMIN VÉSZKIJÁRAT – egyszer használatos kódok
// ============================================================
const renderRecCount = async () => {
    try {
        const n = await countCodes(session.user.empId);
        $('#recCount').textContent = n;
        $('#recCount').classList.toggle('text-danger', n === 0);
        $('#sumRecovery').textContent = n ? `${n} fel nem használt kód` : '⚠️ Nincs kódod – generálj újakat!';
        $('#sumRecovery').classList.toggle('text-danger', n === 0);
    } catch { $('#recCount').textContent = '–'; $('#sumRecovery').textContent = 'Nem érhető el (internet?)'; }
};

$('#recGen').addEventListener('click', async (e) => {
    const n = Number($('#recCount').textContent) || 0;
    if (n && !confirm(`Még ${n} fel nem használt kódod van. Újakat generálsz? A régiek érvénytelenné válnak.`)) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Generálás…';
    try {
        const codes = await regenerateCodes(session.user.empId);
        feedback('success');
        const sheet = openSheet(`
            <h5 class="fw-bold mb-1">🔑 Az új vészkódjaid</h5>
            <div class="info-warn mb-3">Ezek <b>csak most</b> láthatók! Írd fel vagy mentsd el biztonságos helyre (pl. jelszókezelő). Mindegyik egyszer használható.</div>
            <div class="rec-codes mono" id="recCodes">${codes.map((c) => `<div>${esc(c)}</div>`).join('')}</div>
            <button class="btn btn-light w-100 mt-3" id="recCopy">📋 Másolás</button>
            <button class="btn btn-primary w-100 mt-2" id="recDone">Felírtam, bezárom</button>`);
        $('#recCopy', sheet).addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(codes.join('\n')); toast('Kimásolva ✓', 'success'); }
            catch { toast('Nem sikerült – írd fel kézzel.', 'error'); }
        });
        $('#recDone', sheet).addEventListener('click', closeSheet);
    } catch (err) {
        console.error(err); feedback('error'); toast('Nem sikerült a generálás.', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Új vészkódok generálása';
        renderRecCount();
    }
});
renderRecCount();

// ============================================================
// MUNKANAP-ÁTHELYEZÉSEK (munkaidő naptár)
// beépített (rendelet a kódban) + admin lista; 'none' = beépített elrejtése
// ============================================================
let swapType = 'work';

const renderSwaps = () => {
    const all = { ...BUILTIN_SWAPS, ...adminSwaps };
    const tk = iso(today());
    const next = Object.keys(all).filter((d) => d >= tk && all[d] !== 'none').sort()[0];
    $('#sumSwaps').textContent = next
        ? `Következő: ${fmtDay(parseIso(next))} – ${all[next] === 'work' ? 'ledolgozós' : 'pihenőnap'}`
        : 'Nincs közelgő áthelyezés';
    const thisYear = new Date().getFullYear();
    const rows = Object.keys(all).filter((d) => Number(d.slice(0, 4)) >= thisYear - 1).sort();
    $('#swapList').innerHTML = rows.length ? rows.map((d) => {
        const t = all[d];
        const builtin = d in BUILTIN_SWAPS;
        const hidden = t === 'none';
        return `<div class="swap-row ${hidden ? 'opacity-50' : ''}">
            <div class="flex-grow-1">
                <div class="fw-bold small">${esc(fmtLong(parseIso(d)))}</div>
                <div class="text-muted tiny">${builtin ? 'Beépített (rendelet)' : 'Admin által felvett'}${hidden ? ' · kikapcsolva' : ''}</div>
            </div>
            ${hidden ? '' : `<span class="swap-tag ${t}">${t === 'work' ? 'Ledolgozós' : 'Pihenőnap'}</span>`}
            <button class="btn btn-sm btn-light" data-swap="${d}">${hidden ? 'Vissza' : '✕'}</button>
        </div>`;
    }).join('') : '<div class="text-muted small">Nincs áthelyezés.</div>';
};

const storeSwaps = async (next, msg) => {
    const prev = adminSwaps;
    adminSwaps = next;
    renderSwaps();
    try { await saveSwaps(adminSwaps); feedback('success'); toast(msg, 'success'); }
    catch (e) { fail(e); adminSwaps = prev; renderSwaps(); }
};

$('#swapType').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    feedback();
    swapType = b.dataset.t;
    $('#swapType').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
});

$('#swapAdd').addEventListener('click', () => {
    const d = $('#swapDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { feedback('error'); return toast('Válassz dátumot.', 'error'); }
    const wd = dow(parseIso(d));
    if (swapType === 'work' && wd < 5 && !confirm('Ez hétköznap. Biztosan ledolgozós napnak jelölöd?')) return;
    if (swapType === 'rest' && wd >= 5 && !confirm('Ez hétvégére esik. Biztosan pihenőnapnak jelölöd?')) return;
    const next = { ...adminSwaps };
    if (BUILTIN_SWAPS[d] === swapType) delete next[d]; else next[d] = swapType;
    $('#swapDate').value = '';
    storeSwaps(next, 'Áthelyezés felvéve ✓');
});

$('#swapList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-swap]');
    if (!b) return;
    feedback();
    const d = b.dataset.swap;
    const next = { ...adminSwaps };
    if (d in BUILTIN_SWAPS) {
        if (next[d] === 'none') delete next[d]; else next[d] = 'none';
    } else delete next[d];
    storeSwaps(next, 'Mentve ✓');
});
renderSwaps();

// ============================================================
// PROFILKÉPEK be/ki
// ============================================================
const avChk = $('#avEnabled');
const sumAvatars = () => { $('#sumAvatars').textContent = avChk.checked ? 'Feltölthetők' : 'Kikapcsolva – csak monogram'; };
avChk.checked = initial.avatars.enabled;
sumAvatars();
avChk.addEventListener('change', async () => {
    feedback();
    sumAvatars();
    try {
        await saveAvatarsEnabled(avChk.checked);
        feedback('success'); toast(avChk.checked ? 'Profilképek bekapcsolva' : 'Profilképek kikapcsolva', 'success');
    } catch (e) { fail(e); avChk.checked = !avChk.checked; sumAvatars(); }
});

// ============================================================
// HASZNÁLATI STATISZTIKA – gyűjtés be/ki
// ============================================================
const anChk = $('#anEnabled');
const sumAnalytics = () => { $('#sumAnalytics').textContent = anChk.checked ? 'Gyűjt – csak te látod' : 'Kikapcsolva – nem gyűjt adatot'; };
anChk.checked = initial.analytics.enabled;
sumAnalytics();
anChk.addEventListener('change', async () => {
    feedback();
    sumAnalytics();
    try {
        await saveAnalyticsEnabled(anChk.checked);
        feedback('success'); toast(anChk.checked ? 'Adatgyűjtés bekapcsolva' : 'Adatgyűjtés kikapcsolva', 'success');
    } catch (e) { fail(e); anChk.checked = !anChk.checked; sumAnalytics(); }
});

// ============================================================
// NAVIGÁCIÓ – áttekintés ↔ aloldalak (#advent, #swaps, #recovery)
// ============================================================
const VIEWS = ['home', 'advent', 'swaps', 'recovery'];
const showView = () => {
    const v = location.hash.slice(1);
    const id = VIEWS.includes(v) ? v : 'home';
    VIEWS.forEach((x) => $(`#view-${x}`).classList.toggle('hidden', x !== id));
    window.scrollTo(0, 0);
};
window.addEventListener('hashchange', showView);

let openedHere = false; // innen nyitottuk az aloldalt → a "vissza" előzményben lép vissza
document.querySelectorAll('[data-open]').forEach((row) => row.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return; // a kapcsoló nem nyitja meg
    feedback();
    openedHere = true;
    location.hash = row.dataset.open;
}));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
    feedback();
    if (openedHere) { openedHere = false; history.back(); } else location.hash = '';
}));
showView();

// ============================================================
// ÁTTEKINTÉS – számlálók (a szerveren számol, 1 olvasás / 1000 dokumentum)
// ============================================================
const count = async (q, el, alertBox) => {
    try {
        const n = (await getCountFromServer(q)).data().count;
        $(el).textContent = n;
        if (alertBox) $(alertBox).classList.toggle('alert', n > 0);
    } catch (e) { console.warn(e); $(el).textContent = '–'; }
};
count(query(collection(db, 'users'), where('status', '==', 'active')), '#stUsers');
count(query(collection(db, 'users'), where('status', '==', 'conflict')), '#stWait', '#stWaitBox');
count(query(collection(db, 'users'), where('reviewed', '==', false), where('status', '==', 'active')), '#stNew', '#stNewBox');
count(query(collection(db, 'feedback'), where('status', '==', 'new')), '#stFb', '#stFbBox');

// Új hibák a statisztika legutóbbi megnyitása óta (JS hiba + felhasználónak megjelent hibaüzenet)
const newErrors = async () => {
    try {
        let seen = {};
        try { seen = JSON.parse(localStorage.getItem('qube_err_seen')) || {}; } catch { /* */ }
        const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return iso(d); });
        const snaps = await Promise.all(days.map((k) => getDoc(doc(db, 'usageDaily', k)).catch(() => null)));
        const total = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        const n = snaps.reduce((acc, sn, i) => {
            if (!sn?.exists()) return acc;
            const c = total(sn.data().errors) + total(sn.data().warnings);
            return acc + Math.max(0, c - (seen[days[i]] || 0));
        }, 0);
        const b = $('#errBadge');
        b.textContent = `${n} új hiba`;
        b.classList.toggle('hidden', !n);
    } catch (e) { console.warn(e); }
};
newErrors();

$('#cpVersion').textContent = `${APP.name} v${APP.version} · ${APP.build}`;
registerHelp('settings');
