// ============================================================
// Használati statisztika – csak admin (data-perm="admin.only")
// Adatforrás (js/track.js gyűjti):
//   usage/{nap}_{uid}  – felhasználónkénti napi összesítő + idővonal
//   usageDaily/{nap}   – napi összesítő (30 napos trendhez)
// Olvasás: az időszak napi felhasználói dokumentumai (pl. 7 nap × aktív fő)
// + 30 napi összesítő. Az eredmény az oldalon belül gyorsítótárazva.
// ============================================================
import { ready } from './session.js';
import { db, collection, doc, getDoc, getDocs, query, where, writeBatch } from './firebase.js';
import { MODULES, APP } from './config.js';
import { esc, $, feedback, toast, openSheet, closeSheet, setPageTabs } from './ui.js';
import { registerHelp } from './help.js';
import { avatar } from './avatar.js';

const session = await ready;

// ---------- Segédek ----------
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBack = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const MONTHS = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
const fmtDayKey = (k) => { const [, m, d] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${d}.`; };
const fmtDur = (ms) => {
    const s = Math.round((ms || 0) / 1000);
    if (s < 60) return `${s} mp`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} p${s % 60 && m < 10 ? ` ${s % 60} mp` : ''}`;
    return `${Math.floor(m / 60)} ó ${m % 60} p`;
};
const num = (n) => (n || 0).toLocaleString('hu-HU');
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const add = (target, src) => Object.entries(src || {}).forEach(([k, v]) => { target[k] = (target[k] || 0) + (Number(v) || 0); });

const PAGE_TITLES = {
    home: '🏠 Kezdőlap', info: 'ℹ️ Infó', unknown: '❔ Ismeretlen',
    ...Object.fromEntries(MODULES.map((m) => [m.id, `${m.icon} ${m.title}`])),
    settings: '⚙️ Vezérlőpult'
};
const pageTitle = (id) => PAGE_TITLES[id] || id;

const ACTIONS = {
    'ic:generate': '⚡ IC generálás',
    'ic:replay': '⚡ Utolsó IC QR újra',
    'mes:qr': '💻 MES belépő QR',
    'pack:qr': '📦 Csomagoló QR',
    'calendar:leave-add': '🏖️ Szabadság bejelölés',
    'calendar:leave-remove': '🏖️ Szabadság törlés',
    'calendar:shift': '🔄 Műszak beállítás'
};
const actionTitle = (k) => ACTIONS[k] || (k.endsWith(':send') ? '💬 Visszajelzés küldés' : k);

// ---------- Adatok ----------
let range = 1;
let noSelf = false;
let search = '';
const cache = new Map();   // range → usage dokumentumok
let daily = null;          // 30 nap usageDaily

const loadRange = async (n) => {
    if (cache.has(n)) return cache.get(n);
    const from = dayKey(daysBack(n - 1));
    const snap = await getDocs(query(collection(db, 'usage'), where('day', '>=', from)));
    const docs = snap.docs.map((d) => d.data());
    cache.set(n, docs);
    return docs;
};

const loadDaily = async () => {
    if (daily) return daily;
    const keys = Array.from({ length: 30 }, (_, i) => dayKey(daysBack(29 - i)));
    const snaps = await Promise.all(keys.map((k) => getDoc(doc(db, 'usageDaily', k)).catch(() => null)));
    daily = keys.map((k, i) => ({ day: k, data: snaps[i]?.exists() ? snaps[i].data() : null }));
    return daily;
};

// Idővonal: "HH:MM:SS|modul|érték" – a látható idő bejegyzés frissülhet, a legnagyobb számít
const parseLog = (log) => {
    const views = new Map();
    const out = [];
    (log || []).forEach((line) => {
        const [time, page, ...rest] = String(line).split('|');
        const val = rest.join('|');
        if (/^\d+$/.test(val)) {
            const key = `${time}|${page}`;
            const prev = views.get(key);
            if (!prev) { const e = { time, page, kind: 'view', secs: Number(val) }; views.set(key, e); out.push(e); }
            else prev.secs = Math.max(prev.secs, Number(val));
        } else if (val === '▶') out.push({ time, page, kind: 'start' });
        else if (val.startsWith('@')) out.push({ time, page, kind: 'action', text: val.slice(1) });
        else if (val.startsWith('!')) out.push({ time, page, kind: 'error', text: val.slice(1) });
    });
    return out.sort((a, b) => a.time.localeCompare(b.time));
};

