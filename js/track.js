// ============================================================
// Használati statisztika (csak az admin látja: stats.html)
// Mit gyűjt: melyik modult, mikor, mennyi ideig (látható idő), milyen
// műveleteket (pl. IC generálás, QR megnyitás), JS hibákat, a felhasználónak
// megjelent hibaüzeneteket, betöltési időt, offline szakaszokat, feltöltésre
// váró adatok számát, frissítéseket, és a készülék típusát / app verziót.
// Jelszót, MES adatot, kódot NEM.
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
const RECENT_KEY = 'qube_usage_recent';  // utolsó 40 esemény (hibabejelentéshez)
const OFF_KEY = 'qube_usage_offline';    // mióta offline
const SESSION_GAP = 30 * 60 * 1000;      // 30 perc szünet = új munkamenet
const FLUSH_EVERY = 2 * 60 * 1000;
const LOG_MAX = 400;                     // idővonal bejegyzés / fő / nap
const SLOW_MS = 4000;                    // ennél lassabb betöltés külön bejegyzést kap

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hms = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const clean = (s, n) => String(s ?? '').replace(/[|\n\r]/g, ' ').slice(0, n);
const lsGet = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* tele */ } };

const page = document.body?.dataset.page || 'unknown';

let session = null;
let enabled = cachedSettings()?.analytics?.enabled !== false;

// ---------- Helyi sor ----------
// Napi rekord: m modulok {v,ms} · a műveletek · e JS hibák · w hibaüzenetek ·
// h órák · p betöltés {n,ms} · n hálózat {off,offMs} · s munkamenetek · log
const readQ = () => lsGet(Q_KEY, {});
const writeQ = (q) => lsSet(Q_KEY, q);
const dayRec = (q, day) => {
    q.days ||= {};
    const r = (q.days[day] ||= {});
    r.m ||= {}; r.a ||= {}; r.e ||= {}; r.w ||= {}; r.h ||= {}; r.p ||= {}; r.n ||= {}; r.s ||= 0; r.log ||= [];
    return r;
};

// Utolsó események a hibabejelentéshez (a feltöltéstől függetlenül megmarad)
const remember = (line, t) => {
    const r = lsGet(RECENT_KEY, []);
    r.push(`${dayOf(t).slice(5)} ${line}`);
    lsSet(RECENT_KEY, r.slice(-40));
};

// Egy módosítás a sorban (azonnal mentve – oldalváltáskor sem vész el)
const mutate = (fn, t = Date.now()) => {
    if (!enabled) return;
    const q = readQ();
    fn(dayRec(q, dayOf(t)), q);
    writeQ(q);
};
const logLine = (r, t, text) => {
    const line = `${hms(t)}|${page}|${text}`;
    r.log.push(line);
    remember(line, t);
};

// ---------- Oldal (modul) látható ideje ----------
const loadedAt = Date.now();
let visStart = document.visibilityState === 'visible' ? loadedAt : null;
let visibleMs = 0;
let segmentLogged = false;

const newSessionCheck = (t) => {
    const last = Number(lsGet(LAST_KEY, 0)) || 0;
    lsSet(LAST_KEY, t);
    return t - last > SESSION_GAP;
};

const enter = (t) => {
    const fresh = newSessionCheck(t);
    mutate((r) => {
        const m = (r.m[page] ||= { v: 0, ms: 0 });
        m.v++;
        const h = pad(new Date(t).getHours());
        r.h[h] = (r.h[h] || 0) + 1;
        if (fresh) { r.s++; logLine(r, t, '▶'); }
    }, t);
};

const closeSegment = (t = Date.now()) => {
    if (visStart === null) return;
    const ms = Math.max(0, Math.min(t - visStart, 4 * 3600 * 1000));
    visStart = null;
    visibleMs += ms;
    lsSet(LAST_KEY, t);
    mutate((r) => {
        (r.m[page] ||= { v: 0, ms: 0 }).ms += ms;
        // idővonal: belépés ideje | modul | látható másodperc (oldalanként egy sor, frissül)
        const prefix = `${hms(loadedAt)}|${page}|`;
        const line = `${prefix}${Math.round(visibleMs / 1000)}`;
        const i = segmentLogged ? r.log.findIndex((x) => x.startsWith(prefix) && /\|\d+$/.test(x)) : -1;
        if (i >= 0) r.log[i] = line; else r.log.push(line);
        segmentLogged = true;
    }, t);
};

