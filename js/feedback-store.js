// ============================================================
// Visszajelzések (hiba / ötlet) – beküldés helyi sorral
// Internet nélkül is "beküldhető": a telefonon vár, és amint van net,
// magától felmegy (bármelyik oldal megnyitásakor vagy net visszatérésekor).
// Firestore: feedback/{id} – a beküldő a sajátját látja, az admin mindet.
// ============================================================
import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';
import { APP } from './config.js';
import { track, diagnostics } from './track.js';

const OUTBOX = 'qube_fb_outbox';
const MAX_ATTEMPTS = 6;

export const TYPES = {
    bug:  { label: 'Hiba',  icon: '🐞' },
    idea: { label: 'Ötlet', icon: '💡' }
};

export const STATUS = {
    new:      { label: 'Új',          cls: 'fb-new' },
    progress: { label: 'Folyamatban', cls: 'fb-progress' },
    done:     { label: 'Kész',        cls: 'fb-done' },
    rejected: { label: 'Elutasítva',  cls: 'fb-rejected' }
};

const load = () => { try { return JSON.parse(localStorage.getItem(OUTBOX)) || []; } catch { return []; } };
const store = (v) => { try { localStorage.setItem(OUTBOX, JSON.stringify(v)); } catch { /* tele */ } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '')
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

export const pendingFeedback = () => load();

export const queueFeedback = (session, { type, module, text }) => {
    const item = {
        id: uuid(),
        uid: session.uid,
        name: session.user.name || '',
        empId: session.user.empId || '',
        type,
        module,
        text: String(text).trim().slice(0, 2000),
        clientTime: Date.now(),
        version: `${APP.version}${APP.build && APP.build !== 'dev' ? ` (${APP.build})` : ''}`,
        device: navigator.userAgent.slice(0, 200),
        attempts: 0
    };
    // Hibabejelentéshez automatikusan: az utolsó események, készülék, hálózat, várakozó adatok
    if (type === 'bug') { try { item.diag = diagnostics(); } catch { /* nem kritikus */ } }
    store([...load(), item]);
    track('send', type);
    return item;
};

let flushing = false;
export const flushFeedback = async (onChange) => {
    if (flushing || !navigator.onLine) return;
    const items = load();
    if (!items.length) return;
    flushing = true;
    try {
        for (const it of items) {
            const { attempts, ...data } = it;
            try {
                await setDoc(doc(db, 'feedback', it.id), { ...data, status: 'new', createdAt: serverTimestamp() });
                store(load().filter((x) => x.id !== it.id));
            } catch (e) {
                // Lehet, hogy már felment, csak a válasz veszett el
                const exists = await getDoc(doc(db, 'feedback', it.id)).then((s) => s.exists()).catch(() => false);
                if (exists) { store(load().filter((x) => x.id !== it.id)); continue; }
                const offline = e?.code === 'unavailable' || !navigator.onLine;
                if (!offline) {
                    const next = load().map((x) => x.id === it.id ? { ...x, attempts: (x.attempts || 0) + 1 } : x)
                        .filter((x) => (x.attempts || 0) < MAX_ATTEMPTS);
                    store(next);
                }
                if (offline) break;
            }
        }
    } finally {
        flushing = false;
        onChange?.();
    }
};

window.addEventListener('online', () => flushFeedback());
