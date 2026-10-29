/* Service worker of the Muestras desktop app. It keeps the app files (and the libraries from the CDN) so the app opens
   without connection, and refreshes them in the background. It never caches lab data (GitHub API and raw files). */
const CACHE='muestras-v20261029';
const SHELL=['./','index.html','../control-ensayos/app.js?v=20261029','../control-ensayos/app.css?v=20261029','manifest.webmanifest','icons/icon.svg','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request, u=new URL(r.url);
  if(r.method!=='GET'||/(^|\.)github(usercontent)?\.com$/.test(u.hostname)) return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(r);
    const net=fetch(r).then(res=>{if(res.ok||res.type==='opaque') c.put(r,res.clone()); return res;}).catch(()=>hit);
    return hit||net;
  }));
});