// ---------- Hálózat ----------
const goOffline = () => {
    if (lsGet(OFF_KEY, 0)) return;
    const t = Date.now();
    lsSet(OFF_KEY, t);
    mutate((r) => { r.n.off = (r.n.off || 0) + 1; logLine(r, t, '📴'); }, t);
};
const goOnline = () => {
    const since = Number(lsGet(OFF_KEY, 0)) || 0;
    if (!since) return;
    const t = Date.now();
    lsSet(OFF_KEY, 0);
    const ms = Math.min(t - since, 12 * 3600 * 1000);
    mutate((r) => { r.n.offMs = (r.n.offMs || 0) + ms; logLine(r, t, `📶 ${Math.round(ms / 1000)}`); }, t);
};

// ---------- Feltöltésre váró adatok (beragadt sor felderítése) ----------
const syncInfo = () => {
    const ic = lsGet('qube_ic_outbox', []);
    const fb = lsGet('qube_fb_outbox', []);
    const oldest = [...ic, ...fb].reduce((m, x) => Math.min(m, x.clientTime || Infinity), Infinity);
    return {
        ic: Array.isArray(ic) ? ic.length : 0,
        fb: Array.isArray(fb) ? fb.length : 0,
        oldestMin: Number.isFinite(oldest) ? Math.round((Date.now() - oldest) / 60000) : 0,
        sw: !!navigator.serviceWorker?.controller
    };
};

// ---------- Feltöltés ----------
// a feltöltött számokat kivonja a közben tovább gyűlt helyi adatból
const subtract = (a, s) => {
    Object.entries(s).forEach(([k, v]) => {
        if (a[k] === undefined) return;
        if (typeof v === 'number') { a[k] -= v; if (a[k] <= 0) delete a[k]; }
        else if (v && typeof v === 'object') { subtract(a[k], v); if (!Object.keys(a[k]).length) delete a[k]; }
    });
};
const incMap = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
    [k, typeof v === 'object' ? incMap(v) : increment(Math.round(v))]));

// Üres map-et NEM küldünk: merge-nél az üres map felülírná a mezőt (pl. törölné a korábbi hibák számát)
const noEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) =>
    !(v && typeof v === 'object' && v.constructor === Object && !Object.keys(v).length)));

