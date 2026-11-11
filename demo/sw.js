/* 21GRAM Tennis is offline for now: this removes the old notification worker from devices that had it. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.registration.unregister()));
