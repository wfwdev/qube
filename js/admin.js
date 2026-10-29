// ============================================================
// Felhasználók és szerepkörök kezelése
// ============================================================
import { ready } from './session.js';
import {
    db, collection, doc, onSnapshot, getDoc, updateDoc, deleteDoc, setDoc, writeBatch
} from './firebase.js';
import { PERMISSIONS, DEFAULT_ROLES, NEW_USER_ROLE, EMP_ID_PATTERN } from './config.js';
import { esc, $, feedback, toast, openSheet, closeSheet } from './ui.js';

const session = await ready;
const canManage = session.can('users.manage');
const isAdmin = session.isAdmin;

let users = [];          // [{ id, ...data }]
let roles = {};          // { roleId: { label, rank, permissions } }
let filter = 'all';
let search = '';

const STATUS = {
    active:   { label: 'Aktív',            cls: 'st-active' },
    conflict: { label: 'Összekapcsolásra vár', cls: 'st-conflict' },
    disabled: { label: 'Letiltva',         cls: 'st-disabled' },
    merged:   { label: 'Áthelyezve',       cls: 'st-merged' }
};

const roleLabel = (id) => roles[id]?.label || (id === 'admin' ? 'Admin' : id);
const sortedRoles = () => Object.entries(roles).sort((a, b) => (b[1].rank || 0) - (a[1].rank || 0));
const fmtTime = (ts) => {
    const d = ts?.toDate?.();
    return d ? d.toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
};
const fail = (e, msg = 'Nem sikerült menteni.') => { console.error(e); feedback('error'); toast(msg, 'error'); };
const ok = (msg) => { feedback('success'); toast(msg, 'success'); };

// Vezető (nem admin) admin fiókot nem kezelhet és nem adhat admin szerepet
const canEditUser = (u) => isAdmin || (canManage && u.role !== 'admin' && u.id !== session.uid);

// ============================================================
// FÜLEK
// ============================================================
const tabs = $('#tabs');
if (!isAdmin) tabs.classList.add('hidden');

const showTab = (name) => {
    ['users', 'roles'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== name));
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
};
tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    feedback(); showTab(b.dataset.tab);
});
showTab(isAdmin && location.hash === '#roles' ? 'roles' : 'users');

// ============================================================
// FELHASZNÁLÓK
// ============================================================
const renderFilters = () => {
    const count = (st) => users.filter((u) => u.status === st).length;
    const chips = [
        ['all', 'Mind', users.filter((u) => u.status !== 'merged').length],
        ['conflict', 'Várakozó', count('conflict')],
        ['disabled', 'Letiltott', count('disabled')]
    ];
    $('#filters').innerHTML = chips.map(([id, label, n]) =>
        `<button class="chip ${filter === id ? 'active' : ''} ${id === 'conflict' && n ? 'chip-alert' : ''}" data-f="${id}">${label} <span>${n}</span></button>`
    ).join('');
};

const renderUsers = () => {
    renderFilters();
    const q = search.toLowerCase();
    const list = users
        .filter((u) => filter === 'all' ? u.status !== 'merged' : u.status === filter)
        .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.empId || '').includes(q))
        .sort((a, b) => (a.status === 'conflict' ? -1 : 0) - (b.status === 'conflict' ? -1 : 0)
            || (a.name || '').localeCompare(b.name || '', 'hu'));

    $('#userList').innerHTML = list.length ? list.map((u) => {
        const st = STATUS[u.status] || { label: u.status, cls: '' };
        return `
        <button class="user-row" data-id="${esc(u.id)}">
            <div class="avatar sm">${esc((u.name || '?').charAt(0).toUpperCase())}</div>
            <div class="flex-grow-1 text-start">
                <div class="fw-bold">${esc(u.name)} ${u.id === session.uid ? '<span class="me-badge">Én</span>' : ''}</div>
                <div class="text-muted tiny">${esc(u.empId)} · ${esc(roleLabel(u.role))} · ${fmtTime(u.lastActive)}</div>
            </div>
            ${u.status !== 'active' ? `<span class="status ${st.cls}">${esc(st.label)}</span>` : ''}
        </button>`;
    }).join('') : `<div class="text-center text-muted small py-4">Nincs találat.</div>`;
};

$('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    feedback(); filter = b.dataset.f; renderUsers();
});
$('#userSearch').addEventListener('input', (e) => { search = e.target.value.trim(); renderUsers(); });
$('#userList').addEventListener('click', (e) => {
    const row = e.target.closest('.user-row');
    if (row) openUser(row.dataset.id);
});

