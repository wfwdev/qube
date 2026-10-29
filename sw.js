// ============================================================
// Qube Service Worker
// - Saját fájlok: hálózat először (mindig a friss kód), offline → cache
// - CDN könyvtárak (verziózott URL-ek): cache először
// - Firebase API hívásokba nem nyúl (azokat a Firestore SDK kezeli offline)
// Új kiadásnál elég a VERSION-t emelni → megjelenik a "Frissítés" gomb.
// ============================================================
const VERSION = 'qube-v2.0.0';
const CACHE = `${VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './admin.html',
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
    './js/admin.js'
];

const CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'www.gstatic.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
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

// Gyenge gyári WiFi esetén ennyi várakozás után a cache-ből szolgál ki
const NETWORK_TIMEOUT = 4000;

const networkFirst = async (req) => {
    const cache = await caches.open(CACHE);
    const fromNetwork = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
    });
    try {
        const timeout = new Promise((resolve) => setTimeout(async () => {
            resolve(await cache.match(req, { ignoreSearch: true }) || fromNetwork);
        }, NETWORK_TIMEOUT));
        return await Promise.race([fromNetwork, timeout]);
    } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('./index.html');
        throw new Error('offline');
    }
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
        e.respondWith(networkFirst(req));
    } else if (CDN_HOSTS.includes(url.hostname)) {
        e.respondWith(cacheFirst(req));
    }
    // minden más (Firestore, Auth API) → böngésző alapértelmezés
});
