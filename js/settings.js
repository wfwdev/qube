// ============================================================
// Beállítások – csak admin (data-perm="admin.only")
// A Firestore szabály is csak adminnak engedi a settings írását.
// ============================================================
import { ready } from './session.js';
import { loadSettings, saveAdvent, DEFAULT_ADVENT_MESSAGES } from './features.js';
import { openAdvent, adventDay, az } from './advent.js';
import { esc, $, feedback, toast, openSheet, closeSheet, setPageTabs } from './ui.js';

await ready;

let advent = (await loadSettings()).advent;

const fail = (e) => { console.error(e); feedback('error'); toast('Nem sikerült menteni.', 'error'); };

// ---------- Kapcsolók ----------
const enabledChk = $('#advEnabled');
const snowChk = $('#advSnow');

const renderStatus = () => {
    const day = adventDay();
    $('#advStatus').textContent = !advent.enabled
        ? 'Kikapcsolva – a felhasználók nem látják.'
        : day ? `Most aktív: ${az(day)} ${day}. ablakig lehet nyitni.` : 'Bekapcsolva – december 1-jén jelenik meg a felhasználóknál.';
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
