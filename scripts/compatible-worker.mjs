// Only public, build-listed resources are cached. API responses and credentials never enter this cache.
export function compatibleWorkerSource(version, files) {
  const assets=['',...files.filter(file=>file!=='sw.js'&&/\.(?:html|m?js|css|json|png)$/.test(file))];
  return `const CACHE_NAME=${JSON.stringify('work-card-compatible-'+version)};
const ASSETS=${JSON.stringify(assets)};
const base=new URL('./',self.location.href);
const allowed=new Set(ASSETS.map(file=>new URL(file,base).href));
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll([...allowed].map(url=>new Request(url,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE_NAME&&(name.startsWith('work-card-compatible-')||/^work-card-v\\d+$/.test(name))).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||request.headers.has('Authorization')||request.headers.has('x-device-token'))return;
  const url=new URL(request.url);
  const key=new URL(url.pathname,base).href;
  if(url.origin!==base.origin||!allowed.has(key))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{
      const response=await fetch(request);
      if(response.status>=500)throw Error('Server temporarily unavailable');
      // Never store an OAuth callback URL, token-bearing query, or failed response.
      if(response.ok&&!url.search&&response.type!=='opaque')await cache.put(key,response.clone()).catch(()=>{});
      return response;
    }catch(error){
      return (await cache.match(key))||new Response('Няма интернет връзка. Отвори приложението онлайн, за да подготвиш офлайн файловете.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
`;
}
