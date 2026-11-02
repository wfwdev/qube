// ============================================================
// Beállítások – csak admin (data-perm="admin.only")
// A Firestore szabály is csak adminnak engedi a settings írását.
// ============================================================
import { ready } from './session.js';
import { loadSettings, saveAdvent, saveSwaps, DEFAULT_ADVENT_MESSAGES } from './features.js';
import { BUILTIN_SWAPS, parseIso, fmtLong, dow } from './hu-calendar.js';
import { openAdvent, adventDay, adventTeaser, az } from './advent.js';
import { esc, $, feedback, toast, openSheet, closeSheet, setPageTabs } from './ui.js';
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

setPageTabs([{ id: 'settings', icon: '⚙️', label: 'Beállítások' }], () => {});
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
    } catch { $('#recCount').textContent = '–'; }
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
