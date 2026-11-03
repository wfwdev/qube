// ============================================================
// Használati statisztika (csak az admin látja: stats.html)
// Mit gyűjt: melyik modult, mikor, mennyi ideig (látható idő), milyen
// műveleteket (pl. IC generálás, QR megnyitás), JS hibákat, és a készülék
// típusát / app verziót. Jelszót, MES adatot, kódot NEM.
//
// Takarékos írás: minden a telefonon gyűlik (localStorage), és legfeljebb
// 2 percenként, illetve az app háttérbe tételekor megy fel egy batch-ben:
//   usage/{nap}_{uid}   – a felhasználó napi összesítője + idővonal (log)
//   usageDaily/{nap}    – a nap összesítője (trendekhez, olcsó lekérdezés)
// Admin a Vezérlőpulton kikapcsolhatja (settings/app.analytics.enabled).
// ============================================================
import { db, doc, writeBatch, increment, arrayUnion, serverTimestamp } from './firebase.js';
import { cachedSettings, loadSettings } from './features.js';
import { APP } from './config.js';

const Q_KEY = 'qube_usage_q';
const LAST_KEY = 'qube_usage_last';      // utolsó aktivitás (munkamenet határ)
const FLUSH_KEY = 'qube_usage_flush';    // utolsó feltöltés ideje
const SESSION_GAP = 30 * 60 * 1000;      // 30 perc szünet = új munkamenet
const FLUSH_EVERY = 2 * 60 * 1000;
const LOG_MAX = 400;                     // idővonal bejegyzés / fő / nap

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hms = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const clean = (s, n) => String(s ?? '').replace(/[|\n\r]/g, ' ').slice(0, n);

const page = document.body?.dataset.page || 'unknown';

let session = null;
let enabled = cachedSettings()?.analytics?.enabled !== false;

// ---------- Helyi sor ----------
const readQ = () => { try { return JSON.parse(localStorage.getItem(Q_KEY)) || {}; } catch { return {}; } };
const writeQ = (q) => { try { localStorage.setItem(Q_KEY, JSON.stringify(q)); } catch { /* tele */ } };

const dayRec = (q, day) => {
    q.days ||= {};
    return (q.days[day] ||= { m: {}, a: {}, e: {}, h: {}, s: 0, log: [] });
};

// Egy módosítás a sorban (azonnal mentve – oldalváltáskor sem vész el)
const mutate = (fn, t = Date.now()) => {
    if (!enabled) return;
    const q = readQ();
    fn(dayRec(q, dayOf(t)), q);
    writeQ(q);
};

// ---------- Oldal (modul) látható ideje ----------
const loadedAt = Date.now();
let visStart = document.visibilityState === 'visible' ? loadedAt : null;
let visibleMs = 0;
let segmentLogged = false;

const newSessionCheck = (t) => {
    let last = 0;
    try { last = Number(localStorage.getItem(LAST_KEY)) || 0; } catch { /* */ }
    try { localStorage.setItem(LAST_KEY, String(t)); } catch { /* */ }
    return t - last > SESSION_GAP;
};

// Megnyitás: 1 nézet, óra szerinti eloszlás, esetleg új munkamenet
const enter = (t) => {
    const fresh = newSessionCheck(t);
    mutate((r) => {
        const m = (r.m[page] ||= { v: 0, ms: 0 });
        m.v++;
        const h = pad(new Date(t).getHours());
        r.h[h] = (r.h[h] || 0) + 1;
        if (fresh) { r.s++; r.log.push(`${hms(t)}|${page}|▶`); }
    }, t);
};

// Látható idő lezárása (háttérbe tétel / oldalváltás)
const closeSegment = (t = Date.now()) => {
    if (visStart === null) return;
    const ms = Math.max(0, Math.min(t - visStart, 4 * 3600 * 1000));
    visStart = null;
    visibleMs += ms;
    try { localStorage.setItem(LAST_KEY, String(t)); } catch { /* */ }
    mutate((r) => {
        (r.m[page] ||= { v: 0, ms: 0 }).ms += ms;
        // idővonal: belépés ideje | modul | látható másodperc (oldalanként egyszer, utána frissít)
        const line = `${hms(loadedAt)}|${page}|${Math.round(visibleMs / 1000)}`;
        const prefix = `${hms(loadedAt)}|${page}|`;
        const i = segmentLogged ? r.log.findIndex((x) => x.startsWith(prefix) && /\|\d+$/.test(x)) : -1;
        if (i >= 0) r.log[i] = line; else r.log.push(line);
        segmentLogged = true;
    }, t);
};

