// ============================================================
// IC generátor
// - Generálás: két QR (formátum a régi rendszerrel azonos)
// - Lista: IC számok kezelése (ic.manage), import a régi rendszerből
// - Statisztika: napi / havi, IC-nként (ic.stats)
//
// Offline: az IC lista a telefonon is tárolva van, a generálások
// naplója egy helyi "kimenő" sorba kerül, és net esetén feltöltődik.
// ============================================================
import { ready } from './session.js';
import {
    db, collection, doc, getDoc, onSnapshot, setDoc, deleteDoc,
    writeBatch, serverTimestamp, increment
} from './firebase.js';
import { IC, LEGACY_IC_SOURCE } from './config.js';
import { esc, $, feedback, toast, openSheet, closeSheet } from './ui.js';

const session = await ready;
const canManage = session.can('ic.manage');
const canStats = session.can('ic.stats');

const LIST_CACHE = 'qube_ic_list';
const OUTBOX = 'qube_ic_outbox';
const MAX_ATTEMPTS = 6;

// ============================================================
// SEGÉDEK
// ============================================================
const pad = (n, l = 2) => String(n).padStart(l, '0');
const cleanCode = (raw) => String(raw ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const formatIC = (raw) => {
    const c = cleanCode(raw);
    if (c.length !== 13) return c;
    return `${c.slice(0, 2)}.${c.slice(2, 6)}-${c.slice(6, 10)}.${c.slice(10, 11)}.${c.slice(11, 13)}`;
};
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const fmtNum = (n) => Number(n || 0).toLocaleString('hu-HU');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '')
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

const load = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } };
const store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* tele */ } };

// ============================================================
// FÜLEK
// ============================================================
const tabs = $('#icTabs');
if (canManage || canStats) {
    tabs.classList.remove('hidden');
    tabs.querySelector('[data-tab=list]').classList.toggle('hidden', !canManage);
    tabs.querySelector('[data-tab=stats]').classList.toggle('hidden', !canStats);
}
const showTab = (name) => {
    ['gen', 'list', 'stats'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== name));
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'stats') loadStats();
};
tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    feedback(); showTab(b.dataset.tab);
});

// ============================================================
// IC LISTA – élő + helyi cache
// ============================================================
let icList = load(LIST_CACHE, []);   // [{ code, area }]
let genArea = IC.areas[0];
let listArea = 'all';

const sortList = (l) => l.sort((a, b) => a.area.localeCompare(b.area) || a.code.localeCompare(b.code));

onSnapshot(collection(db, 'ic_numbers'), (snap) => {
    icList = sortList(snap.docs.map((d) => ({ code: d.id, area: d.data().area })));
    store(LIST_CACHE, icList);
    renderGenSelect();
    renderList();
}, (e) => {
    console.error(e);
    if (!icList.length) toast('Az IC lista nem tölthető be.', 'error');
});

// ============================================================
// GENERÁLÁS
// ============================================================
$('#genMax').textContent = fmtNum(IC.maxAmount);
$('#genAmount').max = IC.maxAmount;

$('#genAreas').innerHTML = IC.areas.map((a) =>
    `<button data-area="${esc(a)}" class="${a === genArea ? 'active' : ''}">${esc(a)}</button>`).join('');
$('#genAreas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (!b) return;
    feedback();
    genArea = b.dataset.area;
    $('#genAreas').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderGenSelect();
});

function renderGenSelect() {
    const sel = $('#genSelect');
    const prev = sel.value;
    const items = icList.filter((ic) => ic.area === genArea);
    sel.innerHTML = items.length
        ? '<option value="">– Válassz –</option>' + items.map((ic) =>
            `<option value="${esc(ic.code)}">${esc(formatIC(ic.code))}</option>`).join('')
        : '<option value="">Nincs IC ezen a területen</option>';
    if (items.some((i) => i.code === prev)) sel.value = prev;
}

