/* sw.js — KeFo PWA
 * نطاق الخدمة: مجلد الموقع الحالي (مثلاً /kefo/)
 * ملاحظات:
 * - غيّر CACHE_VERSION عند أي تعديل كبير لضمان تحديث الكاش.
 */

const CACHE_VERSION = 'kefo-v32';
const APP_CACHE     = CACHE_VERSION;           // كاش الواجهة
const RUNTIME_CACHE = 'runtime-v1';
const FONT_CACHE    = 'font-cache-v1';
const MEDIA_CACHE   = 'media-cache-v1';

// أصول حرجة للواجهة (Shell)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// تفعيل Navigation Preload (أسرع في 4G/3G)
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // مطالبة بالتحكم مباشرة
    self.clients.claim();

    // تمكين preloading
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }

    // تنظيف الكاشات القديمة
    const keep = new Set([APP_CACHE, RUNTIME_CACHE, FONT_CACHE, MEDIA_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map(k => keep.has(k) ? Promise.resolve() : caches.delete(k)));
  })());
});

// تثبيت + precache
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    try { await cache.addAll(CORE_ASSETS); } catch (_) { /* قد تفشل بعض الروابط بالخارج */ }
    // تجاوز الانتظار
    self.skipWaiting();
  })());
});

// قناة لتحديث فوري (اختياري)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// أدوات إستراتيجيات
async function cacheFirst(request, cacheName = RUNTIME_CACHE, maxAgeSeconds = 0) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const resp = await fetch(request).catch(() => null);
  if (resp && resp.ok) {
    cache.put(request, resp.clone());
  }
  return resp || cached || new Response('', { status: 504, statusText: 'Offline' });
}

async function staleWhileRevalidate(request, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  const cachedPromise = cache.match(request, { ignoreSearch: true });
  const networkPromise = fetch(request).then(resp => {
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);

  const cached = await cachedPromise;
  return cached || (await networkPromise) || new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirst(request, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  try {
    // جرّب Navigation Preload أولاً
    const preload = await self.navigationPreload?.getState?.().then(s => s.enabled ? event.preloadResponse : null).catch(() => null);
    if (preload) return preload;
  } catch (_) {}

  try {
    const resp = await fetch(request);
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (_) {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || null;
  }
}

// مساعد HTML fallback بسيط
function offlineFallbackHTML() {
  const html = `
    <!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>KeFo — بلا اتصال</title>
    <body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto;display:grid;place-items:center;height:100vh;background:#071107;color:#def7e5">
      <div style="max-width:560px;text-align:center;padding:24px;border:1px solid rgba(0,255,136,.25);border-radius:12px;background:#0a150a">
        <h1 style="margin:0 0 8px;font-size:22px">أنت الآن بلا اتصال</h1>
        <p style="opacity:.8;line-height:1.8">بعض البيانات تحتاج للإنترنت (مثل المنشورات من الخادم)،
        لكن الواجهة الأساسية متاحة. أعد المحاولة عند توفر الشبكة.</p>
        <button onclick="location.reload()" style="margin-top:10px;padding:10px 14px;border-radius:10px;border:0;background:linear-gradient(90deg,#00ff88,#11ffaa);color:#071407;font-weight:800;cursor:pointer">تحديث</button>
      </div>
    </body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' }});
}

// اعتراض الطلبات
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // نُعالج فقط GET
  if (req.method !== 'GET') return;

  // تنقلات (HTML)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        // جرّب استخدام Navigation Preload إن أُتيح
        const preload = await event.preloadResponse;
        if (preload) return preload;

        // شبكة أولاً
        const net = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        if (net && net.ok) cache.put('./index.html', net.clone()); // تحديث النسخة
        return net;
      } catch (_) {
        // رجوع إلى index.html من الكاش أو صفحة بلا اتصال
        const cache = await caches.open(APP_CACHE);
        return (await cache.match('./index.html', { ignoreSearch: true })) || offlineFallbackHTML();
      }
    })());
    return;
  }

  // عدم محاولة كاش لواجهات Firestore/analytics
  if (
    /googleapis\.com\/(firestore|identitytoolkit|securetoken)/.test(url.href) ||
    /gstatic\.com\/firebasejs/.test(url.href)
  ) {
    // هذه غالباً تحتاج أونلاين — جرّب شبكة مباشرة، وإن فشل لا نوفّر بديل
    event.respondWith(fetch(req).catch(() => new Response('', { status: 504, statusText: 'Offline' })));
    return;
  }

  // Google Fonts: SWR
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  // وسائط يوتيوب المصغّرة / iframe: Cache-first
  if (/i\.ytimg\.com$/.test(url.host) || /youtube-nocookie\.com$/.test(url.host)) {
    event.respondWith(cacheFirst(req, MEDIA_CACHE, 60 * 60 * 24 * 7));
    return;
  }

  // أصول نفس الأصل (icons/css/js/صور المستخدم): SWR
  if (url.origin === location.origin) {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }

  // افتراضي: Network-first مع رجوع للكاش إن وُجد
  event.respondWith((async () => {
    const resp = await networkFirst(req, RUNTIME_CACHE);
    if (resp) return resp;
    const cache = await caches.open(RUNTIME_CACHE);
    return (await cache.match(req, { ignoreSearch: true })) || new Response('', { status: 504, statusText: 'Offline' });
  })());
});