// ---------- Feltöltés ----------
let flushing = false;
const flush = async (force = false) => {
    if (!enabled || !session?.uid || flushing || !navigator.onLine) return;
    let lastFlush = 0;
    try { lastFlush = Number(localStorage.getItem(FLUSH_KEY)) || 0; } catch { /* */ }
    if (!force && Date.now() - lastFlush < FLUSH_EVERY) return;

    const q = readQ();
    const days = Object.keys(q.days || {});
    if (!days.length) return;
    if (q.uid && q.uid !== session.uid) { writeQ({}); return; } // más fiók régi adata
    flushing = true;
    try { localStorage.setItem(FLUSH_KEY, String(Date.now())); } catch { /* */ }

    const sent = q.sent || {};
    const b = writeBatch(db);
    days.forEach((day) => {
        const r = q.days[day];
        const inc = (o, f = (x) => x) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, increment(f(v))]));
        const modules = Object.fromEntries(Object.entries(r.m).map(([k, v]) => [k, { views: increment(v.v), ms: increment(Math.round(v.ms)) }]));
        const totalMs = Object.values(r.m).reduce((s, v) => s + v.ms, 0);
        const room = Math.max(0, LOG_MAX - (sent[day] || 0));
        const log = room ? r.log.slice(-room) : [];

        const user = {
            uid: session.uid,
            name: clean(session.user?.name, 60),
            day,
            modules,
            actions: inc(r.a),
            errors: inc(r.e),
            hours: inc(r.h),
            sessions: increment(r.s),
            time: increment(Math.round(totalMs)),
            last: serverTimestamp(),
            device: deviceInfo()
        };
        if (log.length) user.log = arrayUnion(...log);
        b.set(doc(db, 'usage', `${day}_${session.uid}`), user, { merge: true });

        b.set(doc(db, 'usageDaily', day), {
            modules,
            actions: inc(r.a),
            errors: inc(r.e),
            hours: inc(r.h),
            sessions: increment(r.s),
            time: increment(Math.round(totalMs)),
            users: { [session.uid]: true }
        }, { merge: true });
        sent[day] = (sent[day] || 0) + log.length;
    });

    try {
        await b.commit();
        // Csak a feltöltött részt vesszük ki – közben érkezett adat megmarad
        const now = readQ();
        days.forEach((day) => {
            const a = now.days?.[day], s = q.days[day];
            if (!a) return;
            Object.entries(s.m).forEach(([k, v]) => { if (a.m[k]) { a.m[k].v -= v.v; a.m[k].ms -= v.ms; if (a.m[k].v <= 0 && a.m[k].ms <= 0) delete a.m[k]; } });
            ['a', 'e', 'h'].forEach((f) => Object.entries(s[f]).forEach(([k, v]) => { if (a[f][k] !== undefined) { a[f][k] -= v; if (a[f][k] <= 0) delete a[f][k]; } }));
            a.s = Math.max(0, a.s - s.s);
            a.log = a.log.slice(s.log.length);
            if (!Object.keys(a.m).length && !Object.keys(a.a).length && !Object.keys(a.e).length && !Object.keys(a.h).length && !a.s && !a.log.length) delete now.days[day];
        });
        // a régi napok számlálóját elengedjük
        const keep = Object.fromEntries(Object.entries(sent).filter(([d]) => d >= dayOf(Date.now() - 2 * 86400000)));
        writeQ({ ...now, uid: session.uid, sent: keep });
    } catch (e) {
        console.warn('Statisztika feltöltése sikertelen – később újra', e);
        try { localStorage.setItem(FLUSH_KEY, '0'); } catch { /* */ }
    } finally { flushing = false; }
};

// ---------- Készülék ----------
const deviceInfo = () => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const osVer = ios ? (ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1, 3).join('.')
        : android ? (ua.match(/Android (\d+(?:\.\d+)?)/) || [])[1] : '';
    const browser = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Edg/.test(ua) ? 'Edge'
        : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Safari/.test(ua) ? 'Safari' : 'Egyéb';
    return {
        os: ios ? 'iOS' : android ? 'Android' : 'Egyéb',
        osVer: clean(osVer || '', 10),
        browser,
        pwa: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
        version: APP.version,
        build: clean(APP.build, 20),
        screen: `${screen.width}×${screen.height}`
    };
};

// ---------- Nyilvános ----------
// Művelet rögzítése, pl. track('generate') → "ic:generate"
export const track = (action, detail = '') => {
    const t = Date.now();
    mutate((r) => {
        const k = `${page}:${clean(action, 30)}`;
        r.a[k] = (r.a[k] || 0) + 1;
        r.log.push(`${hms(t)}|${page}|@${clean(action, 30)}${detail ? ` ${clean(detail, 40)}` : ''}`);
    }, t);
};

// Indítás a munkamenet után (ui.js renderChrome hívja)
export const startTracking = (s) => {
    if (session || !s?.uid) return;
    session = s;
    if (!enabled) return;
    enter(loadedAt);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { closeSegment(); flush(true); }
        else {
            const t = Date.now();
            if (newSessionCheck(t)) mutate((r) => { r.s++; r.log.push(`${hms(t)}|${page}|▶`); }, t);
            visStart = t;
        }
    });
    addEventListener('pagehide', () => closeSegment());
    addEventListener('online', () => flush());

    // JS hibák – fejlesztéshez
    const onErr = (msg) => {
        const t = Date.now();
        mutate((r) => {
            r.e[page] = (r.e[page] || 0) + 1;
            r.log.push(`${hms(t)}|${page}|!${clean(msg, 90)}`);
        }, t);
    };
    addEventListener('error', (e) => onErr(e.message || 'Hiba'));
    addEventListener('unhandledrejection', (e) => onErr(e.reason?.message || String(e.reason || 'Promise hiba')));

    // időnként: a látható idő mentése, és ha esedékes, feltöltés
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        closeSegment(); visStart = Date.now();
        flush();
    }, 60 * 1000);

    flush();
    loadSettings().then((st) => { enabled = st?.analytics?.enabled !== false; if (!enabled) writeQ({}); });
};