// ---------- Felhasználó lap ----------
const openUser = (id) => {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    feedback();
    const editable = canEditUser(u);
    const st = STATUS[u.status] || { label: u.status, cls: '' };

    const roleOptions = sortedRoles()
        .filter(([rid]) => isAdmin || rid !== 'admin')
        .map(([rid, r]) => `<option value="${esc(rid)}" ${rid === u.role ? 'selected' : ''}>${esc(r.label)}</option>`)
        .join('');

    let body = `
        <div class="d-flex align-items-center gap-3 mb-4">
            <div class="avatar">${esc((u.name || '?').charAt(0).toUpperCase())}</div>
            <div>
                <h5 class="fw-bold mb-0">${esc(u.name)}</h5>
                <div class="text-muted small">Törzsszám: <b>${esc(u.empId)}</b></div>
                <span class="status ${st.cls}">${esc(st.label)}</span>
            </div>
        </div>
        <div class="text-muted tiny mb-3">Regisztrált: ${fmtTime(u.createdAt)} · Utoljára aktív: ${fmtTime(u.lastActive)}</div>`;

    if (u.status === 'conflict') {
        body += isAdmin
            ? `<div class="notice mb-3">Ez a törzsszám már egy másik fiókhoz tartozik. Összekapcsoláskor az új eszköz átveszi a régi fiók szerepkörét, a régi fiók pedig megszűnik.</div>
               <button class="btn btn-primary w-100 mb-2" id="uLink">🔗 Összekapcsolás a régi fiókkal</button>
               <button class="btn btn-light w-100 mb-2" id="uDelete">Elutasítás (törlés, újra regisztrálhat)</button>`
            : `<div class="notice">Az összekapcsolást admin végezheti el.</div>`;
    } else if (u.status === 'merged') {
        body += `<div class="notice">Ez a fiók egy új eszközre lett áthelyezve.</div>`;
        if (isAdmin) body += `<button class="btn btn-outline-danger w-100 mt-3" id="uDelete">Régi fiók törlése</button>`;
    } else if (editable) {
        body += `
            <label class="form-label">Szerepkör</label>
            <select id="uRole" class="form-select mb-3" ${u.id === session.uid ? 'disabled' : ''}>${roleOptions}</select>
            ${u.id === session.uid ? '<div class="text-muted tiny mb-3">A saját szerepkörödet nem módosíthatod.</div>' : ''}
            <label class="setting-row mb-4" for="uActive">
                <div><div class="fw-bold small">Fiók aktív</div><div class="text-muted tiny">Letiltva nem éri el az alkalmazást</div></div>
                <div class="form-check form-switch fs-5 mb-0"><input class="form-check-input" type="checkbox" id="uActive" ${u.status === 'active' ? 'checked' : ''} ${u.id === session.uid ? 'disabled' : ''}></div>
            </label>
            ${isAdmin ? `
            <label class="form-label">Törzsszám javítása</label>
            <div class="d-flex gap-2 mb-4">
                <input type="text" id="uEmp" class="form-control" inputmode="numeric" maxlength="10" value="${esc(u.empId)}">
                <button class="btn btn-light px-3" id="uEmpSave">✓</button>
            </div>` : ''}
            <div class="d-flex gap-2">
                ${isAdmin && u.id !== session.uid ? '<button class="btn btn-outline-danger" id="uDelete">Törlés</button>' : ''}
                <button class="btn btn-light flex-grow-1" id="uClose">Mégsem</button>
                <button class="btn btn-primary flex-grow-1" id="uSave">Mentés</button>
            </div>`;
    } else {
        body += `<div class="text-muted small">Szerepkör: <b>${esc(roleLabel(u.role))}</b></div>
                 <button class="btn btn-light w-100 mt-4" id="uClose">Bezárás</button>`;
    }

    const sheet = openSheet(body);
    $('#uClose', sheet)?.addEventListener('click', closeSheet);
    $('#uSave', sheet)?.addEventListener('click', () => saveUser(u, sheet));
    $('#uEmpSave', sheet)?.addEventListener('click', () => changeEmpId(u, $('#uEmp', sheet).value.trim()));
    $('#uLink', sheet)?.addEventListener('click', () => linkUser(u));
    $('#uDelete', sheet)?.addEventListener('click', () => removeUser(u));
};

