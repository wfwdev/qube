// ============================================================
// Visszajelzés oldal
// - Új: hiba / ötlet beküldése (offline is: helyi sorba kerül)
// - Sajátjaim: a saját bejelentések állapota és a fejlesztő válasza
// - Beérkezett (csak admin): összes bejelentés, állapot + válasz
// ============================================================
import { ready } from './session.js';
import { db, collection, doc, onSnapshot, query, where, updateDoc, deleteDoc, serverTimestamp } from './firebase.js';
import { MODULES } from './config.js';
import { esc, $, feedback, toast, openSheet, closeSheet, setPageTabs } from './ui.js';
import { TYPES, STATUS, queueFeedback, flushFeedback, pendingFeedback } from './feedback-store.js';

const session = await ready;
const isAdmin = session.isAdmin;

// Modulok listája a választóhoz (a jövőbeli modulok is automatikusan bekerülnek)
const MODULE_OPTIONS = [
    { id: 'general', title: 'Általános / az egész app' },
    ...MODULES.filter((m) => m.id !== 'feedback').map((m) => ({ id: m.id, title: m.title })),
    { id: 'info', title: 'Infó oldal' }
];
const moduleTitle = (id) => MODULE_OPTIONS.find((m) => m.id === id)?.title || id;

const fmtTime = (ms) => new Date(ms).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeOf = (f) => f.clientTime || f.createdAt?.toMillis?.() || 0;

// ============================================================
// FÜLEK
// ============================================================
const showTab = (name) => {
    ['new', 'mine', 'all'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== name));
    window.scrollTo(0, 0);
};

// ============================================================
// ÚJ BEKÜLDÉS
// ============================================================
let fbType = 'bug';
const textEl = $('#fbText');
const PLACEHOLDER = {
    bug: 'Írd le, mi történt, és mit csináltál előtte. Pl. „Az IC generátorban a Generálás gomb után nem jelent meg a QR.”',
    idea: 'Írd le, mit szeretnél, és miben segítene. Pl. „Jó lenne, ha az IC listában lehetne keresni.”'
};
const renderType = () => {
    $('#fbType').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.type === fbType));
    $('#fbTextLabel').textContent = fbType === 'bug' ? 'Mi történt?' : 'Mi az ötleted?';
    textEl.placeholder = PLACEHOLDER[fbType];
};
$('#fbType').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    feedback(); fbType = b.dataset.type; renderType();
});

$('#fbModule').innerHTML = MODULE_OPTIONS.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('');
const preset = new URLSearchParams(location.search).get('modul');
if (preset && MODULE_OPTIONS.some((m) => m.id === preset)) $('#fbModule').value = preset;

textEl.addEventListener('input', () => { $('#fbCount').textContent = textEl.value.length; });

const renderPending = () => {
    const n = pendingFeedback().length;
    const el = $('#fbPending');
    el.classList.toggle('hidden', !n);
    el.textContent = `⏳ ${n} beküldés vár internetre – amint van kapcsolat, magától elküldöm.`;
};

$('#fbSend').addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (text.length < 5) { feedback('error'); return toast('Írj egy kicsit bővebben!', 'error'); }
    queueFeedback(session, { type: fbType, module: $('#fbModule').value, text });
    textEl.value = ''; $('#fbCount').textContent = '0';
    feedback('success');
    if (navigator.onLine) {
        toast('Köszönöm, megkaptam! 🙏', 'success');
        await flushFeedback(renderPending);
    } else {
        toast('Elmentve – net esetén elküldöm.', 'success');
    }
    renderPending();
});

// ============================================================
// LISTA KÁRTYA (közös)
// ============================================================
const card = (f, { admin = false } = {}) => {
    const t = TYPES[f.type] || TYPES.bug;
    const st = STATUS[f.status] || STATUS.new;
    return `
    <button class="fb-card" data-id="${esc(f.id)}" ${admin ? '' : 'disabled'}>
        <div class="d-flex justify-content-between align-items-center gap-2 mb-1">
            <span class="fw-bold small">${t.icon} ${esc(t.label)} · ${esc(moduleTitle(f.module))}</span>
            <span class="fb-status ${st.cls}">${esc(st.label)}</span>
        </div>
        ${admin ? `<div class="text-muted tiny mb-1">${esc(f.name)} (${esc(f.empId)}) · ${fmtTime(timeOf(f))}</div>` : `<div class="text-muted tiny mb-1">${fmtTime(timeOf(f))}</div>`}
        <div class="fb-text">${esc(f.text)}</div>
        ${f.reply ? `<div class="fb-reply"><b>Válasz:</b> ${esc(f.reply)}</div>` : ''}
    </button>`;
};

// ============================================================
// SAJÁTJAIM
// ============================================================
let mine = [];
const renderMine = () => {
    const pend = pendingFeedback().map((p) => ({ ...p, status: 'new', pending: true }));
    const all = [...pend, ...mine.filter((m) => !pend.some((p) => p.id === m.id))]
        .sort((a, b) => timeOf(b) - timeOf(a));
    $('#mineList').innerHTML = all.length
        ? all.map((f) => card(f) + (f.pending ? '<div class="text-muted tiny text-center mb-2">⏳ még nincs elküldve (nincs internet)</div>' : '')).join('')
        : '<div class="text-center text-muted small py-4">Még nem küldtél be semmit.</div>';
};

