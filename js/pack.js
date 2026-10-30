// ============================================================
// Csomagoló kód
// Egy számkód, CSAK ezen a telefonon tárolva (Qube-fiókonként külön),
// a szerverre nem kerül fel. A QR pontosan a számot tartalmazza –
// nincs utána TAB, ENTER vagy F4.
// ============================================================
import { ready } from './session.js';
import { $, feedback, toast, setPageTabs } from './ui.js';

const session = await ready;

const KEY = `qube_pack_${session.uid}`;
const TIMEOUT_KEY = 'qube_pack_timeout';
const DEFAULT_TIMEOUT = 30;
const CODE_PATTERN = /^[0-9]{1,30}$/;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = (v) => localStorage.setItem(KEY, JSON.stringify(v));

// ---------- Nézetek ----------
const render = () => {
    const d = load();
    const has = !!d?.code;
    $('#viewCard').classList.toggle('hidden', !has);
    $('#viewForm').classList.toggle('hidden', has);
    if (has) $('#cardCode').textContent = d.code;
};

const openForm = () => {
    const d = load();
    $('#packCode').value = d?.code || '';
    $('#cancelBtn').classList.toggle('hidden', !d);
    $('#deleteBtn').classList.toggle('hidden', !d);
    $('#viewCard').classList.add('hidden');
    $('#viewForm').classList.remove('hidden');
    $('#packCode').focus();
};

$('#editBtn').addEventListener('click', () => { feedback(); openForm(); });
$('#cancelBtn').addEventListener('click', () => { feedback(); render(); });

// Csak számjegy maradjon a mezőben (beillesztésnél is)
$('#packCode').addEventListener('input', (e) => {
    const clean = e.target.value.replace(/\D/g, '');
    if (clean !== e.target.value) e.target.value = clean;
});

$('#saveBtn').addEventListener('click', () => {
    const code = $('#packCode').value.trim();
    if (!CODE_PATTERN.test(code)) { feedback('error'); return toast('Adj meg egy számkódot!', 'error'); }
    try {
        save({ code });
    } catch {
        feedback('error'); return toast('Nem sikerült menteni (privát böngészés?).', 'error');
    }
    feedback('success'); toast('Elmentve ezen a telefonon', 'success');
    render();
});

$('#deleteBtn').addEventListener('click', () => {
    if (!confirm('Törlöd a csomagoló kódot erről a telefonról?')) return;
    localStorage.removeItem(KEY);
    $('#packCode').value = '';
    feedback('success'); toast('Kód törölve');
    $('#cancelBtn').classList.add('hidden');
    $('#deleteBtn').classList.add('hidden');
});

// ---------- QR időkorlát (egyéni beállítás) ----------
const timeoutSel = $('#qrTimeout');
const getTimeout = () => {
    const v = localStorage.getItem(TIMEOUT_KEY);
    return v === null ? DEFAULT_TIMEOUT : parseInt(v, 10) || 0;
};
timeoutSel.value = String(getTimeout());
if (!timeoutSel.value) timeoutSel.value = String(DEFAULT_TIMEOUT);
timeoutSel.addEventListener('change', () => {
    localStorage.setItem(TIMEOUT_KEY, timeoutSel.value);
    feedback(); toast('Beállítás mentve');
});

// ---------- QR megjelenítés ----------
let timer = null;
let wakeLock = null;

const closeQr = () => {
    clearInterval(timer); timer = null;
    $('#packQr').innerHTML = '';
    $('#qrFullscreen').classList.add('hidden');
    document.body.classList.remove('qr-open');
    wakeLock?.release?.().catch(() => {}); wakeLock = null;
};

const showQr = async () => {
    const d = load();
    if (!d?.code) return openForm();
    if (typeof QRCode === 'undefined') { feedback('error'); return toast('A QR modul nem töltődött be. Frissíts!', 'error'); }

    feedback('success');
    $('#packQr').innerHTML = '';
    new QRCode($('#packQr'), { text: d.code, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
    $('#packQrText').textContent = d.code;
    $('#qrFullscreen').classList.remove('hidden');
    document.body.classList.add('qr-open');

    // Amíg a QR látszik, ne aludjon el a kijelző
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }

    const total = getTimeout();
    const bar = $('#countdownBar');
    const text = $('#countdownText');
    $('#countdown').classList.toggle('hidden', !total);
    if (!total) { text.textContent = ''; return; }

    const end = Date.now() + total * 1000;
    const tick = () => {
        const left = Math.max(0, end - Date.now());
        bar.style.width = `${(left / (total * 1000)) * 100}%`;
        text.textContent = `Eltűnik ${Math.ceil(left / 1000)} mp múlva`;
        if (!left) closeQr();
    };
    clearInterval(timer);
    tick();
    timer = setInterval(tick, 250);
};

$('#showQrBtn').addEventListener('click', showQr);
$('#qrClose').addEventListener('click', () => { feedback(); closeQr(); });
// Háttérbe tett appnál eltűnik (kivéve "Csak ha bezárom" beállításnál)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && getTimeout() > 0) closeQr();
});

// Alsó menü: Kezdőlap · Csomagoló
setPageTabs([{ id: 'pack', icon: '📦', label: 'Csomagoló QR' }], () => {});
render();
