// ============================================================
// Magyar munkaidő-naptár logika (szerver nélkül, offline is működik)
// - Munkaszüneti napok: Mt. 102. § – a húsvéttól függőket évente számolja
// - Áthelyezett munkanapok: beépített (hivatalos rendelet) + admin kiegészítés
// - 3 műszakos heti forgás (DE / DU / É)
// ============================================================

// Hivatalos munkanap-áthelyezések. Új év rendeletét az admin a Beállításokban
// is felveheti – az felülírja / kiegészíti ezt a listát.
//   10/2025. (IV. 30.) NGM rendelet – 2026
export const BUILTIN_SWAPS = {
    '2026-01-02': 'rest',   // péntek – pihenőnap
    '2026-01-10': 'work',   // szombat – ledolgozós (jan. 2. helyett)
    '2026-08-21': 'rest',   // péntek – pihenőnap
    '2026-08-08': 'work'    // szombat – ledolgozós (aug. 21. helyett)
};

export const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
export const DAYS_SHORT = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
export const DAYS_LONG = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
export const daysBetween = (a, b) => Math.round((b - a) / 86400000);
// Hétfő = 0 … vasárnap = 6
export const dow = (d) => (d.getDay() + 6) % 7;
export const mondayOf = (d) => addDays(d, -dow(d));

export const fmtDay = (d) => `${MONTHS[d.getMonth()].slice(0, 3)}. ${d.getDate()}.`;
export const fmtLong = (d) => `${d.getFullYear()}. ${MONTHS[d.getMonth()]} ${d.getDate()}., ${DAYS_LONG[d.getDay()]}`;

// ---------- Húsvét (Gauss–Meeus algoritmus, Gergely-naptár) ----------
export const easter = (y) => {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
};

// ---------- Munkaszüneti napok ----------
const holidayCache = new Map();
export const holidays = (y) => {
    if (holidayCache.has(y)) return holidayCache.get(y);
    const e = easter(y);
    const list = [
        [new Date(y, 0, 1), 'Újév'],
        [new Date(y, 2, 15), 'Nemzeti ünnep'],
        [addDays(e, -2), 'Nagypéntek'],
        [e, 'Húsvétvasárnap'],
        [addDays(e, 1), 'Húsvéthétfő'],
        [new Date(y, 4, 1), 'A munka ünnepe'],
        [addDays(e, 49), 'Pünkösdvasárnap'],
        [addDays(e, 50), 'Pünkösdhétfő'],
        [new Date(y, 7, 20), 'Államalapítás ünnepe'],
        [new Date(y, 9, 23), 'Nemzeti ünnep'],
        [new Date(y, 10, 1), 'Mindenszentek'],
        ...(y >= 2026 ? [[new Date(y, 11, 24), 'Szenteste']] : []),
        [new Date(y, 11, 25), 'Karácsony'],
        [new Date(y, 11, 26), 'Karácsony másnapja']
    ];
    const map = new Map(list.map(([d, n]) => [iso(d), n]));
    holidayCache.set(y, map);
    return map;
};

// ---------- Egy nap besorolása ----------
// type: 'holiday' | 'workSat' (ledolgozós) | 'restSwap' (áthelyezett pihenőnap) | 'weekend' | 'work'
export const dayInfo = (d, swaps = BUILTIN_SWAPS) => {
    const k = iso(d);
    const h = holidays(d.getFullYear()).get(k);
    if (h) return { type: 'holiday', name: h, workday: false };
    if (swaps[k] === 'work') return { type: 'workSat', name: 'Ledolgozós munkanap', workday: true };
    if (swaps[k] === 'rest') return { type: 'restSwap', name: 'Áthelyezett pihenőnap', workday: false };
    if (dow(d) >= 5) return { type: 'weekend', name: '', workday: false };
    return { type: 'work', name: '', workday: true };
};

export const nextHoliday = (from = today()) => {
    for (let i = 0; i < 400; i++) {
        const d = addDays(from, i);
        const h = holidays(d.getFullYear()).get(iso(d));
        if (h) return { date: d, name: h, inDays: i };
    }
    return null;
};

// ---------- Műszak ----------
export const SHIFTS = {
    DE:  { short: 'DE', label: 'Délelőtt', time: '06–14', cls: 'sh-de' },
    DU:  { short: 'DU', label: 'Délután',  time: '14–22', cls: 'sh-du' },
    E:   { short: 'É',  label: 'Éjszaka',  time: '22–06', cls: 'sh-e' },
    NAP: { short: 'N',  label: 'Nappalos', time: '',      cls: 'sh-nap' }
};
export const ORDERS = {
    'DE-DU-E': { label: 'DE → DU → É', seq: ['DE', 'DU', 'E'] },
    'DE-E-DU': { label: 'DE → É → DU', seq: ['DE', 'E', 'DU'] }
};

// cfg: { mode: '3' | '1' | 'none', order, refMonday: 'YYYY-MM-DD', refShift: 'DE'|'DU'|'E' }
export const shiftForDate = (d, cfg) => {
    if (!cfg || cfg.mode === 'none') return null;
    if (cfg.mode === '1') return 'NAP';
    const seq = (ORDERS[cfg.order] || ORDERS['DE-DU-E']).seq;
    const weeks = Math.round(daysBetween(parseIso(cfg.refMonday), mondayOf(d)) / 7);
    const start = Math.max(0, seq.indexOf(cfg.refShift));
    return seq[(((start + weeks) % 3) + 3) % 3];
};

// ---------- Szabadság: egybefüggő szakaszok ----------
// Két szabadságnap egy szakasz, ha köztük csak nem-munkanap van.
export const groupRanges = (isoDays, swaps) => {
    const days = [...new Set(isoDays)].sort();
    const out = [];
    for (const k of days) {
        const d = parseIso(k);
        const last = out[out.length - 1];
        if (last) {
            let gapOnlyRest = true;
            for (let x = addDays(last.end, 1); x < d; x = addDays(x, 1)) {
                if (dayInfo(x, swaps).workday) { gapOnlyRest = false; break; }
            }
            if (gapOnlyRest) { last.end = d; last.count++; continue; }
        }
        out.push({ start: d, end: d, count: 1 });
    }
    return out;
};

export const fmtRange = (r) => (iso(r.start) === iso(r.end) ? fmtDay(r.start)
    : r.start.getMonth() === r.end.getMonth() ? `${MONTHS[r.start.getMonth()].slice(0, 3)}. ${r.start.getDate()}–${r.end.getDate()}.`
    : `${fmtDay(r.start)} – ${fmtDay(r.end)}`);