$('#genBtn').addEventListener('click', () => {
    const code = $('#genSelect').value;
    const amount = parseInt($('#genAmount').value, 10);
    if (!code) { feedback('error'); return toast('Válassz IC-t!', 'error'); }
    if (!Number.isInteger(amount) || amount < 1 || amount > IC.maxAmount) {
        feedback('error'); return toast(`A mennyiség 1 és ${fmtNum(IC.maxAmount)} között lehet!`, 'error');
    }
    if (typeof QRCode === 'undefined') { feedback('error'); return toast('A QR modul nem töltődött be. Frissíts!', 'error'); }

    const now = new Date();
    const clean = cleanCode(code);
    const padded = String(amount).padStart(7, '0');
    const r10 = Math.floor(Math.random() * 9e9 + 1e9).toString();
    const qr1 = `${clean.toLowerCase()}@${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}@${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const qr2 = `${clean}${padded}${r10}`;

    showQr(qr1, qr2, `${formatIC(clean)}${padded}${r10}`, { area: genArea, amount });
    feedback('success');

    enqueue({
        id: uuid(),
        icCode: clean,
        area: genArea,
        amount,
        clientTime: now.getTime(),
        day: dayKey(now),
        month: monthKey(now),
        attempts: 0
    });
});

// ---------- Teljes képernyős QR ----------
const showQr = (q1, q2, label2, meta) => {
    $('#qr1').innerHTML = ''; $('#qr2').innerHTML = '';
    new QRCode($('#qr1'), { text: q1, width: 260, height: 260 });
    new QRCode($('#qr2'), { text: q2, width: 260, height: 260 });
    $('#qr1Text').textContent = q1;
    $('#qr2Text').textContent = label2;
    $('#qrMeta').innerHTML = `<span class="role-badge">${esc(meta.area)}</span> <b>${fmtNum(meta.amount)} db</b>`;
    $('#qrFullscreen').classList.remove('hidden');
    document.body.classList.add('qr-open');
};
$('#qrClose').addEventListener('click', () => {
    feedback();
    $('#qrFullscreen').classList.add('hidden');
    document.body.classList.remove('qr-open');
});

// ============================================================
// KIMENŐ SOR (napló + statisztika feltöltése)
// ============================================================
let outbox = load(OUTBOX, []);
let flushing = false;

const renderSync = () => {
    const el = $('#syncLine');
    el.classList.toggle('hidden', !outbox.length);
    el.textContent = `⏳ ${outbox.length} generálás feltöltésre vár – net esetén automatikusan elküldi.`;
};

const enqueue = (item) => {
    outbox.push(item);
    store(OUTBOX, outbox);
    renderSync();
    flush();
};

const remove = (id) => {
    outbox = outbox.filter((x) => x.id !== id);
    store(OUTBOX, outbox);
};

const send = (item) => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'ic_logs', item.id), {
        icCode: item.icCode,
        area: item.area,
        amount: item.amount,
        uid: session.uid,
        name: session.user.name,
        empId: session.user.empId,
        clientTime: item.clientTime,
        day: item.day,
        ts: serverTimestamp()
    });
    const inc = {
        count: increment(1),
        amount: increment(item.amount),
        byIc: { [item.icCode]: { count: increment(1), amount: increment(item.amount) } }
    };
    batch.set(doc(db, 'ic_stats', `d_${item.day}`), inc, { merge: true });
    batch.set(doc(db, 'ic_stats', `m_${item.month}`), inc, { merge: true });
    return batch.commit();
};

async function flush() {
    if (flushing || !outbox.length || !navigator.onLine) return renderSync();
    flushing = true;
    try {
        for (const item of [...outbox]) {
            try {
                await send(item);
                remove(item.id);
            } catch (e) {
                // Lehet, hogy korábban már felment, csak a válasz veszett el
                const exists = await getDoc(doc(db, 'ic_logs', item.id)).then((s) => s.exists()).catch(() => false);
                if (exists) { remove(item.id); continue; }
                const offline = e?.code === 'unavailable' || !navigator.onLine;
                if (!offline) item.attempts = (item.attempts || 0) + 1; // net hiánya nem számít próbálkozásnak
                if (item.attempts >= MAX_ATTEMPTS) {
                    console.warn('Napló eldobva sok sikertelen próbálkozás után', item, e);
                    remove(item.id);
                } else {
                    store(OUTBOX, outbox);
                }
                if (offline) break; // nincs net → később
            }
        }
    } finally {
        flushing = false;
        renderSync();
    }
}

window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
renderSync();
flush();

// ============================================================
// IC LISTA KEZELÉSE (ic.manage)
// ============================================================
function renderList() {
    if (!canManage) return;
    const chips = [['all', 'Mind', icList.length], ...IC.areas.map((a) => [a, a, icList.filter((i) => i.area === a).length])];
    $('#listFilters').innerHTML = chips.map(([id, label, n]) =>
        `<button class="chip ${listArea === id ? 'active' : ''}" data-f="${esc(id)}">${esc(label)} <span>${n}</span></button>`).join('');

    const items = icList.filter((i) => listArea === 'all' || i.area === listArea);
    $('#icList').innerHTML = items.length ? items.map((ic) => `
        <button class="user-row" data-code="${esc(ic.code)}">
            <span class="area-badge area-${esc(ic.area.toLowerCase())}">${esc(ic.area)}</span>
            <span class="flex-grow-1 text-start fw-bold mono">${esc(formatIC(ic.code))}</span>
            <span class="text-muted">›</span>
        </button>`).join('')
        : `<div class="text-center text-muted small py-4">Még nincs IC rögzítve.</div>`;
}

if (canManage) {
    $('#listFilters').addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (!b) return;
        feedback(); listArea = b.dataset.f; renderList();
    });
    $('#icList').addEventListener('click', (e) => {
        const row = e.target.closest('[data-code]');
        if (row) openIc(row.dataset.code);
    });
    $('#icAddBtn').addEventListener('click', () => openIc(null));
    $('#icImportBtn').addEventListener('click', openImport);
    renderList();
}

const areaSelect = (id, selected) => `<select id="${id}" class="form-select mb-3">${IC.areas.map((a) =>
    `<option value="${esc(a)}" ${a === selected ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>`;

function openIc(code) {
    feedback();
    const ic = code ? icList.find((x) => x.code === code) : null;
    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">${ic ? 'IC szerkesztése' : 'Új IC'}</h5>
        <label class="form-label">Terület</label>
        ${areaSelect('imArea', ic?.area || (listArea !== 'all' ? listArea : genArea))}
        <label class="form-label">IC szám (13 karakter)</label>
        <input type="text" id="imCode" class="form-control mono mb-1" autocapitalize="characters" value="${esc(ic ? formatIC(ic.code) : '')}" ${ic ? 'disabled' : ''} placeholder="pl. 12.3456-7890.1.23">
        <div class="text-muted tiny mb-4">${ic ? 'A szám nem módosítható – töröld és vedd fel újra.' : 'Pontok, kötőjelek nélkül vagy velük is beírható.'}</div>
        <div class="d-flex gap-2">
            ${ic ? '<button class="btn btn-outline-danger" id="imDel">Törlés</button>' : ''}
            <button class="btn btn-light flex-grow-1" id="imClose">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="imSave">Mentés</button>
        </div>`);

    $('#imClose', sheet).addEventListener('click', closeSheet);
    $('#imDel', sheet)?.addEventListener('click', async () => {
        if (!confirm(`Törlöd: ${formatIC(ic.code)}?`)) return;
        try { await deleteDoc(doc(db, 'ic_numbers', ic.code)); feedback('success'); toast('Törölve'); closeSheet(); }
        catch (e) { console.error(e); feedback('error'); toast('Nem sikerült törölni.', 'error'); }
    });
    $('#imSave', sheet).addEventListener('click', async () => {
        const area = $('#imArea', sheet).value;
        const clean = ic ? ic.code : cleanCode($('#imCode', sheet).value);
        if (!IC.codePattern.test(clean)) { feedback('error'); return toast('Pontosan 13 karakter kell!', 'error'); }
        if (!ic && icList.some((x) => x.code === clean)) { feedback('error'); return toast('Ez az IC már szerepel a listában!', 'error'); }
        if (ic && ic.area === area) return closeSheet();
        try {
            await setDoc(doc(db, 'ic_numbers', clean), { code: clean, area, createdAt: serverTimestamp(), createdBy: session.uid });
            feedback('success'); toast('Mentve ✓', 'success'); closeSheet();
        } catch (e) { console.error(e); feedback('error'); toast('Nem sikerült menteni.', 'error'); }
    });
}

// ---------- Importálás ----------
function openImport() {
    feedback();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">IC-k importálása</h5>
        ${LEGACY_IC_SOURCE ? `
        <div class="minimal-card p-3 mb-3">
            <div class="fw-bold small mb-1">Átvétel a régi IC generátorból</div>
            <div class="text-muted tiny mb-2">A régi rendszer teljes listáját területekkel együtt átmásolja. A már meglévőket kihagyja.</div>
            <button class="btn btn-primary w-100" id="impLegacy">Régi lista átvétele</button>
        </div>` : ''}
        <label class="form-label">Vagy illeszd be a számokat</label>
        <textarea id="impText" class="form-control mono mb-2" rows="6" placeholder="Soronként egy IC szám (pontokkal, kötőjelekkel is jó)"></textarea>
        <label class="form-label">Terület</label>
        ${areaSelect('impArea', listArea !== 'all' ? listArea : genArea)}
        <div class="text-muted tiny mb-3" id="impInfo">&nbsp;</div>
        <div class="d-flex gap-2">
            <button class="btn btn-light flex-grow-1" id="impClose">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="impSave">Importálás</button>
        </div>`);

    const parse = () => {
        const tokens = $('#impText', sheet).value.split(/[\s,;]+/).map(cleanCode).filter(Boolean);
        const valid = [...new Set(tokens.filter((t) => IC.codePattern.test(t)))];
        const fresh = valid.filter((c) => !icList.some((x) => x.code === c));
        return { tokens, valid, fresh };
    };
    $('#impText', sheet).addEventListener('input', () => {
        const { tokens, valid, fresh } = parse();
        $('#impInfo', sheet).textContent = tokens.length
            ? `${valid.length} érvényes, ebből ${fresh.length} új${tokens.length > valid.length ? ` · ${tokens.length - valid.length} hibás kihagyva` : ''}`
            : ' ';
    });
    $('#impClose', sheet).addEventListener('click', closeSheet);
    $('#impSave', sheet).addEventListener('click', async () => {
        const { fresh } = parse();
        if (!fresh.length) { feedback('error'); return toast('Nincs új, érvényes IC szám.', 'error'); }
        const area = $('#impArea', sheet).value;
        await importItems(fresh.map((code) => ({ code, area })), $('#impSave', sheet));
    });
    $('#impLegacy', sheet)?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Lekérés…';
        try {
            const items = await fetchLegacy();
            const fresh = items.filter((i) => !icList.some((x) => x.code === i.code));
            if (!fresh.length) { toast(`Minden IC (${items.length}) már szerepel a listában.`); btn.textContent = 'Kész'; return; }
            await importItems(fresh, btn);
        } catch (err) {
            console.error(err);
            feedback('error'); toast('A régi rendszer nem érhető el. Használd a beillesztést.', 'error');
            btn.disabled = false; btn.textContent = 'Régi lista átvétele';
        }
    });
}

async function fetchLegacy() {
    const { projectId, apiKey, collection: col } = LEGACY_IC_SOURCE;
    const out = [];
    let pageToken = '';
    do {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}`
            + `?pageSize=300&key=${apiKey}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        (json.documents || []).forEach((d) => {
            const f = d.fields || {};
            const code = cleanCode(f.code?.stringValue);
            const area = f.type?.stringValue || f.area?.stringValue;
            if (IC.codePattern.test(code) && IC.areas.includes(area)) out.push({ code, area });
        });
        pageToken = json.nextPageToken || '';
    } while (pageToken);
    // ismétlődők kiszűrése
    return [...new Map(out.map((i) => [i.code, i])).values()];
}

