/* La Huella de Bibi & Tris · funcionamiento sin conexión. Sube el número de V al publicar una versión nueva. */
const V = 'huella-v2.0.0';
const SHELL = ['./', 'index.html', 'sync.js', 'cuaderno.jpg', 'logo.png', 'manifest.webmanifest', 'icon-192.png', 'recursos/abrazo.webp', 'recursos/corazon.webp', 'recursos/bibi.webp', 'recursos/tris.webp'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || /dropbox/.test(u.hostname)) return;   // Dropbox nunca pasa por la caché
  e.respondWith(fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(V).then(ch => ch.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
