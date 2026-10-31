// ============================================================
// Funkció-beállítások (admin állítja a Beállítások oldalon)
// Firestore: settings/app – mindenki olvassa, csak admin írja.
// Offline / hiba esetén az utolsó ismert értéket használja.
// ============================================================
import { db, doc, getDoc, setDoc } from './firebase.js';

const CACHE_KEY = 'qube_settings';

export const DEFAULT_ADVENT_MESSAGES = [
    'Első nap! Igyál egy jó kávét, megérdemled! ☕',
    'Kitartás! Minden nappal közelebb a pihenés. 🚀',
    'Mai kihívás: dicsérd meg az egyik kollégádat! 🤝',
    'Ma minden kód elsőre átmegy. (Reméljük!) 🟢',
    'Holnap jön a Mikulás! Pucold ki a csizmát! 👢',
    'Boldog Mikulást! Remélem, került valami a csizmába. 🎅',
    'Már egy hete nyitogatod az ablakokat. Szép munka! 🏭',
    'Csak lazán, ma senki sem hajt a tatár! 🧘',
    'Figyelted már, milyen szépen hullik a hó az appban? ❄️',
    'Mai bónusz: veregesd vállon magad egy jó műszak után! 👏',
    'Félidő! Rohamosan közeleg a karácsony! 🎄',
    'Lassan érdemes elgondolkodni az ajándékokon… 🎁',
    'Igyál egy pohár vizet, fontos a hidratálás! 💧',
    'Egy mosoly sokat segít a műszak végén. Próbáld ki! 😁',
    'Tudtad? A Qube is várja már az ünnepeket! 🤖',
    'Lassan itt a pihenés ideje. Tarts ki! 🔋',
    'Már csak egy hét Szentestéig! ⏳',
    'Hajrá! Mindenki számít a munkádra! 💪',
    'Érzed már a bejgli illatát? 🥐',
    'Ma este nézz meg egy jó filmet otthon! 🎬',
    'Ma van az év legrövidebb napja – innen már csak világosodik! 🌅',
    'Mindjárt itt az ünnep! Utolsó hajrá! 🏎️',
    'Holnap Szenteste! Ma már csak óvatosan a raklapokkal! ⚠️',
    '🎄 Boldog karácsonyt kíván a Qube! Pihenj sokat! 🎄'
];

export const DEFAULT_SETTINGS = {
    advent: {
        enabled: false,   // adventi naptár a kezdőlapon (december 1–31.)
        snow: true,       // hóesés a kezdőlapon, amíg a naptár aktív
        messages: DEFAULT_ADVENT_MESSAGES
    }
};

const merge = (data) => {
    const a = data?.advent || {};
    const msgs = Array.isArray(a.messages) ? a.messages : [];
    return {
        advent: {
            enabled: a.enabled === true,
            snow: a.snow !== false,
            // hiányzó / üres napokra az alapértelmezett üzenet
            messages: DEFAULT_ADVENT_MESSAGES.map((m, i) => (typeof msgs[i] === 'string' && msgs[i].trim()) ? msgs[i] : m)
        }
    };
};

const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } };

// Gyors: azonnal a helyi (utolsó ismert) beállítás – lehet null
export const cachedSettings = () => { const c = readCache(); return c ? merge(c) : null; };

// Friss beállítás a szerverről (hiba esetén a helyi / alapértelmezett)
export const loadSettings = async () => {
    try {
        const snap = await getDoc(doc(db, 'settings', 'app'));
        const data = snap.exists() ? snap.data() : {};
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* tele */ }
        return merge(data);
    } catch (e) {
        console.warn('Beállítások nem tölthetők be', e);
        return merge(readCache() || {});
    }
};

// Admin: az adventi rész mentése (a többi beállítást nem érinti)
export const saveAdvent = async (advent) => {
    await setDoc(doc(db, 'settings', 'app'), {
        advent: {
            enabled: !!advent.enabled,
            snow: !!advent.snow,
            messages: advent.messages.map((m) => String(m).slice(0, 300))
        }
    }, { merge: true });
};
