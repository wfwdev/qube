// ============================================================
// Munkaidő naptár
// - Havi nézet: ünnepek, ledolgozós szombatok, áthelyezett pihenőnapok,
//   saját műszak hetente, saját és kollégák szabadsága
// - Szabadság: bejelölés napra koppintva, éves keret számláló (privát)
// - Műszakom: 3 műszakos heti forgás beállítása (csak ezen a telefonon)
// Firestore: leave/{uid} (mindenki olvassa), leaveQuota/{uid} (csak a saját)
// ============================================================
import { ready } from './session.js';
import { db, collection, doc, onSnapshot, getDoc, setDoc, serverTimestamp } from './firebase.js';
import { cachedSettings, loadSettings } from './features.js';
import { esc, $, feedback, toast, openSheet, closeSheet, setPageTabs, selectPageTab } from './ui.js';
import { registerHelp } from './help.js';
import { avatar } from './avatar.js';
import { track } from './track.js';
import {
    BUILTIN_SWAPS, MONTHS, DAYS_SHORT, SHIFTS, ORDERS,
    iso, parseIso, addDays, today, dow, mondayOf, fmtDay, fmtLong,
    dayInfo, nextHoliday, shiftForDate, groupRanges, fmtRange
} from './hu-calendar.js';

const session = await ready;
const uid = session.uid;

const SHIFT_KEY = `qube_shift_${uid}`;
const LEAVE_CACHE = 'qube_leave_cache';
const QUOTA_CACHE = `qube_quota_${uid}`;

const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* tele */ } };

// ============================================================
// ÁLLAPOT
// ============================================================
let swaps = { ...BUILTIN_SWAPS };
let shiftCfg = load(SHIFT_KEY, null);          // { mode, order, refMonday, refShift }
let leaves = load(LEAVE_CACHE, {});            // { uid: { name, days: [iso] } }
let quota = load(QUOTA_CACHE, {});             // { '2026': 25 }
let view = new Date(today().getFullYear(), today().getMonth(), 1);
let qYear = today().getFullYear();

const applySwaps = (s) => {
    const out = { ...BUILTIN_SWAPS };
    Object.entries(s?.calendar?.swaps || {}).forEach(([k, v]) => { if (v === 'none') delete out[k]; else out[k] = v; });
    swaps = out;
};
applySwaps(cachedSettings());