async function importItems(items, btn) {
    btn.disabled = true;
    try {
        for (let i = 0; i < items.length; i += 400) {
            btn.textContent = `Mentés… ${Math.min(i + 400, items.length)}/${items.length}`;
            const batch = writeBatch(db);
            items.slice(i, i + 400).forEach(({ code, area }) =>
                batch.set(doc(db, 'ic_numbers', code), { code, area, createdAt: serverTimestamp(), createdBy: session.uid }));
            await batch.commit();
        }
        feedback('success'); toast(`${items.length} IC importálva ✓`, 'success'); closeSheet();
    } catch (e) {
        console.error(e);
        feedback('error'); toast('Az importálás megszakadt. Próbáld újra – a meglévőket kihagyja.', 'error');
        btn.disabled = false; btn.textContent = 'Újra';
    }
}

// ============================================================
// STATISZTIKA (ic.stats)
// ============================================================
let statMode = 'd';
let statDate = new Date();
let statUnsub = null;

const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

const periodLabel = () => {
    const d = statDate;
    if (statMode === 'm') return `${d.getFullYear()}. ${MONTHS[d.getMonth()]}`;
    const today = dayKey(new Date()) === dayKey(d);
    return `${today ? 'Ma · ' : ''}${d.getFullYear()}. ${MONTHS[d.getMonth()].slice(0, 3)}. ${d.getDate()}. ${DAYS[d.getDay()]}`;
};

