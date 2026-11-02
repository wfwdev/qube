// ============================================================
// Admin vészkijárat – egyszer használatos vészkódok
// - Az admin a Beállításokban kódokat generál (csak egyszer látja őket).
// - A szerverre csak a kódok SHA-256 lenyomata kerül, maga a kód soha.
// - Ha az admin új eszközről "Összekapcsolás folyamatban" állapotba kerül,
//   egy kóddal visszaveszi a fiókját; a kód ezzel elhasználódik.
// ============================================================
import {
    db, collection, doc, getDocs, query, where, writeBatch, updateDoc, serverTimestamp
} from './firebase.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // nincs 0/O, 1/I – nem téveszthető
export const CODE_COUNT = 5;

export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const hashCode = async (code) => {
    const data = new TextEncoder().encode(`qube-recovery:${normalizeCode(code)}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const randomCode = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const s = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
};

// ---------- Admin: kódok ----------
export const countCodes = async (empId) => {
    const snap = await getDocs(query(collection(db, 'recoveryCodes'), where('empId', '==', empId)));
    return snap.docs.filter((d) => d.data().empId === empId).length;
};

// Új kódsor: a régi (fel nem használt) kódok érvénytelenné válnak
export const regenerateCodes = async (empId) => {
    const old = await getDocs(query(collection(db, 'recoveryCodes'), where('empId', '==', empId)));
    const codes = Array.from({ length: CODE_COUNT }, randomCode);
    const hashes = await Promise.all(codes.map(hashCode));
    const batch = writeBatch(db);
    old.docs.filter((d) => d.data().empId === empId).forEach((d) => batch.delete(doc(db, 'recoveryCodes', d.id)));
    hashes.forEach((h) => batch.set(doc(db, 'recoveryCodes', h), { empId, createdAt: serverTimestamp() }));
    await batch.commit();
    return codes;
};

// ---------- Visszaállítás (összekapcsolásra váró eszközről) ----------
export const recoverWithCode = async ({ uid, empId, code }) => {
    if (normalizeCode(code).length !== 10) throw Object.assign(new Error('format'), { code: 'format' });
    const h = await hashCode(code);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), { role: 'admin', status: 'active', recoveredWith: h });
    batch.delete(doc(db, 'recoveryCodes', h));
    batch.set(doc(db, 'empIds', empId), { uid });
    await batch.commit();

    // Most már admin: a régi eszköz fiókja "áthelyezve" lesz
    try {
        const same = await getDocs(query(collection(db, 'users'), where('empId', '==', empId)));
        await Promise.all(same.docs
            .filter((d) => d.id !== uid && d.data().empId === empId && d.data().status !== 'merged')
            .map((d) => updateDoc(doc(db, 'users', d.id), { status: 'merged' })));
    } catch (e) { console.warn('Régi fiók lezárása később', e); }
};
