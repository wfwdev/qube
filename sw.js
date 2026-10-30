// ============================================================
// Qube Service Worker
// - Saját fájlok: egy verzió MINDIG egyben töltődik le (telepítéskor, a
//   böngésző HTTP cache-ét megkerülve), és onnan szolgálja ki – így nem
//   keveredhet régi és új fájl.
// - CDN könyvtárak (verziózott URL-ek): cache először
// - Firebase API hívásokba nem nyúl
// A VERSION-t GitHub kiadáskor a deploy automatikusan átírja (commit azonosító),
// így minden kiadás új verzió → megjelenik a "Frissítés" gomb. Kézzel nem kell emelni.
// ============================================================
const VERSION = 'qube-dev';
const CACHE = VERSION;
const CDN_CACHE = 'qube-cdn-v1'; // verziózott URL-ek, kiadások között megmarad

const APP_SHELL = [
    './',
    './index.html',
    './admin.html',
    './ic.html',
    './style.css',
    './manifest.json',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-32.png',
    './js/config.js',
    './js/firebase-config.js',
    './js/firebase.js',
    './js/ui.js',
    './js/session.js',
    './js/home.js',
    './js/admin.js',
    './js/ic.js'
];

// Külső könyvtárak előre letöltve (offline használathoz) – ha nem sikerül, nem akadályozza a telepítést
const CDN_PRECACHE = [
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

const CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'www.gstatic.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const c = await caches.open(CACHE);
        // ?v=VERSION → a GitHub CDN sem adhat régi másolatot (más URL = friss lekérés),
        // cache: 'reload' → a böngésző saját gyorsítótára sem. Ha bármelyik fájl hibás,
        // a telepítés megszakad, és a régi, működő verzió marad.
        await Promise.all(APP_SHELL.map(async (u) => {
            const res = await fetch(new Request(`${u}?v=${VERSION}`, { cache: 'reload' }));
            if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
            await c.put(u, res);
        }));
        const cdn = await caches.open(CDN_CACHE);
        await Promise.allSettled(CDN_PRECACHE.map(async (u) => {
            if (!(await cdn.match(u))) await cdn.add(u);
        }));
    })());
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (e) => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Saját fájlok: a verzió cache-éből; ha valami hiányzik, hálózatról
const appFile = async (req) => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
    } catch {
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return Response.error();
    }
};

const cdnFile = async (req) => {
    const cache = await caches.open(CDN_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
};

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        if (url.pathname.endsWith('/reset.html')) return; // vészkijárat: mindig a hálózatról
        e.respondWith(appFile(req));
    } else if (CDN_HOSTS.includes(url.hostname)) {
        e.respondWith(cdnFile(req));
    }
    // minden más (Firestore, Auth API) → böngésző alapértelmezés
});
