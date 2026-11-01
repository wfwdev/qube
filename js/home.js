// ============================================================
// Kezdőlap: modul-csempék a jogosultságok alapján
// ============================================================
import { ready } from './session.js';
import { MODULES } from './config.js';
import { esc, $, feedback, toast } from './ui.js';
import { cachedSettings, loadSettings } from './features.js';
import { flushFeedback } from './feedback-store.js';
import { adventDay, adventTeaser, daysUntilAdvent, openAdvent, openedKey, showPop, startSnow, az } from './advent.js';

const session = await ready;

const firstName = (session.user.name || '').split(' ').slice(-1)[0];
$('#greeting').textContent = `Szia, ${firstName}!`;
$('#roleLine').textContent = session.roleLabel;

if (session.roleMissing) {
    $('#notice').innerHTML = `<div class="notice">A szerepköröd még nincs beállítva – az adminisztrátor hamarosan beállítja.</div>`;
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

const visible = MODULES.filter((m) => !m.perm || session.can(m.perm));
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
    const icon = $('#greetIcon');
    const day = adventDay();
    const teaser = adventTeaser();
    const a = settings?.advent;
    if (!a?.enabled || (!day && !teaser)) { box.innerHTML = ''; icon.innerHTML = ''; return; }

    // November 15–30.: csak az ikon a név mellett – "készül valami"
    if (teaser) {
        box.innerHTML = '';
        const n = daysUntilAdvent();
        icon.innerHTML = '<button class="greet-icon teaser" id="adventIcon" aria-label="Meglepetés">🎄</button>';
        $('#adventIcon').addEventListener('click', () => {
            feedback();
            showPop({
                emoji: '🎁',
                title: 'Valami készül…',
                body: `December 1-jén kinyílik a Qube adventi naptára! Minden nap egy új ablak vár rád. Még ${n} nap!`,
                button: 'Várom!'
            });
        });
        return;
    }

    // December: ikon a név mellett + kártya
    const opened = (() => { try { return JSON.parse(localStorage.getItem(openedKey(session.uid))) || []; } catch { return []; } })();
    const todayDone = opened.includes(day);
    const xmas = new Date().getDate() >= 25;
    const open = () => { feedback(); openAdvent({ day, messages: a.messages, key: openedKey(session.uid) }); };

    icon.innerHTML = `<button class="greet-icon" id="adventIcon" aria-label="Adventi naptár">🎄${!todayDone && !xmas ? '<span class="advent-dot"></span>' : ''}</button>`;
    $('#adventIcon').addEventListener('click', open);

    box.innerHTML = `
        <button class="advent-card" id="adventCard">
            <span class="advent-card-ico">🎄</span>
            <span class="text-start">
                <span class="d-block fw-bold">Adventi naptár</span>
                <span class="d-block small">${xmas ? 'Boldog karácsonyt! 🎁' : todayDone ? `${az(day) === 'az' ? 'Az' : 'A'} ${day}. ablak már nyitva ✓` : `Ma ${az(day)} ${day}. ablak vár rád!`}</span>
            </span>
            ${!todayDone && !xmas ? '<span class="advent-dot"></span>' : ''}
        </button>`;
    $('#adventCard').addEventListener('click', open);
    if (a.snow) startSnow();
};

// Bezáráskor frissüljön a kártya felirata (mai ablak kinyitva)
$('#sheetOverlay').addEventListener('click', () => setTimeout(renderFeatures, 50), true);

settings = cachedSettings();
renderFeatures();
loadSettings().then((s) => { settings = s; renderFeatures(); });

// Offline beküldött visszajelzések feltöltése
flushFeedback();

// Admin: új visszajelzések száma a csempén
if (session.isAdmin) {
    (async () => {
        try {
            const { db, collection, getDocs, query, where } = await import('./firebase.js');
            const snap = await getDocs(query(collection(db, 'feedback'), where('status', '==', 'new')));
            const n = snap.docs.filter((d) => d.data().status === 'new').length;
            const tile = document.querySelector('.dashboard-tile[data-id="feedback"]');
            if (n && tile) tile.insertAdjacentHTML('beforeend', `<span class="tile-badge">${n}</span>`);
        } catch { /* offline – nem kritikus */ }
    })();
}
