// My I-Car : rend l'appli installable et permet de l'ouvrir même sans réseau.
// Toujours la dernière version quand il y a du réseau ; l'IA (/api/) n'est jamais mise en cache.
const CACHE = 'myicar-v16';
const BASE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});

// Alertes des agents (prêt en retard, échéances…)
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { texte: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.titre || 'My I-Car', {
    body: m.texte || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: m.tag || undefined, renotify: !!m.tag, data: { page: m.page || 'dashboard' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const page = (e.notification.data && e.notification.data.page) || 'dashboard';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => new URL(x.url).origin === location.origin);
    if (c) { c.postMessage({ aller: page }); return c.focus(); }
    return self.clients.openWindow('/?page=' + encodeURIComponent(page));
  }));
});