const myDays = () => new Set(leaves[uid]?.days || []);
const othersOn = (k) => Object.entries(leaves)
    .filter(([id, l]) => id !== uid && l.days?.includes(k))
    .map(([id, l]) => ({ id, name: l.name || '?' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

// ============================================================
// MA KÁRTYA
// ============================================================
const shiftBadge = (s) => s ? `<span class="sh-badge ${SHIFTS[s].cls}">${SHIFTS[s].short}</span>` : '';

const renderToday = () => {
    const t = today();
    const info = dayInfo(t, swaps);
    const mine = myDays().has(iso(t));
    const s = shiftForDate(t, shiftCfg);
    let main;
    if (mine) main = '🏖️ Szabadságon vagy';
    else if (info.type === 'holiday') main = `🎉 ${esc(info.name)}`;
    else if (info.type === 'restSwap') main = '😌 Áthelyezett pihenőnap';
    else if (info.type === 'weekend') main = '😌 Hétvége';
    else if (s && s !== 'NAP') main = `${shiftBadge(s)} ${SHIFTS[s].label} · ${SHIFTS[s].time}`;
    else main = info.type === 'workSat' ? '🛠️ Ledolgozós munkanap' : '🛠️ Munkanap';

    const nh = nextHoliday(addDays(t, 1));
    const others = othersOn(iso(t)).length;
    const setup = !shiftCfg ? '<button class="today-setup" id="goShift">Állítsd be a műszakodat →</button>' : '';
    $('#todayCard').innerHTML = `
        <div class="today-date">Ma · ${esc(fmtLong(t))}</div>
        <div class="today-main">${main}</div>
        <div class="today-sub">
            ${nh ? `<span>🎉 ${esc(nh.name)}: ${esc(fmtDay(nh.date))} (${nh.inDays + 1} nap múlva)</span>` : ''}
            ${others ? `<span>🏖️ Ma ${others} kolléga szabadságon</span>` : ''}
        </div>
        ${setup}`;
    $('#goShift')?.addEventListener('click', () => selectPageTab('shift'));
};

// ============================================================
// HAVI NAPTÁR
// ============================================================
const renderCal = () => {
    $('#calTitle').textContent = `${view.getFullYear()}. ${MONTHS[view.getMonth()]}`;
    const first = mondayOf(view);
    const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
    const mine = myDays();
    const tk = iso(today());
    const showShift = shiftCfg && shiftCfg.mode === '3';

    let html = `<div class="cal-head ${showShift ? '' : 'no-shift'}">${showShift ? '<span></span>' : ''}${DAYS_SHORT.map((d, i) => `<span class="${i >= 5 ? 'we' : ''}">${d}</span>`).join('')}</div>`;
    for (let w = first; w <= last; w = addDays(w, 7)) {
        html += `<div class="cal-week ${showShift ? '' : 'no-shift'}">`;
        if (showShift) { const s = shiftForDate(w, shiftCfg); html += `<span class="cal-shift">${shiftBadge(s)}</span>`; }
        for (let i = 0; i < 7; i++) {
            const d = addDays(w, i);
            const k = iso(d);
            const info = dayInfo(d, swaps);
            const others = othersOn(k).length;
            const cls = [
                'cal-day',
                `t-${info.type}`,
                d.getMonth() !== view.getMonth() ? 'out' : '',
                k === tk ? 'today' : '',
                mine.has(k) ? 'leave' : ''
            ].filter(Boolean).join(' ');
            html += `<button class="${cls}" data-d="${k}" title="${esc(info.name)}">
                <span class="n">${d.getDate()}</span>
                ${others ? `<span class="oth">${others}</span>` : ''}
                ${info.type === 'workSat' ? '<span class="mk">M</span>' : ''}
            </button>`;
        }
        html += '</div>';
    }
    $('#calGrid').innerHTML = html;
};

const stepMonth = (n) => { feedback(); view = new Date(view.getFullYear(), view.getMonth() + n, 1); renderCal(); };
$('#calPrev').addEventListener('click', () => stepMonth(-1));
$('#calNext').addEventListener('click', () => stepMonth(1));
$('#calTitle').addEventListener('click', () => { feedback(); view = new Date(today().getFullYear(), today().getMonth(), 1); renderCal(); });

// Lapozás ujjal
let touchX = null;
$('#calGrid').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#calGrid').addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) stepMonth(dx < 0 ? 1 : -1);
});

// ---------- Nap részletei ----------
const TYPE_LABEL = {
    holiday: '🎉 Munkaszüneti nap',
    workSat: '🛠️ Ledolgozós (áthelyezett) munkanap',
    restSwap: '😌 Áthelyezett pihenőnap',
    weekend: '😌 Hétvége',
    work: '🛠️ Munkanap'
};

const openDay = (k) => {
    const d = parseIso(k);
    const info = dayInfo(d, swaps);
    const mine = myDays().has(k);
    const s = info.workday ? shiftForDate(d, shiftCfg) : null;
    const others = othersOn(k);
    feedback();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-1">${esc(fmtLong(d))}</h5>
        <div class="mb-3">${TYPE_LABEL[info.type]}${info.type === 'holiday' ? ` – <b>${esc(info.name)}</b>` : ''}</div>
        ${s && !mine ? `<div class="day-row">${shiftBadge(s)} <b>${SHIFTS[s].label}</b> ${SHIFTS[s].time ? `· ${SHIFTS[s].time}` : ''}</div>` : ''}
        ${info.workday ? `
            <button class="btn ${mine ? 'btn-outline-danger' : 'btn-primary'} w-100 mb-3" id="dayLeave">
                ${mine ? 'Szabadság törlése erről a napról' : '🏖️ Szabadságon leszek ezen a napon'}
            </button>` : (mine ? `<button class="btn btn-outline-danger w-100 mb-3" id="dayLeave">Szabadság törlése erről a napról</button>` : '')}
        <h6 class="fw-bold mb-2">Kollégák szabadságon</h6>
        <div class="mb-3">${others.length ? others.map((o) => `<span class="name-chip with-av">${avatar(o.id, o.name, 'xs')}${esc(o.name)}</span>`).join('') : '<span class="text-muted small">Senki</span>'}</div>
        <button class="btn btn-light w-100" id="dayClose">Bezárás</button>`);
    $('#dayClose', sheet).addEventListener('click', closeSheet);
    $('#dayLeave', sheet)?.addEventListener('click', () => toggleLeave(k));
};

$('#calGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (b) openDay(b.dataset.d);
});

// ============================================================
// SZABADSÁG
// ============================================================
const toggleLeave = async (k) => {
    if (!navigator.onLine) { feedback('error'); return toast('A szabadság bejelöléséhez internet kell.', 'error'); }
    const days = myDays();
    const adding = !days.has(k);
    if (adding) days.add(k); else days.delete(k);
    // Csak a tavalyi év elejétől őrizzük meg (ne nőjön a végtelenségig)
    const keepFrom = `${today().getFullYear() - 1}-01-01`;
    const list = [...days].filter((x) => x >= keepFrom).sort();
    const prev = leaves[uid];
    leaves = { ...leaves, [uid]: { name: session.user.name, days: list } };
    renderAll();
    closeSheet();
    try {
        await setDoc(doc(db, 'leave', uid), { uid, name: session.user.name, days: list, updatedAt: serverTimestamp() });
        feedback('success');
        track(adding ? 'leave-add' : 'leave-remove', k);
        toast(adding ? 'Szabadság bejelölve 🏖️' : 'Szabadság törölve', 'success');
    } catch (e) {
        console.error(e);
        leaves = { ...leaves, [uid]: prev || { name: session.user.name, days: [] } };
        renderAll();
        feedback('error'); toast('Nem sikerült menteni.', 'error');
    }
};

const usedInYear = (y) => [...myDays()].filter((k) => k.startsWith(`${y}-`) && dayInfo(parseIso(k), swaps).workday).length;

const renderLeave = () => {
    // Keret
    $('#qTitle').textContent = `${qYear}. évi szabadság`;
    const used = usedInYear(qYear);
    const total = Number(quota[qYear]) || 0;
    $('#qUsed').textContent = used;
    $('#qTotal').textContent = total || '–';
    $('#qLeft').textContent = total ? total - used : '–';
    $('#qLeft').classList.toggle('text-danger', total > 0 && total - used < 0);
    $('#qBar').style.width = `${total ? Math.min(100, Math.round(used / total * 100)) : 0}%`;

    // Saját (mától)
    const tk = iso(today());
    const mine = groupRanges([...myDays()].filter((k) => k >= tk), swaps);
    $('#myLeave').innerHTML = mine.length ? mine.map((r) => `
        <div class="leave-row"><span class="fw-bold">${esc(fmtRange(r))}</span><span class="text-muted small">${r.count} nap</span></div>`).join('')
        : '<div class="text-muted small p-2">Nincs tervezett szabadságod. Koppints egy napra a naptárban a bejelöléshez.</div>';

    // Kollégák (mától)
    const rows = [];
    Object.entries(leaves).forEach(([id, l]) => {
        if (id === uid) return;
        groupRanges((l.days || []).filter((k) => k >= tk), swaps).forEach((r) => rows.push({ id, name: l.name || '?', r }));
    });
    rows.sort((a, b) => a.r.start - b.r.start || a.name.localeCompare(b.name, 'hu'));
    $('#othersLeave').innerHTML = rows.length ? rows.map(({ id, name, r }) => `
        <div class="leave-row"><span class="d-flex align-items-center gap-2">${avatar(id, name, 'sm')}<span><span class="fw-bold">${esc(name)}</span><br><span class="text-muted small">${esc(fmtRange(r))}</span></span></span><span class="text-muted small">${r.count} nap</span></div>`).join('')
        : '<div class="text-muted small p-2">Nincs tervezett szabadság.</div>';
};

$('#qPrev').addEventListener('click', () => { feedback(); qYear--; renderLeave(); });
$('#qNext').addEventListener('click', () => { feedback(); qYear++; renderLeave(); });
$('#qEdit').addEventListener('click', () => {
    feedback();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">${qYear}. évi szabadságkeret</h5>
        <label class="form-label" for="qInput">Hány nap szabadságod van idén?</label>
        <input type="number" id="qInput" class="form-control form-control-lg mb-1" inputmode="numeric" min="0" max="60" value="${Number(quota[qYear]) || ''}" placeholder="Pl. 25">
        <div class="text-muted tiny mb-3">Alapszabadság + pótszabadságok együtt. Csak te látod.</div>
        <div class="d-flex gap-2">
            <button class="btn btn-light flex-grow-1" id="qClose">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="qSave">Mentés</button>
        </div>`);
    $('#qClose', sheet).addEventListener('click', closeSheet);
    $('#qSave', sheet).addEventListener('click', async () => {
        const n = parseInt($('#qInput', sheet).value, 10);
        if (!Number.isInteger(n) || n < 0 || n > 60) { feedback('error'); return toast('0 és 60 közötti szám kell.', 'error'); }
        quota = { ...quota, [qYear]: n };
        store(QUOTA_CACHE, quota);
        renderLeave(); closeSheet();
        try { await setDoc(doc(db, 'leaveQuota', uid), { quota }); feedback('success'); toast('Keret mentve ✓', 'success'); }
        catch (e) { console.warn(e); toast('Elmentve ezen a telefonon.'); }
    });
});

