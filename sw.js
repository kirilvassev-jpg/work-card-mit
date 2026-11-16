const CACHE_NAME = 'work-card-v17';
const ASSETS = ['index.html','history.html','login.html','requests.html','assign.html','dashboard.html','tablet.html','schedule.html','devices.html','manifest.json','app-config.js','auth.js','login.js','devices.js','draft-store.js','drafts.js','theme.css','ui.js','datepicker.js','Repairs.png','icons/icon-192.png','icons/icon-512.png'];
const base = new URL('./', self.location.href);
const allowed = new Set(ASSETS.map(file => new URL(file, base).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([...allowed])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('work-card-') && name !== CACHE_NAME).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Never cache API responses, tokens, other origins, or arbitrary URLs.
  if (event.request.method !== 'GET' || !allowed.has(event.request.url)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || new Response('Няма интернет връзка.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});
