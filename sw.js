const CACHE_NAME = 'hr-attendance-cache-v2';

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
    }).then(() => {
      // Schedule notification triggers if supported
      if (typeof scheduleNotificationTriggers === 'function') {
        scheduleNotificationTriggers();
      }
      return self.clients.claim();
    })
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

// Reminders Check
let checkInterval = null;
let lastCheckInTime = '';
let lastCheckOutTime = '';

function triggerReminderNotification(title, body) {
  const now = new Date();
  const timeKey = `${now.toDateString()}_${now.getHours()}_${now.getMinutes()}`;

  if (title.includes('الحضور')) {
    if (lastCheckInTime === timeKey) return;
    lastCheckInTime = timeKey;
  } else {
    if (lastCheckOutTime === timeKey) return;
    lastCheckOutTime = timeKey;
  }

  const options = {
    body: body,
    icon: '/assets/app_icon.png',
    badge: '/assets/app_icon.png',
    vibrate: [200, 100, 200],
    data: {
      url: '/employee/index.html'
    }
  };

  self.registration.showNotification(title, options);
}

function startReminderTimer() {
  if (checkInterval) return;
  checkInterval = setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const day = now.getDay(); // 0 = Sunday, ..., 5 = Friday, 6 = Saturday

    // Check if it's a weekend (default: Friday=5, Saturday=6)
    if (day === 5 || day === 6) return;

    // Check-in reminder at 8:45 AM
    if (hours === 8 && minutes === 45) {
      triggerReminderNotification(
        'تذكير تسجيل الحضور ⏰',
        'صباح الخير! يرجى تسجيل حضورك اليوم في موقع العمل.'
      );
    }

    // Check-out reminders
    const isCheckOutTime =
      (hours === 15 && minutes === 0) ||// 3:00 PM
      (hours === 14 && minutes === 45) || //2:45
      (hours === 15 && minutes === 30) ||  // 3:30 PM
      (hours === 16 && minutes === 0) ||   // 4:00 PM
      (hours === 17 && minutes === 0);     // 5:00 PM

    if (isCheckOutTime) {
      triggerReminderNotification(
        'تذكير تسجيل الانصراف ⏰',
        'مرحباً! يرجى التأكد من تسجيل انصرافك في حال انتهاء وقت العمل.'
      );
    }
  }, 60000); // Check every minute
}

// Start timer when service worker starts
startReminderTimer();

// Handle clicking on the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const targetUrl = '/employee/index.html';

      // Check if there is already a window open with this URL and focus it
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.pathname.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }

      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Schedule Notification Triggers (experimental API fallback)
function scheduleNotificationTriggers() {
  if (!('showTrigger' in Notification.prototype) || !self.TimestampTrigger) {
    console.log('[Service Worker] Notification Triggers API not supported');
    return;
  }

  // Schedule for the next 7 days
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date();
    targetDate.setDate(now.getDate() + i);
    const day = targetDate.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday

    // Skip weekends (Friday and Saturday)
    if (day === 5 || day === 6) continue;

    const dateKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    // 1. Check-in at 8:45 AM
    const checkInTime = new Date(targetDate);
    checkInTime.setHours(8, 45, 0, 0);
    if (checkInTime > now) {
      self.registration.showNotification('تذكير تسجيل الحضور ⏰', {
        body: 'صباح الخير! يرجى تسجيل حضورك اليوم في موقع العمل.',
        icon: '/assets/app_icon.png',
        badge: '/assets/app_icon.png',
        vibrate: [200, 100, 200],
        tag: `checkin-${dateKey}`,
        showTrigger: new self.TimestampTrigger(checkInTime.getTime()),
        data: { url: '/employee/index.html' }
      }).catch(err => console.error('Failed to schedule check-in trigger:', err));
    }

    // 2. Check-out times: 3:00 PM, 3:30 PM, 4:00 PM, 5:00 PM
    const checkoutHours = [
      { h: 15, m: 0, label: '3:00' },
      { h: 15, m: 30, label: '3:30' },
      { h: 16, m: 0, label: '4:00' },
      { h: 17, m: 0, label: '5:00' }
    ];

    checkoutHours.forEach(({ h, m, label }) => {
      const checkoutTime = new Date(targetDate);
      checkoutTime.setHours(h, m, 0, 0);
      if (checkoutTime > now) {
        self.registration.showNotification('تذكير تسجيل الانصراف ⏰', {
          body: 'مرحباً! يرجى التأكد من تسجيل انصرافك في حال انتهاء وقت العمل.',
          icon: '/assets/app_icon.png',
          badge: '/assets/app_icon.png',
          vibrate: [200, 100, 200],
          tag: `checkout-${dateKey}-${label}`,
          showTrigger: new self.TimestampTrigger(checkoutTime.getTime()),
          data: { url: '/employee/index.html' }
        }).catch(err => console.error(`Failed to schedule checkout ${label} trigger:`, err));
      }
    });
  }
  console.log('[Service Worker] Successfully scheduled notification triggers for the next 7 days.');
}

// Handle message events
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'schedule_reminders') {
    scheduleNotificationTriggers();
  }
});