// ============================================================
// MŰSZAKOM
// ============================================================
$('#shOrder').innerHTML = Object.entries(ORDERS).map(([k, o]) => `<option value="${k}">${esc(o.label)}</option>`).join('');

const saveShift = (cfg) => {
    track('shift', cfg?.mode || '');
    shiftCfg = cfg;
    if (cfg) store(SHIFT_KEY, cfg); else localStorage.removeItem(SHIFT_KEY);
    renderAll();
};

const renderShift = () => {
    const mode = shiftCfg?.mode || 'none';
    $('#shMode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === (shiftCfg ? mode : '')));
    $('#sh3').classList.toggle('hidden', mode !== '3');
    if (mode !== '3') return;
    const nowShift = shiftForDate(today(), shiftCfg);
    $('#shNow').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.s === nowShift));
    $('#shOrder').value = shiftCfg.order;
    const m = mondayOf(today());
    $('#shPreview').innerHTML = Array.from({ length: 6 }, (_, i) => {
        const w = addDays(m, i * 7);
        const s = shiftForDate(w, shiftCfg);
        return `<div class="leave-row"><span>${i === 0 ? '<b>Ez a hét</b>' : `${esc(fmtDay(w))} – ${esc(fmtDay(addDays(w, 6)))}`}</span><span>${shiftBadge(s)} ${SHIFTS[s].label}</span></div>`;
    }).join('');
};

