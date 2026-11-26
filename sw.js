// Service worker de LA HUELLA DE BIBI & TRIS (V2.3.0).
// Solo guarda en caché los archivos de la APLICACIÓN para que abra sin conexión.
// Nunca toca los datos del usuario (están en IndexedDB, que el service worker no lee ni borra).
// Al publicar una versión nueva, cambia el número de CACHE.
const CACHE = "huella-bibi-tris-v2-3-0";
const SHELL = ["./", "index.html", "sync.js", "cuaderno.jpg", "logo.png", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "recursos/abrazo.webp", "recursos/corazon.webp", "recursos/bibi.webp", "recursos/tris.webp", "recursos/arco_asia.webp", "recursos/arco_hada.webp", "recursos/arco_irina.webp", "recursos/arco_bibi.webp", "recursos/arco_tris.webp"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("huella-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;   // Dropbox y fuentes de Google no pasan por aquí
  // Caché primero (funciona sin conexión) y actualización en segundo plano.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
    const network = fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => cached || (req.mode === "navigate" ? caches.match("index.html") : undefined));
    return cached || network;
  }));
});
