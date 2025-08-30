/* sw.js — KeFo PWA */
const VERSION = 'kefo-v33';
const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-128.png',
  'icons/icon-144.png',
  'icons/icon-152.png',
  'icons/icon-192.png',
  'icons/icon-384.png',
  'icons/icon-512.png'
];

const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const IMG_CACHE = `images-${VERSION}`;
const FONTS_CACHE = `fonts-${VERSION}`;

// حد أقصى لصور الكاش
const IMG_MAX_ENTRIES = 60;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(APP_SHELL);
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
    } catch (e) { /* ignore */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => ![SHELL_CACHE, RUNTIME_CACHE, IMG_CACHE, FONTS_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    self.clients.claim();
  })());
});

// Helper: حذف أقدم عنصر عند تجاوز الحد
async function enforceImageLimit(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > IMG_MAX_ENTRIES) {
    // احذف الأقدم (ببساطة أول مفتاح)
    await cache.delete(keys[0]);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // فقط GET
  if (request.method !== 'GET') return;

  // لا نتدخل في Firebase/Firestore
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebaseio.com')) {
    return;
  }

  // تنقلات SPA → ارجع index.html (Network-First مع fallback)
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // استفد من navigationPreload لو موجود
        const preload = await event.preloadResponse;
        if (preload) return preload;

        const net = await fetch(request, { cache: 'no-store' });
        // إن نجحت الشبكة نخزن نسخة من index.html
        const cache = await caches.open(SHELL_CACHE);
        cache.put('index.html', net.clone());
        return net;
      } catch {
        // fallback إلى index.html من الكاش
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match('index.html');
        if (cached) return cached;
        // محاولة أخيرة: أي رد من الكاش
        const any = await caches.match(request);
        return any || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // ملفات الخطوط من Google — Cache First
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const net = await fetch(request);
        cache.put(request, net.clone());
        return net;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // صور (نفس الأصل أو خارجي مثل i.ytimg.com) — Cache First
  if (request.destination === 'image' ||
      /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const net = await fetch(request, { mode: 'cors' });
        // خزّن فقط إن نجحت
        if (net && net.status === 200) {
          cache.put(request, net.clone());
          enforceImageLimit(IMG_CACHE);
        }
        return net;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // بقية ملفات نفس الأصل (JS/CSS/JSON…) — Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      const fetchPromise = fetch(request).then((net) => {
        // خزّن فقط الردود الصالحة
        if (net && net.status === 200 && net.type === 'basic') {
          cache.put(request, net.clone());
        }
        return net;
      }).catch(() => null);

      // أرجع الكاش فورًا، وحدث في الخلفية
      return cached || fetchPromise || Response.error();
    })());
    return;
  }

  // خارجي عام — Network First ثم كاش
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const net = await fetch(request);
      if (net && net.status === 200) cache.put(request, net.clone());
      return net;
    } catch {
      const cached = await cache.match(request);
      return cached || Response.error();
    }
  })());
});

// استقبال أوامر من الصفحة (لتحديث الخدمة فورًا)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