$('#shMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    feedback();
    const mode = b.dataset.mode;
    if (mode === '3') saveShift({ mode: '3', order: shiftCfg?.order || 'DE-DU-E', refMonday: iso(mondayOf(today())), refShift: shiftCfg?.mode === '3' ? shiftForDate(today(), shiftCfg) : 'DE' });
    else saveShift({ mode });
    toast('Mentve ✓', 'success');
});
$('#shNow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    feedback();
    saveShift({ ...shiftCfg, refMonday: iso(mondayOf(today())), refShift: b.dataset.s });
});
$('#shOrder').addEventListener('change', () => {
    feedback();
    // A mostani hét műszakja marad, csak a sorrend változik
    saveShift({ ...shiftCfg, order: $('#shOrder').value, refMonday: iso(mondayOf(today())), refShift: shiftForDate(today(), shiftCfg) });
});

// ============================================================
// ADATOK + INDÍTÁS
// ============================================================
function renderAll() { renderToday(); renderCal(); renderLeave(); renderShift(); }

onSnapshot(collection(db, 'leave'), (snap) => {
    if (snap.metadata?.fromCache && snap.empty) return; // offline: marad a tárolt
    const next = {};
    snap.docs.forEach((d) => { const x = d.data(); next[d.id] = { name: x.name, days: Array.isArray(x.days) ? x.days : [] }; });
    leaves = next;
    store(LEAVE_CACHE, leaves);
    renderAll();
}, (e) => console.warn('Szabadságok nem tölthetők be', e));

getDoc(doc(db, 'leaveQuota', uid)).then((s) => {
    if (s.exists() && s.data().quota) { quota = { ...s.data().quota, ...quota }; store(QUOTA_CACHE, quota); renderLeave(); }
}).catch(() => {});

loadSettings().then((s) => { applySwaps(s); renderAll(); });

setPageTabs([
    { id: 'cal', icon: '📅', label: 'Naptár' },
    { id: 'leave', icon: '🏖️', label: 'Szabadság' },
    { id: 'shift', icon: '🔄', label: 'Műszakom' }
], (id) => {
    ['cal', 'leave', 'shift'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== id));
    window.scrollTo(0, 0);
});
registerHelp('calendar');
renderAll();
