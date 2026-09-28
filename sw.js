const C="investment-lab-v18",A=["./","./index.html","./styles.css","./app.js?v=20260928-17","./data.js?v=20260928-16","./backtest.js?v=20260928-15","./simulation.js?v=20260928-02","./manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.pathname.endsWith("/sw.js")||u.pathname.includes("/api/")||u.hostname.includes("yahoo.com"))return;
  e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{
    if(r.ok){const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy))}
    return r;
  }).catch(()=>caches.match(e.request).then(hit=>hit||caches.match("./index.html"))));
});