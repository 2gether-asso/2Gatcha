// Service worker 2Gatcha (2026-10-20) : cache du site + notifications push.
//
// - Pages (HTML) : reseau d'abord (le site reste toujours a jour), copie en
//   cache ; reseau trop lent (> 3 s) ou coupe : derniere copie, sinon la page
//   hors ligne (offline.html).
// - CSS, JS, images et polices du site : servis du cache tout de suite, puis
//   rafraichis en arriere-plan (stale-while-revalidate). Chaque deploiement
//   change le suffixe ?v= des CSS/JS (static.yml) : l'ancienne copie du meme
//   fichier est alors retiree.
// - Illustrations des cartes (/image?id=, immuables cote API) : cache d'abord,
//   au plus IMAGE_MAX images (les plus anciennes sortent), seulement quand
//   l'API est sur le meme domaine (image Docker). Depuis GitHub Pages, la
//   reponse est "opaque" (autre domaine) : Chrome compterait ~7 Mo de quota
//   par image, on laisse donc le cache HTTP du navigateur (immutable, 1 an).
//   Meme chose pour les polices Google.
// - API (/webhook/...) et tout ce qui n'est pas un GET : jamais en cache.
// Les notifications push (api/src/native/push.js) restent gerees plus bas.

const VERSION = "2026-10-30b";
const STATIC = "gatcha-static-" + VERSION;
const IMAGES = "gatcha-images-v1";
const KEEP = [STATIC, IMAGES];
const IMAGE_MAX = 600;
const NAV_TIMEOUT = 3000;
// Precharge a l'installation : la page hors ligne (styles en ligne, rien a
// charger d'autre ; les CSS/JS portent un ?v= qui change a chaque deploiement),
// le manifeste et l'icone de l'application installable (2026-10-21).
const PRECACHE = ["offline.html", "manifest.json", "assets/app/icon-192.png"];
// Pages a ne jamais garder (jetons dans l'adresse, outils de test).
const NO_CACHE_PAGES = /\/(auth-callback|dev-login|maintenance)\.html$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gatcha-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return /\/webhook\//.test(url.pathname) && !/\/webhook\/image$/.test(url.pathname);
}
function isCardImage(url) {
  return /\/(webhook\/)?image$/.test(url.pathname) && url.searchParams.has("id");
}
function isStatic(url) {
  return url.origin === self.location.origin && /\.(css|js|png|jpe?g|webp|gif|svg|ico|woff2?)$/i.test(url.pathname);
}

// Retire les autres versions (?v=...) du meme fichier.
async function dropOldVersions(cache, request) {
  const url = new URL(request.url);
  const same = await cache.keys(new Request(url.origin + url.pathname), { ignoreSearch: true });
  await Promise.all(same.filter((r) => r.url !== request.url).map((r) => cache.delete(r)));
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request).then((res) => {
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      event.waitUntil(dropOldVersions(cache, event.request).then(() => cache.put(event.request, copy)).catch(() => {}));
    }
    return res;
  });
  if (cached) { event.waitUntil(fresh.catch(() => {})); return cached; }
  return fresh;
}

async function cacheFirst(event, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res && res.ok && res.type === "basic") {
    // Rangement apres coup : la page n'attend jamais le cache (quota plein...).
    event.waitUntil((async () => {
      await cache.put(event.request, res.clone());
      const keys = await cache.keys();
      if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
    })().catch(() => {}));
  }
  return res;
}

async function networkFirstPage(event) {
  const url = new URL(event.request.url);
  const key = url.origin + url.pathname;  // sans ?parametres
  const cache = await caches.open(STATIC);
  const network = fetch(event.request).then((res) => {
    if (res && res.ok && res.type === "basic" && !NO_CACHE_PAGES.test(url.pathname)) { const copy = res.clone(); event.waitUntil(cache.put(key, copy).catch(() => {})); }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
    // Reseau lent : derniere copie si on l'a, sinon on continue d'attendre.
    const cached = await cache.match(key);
    if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
    return await network;
  } catch (e) {
    return (await cache.match(key)) || (await cache.match("offline.html")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (req.mode === "navigate") { event.respondWith(networkFirstPage(event)); return; }
  if (isCardImage(url)) { if (url.origin === self.location.origin) event.respondWith(cacheFirst(event, IMAGES, IMAGE_MAX)); return; }
  if (isApi(url)) return;
  if (isStatic(url)) { event.respondWith(staleWhileRevalidate(event, STATIC)); return; }
});

// Rappels locaux (js/lazy/reminders.js) : programmes par la page (un service
// worker est endormi par le navigateur au bout d'environ 30 s, ses minuteurs
// ne tiendraient pas) ; affiches avec showNotification, le clic passe par
// notificationclick ci-dessous comme les notifications push.

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "2Gatcha", {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: "assets/app/icon-192.png",
    badge: "assets/app/icon-maskable-192.png",
    data: { url: data.url || "index.html" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "index.html", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