let flushing = false;
const flush = async (force = false) => {
    if (!enabled || !session?.uid || flushing || !navigator.onLine) return;
    const lastFlush = Number(lsGet(FLUSH_KEY, 0)) || 0;
    if (!force && Date.now() - lastFlush < FLUSH_EVERY) return;

    const q = readQ();
    const days = Object.keys(q.days || {});
    if (!days.length) return;
    if (q.uid && q.uid !== session.uid) { writeQ({}); return; } // más fiók régi adata
    flushing = true;
    lsSet(FLUSH_KEY, Date.now());

    const sent = q.sent || {};
    const b = writeBatch(db);
    days.forEach((day) => {
        const r = dayRec(q, day);
        const modules = Object.fromEntries(Object.entries(r.m).map(([k, v]) => [k, { views: increment(v.v || 0), ms: increment(Math.round(v.ms || 0)) }]));
        const totalMs = Object.values(r.m).reduce((s, v) => s + (v.ms || 0), 0);
        const room = Math.max(0, LOG_MAX - (sent[day] || 0));
        const log = room ? r.log.slice(-room) : [];
        const common = {
            modules,
            actions: incMap(r.a),
            errors: incMap(r.e),
            warnings: incMap(r.w),
            hours: incMap(r.h),
            perf: incMap(r.p),
            sessions: increment(r.s),
            time: increment(Math.round(totalMs))
        };
        const user = {
            ...common,
            uid: session.uid,
            name: clean(session.user?.name, 60),
            day,
            net: incMap(r.n),
            last: serverTimestamp(),
            device: deviceInfo(),
            sync: syncInfo()
        };
        if (log.length) user.log = arrayUnion(...log);
        b.set(doc(db, 'usage', `${day}_${session.uid}`), noEmpty(user), { merge: true });
        b.set(doc(db, 'usageDaily', day), noEmpty({ ...common, users: { [session.uid]: true } }), { merge: true });
        sent[day] = (sent[day] || 0) + log.length;
    });

    try {
        await b.commit();
        const now = readQ();
        days.forEach((day) => {
            const a = now.days?.[day], s = q.days[day];
            if (!a) return;
            const { log: sLog, ...sNum } = s;
            const { log: aLog, ...aNum } = a;
            subtract(aNum, sNum);
            const rest = { ...aNum, log: (aLog || []).slice(sLog.length) };
            if (!rest.log.length && !Object.values(aNum).some((v) => (typeof v === 'number' ? v > 0 : Object.keys(v || {}).length))) delete now.days[day];
            else now.days[day] = rest;
        });
        const keep = Object.fromEntries(Object.entries(sent).filter(([d]) => d >= dayOf(Date.now() - 2 * 86400000)));
        writeQ({ ...now, uid: session.uid, sent: keep });
    } catch (e) {
        console.warn('Statisztika feltöltése sikertelen – később újra', e);
        lsSet(FLUSH_KEY, 0);
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
// Művelet rögzítése, pl. track('generate') → "ic:generate"; scope: más előtag (pl. 'app')
export const track = (action, detail = '', scope = page) => {
    const t = Date.now();
    mutate((r) => {
        const k = `${scope}:${clean(action, 30)}`;
        r.a[k] = (r.a[k] || 0) + 1;
        logLine(r, t, `@${scope === page ? '' : `${scope}:`}${clean(action, 30)}${detail ? ` ${clean(detail, 40)}` : ''}`);
    }, t);
};

// Hibabejelentéshez csatolt diagnosztika (js/feedback-store.js)
export const diagnostics = () => {
    const d = deviceInfo();
    return {
        recent: lsGet(RECENT_KEY, []).slice(-30).map((x) => clean(x, 140)),
        device: `${d.os} ${d.osVer} · ${d.browser} · ${d.pwa ? 'telepített app' : 'böngésző'} · ${d.screen}`,
        version: `${APP.version} (${APP.build})`,
        online: navigator.onLine,
        sync: syncInfo(),
        page
    };
};

const onEvent = (ev) => {
    if (ev.kind === 'warn') {
        mutate((r) => { r.w[page] = (r.w[page] || 0) + 1; logLine(r, ev.t, `⚠${clean(ev.detail, 90)}`); }, ev.t);
    } else if (ev.kind === 'app') {
        track(ev.detail, '', 'app');
    }
};

// Indítás a munkamenet után (ui.js renderChrome hívja)
export const startTracking = (s) => {
    if (session || !s?.uid) return;
    session = s;
    if (!enabled) return;
    enter(loadedAt);

    // Betöltési idő: a navigáció kezdetétől az oldal használhatóságáig (munkamenet kész)
    const readyMs = Math.round(performance.now());
    mutate((r) => {
        const p = (r.p[page] ||= { n: 0, ms: 0 });
        p.n++; p.ms += Math.min(readyMs, 60000);
        if (readyMs > SLOW_MS) logLine(r, Date.now(), `🐢 ${Math.round(readyMs / 100) / 10}`);
    });

    // A modul betöltése előtti események (hibaüzenet, frissítés gomb)
    (window.__qubeEvents || []).splice(0).forEach(onEvent);
    addEventListener('qube:event', (e) => { onEvent(e.detail); window.__qubeEvents = []; });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { closeSegment(); flush(true); }
        else {
            const t = Date.now();
            if (newSessionCheck(t)) mutate((r) => { r.s++; logLine(r, t, '▶'); }, t);
            visStart = t;
        }
    });
    addEventListener('pagehide', () => closeSegment());
    addEventListener('offline', goOffline);
    addEventListener('online', () => { goOnline(); flush(); });
    if (navigator.onLine) goOnline(); else goOffline();

    // JS hibák – fejlesztéshez
    const onErr = (msg) => {
        const t = Date.now();
        mutate((r) => { r.e[page] = (r.e[page] || 0) + 1; logLine(r, t, `!${clean(msg, 90)}`); }, t);
    };
    addEventListener('error', (e) => onErr(e.message || 'Hiba'));
    addEventListener('unhandledrejection', (e) => onErr(e.reason?.message || String(e.reason || 'Promise hiba')));

    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        closeSegment(); visStart = Date.now();
        flush();
    }, 60 * 1000);

    flush();
    loadSettings().then((st) => { enabled = st?.analytics?.enabled !== false; if (!enabled) writeQ({}); });
};
