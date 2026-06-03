const CACHE_NAME = 'hr-attendance-cache-v1';

// Static assets to cache immediately on installation
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/confirm-action.html',
  '/manifest.json',
  '/assets/global.css',
  '/assets/logo.png',
  '/assets/app_icon.png',
  '/employee/index.html',
  '/employee/app.js',
  '/employee/biometric-manager.js',
  '/hr/index.html',
  '/hr/app.js'
];

// Local faceapi model assets to pre-cache to make face detection instant
const MODEL_ASSETS = [
  '/models/face_landmark_68_model-shard1',
  '/models/face_landmark_68_model-weights_manifest.json',
  '/models/face_recognition_model-shard1',
  '/models/face_recognition_model-shard2',
  '/models/face_recognition_model-weights_manifest.json',
  '/models/ssd_mobilenetv1_model-shard1',
  '/models/ssd_mobilenetv1_model-shard2',
  '/models/ssd_mobilenetv1_model-weights_manifest.json'
];

// Install Event - Pre-cache critical files and models
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching critical assets & models');
      // We run cache.addAll on critical assets and models separately
      // to ensure failure in one doesn't block the other
      const cacheCritical = cache.addAll(CRITICAL_ASSETS)
        .catch(err => console.error('[Service Worker] Failed to cache critical assets:', err));
        
      const cacheModels = cache.addAll(MODEL_ASSETS)
        .catch(err => console.error('[Service Worker] Failed to cache model assets:', err));
        
      return Promise.all([cacheCritical, cacheModels]);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Handle intercepting and caching strategies
self.addEventListener('fetch', (event) => {
  // Only handle GET requests; POST, PUT, DELETE should bypass the service worker
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Bypass database requests (Supabase API or local API endpoints)
  if (url.pathname.includes('/api/') || url.hostname.includes('supabase.co')) {
    return;
  }

  // Determine if asset is immutable (CDN libraries, models, fonts, images)
  const isImmutable = url.pathname.includes('/models/') || 
                      url.hostname.includes('cdn.jsdelivr.net') || 
                      url.hostname.includes('fonts.gstatic.com') ||
                      url.hostname.includes('fonts.googleapis.com') ||
                      url.pathname.endsWith('.png') ||
                      url.pathname.endsWith('.jpg') ||
                      url.pathname.endsWith('.jpeg') ||
                      url.pathname.endsWith('.ico');

  if (isImmutable) {
    // Cache-First Strategy
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request).then((networkResponse) => {
          // Check if we received a valid response
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          
          return networkResponse;
        }).catch((err) => {
          console.warn('[Service Worker] Fetch failed for immutable resource:', url.pathname, err);
        });
      })
    );
  } else {
    // Stale-While-Revalidate Strategy for HTML, JS, CSS
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch((err) => {
          // Quietly swallow fetch errors when offline, return cachedResponse if present
          if (cachedResponse) return cachedResponse;
          throw err;
        });
        
        return cachedResponse || fetchPromise;
      })
    );
  }
});