const saveUser = async (u, sheet) => {
    const role = $('#uRole', sheet).value || u.role;
    const status = $('#uActive', sheet).checked ? 'active' : 'disabled';
    if (role === u.role && status === u.status) return closeSheet();
    if (!isAdmin && role === 'admin') return fail(null, 'Admin szerepet csak admin adhat.');
    try {
        await updateDoc(doc(db, 'users', u.id), { role, status });
        ok('Mentve ✓'); closeSheet();
    } catch (e) { fail(e); }
};

// Admin: törzsszám javítása (a foglalási táblát is átírja)
const changeEmpId = async (u, empId) => {
    if (empId === u.empId) return;
    if (!EMP_ID_PATTERN.test(empId)) return fail(null, 'Érvénytelen törzsszám!');
    try {
        const newRef = doc(db, 'empIds', empId);
        const taken = await getDoc(newRef);
        if (taken.exists() && taken.data().uid !== u.id) return fail(null, 'Ez a törzsszám már foglalt!');
        const batch = writeBatch(db);
        const oldRef = doc(db, 'empIds', u.empId);
        const old = await getDoc(oldRef);
        if (old.exists() && old.data().uid === u.id) batch.delete(oldRef);
        batch.set(newRef, { uid: u.id });
        batch.update(doc(db, 'users', u.id), { empId });
        await batch.commit();
        ok('Törzsszám frissítve ✓'); closeSheet();
    } catch (e) { fail(e); }
};

// Admin: új eszköz összekapcsolása a régi fiókkal
const linkUser = async (u) => {
    try {
        const empRef = doc(db, 'empIds', u.empId);
        const emp = await getDoc(empRef);
        const oldId = emp.exists() ? emp.data().uid : null;
        const old = users.find((x) => x.id === oldId);

        const role = old?.role || NEW_USER_ROLE;
        const msg = old
            ? `Összekapcsolod?\n\nRégi fiók: ${old.name} (${roleLabel(old.role)})\nÚj eszköz: ${u.name}\n\nAz új eszköz megkapja a(z) "${roleLabel(role)}" szerepkört.`
            : 'A régi fiók már nem létezik. Az új eszköz átveszi a törzsszámot. Folytatod?';
        if (!confirm(msg)) return;

        const batch = writeBatch(db);
        batch.set(empRef, { uid: u.id });
        batch.update(doc(db, 'users', u.id), { role, status: 'active' });
        if (old) batch.update(doc(db, 'users', old.id), { status: 'merged' });
        await batch.commit();
        ok('Összekapcsolva ✓'); closeSheet();
    } catch (e) { fail(e); }
};

// Admin: fiók törlése (a törzsszám foglalás is felszabadul, ha az övé)
const removeUser = async (u) => {
    if (!confirm(`Biztosan törlöd: ${u.name}?\nAz eszközén újra regisztrálnia kell.`)) return;
    try {
        const batch = writeBatch(db);
        const empRef = doc(db, 'empIds', u.empId);
        const emp = await getDoc(empRef);
        if (emp.exists() && emp.data().uid === u.id) batch.delete(empRef);
        batch.delete(doc(db, 'users', u.id));
        await batch.commit();
        ok('Törölve'); closeSheet();
    } catch (e) { fail(e); }
};

// ============================================================
// SZEREPKÖRÖK (csak admin)
// ============================================================
const renderRoles = () => {
    const list = sortedRoles();
    $('#seedBox').classList.toggle('hidden', list.length > 0);
    $('#roleList').innerHTML = list.map(([id, r]) => {
        const n = users.filter((u) => u.role === id && u.status !== 'merged').length;
        return `
        <button class="user-row" data-role="${esc(id)}">
            <div class="flex-grow-1 text-start">
                <div class="fw-bold">${esc(r.label)} <span class="text-muted tiny">(${esc(id)})</span></div>
                <div class="text-muted tiny">${id === 'admin' ? 'Minden jogosultság' : `${(r.permissions || []).length} jogosultság`} · ${n} fő</div>
            </div>
            <span class="text-muted">›</span>
        </button>`;
    }).join('');
};