const isFuture = (d) => (statMode === 'm' ? monthKey(d) > monthKey(new Date()) : dayKey(d) > dayKey(new Date()));

function loadStats() {
    if (!canStats) return;
    statUnsub?.();
    $('#statLabel').textContent = periodLabel();
    const next = new Date(statDate);
    if (statMode === 'm') next.setMonth(next.getMonth() + 1, 1); else next.setDate(next.getDate() + 1);
    $('#statNext').disabled = isFuture(next);

    const id = statMode === 'm' ? `m_${monthKey(statDate)}` : `d_${dayKey(statDate)}`;
    $('#statByIc').innerHTML = '<div class="text-muted small">Betöltés…</div>';
    statUnsub = onSnapshot(doc(db, 'ic_stats', id), (snap) => {
        const s = snap.exists() ? snap.data() : { count: 0, amount: 0, byIc: {} };
        $('#statCount').textContent = fmtNum(s.count);
        $('#statAmount').textContent = fmtNum(s.amount);
        const rows = Object.entries(s.byIc || {}).sort((a, b) => (b[1].amount || 0) - (a[1].amount || 0));
        const max = Math.max(1, ...rows.map(([, v]) => v.amount || 0));
        $('#statByIc').innerHTML = rows.length ? rows.map(([code, v]) => {
            const area = icList.find((x) => x.code === code)?.area;
            return `
            <div class="bar-row">
                <div class="d-flex justify-content-between align-items-baseline gap-2">
                    <span class="mono fw-bold small">${esc(formatIC(code))} ${area ? `<span class="area-badge area-${esc(area.toLowerCase())}">${esc(area)}</span>` : ''}</span>
                    <span class="small text-nowrap"><b>${fmtNum(v.amount)}</b> db · ${fmtNum(v.count)}×</span>
                </div>
                <div class="bar"><span style="width:${Math.max(2, Math.round((v.amount || 0) / max * 100))}%"></span></div>
            </div>`;
        }).join('') : '<div class="text-muted small">Ebben az időszakban nem volt generálás.</div>';
    }, (e) => {
        console.error(e);
        $('#statByIc').innerHTML = '<div class="text-muted small">A statisztika nem tölthető be.</div>';
    });
}

if (canStats) {
    $('#statModes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        feedback();
        statMode = b.dataset.mode;
        statDate = new Date();
        $('#statModes').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        loadStats();
    });
    const step = (dir) => {
        const d = new Date(statDate);
        if (statMode === 'm') d.setMonth(d.getMonth() + dir, 1); else d.setDate(d.getDate() + dir);
        if (isFuture(d)) return;
        feedback(); statDate = d; loadStats();
    };
    $('#statPrev').addEventListener('click', () => step(-1));
    $('#statNext').addEventListener('click', () => step(1));
}

renderGenSelect();
