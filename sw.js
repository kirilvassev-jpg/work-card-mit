const CACHE_VERSION = 'v5';
const CACHE_NAME = 'work-card-' + CACHE_VERSION;

const urlsToCache = [
  '/work-card-mit/',
  '/work-card-mit/index.html',
  '/work-card-mit/history.html',
  '/work-card-mit/login.html',
  '/work-card-mit/requests.html',
  '/work-card-mit/assign.html',
  '/work-card-mit/dashboard.html',
  '/work-card-mit/tablet.html',
  '/work-card-mit/schedule.html',
  '/work-card-mit/manifest.json',
  '/work-card-mit/Repairs.png'
];

// Install - cache all pages
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Activate - delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - Network First strategy
self.addEventListener('fetch', event => {
  // Skip non-GET and API requests
  if (event.request.method !== 'GET' || event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
