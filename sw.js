// ============================================================
// Qube Service Worker
// - Saját fájlok: cache-ből azonnal, háttérben frissítve
// - CDN könyvtárak (verziózott URL-ek): cache először
// - Firebase API hívásokba nem nyúl (azokat a Firestore SDK kezeli offline)
// Új kiadásnál elég a VERSION-t emelni → megjelenik a "Frissítés" gomb.
// ============================================================
const VERSION = 'qube-v2.1.1';
const CACHE = `${VERSION}`;

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
    e.waitUntil(caches.open(CACHE).then(async (c) => {
        await c.addAll(APP_SHELL);
        await Promise.allSettled(CDN_PRECACHE.map((u) => c.add(u)));
    }));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (e) => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Saját fájlok: azonnal a cache-ből (gyors oldalváltás), a háttérben frissít.
// Új kiadásnál a VERSION emelése úgyis teljesen új cache-t tölt le.
const staleWhileRevalidate = async (e, req) => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const update = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
    }).catch(() => null);
    if (hit) {
        e.waitUntil(update);
        return hit;
    }
    const res = await update;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
};

const cacheFirst = async (req) => {
    const cache = await caches.open(CACHE);
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
        e.respondWith(staleWhileRevalidate(e, req));
    } else if (CDN_HOSTS.includes(url.hostname)) {
        e.respondWith(cacheFirst(req));
    }
    // minden más (Firestore, Auth API) → böngésző alapértelmezés
});
