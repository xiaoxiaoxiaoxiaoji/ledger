// 每日记账 · Service Worker
// 作用：把应用外壳缓存到本地，下次打开（甚至没网）也能秒开
// 注意：只有通过 http:// 或 https:// 打开时才会生效；
//       直接双击 index.html（file://）时浏览器会忽略它，不影响使用。

const CACHE_NAME = 'ledger-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/sync.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 策略：应用外壳走缓存优先；其它请求（如 Supabase 接口）走网络优先，失败不阻塞
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 跨域请求（Supabase、CDN）不拦截，让浏览器正常走网络
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((resp) => {
          // 顺手更新缓存
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => cached); // 断网时用缓存兜底
      return cached || fetchPromise;
    })
  );
});