// Összesítés a kiválasztott időszakra
const aggregate = (docs) => {
    const users = new Map();
    const modules = {};
    const actions = {};
    const hours = {};
    const errors = [];
    let sessions = 0, time = 0, errCount = 0;

    docs.forEach((d) => {
        if (noSelf && d.uid === session.uid) return;
        const u = users.get(d.uid) || { uid: d.uid, name: d.name, days: [], time: 0, sessions: 0, views: 0, modules: {}, actions: {}, errors: 0, device: null, deviceDay: '', last: 0 };
        users.set(d.uid, u);
        u.name = d.name || u.name;
        u.days.push(d);
        u.time += d.time || 0;
        u.sessions += d.sessions || 0;
        Object.entries(d.modules || {}).forEach(([m, v]) => {
            u.views += v.views || 0;
            const um = (u.modules[m] ||= { views: 0, ms: 0 });
            um.views += v.views || 0; um.ms += v.ms || 0;
            const gm = (modules[m] ||= { views: 0, ms: 0, users: new Set() });
            gm.views += v.views || 0; gm.ms += v.ms || 0; gm.users.add(d.uid);
        });
        add(u.actions, d.actions);
        add(actions, d.actions);
        add(hours, d.hours);
        const ec = sum(d.errors);
        u.errors += ec; errCount += ec;
        sessions += d.sessions || 0;
        time += d.time || 0;
        if (d.day >= u.deviceDay) { u.device = d.device; u.deviceDay = d.day; }
        const lastMs = d.last?.toMillis ? d.last.toMillis() : 0;
        if (lastMs > u.last) u.last = lastMs;
        parseLog(d.log).filter((e) => e.kind === 'error').forEach((e) => errors.push({ ...e, day: d.day, name: d.name }));
    });
    errors.sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
    return { users: [...users.values()], modules, actions, hours, errors, sessions, time, errCount };
};

// ---------- Kirajzolás ----------
const bars = (rows, { fmt = num, max } = {}) => {
    const m = max ?? Math.max(1, ...rows.map((r) => r.value));
    return rows.length ? rows.map((r) => `
        <div class="st-row">
            <div class="st-row-top"><span class="st-row-lbl">${r.label}</span><span class="st-row-val">${esc(fmt(r.value))}${r.sub ? ` <small>${esc(r.sub)}</small>` : ''}</span></div>
            <div class="bar"><span style="width:${Math.round(r.value / m * 100)}%"></span></div>
        </div>`).join('') : '<div class="text-muted small p-2">Nincs adat.</div>';
};

