// ============================================================
// Kezdőlap: modul-csempék a jogosultságok alapján
// ============================================================
import { ready } from './session.js';
import { MODULES } from './config.js';
import { esc, $, feedback, toast } from './ui.js';
import { cachedSettings, loadSettings } from './features.js';
import { adventDay, openAdvent, openedKey, startSnow, az } from './advent.js';

const session = await ready;

const firstName = (session.user.name || '').split(' ').slice(-1)[0];
$('#greeting').textContent = `Szia, ${firstName}!`;
$('#roleLine').textContent = session.roleLabel;

if (session.roleMissing) {
    $('#notice').innerHTML = `<div class="notice">A(z) „${esc(session.role)}” szerepkör még nincs beállítva. Szólj az adminnak.</div>`;
} else if (session.isAdmin) {
    // Admin figyelmeztetés, ha a szerepkörök még nincsenek feltöltve.
    // Nem várunk rá: a csempék azonnal megjelennek, ez a háttérben fut.
    checkRolesSeeded();
}

async function checkRolesSeeded() {
    try {
        const { db, collection, getDocs, limit, query } = await import('./firebase.js');
        const snap = await getDocs(query(collection(db, 'roles'), limit(1)));
        if (snap.empty) {
            $('#notice').innerHTML = `<a class="notice" href="admin.html#roles">⚠️ A szerepkörök még nincsenek feltöltve. Koppints ide a beállításhoz.</a>`;
        }
    } catch { /* nem kritikus */ }
}

const visible = MODULES.filter((m) => session.can(m.perm));
$('#tiles').innerHTML = visible.length
    ? visible.map((m) => `
        <button class="dashboard-tile tile-${esc(m.color)} ${m.ready ? '' : 'tile-soon'}" data-id="${esc(m.id)}">
            <div class="tile-icon">${m.icon}</div>
            <div class="tile-title">${esc(m.title)}</div>
            <div class="tile-desc">${m.ready ? esc(m.desc) : 'Hamarosan'}</div>
        </button>`).join('')
    : `<div class="text-muted small">Jelenleg nincs elérhető modul a szerepkörödhöz.</div>`;

$('#tiles').addEventListener('click', (e) => {
    const tile = e.target.closest('.dashboard-tile');
    if (!tile) return;
    const m = MODULES.find((x) => x.id === tile.dataset.id);
    if (!m.ready) { feedback('error'); return toast('Ez a modul még fejlesztés alatt van.'); }
    feedback();
    location.href = m.href;
});

// ============================================================
// Admin által bekapcsolható funkciók (Beállítások oldal)
// ============================================================
let settings = null;

const renderFeatures = () => {
    const box = $('#features');
    const day = adventDay();
    const a = settings?.advent;
    if (!a?.enabled || !day) { box.innerHTML = ''; return; }

    const opened = (() => { try { return JSON.parse(localStorage.getItem(openedKey(session.uid))) || []; } catch { return []; } })();
    const todayDone = opened.includes(day);
    const xmas = new Date().getDate() >= 25;
    box.innerHTML = `
        <button class="advent-card" id="adventCard">
            <span class="advent-card-ico">🎄</span>
            <span class="text-start">
                <span class="d-block fw-bold">Adventi naptár</span>
                <span class="d-block small">${xmas ? 'Boldog karácsonyt! 🎁' : todayDone ? `${az(day) === 'az' ? 'Az' : 'A'} ${day}. ablak már nyitva ✓` : `Ma ${az(day)} ${day}. ablak vár rád!`}</span>
            </span>
            ${!todayDone && !xmas ? '<span class="advent-dot"></span>' : ''}
        </button>`;
    $('#adventCard').addEventListener('click', () => {
        feedback();
        openAdvent({ day, messages: a.messages, key: openedKey(session.uid) });
    });
    if (a.snow) startSnow();
};

// Bezáráskor frissüljön a kártya felirata (mai ablak kinyitva)
$('#sheetOverlay').addEventListener('click', () => setTimeout(renderFeatures, 50), true);

settings = cachedSettings();
renderFeatures();
loadSettings().then((s) => { settings = s; renderFeatures(); });
