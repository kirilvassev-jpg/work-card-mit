const CACHE_NAME="work-card-compatible-c1a331462e4781c2";
const ASSETS=["","login.html","requests.html","assign.html","schedule.html","history.html","dashboard.html","index.html","tablet.html","auth.js","manifest.json","theme.css","ui.js","datepicker.js","Repairs.png","icons/icon-192.png","icons/icon-512.png","compat/releases/c1a331462e4781c2/legacy/login.html","compat/releases/c1a331462e4781c2/office/login.html","compat/releases/c1a331462e4781c2/legacy/requests.html","compat/releases/c1a331462e4781c2/office/requests.html","compat/releases/c1a331462e4781c2/legacy/assign.html","compat/releases/c1a331462e4781c2/office/assign.html","compat/releases/c1a331462e4781c2/legacy/schedule.html","compat/releases/c1a331462e4781c2/office/schedule.html","compat/releases/c1a331462e4781c2/legacy/history.html","compat/releases/c1a331462e4781c2/office/history.html","compat/releases/c1a331462e4781c2/legacy/dashboard.html","compat/releases/c1a331462e4781c2/office/dashboard.html","compat/releases/c1a331462e4781c2/legacy/index.html","compat/releases/c1a331462e4781c2/office/index.html","compat/releases/c1a331462e4781c2/legacy/tablet.html","compat/releases/c1a331462e4781c2/office/tablet.html","compat/releases/c1a331462e4781c2/office/app-config.js","compat/releases/c1a331462e4781c2/office/auth.js","compat/releases/c1a331462e4781c2/office/login.js","compat/releases/c1a331462e4781c2/office/plan-editor.mjs","compat/releases/c1a331462e4781c2/office/theme.css","compat/releases/c1a331462e4781c2/office/ui.js","compat/releases/c1a331462e4781c2/office/datepicker.js","compat/releases/c1a331462e4781c2/office/Repairs.png","compat/releases/c1a331462e4781c2/office/icons/icon-192.png","compat/releases/c1a331462e4781c2/office/icons/icon-512.png","compat/releases/c1a331462e4781c2/shared/draft-store.js","compat/releases/c1a331462e4781c2/shared/drafts.js","compat/releases/c1a331462e4781c2/shared/plan-model.mjs","compat/releases/c1a331462e4781c2/shared/request-plan.mjs","compat/releases/c1a331462e4781c2/shared/work-plan.css","compat/releases/c1a331462e4781c2/shared/safe-render.js","compat/releases/c1a331462e4781c2/shared/legacy-submit.js","compat/releases/c1a331462e4781c2/shared/pending-cards.js","compat/releases/c1a331462e4781c2/shared/legacy-resume.js","compat/releases/c1a331462e4781c2/vendor/chartjs-4.4.1/chart.umd.js","compat/releases/c1a331462e4781c2/vendor/msal-browser-2.38.0/msal-browser.min.js","compat/releases/c1a331462e4781c2/vendor/manifest.json","compat/releases/c1a331462e4781c2/router.js","compat/releases/c1a331462e4781c2/office-bridge.js"];
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
    await Promise.all(names.filter(name=>name!==CACHE_NAME&&(name.startsWith('work-card-compatible-')||/^work-card-v\d+$/.test(name))).map(name=>caches.delete(name)));
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