const renderOverview = (A) => {
    const n = A.users.length;
    const perUserDay = A.users.reduce((s, u) => s + u.days.length, 0);
    $('#kpis').innerHTML = [
        ['👤', num(n), 'aktív felhasználó'],
        ['▶', num(A.sessions), 'munkamenet'],
        ['⏱️', fmtDur(A.time), 'összes használat'],
        ['📈', fmtDur(perUserDay ? A.time / perUserDay : 0), 'átlag / fő / nap'],
        ['⚡', num(sum(A.actions)), 'művelet'],
        ['🐞', num(A.errCount), 'JS hiba', A.errCount > 0]
    ].map(([i, v, l, alert]) => `<div class="st-kpi ${alert ? 'alert' : ''}"><span class="st-kpi-ico">${i}</span><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('');

    // Napszakok
    const hmax = Math.max(1, ...Object.values(A.hours));
    $('#hours').innerHTML = Array.from({ length: 24 }, (_, h) => {
        const v = A.hours[pad(h)] || 0;
        return `<div class="st-col" title="${h}:00 – ${v}"><span style="height:${Math.round(v / hmax * 100)}%"></span><i>${h % 3 === 0 ? h : ''}</i></div>`;
    }).join('');

    $('#actions').innerHTML = bars(Object.entries(A.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: esc(actionTitle(k)), value: v })));

    $('#errors').innerHTML = A.errors.length ? A.errors.slice(0, 30).map((e) => `
        <div class="st-err">
            <div class="text-muted tiny">${esc(fmtDayKey(e.day))} ${esc(e.time)} · ${esc(e.name || '?')} · ${esc(pageTitle(e.page))}</div>
            <div class="mono small">${esc(e.text)}</div>
        </div>`).join('') : '<div class="text-muted small p-2">Nem volt hiba ebben az időszakban. 🎉</div>';
};

const renderTrend = (D) => {
    const vals = D.map((x) => Object.keys(x.data?.users || {}).length);
    const max = Math.max(1, ...vals);
    $('#trend').innerHTML = D.map((x, i) => `
        <div class="st-col ${i === D.length - 1 ? 'today' : ''}" title="${esc(fmtDayKey(x.day))}: ${vals[i]} fő, ${esc(fmtDur(x.data?.time))}">
            <span style="height:${Math.round(vals[i] / max * 100)}%"></span>
            <i>${i % 5 === 4 || i === D.length - 1 ? x.day.slice(8) : ''}</i>
        </div>`).join('');
    const total = vals.reduce((a, b) => a + b, 0);
    const active = vals.filter(Boolean).length;
    $('#trendNote').textContent = active ? `Átlag ${Math.round(total / active * 10) / 10} fő naponta (a használt napokon) · a saját használatot is tartalmazza` : 'Még nincs adat.';
};

const renderModules = (A) => {
    const rows = Object.entries(A.modules).sort((a, b) => b[1].ms - a[1].ms);
    $('#modules').innerHTML = rows.length ? bars(rows.map(([m, v]) => ({
        label: esc(pageTitle(m)),
        value: v.ms,
        sub: `${num(v.views)} megnyitás · ${v.users.size} fő · ⌀ ${fmtDur(v.views ? v.ms / v.views : 0)}`
    })), { fmt: fmtDur }) : '<div class="text-muted small p-2">Nincs adat.</div>';
};

const lastSeen = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const sameDay = dayKey(d) === dayKey(new Date());
    return sameDay ? `ma ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${MONTHS[d.getMonth()]} ${d.getDate()}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const devBadge = (dev) => dev ? `<span class="st-dev">${dev.os === 'iOS' ? '📱' : dev.os === 'Android' ? '🤖' : '💻'} ${dev.pwa ? 'App' : esc(dev.browser)}</span>` : '';

let lastAgg = null;
const renderUsers = (A) => {
    const q = search.toLowerCase();
    const list = A.users.filter((u) => !q || (u.name || '').toLowerCase().includes(q)).sort((a, b) => b.time - a.time);
    $('#users').innerHTML = list.length ? list.map((u) => {
        const top = Object.entries(u.modules).sort((a, b) => b[1].ms - a[1].ms)[0];
        return `
        <button class="user-row" data-uid="${esc(u.uid)}">
            ${avatar(u.uid, u.name, 'sm')}
            <div class="flex-grow-1 text-start" style="min-width:0">
                <div class="fw-bold text-truncate">${esc(u.name || '?')} ${u.errors ? `<span class="st-errbadge">🐞 ${u.errors}</span>` : ''}</div>
                <div class="text-muted tiny text-truncate">${esc(lastSeen(u.last))} · ${top ? esc(pageTitle(top[0])) : ''} ${devBadge(u.device)}</div>
            </div>
            <div class="text-end flex-none">
                <div class="fw-bold small">${esc(fmtDur(u.time))}</div>
                <div class="text-muted tiny">${u.sessions} munkam.</div>
            </div>
        </button>`;
    }).join('') : '<div class="text-muted small p-2">Nincs adat.</div>';
};

const openUser = (uid) => {
    const u = lastAgg?.users.find((x) => x.uid === uid);
    if (!u) return;
    feedback();
    const days = [...u.days].sort((a, b) => b.day.localeCompare(a.day));
    const mods = Object.entries(u.modules).sort((a, b) => b[1].ms - a[1].ms);
    const dev = u.device || {};
    const timeline = days.map((d) => {
        const ev = parseLog(d.log);
        return `
        <details class="st-day" ${d === days[0] ? 'open' : ''}>
            <summary><b>${esc(fmtDayKey(d.day))}</b> <span class="text-muted small">· ${esc(fmtDur(d.time))} · ${d.sessions || 0} munkamenet</span></summary>
            <div class="st-tl">${ev.length ? ev.map((e) => `
                <div class="st-ev ev-${e.kind}">
                    <span class="st-ev-t">${esc(e.time.slice(0, 5))}</span>
                    <span class="st-ev-x">${e.kind === 'start' ? '▶ Megnyitotta az appot'
                        : e.kind === 'view' ? `${esc(pageTitle(e.page))} <small>${esc(fmtDur(e.secs * 1000))}</small>`
                        : e.kind === 'action' ? `${esc(actionTitle(`${e.page}:${e.text.split(' ')[0]}`))} <small>${esc(e.text.split(' ').slice(1).join(' '))}</small>`
                        : `🐞 <span class="mono">${esc(e.text)}</span> <small>${esc(pageTitle(e.page))}</small>`}</span>
                </div>`).join('') : '<div class="text-muted small">Nincs részletes idővonal.</div>'}
            </div>
        </details>`;
    }).join('');

    const sheet = openSheet(`
        <div class="d-flex align-items-center gap-3 mb-3">
            ${avatar(u.uid, u.name, 'lg')}
            <div style="min-width:0">
                <h5 class="fw-bold mb-0 text-truncate">${esc(u.name || '?')}</h5>
                <div class="text-muted small">Utoljára: ${esc(lastSeen(u.last) || '–')}</div>
            </div>
        </div>
        <div class="st-kpis sm mb-3">
            <div class="st-kpi"><b>${esc(fmtDur(u.time))}</b><small>használat</small></div>
            <div class="st-kpi"><b>${u.sessions}</b><small>munkamenet</small></div>
            <div class="st-kpi"><b>${u.days.length}</b><small>nap</small></div>
        </div>
        <h6 class="cp-group mt-0">Modulok</h6>
        <div class="mb-3">${bars(mods.map(([m, v]) => ({ label: esc(pageTitle(m)), value: v.ms, sub: `${v.views}×` })), { fmt: fmtDur })}</div>
        ${Object.keys(u.actions).length ? `<h6 class="cp-group">Műveletek</h6><div class="mb-3">${bars(Object.entries(u.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: esc(actionTitle(k)), value: v })))}</div>` : ''}
        <h6 class="cp-group">Készülék</h6>
        <div class="small mb-3">${esc(dev.os || '?')} ${esc(dev.osVer || '')} · ${esc(dev.browser || '?')} · ${dev.pwa ? '📲 telepített app' : '🌐 böngészőben'} · ${esc(dev.screen || '')}<br>
            App: <b class="${dev.version && dev.version !== APP.version ? 'text-danger' : ''}">v${esc(dev.version || '?')}</b> <span class="text-muted">${esc(dev.build || '')}</span></div>
        <h6 class="cp-group">Idővonal</h6>
        ${timeline}
        <button class="btn btn-light w-100 mt-3" id="stClose">Bezárás</button>`);
    $('#stClose', sheet).addEventListener('click', closeSheet);
};

