// ============================================================
// MES terminál – belépő QR
// A MES felhasználónév és jelszó CSAK ezen a telefonon tárolódik
// (localStorage, Qube-fiókonként külön), a szerverre nem kerül fel.
// QR tartalma: felhasználónév + TAB + jelszó + ENTER (a terminál így
// magától kitölti a két mezőt és belép).
// ============================================================
import { ready } from './session.js';
import { $, feedback, toast, setPageTabs } from './ui.js';

const session = await ready;

const KEY = `qube_mes_${session.uid}`;
const TIMEOUT_KEY = 'qube_mes_timeout';
const DEFAULT_TIMEOUT = 30;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = (v) => localStorage.setItem(KEY, JSON.stringify(v));

// ---------- Nézetek ----------
const render = () => {
    const d = load();
    const has = !!(d?.user && d?.pass);
    $('#viewCard').classList.toggle('hidden', !has);
    $('#viewForm').classList.toggle('hidden', has);
    if (has) $('#cardUser').textContent = d.user;
};

const openForm = () => {
    const d = load();
    $('#mesUser').value = d?.user || '';
    $('#mesPass').value = d?.pass || '';
    $('#mesPass').type = 'password';
    $('#cancelBtn').classList.toggle('hidden', !d);
    $('#deleteBtn').classList.toggle('hidden', !d);
    $('#viewCard').classList.add('hidden');
    $('#viewForm').classList.remove('hidden');
};

$('#editBtn').addEventListener('click', () => { feedback(); openForm(); });
$('#cancelBtn').addEventListener('click', () => { feedback(); render(); });
$('#passEye').addEventListener('click', () => {
    const p = $('#mesPass');
    p.type = p.type === 'password' ? 'text' : 'password';
});

$('#saveBtn').addEventListener('click', () => {
    const user = $('#mesUser').value.trim();
    const pass = $('#mesPass').value; // a jelszó szóközt is tartalmazhat – nem vágjuk
    if (!user || !pass) { feedback('error'); return toast('Mindkét mezőt ki kell tölteni!', 'error'); }
    if (/[\t\r\n]/.test(user + pass)) { feedback('error'); return toast('Tabulátor / sortörés nem lehet benne.', 'error'); }
    try {
        save({ user, pass });
    } catch {
        feedback('error'); return toast('Nem sikerült menteni (privát böngészés?).', 'error');
    }
    feedback('success'); toast('Elmentve ezen a telefonon 🔒', 'success');
    render();
});

$('#deleteBtn').addEventListener('click', () => {
    if (!confirm('Törlöd a MES belépési adatokat erről a telefonról?')) return;
    localStorage.removeItem(KEY);
    $('#mesUser').value = ''; $('#mesPass').value = '';
    feedback('success'); toast('Adatok törölve');
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
    $('#mesQr').innerHTML = ''; // a jelszó ne maradjon a képernyőn / DOM-ban
    $('#qrFullscreen').classList.add('hidden');
    document.body.classList.remove('qr-open');
    wakeLock?.release?.().catch(() => {}); wakeLock = null;
};

const showQr = async () => {
    const d = load();
    if (!d?.user || !d?.pass) return openForm();
    if (typeof QRCode === 'undefined') { feedback('error'); return toast('A QR modul nem töltődött be. Frissíts!', 'error'); }

    feedback('success');
    $('#mesQr').innerHTML = '';
    new QRCode($('#mesQr'), { text: `${d.user}\t${d.pass}\r`, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
    $('#mesQrUser').textContent = d.user;
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

// Alsó menü: Kezdőlap · MES
setPageTabs([{ id: 'mes', icon: '💻', label: 'Belépő QR' }], () => {});
render();
