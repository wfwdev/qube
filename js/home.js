// ============================================================
// Kezdőlap: modul-csempék a jogosultságok alapján
// ============================================================
import { ready } from './session.js';
import { MODULES } from './config.js';
import { esc, $, feedback, toast } from './ui.js';

const session = await ready;

const firstName = (session.user.name || '').split(' ').slice(-1)[0];
$('#greeting').textContent = `Szia, ${firstName}!`;
$('#roleLine').textContent = session.roleLabel;

if (session.roleMissing) {
    $('#notice').innerHTML = `<div class="notice">A(z) „${esc(session.role)}” szerepkör még nincs beállítva. Szólj az adminnak.</div>`;
} else if (session.isAdmin) {
    // Admin figyelmeztetés, ha a szerepkörök még nincsenek feltöltve
    const { db, collection, getDocs, limit, query } = await import('./firebase.js');
    const snap = await getDocs(query(collection(db, 'roles'), limit(1))).catch(() => null);
    if (snap && snap.empty) {
        $('#notice').innerHTML = `<a class="notice" href="admin.html#roles">⚠️ A szerepkörök még nincsenek feltöltve. Koppints ide a beállításhoz.</a>`;
    }
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
