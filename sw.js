/* Santani Calzado: guarda una copia de la app para que abra aunque no haya internet.
   Siempre intenta primero la versión nueva y usa la guardada solo si no hay conexión. */
var V = 'santani-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET' || r.url.indexOf('/_blob/') >= 0) return;
  e.respondWith(fetch(r).then(function (res) {
    var copy = res.clone();
    caches.open(V).then(function (c) { c.put(r, copy); }).catch(function () {});
    return res;
  }).catch(function () {
    return caches.match(r).then(function (m) { return m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()); });
  }));
});