const share = (title, counts, highlight) => {
    const total = sum(counts) || 1;
    return bars(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
        label: `${esc(k)}${highlight?.(k) ? ' <span class="st-errbadge">régi</span>' : ''}`,
        value: v,
        sub: `${Math.round(v / total * 100)}%`
    })), { fmt: (v) => `${v} fő` });
};

const renderDevices = (A) => {
    const c = { ver: {}, pwa: {}, os: {}, br: {} };
    A.users.forEach((u) => {
        const d = u.device;
        if (!d) return;
        const v = `v${d.version || '?'}${d.build && d.build !== 'dev' ? ` (${d.build})` : ''}`;
        c.ver[v] = (c.ver[v] || 0) + 1;
        const p = d.pwa ? '📲 Telepített app' : '🌐 Böngésző';
        c.pwa[p] = (c.pwa[p] || 0) + 1;
        const o = `${d.os}${d.osVer ? ` ${d.osVer.split('.')[0]}` : ''}`;
        c.os[o] = (c.os[o] || 0) + 1;
        c.br[d.browser || '?'] = (c.br[d.browser || '?'] || 0) + 1;
    });
    const current = `v${APP.version}`;
    $('#versions').innerHTML = share('', c.ver, (k) => !k.startsWith(current + ' ') && k !== current);
    $('#pwa').innerHTML = share('', c.pwa);
    $('#os').innerHTML = share('', c.os);
    $('#browsers').innerHTML = share('', c.br);
};

