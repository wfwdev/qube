// ============================================================
// MES terminál – belépő QR
// A MES felhasználónév és jelszó CSAK ezen a telefonon tárolódik
// (localStorage, Qube-fiókonként külön), a szerverre nem kerül fel.
// QR tartalma: felhasználónév + TAB + jelszó + beállítható lezárás
// (alapból F4 – Honeywell olvasóval).
// ============================================================
import { ready } from './session.js';
import { $, feedback, toast, setPageTabs } from './ui.js';

const session = await ready;

const KEY = `qube_mes_${session.uid}`;
const TIMEOUT_KEY = 'qube_mes_timeout';
const SUFFIX_KEY = 'qube_mes_suffix';
const AFTER_TAB_KEY = 'qube_mes_aftertab'; // F4 után még egy TAB (a következő fülre lép)
// Honeywell olvasók (pl. Xenon XP 1950g): a 0x19 (EM) vezérlőkaraktert gyárilag
// F4 billentyűként küldik (Function Code Transmit = Enable, Control+X mód kikapcsolva).
const SUFFIXES = {
    'f4-sep': '',        // F4 külön, második QR-ban (AltGr-es jelszónál is biztos)
    'f4': '\x19',
    'tab-enter': '\t\r',
    'tab-space': '\t ',
    'tab2-enter': '\t\t\r',
    'enter': '\r',
    'none': ''
};
const DEFAULT_SUFFIX = 'f4-sep';
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

// ---------- Lezárás (egyéni beállítás) ----------
const suffixSel = $('#qrSuffix');
const getSuffixId = () => {
    const v = localStorage.getItem(SUFFIX_KEY);
    return v in SUFFIXES ? v : DEFAULT_SUFFIX;
};
suffixSel.value = getSuffixId();
const afterTab = () => localStorage.getItem(AFTER_TAB_KEY) !== 'false'; // alapból bekapcsolva
const afterTabChk = $('#afterTab');
afterTabChk.checked = afterTab();
afterTabChk.addEventListener('change', () => {
    localStorage.setItem(AFTER_TAB_KEY, afterTabChk.checked);
    feedback(); toast('Beállítás mentve');
});

suffixSel.addEventListener('change', () => {
    localStorage.setItem(SUFFIX_KEY, suffixSel.value);
    feedback(); toast('Beállítás mentve');
});

// ---------- QR megjelenítés ----------
let timer = null;
let wakeLock = null;

const closeQr = () => {
    clearInterval(timer); timer = null;
    $('#mesQr').innerHTML = ''; // a jelszó ne maradjon a képernyőn / DOM-ban
    $('#mesQr2').innerHTML = '';
    $('#qrFullscreen').classList.add('hidden');
    document.body.classList.remove('qr-open');
    wakeLock?.release?.().catch(() => {}); wakeLock = null;
};

// test = 'f4': csak egy F4 billentyűt tartalmazó teszt-QR (hibakereséshez)
const showQr = async (test = null) => {
    const d = load();
    if (!test && (!d?.user || !d?.pass)) return openForm();
    if (typeof QRCode === 'undefined') { feedback('error'); return toast('A QR modul nem töltődött be. Frissíts!', 'error'); }

    feedback('success');
    $('#mesQr').innerHTML = '';
    const tail = afterTab() ? '\t' : '';
    const sid = getSuffixId();
    const content = test === 'f4' ? SUFFIXES.f4 : `${d.user}\t${d.pass}${SUFFIXES[sid]}${sid === 'f4' ? tail : ''}`;
    new QRCode($('#mesQr'), { text: content, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });

    // Külön F4 QR: 1. csippantás kitölti a mezőket, 2. csippantás belép
    const sep = !test && getSuffixId() === 'f4-sep';
    $('#mesQr2').innerHTML = '';
    if (sep) new QRCode($('#mesQr2'), { text: SUFFIXES.f4 + tail, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
    $('#qrBox2').classList.toggle('hidden', !sep);
    $('#qrStep1').classList.toggle('hidden', !sep);
    document.querySelector('#qrFullscreen .qr-scroll-area').classList.toggle('two', sep);
    $('#mesQrUser').textContent = test === 'f4' ? 'TESZT: csak F4' : d.user;
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

$('#showQrBtn').addEventListener('click', () => showQr());
$('#testF4Btn').addEventListener('click', () => showQr('f4'));
$('#qrClose').addEventListener('click', () => { feedback(); closeQr(); });
// Háttérbe tett appnál eltűnik (kivéve "Csak ha bezárom" beállításnál)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && getTimeout() > 0) closeQr();
});

// Alsó menü: Kezdőlap · MES
setPageTabs([{ id: 'mes', icon: '💻', label: 'Belépő QR' }], () => {});
render();