const openRole = (id = null) => {
    feedback();
    const r = id ? roles[id] : { label: '', rank: 15, permissions: [] };
    const isAdminRole = id === 'admin';
    const perms = Object.entries(PERMISSIONS).map(([key, label]) => `
        <label class="perm-row">
            <input type="checkbox" class="form-check-input" value="${esc(key)}"
                ${isAdminRole || (r.permissions || []).includes(key) ? 'checked' : ''} ${isAdminRole ? 'disabled' : ''}>
            <span>${esc(label)}<br><span class="text-muted tiny">${esc(key)}</span></span>
        </label>`).join('');

    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">${id ? 'Szerepkör szerkesztése' : 'Új szerepkör'}</h5>
        ${id ? '' : `
        <label class="form-label">Azonosító</label>
        <input type="text" id="rId" class="form-control mb-1" placeholder="pl. quality_lead" maxlength="30">
        <div class="text-muted tiny mb-3">Kisbetű, szám, aláhúzás. Később nem módosítható.</div>`}
        <div class="row g-2 mb-3">
            <div class="col-8"><label class="form-label">Megnevezés</label>
                <input type="text" id="rLabel" class="form-control" maxlength="40" value="${esc(r.label)}"></div>
            <div class="col-4"><label class="form-label">Szint</label>
                <input type="number" id="rRank" class="form-control" inputmode="numeric" value="${Number(r.rank) || 0}" ${isAdminRole ? 'disabled' : ''}></div>
        </div>
        <label class="form-label">Jogosultságok</label>
        <div class="perm-list mb-4" id="rPerms">${perms}</div>
        <div class="d-flex gap-2">
            ${id && id !== 'admin' && id !== NEW_USER_ROLE ? '<button class="btn btn-outline-danger" id="rDelete">Törlés</button>' : ''}
            <button class="btn btn-light flex-grow-1" id="rClose">Mégsem</button>
            <button class="btn btn-primary flex-grow-1" id="rSave">Mentés</button>
        </div>`);

    $('#rClose', sheet).addEventListener('click', closeSheet);
    $('#rDelete', sheet)?.addEventListener('click', () => deleteRole(id));
    $('#rSave', sheet).addEventListener('click', async () => {
        const roleId = id || $('#rId', sheet).value.trim();
        const label = $('#rLabel', sheet).value.trim();
        const rank = parseInt($('#rRank', sheet).value, 10) || 0;
        const permissions = isAdminRole
            ? Object.keys(PERMISSIONS)
            : [...sheet.querySelectorAll('#rPerms input:checked')].map((i) => i.value);

        if (!/^[a-z][a-z0-9_]{1,29}$/.test(roleId)) return fail(null, 'Érvénytelen azonosító!');
        if (!id && roles[roleId]) return fail(null, 'Ilyen azonosító már létezik!');
        if (label.length < 2) return fail(null, 'Adj meg megnevezést!');
        try {
            await setDoc(doc(db, 'roles', roleId), { label, rank: isAdminRole ? 100 : rank, permissions });
            ok('Szerepkör mentve ✓'); closeSheet();
        } catch (e) { fail(e); }
    });
};

const deleteRole = async (id) => {
    const n = users.filter((u) => u.role === id && u.status !== 'merged').length;
    if (n) return fail(null, `Még ${n} felhasználó ezt használja. Előbb állítsd át őket.`);
    if (!confirm(`Törlöd a(z) "${roleLabel(id)}" szerepkört?`)) return;
    try { await deleteDoc(doc(db, 'roles', id)); ok('Törölve'); closeSheet(); } catch (e) { fail(e); }
};

const seedRoles = async () => {
    try {
        const batch = writeBatch(db);
        Object.entries(DEFAULT_ROLES).forEach(([id, r]) => batch.set(doc(db, 'roles', id), r));
        await batch.commit();
        ok('Alapértelmezett szerepkörök feltöltve ✓');
    } catch (e) { fail(e); }
};

if (isAdmin) {
    $('#seedBtn').addEventListener('click', seedRoles);
    $('#newRoleBtn').addEventListener('click', () => openRole());
    $('#roleList').addEventListener('click', (e) => {
        const row = e.target.closest('[data-role]');
        if (row) openRole(row.dataset.role);
    });
}

// ============================================================
// ÉLŐ ADATOK
// ============================================================
onSnapshot(collection(db, 'roles'), (snap) => {
    roles = {};
    snap.forEach((d) => { roles[d.id] = d.data(); });
    renderUsers();
    if (isAdmin) renderRoles();
}, (e) => fail(e, 'A szerepkörök nem tölthetők be.'));

onSnapshot(collection(db, 'users'), (snap) => {
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsers();
    if (isAdmin) renderRoles();
}, (e) => fail(e, 'A felhasználók nem tölthetők be.'));
