const C="investment-lab-v2",A=["./","./index.html","./styles.css","./app.js","./data.js","./backtest.js","./manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.pathname.includes("/api/")||u.hostname.includes("yahoo.com"))return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
    if(r.ok){const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy))}
    return r
  }).catch(()=>caches.match("./index.html"))));
});