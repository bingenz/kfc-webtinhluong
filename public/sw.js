const STATIC_CACHE = "ca-lam-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(["/favicon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy)));
    return response;
  })));
});

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : { title: "Ca Lam", body: "Bạn có hoạt động mới" };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = windows.some((client) => client.visibilityState === "visible" && client.focused);
    windows.forEach((client) => client.postMessage({ type: "push-activity", activityId: payload.data?.activityId }));
    if (!focused) await self.registration.showNotification(payload.title, { body: payload.body, tag: payload.tag, data: payload.data });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});