const renderAll = async () => {
    $('#stLoading').classList.remove('hidden');
    try {
        const [docs, D] = await Promise.all([loadRange(range), loadDaily()]);
        lastAgg = aggregate(docs);
        renderOverview(lastAgg);
        renderTrend(D);
        renderModules(lastAgg);
        renderUsers(lastAgg);
        renderDevices(lastAgg);
    } catch (e) {
        console.error(e);
        toast(navigator.onLine ? 'Nem sikerült betölteni.' : 'A statisztikához internet kell.', 'error');
    } finally { $('#stLoading').classList.add('hidden'); }
};

// ---------- Események ----------
$('#stRange').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    feedback();
    range = Number(b.dataset.r);
    $('#stRange').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderAll();
});
$('#stNoSelf').addEventListener('change', (e) => { noSelf = e.target.checked; feedback(); renderAll(); });
$('#stSearch').addEventListener('input', (e) => { search = e.target.value.trim(); if (lastAgg) renderUsers(lastAgg); });
$('#users').addEventListener('click', (e) => { const r = e.target.closest('[data-uid]'); if (r) openUser(r.dataset.uid); });

$('#stCleanup').addEventListener('click', async (e) => {
    if (!navigator.onLine) return toast('Ehhez internet kell.', 'error');
    const cutoff = dayKey(daysBack(90));
    if (!confirm(`Törlöd a ${fmtDayKey(cutoff)} előtti statisztikát? Ez nem vonható vissza.`)) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Törlés…';
    try {
        const [u, d] = await Promise.all([
            getDocs(query(collection(db, 'usage'), where('day', '<', cutoff))),
            getDocs(collection(db, 'usageDaily'))
        ]);
        const refs = [...u.docs.map((x) => x.ref), ...d.docs.filter((x) => x.id < cutoff).map((x) => x.ref)];
        for (let i = 0; i < refs.length; i += 400) {
            const b = writeBatch(db);
            refs.slice(i, i + 400).forEach((r) => b.delete(r));
            await b.commit();
        }
        feedback('success'); toast(refs.length ? `${refs.length} régi bejegyzés törölve` : 'Nincs 90 napnál régebbi adat', 'success');
    } catch (err) { console.error(err); feedback('error'); toast('Nem sikerült a törlés.', 'error'); }
    finally { btn.disabled = false; btn.textContent = '90 napnál régebbi adatok törlése'; }
});

setPageTabs([
    { id: 'overview', icon: '📊', label: 'Áttekintés' },
    { id: 'modules', icon: '🧩', label: 'Modulok' },
    { id: 'users', icon: '👤', label: 'Emberek' },
    { id: 'devices', icon: '📱', label: 'Eszközök' }
], (id) => {
    ['overview', 'modules', 'users', 'devices'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== id));
    window.scrollTo(0, 0);
});
registerHelp('stats');
renderAll();
