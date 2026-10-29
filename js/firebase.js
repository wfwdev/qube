// ============================================================
// Firebase inicializálás – egyetlen helyen, minden modul innen importál
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// Offline cache (IndexedDB) – több fül esetén is működik
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export {
    signInAnonymously, onAuthStateChanged,
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp, Timestamp
};