onSnapshot(query(collection(db, 'feedback'), where('uid', '==', session.uid)), (snap) => {
    if (snap.metadata?.fromCache && snap.empty) {
        if (!mine.length) $('#mineList').innerHTML = '<div class="text-center text-muted small py-4">📡 A korábbi bejelentésekhez internet kell.</div>';
        return;
    }
    mine = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMine();
}, (e) => { console.error(e); $('#mineList').innerHTML = '<div class="text-center text-muted small py-4">Nem sikerült betölteni.</div>'; });

// ============================================================
// BEÉRKEZETT (admin)
// ============================================================
let all = [];
let filter = 'open';
const FILTERS = [
    ['open', 'Nyitott', (f) => f.status === 'new' || f.status === 'progress'],
    ['new', 'Új', (f) => f.status === 'new'],
    ['done', 'Kész', (f) => f.status === 'done'],
    ['rejected', 'Elutasítva', (f) => f.status === 'rejected'],
    ['all', 'Mind', () => true]
];

const renderAll = () => {
    $('#allFilters').innerHTML = FILTERS.map(([id, label, fn]) =>
        `<button class="chip ${filter === id ? 'active' : ''}" data-f="${id}">${label} <span>${all.filter(fn).length}</span></button>`).join('');
    const fn = FILTERS.find((x) => x[0] === filter)[2];
    const list = all.filter(fn).sort((a, b) => timeOf(b) - timeOf(a));
    $('#allList').innerHTML = list.length ? list.map((f) => card(f, { admin: true })).join('')
        : '<div class="text-center text-muted small py-4">Nincs ilyen bejelentés.</div>';
};

const openItem = (id) => {
    const f = all.find((x) => x.id === id);
    if (!f) return;
    feedback();
    const t = TYPES[f.type] || TYPES.bug;
    const sheet = openSheet(`
        <h5 class="fw-bold mb-1">${t.icon} ${esc(t.label)} · ${esc(moduleTitle(f.module))}</h5>
        <div class="text-muted small mb-3">${esc(f.name)} (${esc(f.empId)}) · ${fmtTime(timeOf(f))}</div>
        <div class="fb-full mb-3">${esc(f.text)}</div>
        <div class="text-muted tiny mb-3">Verzió: ${esc(f.version || '–')}<br>Eszköz: ${esc(f.device || '–')}</div>
        <label class="form-label">Állapot</label>
        <select id="fbStatus" class="form-select mb-3">${Object.entries(STATUS).map(([k, v]) =>
            `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <label class="form-label">Válasz a beküldőnek</label>
        <textarea id="fbReply" class="form-control mb-3" rows="3" maxlength="1000" placeholder="Opcionális – a beküldő a Sajátjaim fülön látja">${esc(f.reply || '')}</textarea>
        <div class="d-flex gap-2">
            <button class="btn btn-outline-danger" id="fbDel">Törlés</button>
            <button class="btn btn-light flex-grow-1" id="fbClose">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="fbSave">Mentés</button>
        </div>`);
    $('#fbClose', sheet).addEventListener('click', closeSheet);
    $('#fbSave', sheet).addEventListener('click', async () => {
        try {
            await updateDoc(doc(db, 'feedback', f.id), {
                status: $('#fbStatus', sheet).value,
                reply: $('#fbReply', sheet).value.trim(),
                updatedAt: serverTimestamp()
            });
            feedback('success'); toast('Mentve ✓', 'success'); closeSheet();
        } catch (e) { console.error(e); feedback('error'); toast('Nem sikerült menteni.', 'error'); }
    });
    $('#fbDel', sheet).addEventListener('click', async () => {
        if (!confirm('Törlöd ezt a bejelentést?')) return;
        try { await deleteDoc(doc(db, 'feedback', f.id)); feedback('success'); toast('Törölve'); closeSheet(); }
        catch (e) { console.error(e); feedback('error'); toast('Nem sikerült törölni.', 'error'); }
    });
};

if (isAdmin) {
    $('#allFilters').addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (!b) return;
        feedback(); filter = b.dataset.f; renderAll();
    });
    $('#allList').addEventListener('click', (e) => {
        const c = e.target.closest('.fb-card');
        if (c) openItem(c.dataset.id);
    });
    onSnapshot(collection(db, 'feedback'), (snap) => {
        if (snap.metadata?.fromCache && snap.empty) {
            if (!all.length) $('#allList').innerHTML = '<div class="text-center text-muted small py-4">📡 Internetkapcsolat kell.</div>';
            return;
        }
        all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderAll();
    }, (e) => { console.error(e); $('#allList').innerHTML = '<div class="text-center text-muted small py-4">Nem sikerült betölteni.</div>'; });
}

// ============================================================
// INDÍTÁS
// ============================================================
setPageTabs([
    { id: 'new', icon: '✏️', label: 'Új' },
    { id: 'mine', icon: '📋', label: 'Sajátjaim' },
    isAdmin && { id: 'all', icon: '📥', label: 'Beérkezett' }
].filter(Boolean), (id) => { showTab(id); if (id === 'mine') renderMine(); });

renderType();
renderPending();
flushFeedback(() => { renderPending(); renderMine(); });
window.addEventListener('online', () => setTimeout(() => { renderPending(); renderMine(); }, 1500));
