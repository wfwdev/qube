// ============================================================
// Firebase inicializálás – egyetlen helyen, minden modul innen importál
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    initializeFirestore, memoryLocalCache,
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp, Timestamp, increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// Memória cache: oldalváltáskor nem kell az IndexedDB-zárra várni
// (ez okozta a perces betöltést). A gyors indulást a session cache adja.
// Long polling automatikus felismerése: céges WiFi / proxy mögött is működik.
export const db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalAutoDetectLongPolling: true
});

export {
    signInAnonymously, onAuthStateChanged,
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp, Timestamp, increment
};
