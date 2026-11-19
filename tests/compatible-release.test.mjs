import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {renderCompatibleRelease,pages} from '../scripts/build-compatible-release.mjs';
import {createCompatibilityPreview} from '../scripts/preview-compatible-release.mjs';

const release=await renderCompatibleRelease();
const text=file=>release.files.get(file).toString('utf8');
const office=file=>text(release.metadata.prefix+'office/'+file);
const legacy=file=>text(release.metadata.prefix+'legacy/'+file);
const script=text(release.metadata.prefix+'router.js');
function storage(initial={}){
  const values={...initial};
  return {values,getItem:key=>values[key]??null,setItem:(key,value)=>{values[key]=String(value);},removeItem:key=>{delete values[key];}};
}
async function route(page,session,{failure=false}={}){
  const fetched=[],written=[],errors=[];
  const href='https://kirilvassev-jpg.github.io/work-card-mit/'+page;
  await vm.runInNewContext(script,{
    location:{pathname:new URL(href).pathname,href},sessionStorage:session,URL,
    fetch:async url=>{fetched.push(url);return {ok:!failure,text:async()=>text(new URL(url).pathname.slice('/work-card-mit/'.length))};},
    document:{open(){},write:html=>written.push(html),close(){},getElementById:id=>{const el={id};errors.push(el);return el;}}
  });
  return {fetched,written,errors};
}

test('all existing public page addresses choose legacy mechanics or verified-office screens without navigation',async()=>{
  for(const page of pages.filter(p=>p!=='login.html')){
    for(const role of ['mechanic','admin','manager','coordinator','office',null]){
      const session=storage({workcard_role:role,workcard_user:'Съществуващ потребител',workcard_token:'existing-token'});
      const before={...session.values};
      const result=await route(page,session);
      const mode=['admin','manager','coordinator','office'].includes(role)?'office':'legacy';
      assert.equal(new URL(result.fetched[0]).pathname,'/work-card-mit/'+release.metadata.prefix+mode+'/'+page);
      assert.equal(result.written.length,1);assert.deepEqual(session.values,before);
    }
  }
  const result=await route('',storage({workcard_role:'mechanic'}));
  assert.ok(result.fetched[0].endsWith('/legacy/index.html'));
});

test('the common login stays legacy for mechanics and recognizes an office handoff on the same URL',async()=>{
  assert.ok((await route('login.html',storage({workcard_role:'mechanic'}))).fetched[0].endsWith('/legacy/login.html'));
  assert.ok((await route('login.html',storage({wc_office_login_pending:'1'}))).fetched[0].endsWith('/office/login.html'));
  const session=storage(),location={reloads:0,reload(){this.reloads++;}};
  const context={window:{},selectedRole:'coordinator',sessionStorage:session,location};
  vm.runInNewContext(text(release.metadata.prefix+'office-bridge.js'),context);
  context.window.loginMSAL();
  assert.equal(location.reloads,1);assert.equal(session.getItem('wc_office_login_role'),'coordinator');
  assert.ok((await route('login.html',session)).fetched[0].endsWith('/office/login.html'));
});

test('existing mechanic pages, original auth, service worker, manifest and assets are preserved',async()=>{
  const source=JSON.parse(await readFile(new URL('../compat/baseline/source.json',import.meta.url),'utf8'));
  for(const file of source.files){
    const baseline=await readFile(new URL('../compat/baseline/'+file,import.meta.url));
    if(file==='index.html'){
      const rendered=legacy(file);
      assert.ok(rendered.includes('await WC_REQUEST_PLAN.init('));
      assert.ok(rendered.includes('await WC_LEGACY_SUBMIT.submit(API_URL,pending)'));
      assert.ok(rendered.includes('legacyDrafts:true'));
    }else if(pages.includes(file)){
      const rendered=legacy(file).replace('<script src="'+release.metadata.prefix+'office-bridge.js"></script>\n','').replace('<script src="'+release.metadata.prefix+'shared/safe-render.js"></script>\n','');
      if(file==='login.html')assert.equal(rendered,baseline.toString('utf8'),file);
      else {
        assert.match(rendered,/api-proxy['"]/);
        assert.doesNotMatch(rendered,/api-proxy-v2/);
        assert.doesNotMatch(rendered,/localStorage\.clear\(\)/);
      }
    }else assert.deepEqual(release.files.get(file),baseline,file);
  }
  assert.doesNotMatch(office('login.html'),/id="deviceCode"|Код за регистрация/);
  assert.match(office('app-config.js'),/"legacyMechanicLogin":true/);
  assert.match(office('app-config.js'),/"deviceRegistration":false/);
  assert.match(office('app-config.js'),/api-proxy-v2/);
});

test('legacy mechanic login retains the selected name and existing device registration, with its original API',async()=>{
  const source=legacy('login.html');
  const session=storage({keep:'unchanged'}),local=storage({wc_device_token:'existing-device'});
  const context={sessionStorage:session,localStorage:local,window:{location:{}},document:{getElementById:()=>({value:'Съществуващ механик'})}};
  vm.runInNewContext(source.slice(source.indexOf('function loginMechanic()'),source.indexOf("document.getElementById('mechanicSelect').addEventListener")),context);
  context.loginMechanic();
  assert.equal(session.getItem('workcard_role'),'mechanic');assert.equal(session.getItem('workcard_user'),'Съществуващ механик');
  assert.equal(session.getItem('workcard_auth'),'true');assert.equal(context.window.location.href,'tablet.html');
  assert.equal(local.getItem('wc_device_token'),'existing-device');
  const calls=[];
  const select={innerHTML:''};
  const readContext={API_URL:'https://wcsdjfsohqanxcppcvvk.supabase.co/functions/v1/api-proxy',console,
    document:{getElementById:()=>select},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {json:async()=>[{value:'Име',label:'Име'}]};}};
  vm.runInNewContext(source.slice(source.indexOf('async function loadMechanics()'),source.indexOf('function loginMechanic()')),readContext);
  await readContext.loadMechanics();
  assert.ok(calls[0].url.endsWith('/api-proxy'));assert.equal(calls[0].body.path,'nomenclatures?group_name=eq.mechanics&is_active=eq.true&order=sort_order');
  assert.match(select.innerHTML,/Име/);
});

test('office payloads parse, retain public navigation, and do not replace the mechanic PWA or its cache',()=>{
  for(const page of pages){
    const source=office(page);
    assert.doesNotMatch(source,/navigator\.serviceWorker\.register\(/,page);
    assert.doesNotMatch(source,/<link\b[^>]*rel="manifest"/,page);
    for(const [i,s] of [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].entries())assert.doesNotThrow(()=>new vm.Script(s[1],{filename:page+':'+i}));
    const markup=source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
    for(const [,ref] of markup.matchAll(/(?:src|href)="([^"#?]+)"/g)){
      if(/^(https?:|data:)/.test(ref))continue;
      assert.ok(release.files.has(ref),page+': '+ref);
      if(ref.endsWith('.html'))assert.ok(pages.includes(ref),'Navigation must keep the existing addresses: '+ref);
    }
  }
});

test('a missing payload produces a retry message instead of writing a partial document',async()=>{
  const result=await route('tablet.html',storage({workcard_role:'mechanic'}),{failure:true});
  assert.equal(result.written.length,0);
  assert.match(result.errors.find(el=>el.id==='loadStatus').textContent,/не се зареди/);
  assert.equal(result.errors.find(el=>el.id==='retry').hidden,false);
});

function officeLoginContext({callback=false}={}){
  let ready,redirects=0,logouts=0;
  const session=storage({wc_office_login_pending:'1',wc_office_login_auto:'1',wc_office_login_role:'manager'});
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){},toggle(){}},style:{}});return elements.get(id);};
  const location={origin:'https://kirilvassev-jpg.github.io',pathname:'/work-card-mit/login.html',hash:callback?'#code=example':'',search:''};
  const context={WC_CONFIG:{legacyMechanicLogin:true,demo:false,clientId:'example',tenantId:'tenant',apiScope:'api://example/access_as_user'},sessionStorage:session,location,
    WC_AUTH:{logout:()=>{logouts++;},validateSession:async()=>({role:'manager',id:'verified'})},
    document:{addEventListener:(type,fn)=>{ready=fn;},getElementById:element,querySelectorAll:()=>[]},
    msal:{PublicClientApplication:class{async handleRedirectPromise(){return callback?{accessToken:'verified-access',account:{}}:null;}async loginRedirect(){redirects++;}}}};
  context.window=context;
  vm.runInNewContext(office('login.js'),context);
  return {context,session,location,ready:()=>ready(),redirects:()=>redirects,logouts:()=>logouts};
}

test('office handoff starts Microsoft once and a callback validates the server role on the same public login URL',async()=>{
  const initial=officeLoginContext();await initial.ready();
  assert.equal(initial.redirects(),1);assert.equal(initial.session.getItem('wc_office_login_auto'),null);
  assert.equal(initial.session.getItem('wc_office_login_pending'),'1');
  const returned=officeLoginContext({callback:true});await returned.ready();
  assert.equal(returned.redirects(),0);assert.equal(returned.location.href,'assign.html');
  assert.equal(returned.session.getItem('wc_office_login_pending'),null);
  assert.equal(returned.session.getItem('workcard_token'),'verified-access');
  await initial.context.selectRole('mechanic');assert.equal(initial.logouts(),1);
});

test('the compatibility browser preview serves both versions with isolated demo APIs',async(t)=>{
  const server=await createCompatibilityPreview();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const base='http://127.0.0.1:'+server.address().port;
  const config=await(await fetch(base+'/'+release.metadata.prefix+'office/app-config.js')).text();
  assert.ok(config.endsWith('Object.assign(window.WC_CONFIG,{demo:true,apiUrl:"/__demo/api"});\n'));
  const old=await(await fetch(base+'/'+release.metadata.prefix+'legacy/login.html')).text();
  assert.doesNotMatch(old,/wcsdjfsohqanxcppcvvk\.supabase\.co/);
  const rows=await(await fetch(base+'/__legacy/api',{method:'POST',body:JSON.stringify({path:'nomenclatures',method:'GET'})})).json();
  assert.equal(rows[0].value,'Демо механик');
  const tasks=await(await fetch(base+'/__legacy/api',{method:'POST',body:JSON.stringify({path:'service_requests?status=eq.Разпределена',method:'GET'})})).json();
  assert.equal(tasks[0].planned_operations.length,3);
  assert.match(await(await fetch(base+'/auth.js')).text(),/preview-only-existing-device/);
  assert.equal((await fetch(base+'/__legacy/api',{method:'POST',body:JSON.stringify({path:'work_cards',method:'POST'})})).status,403);
  assert.equal((await fetch(base+'/work-card-mit/history.html')).status,200);
  assert.equal((await fetch(base+'/compat/baseline/source.json')).status,404);
});

test('explicit real-backend preview keeps production endpoints and device identity and disables demo login',async(t)=>{
  const server=await createCompatibilityPreview({backend:true});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const base='http://127.0.0.1:'+server.address().port;
  const config=await(await fetch(base+'/'+release.metadata.prefix+'office/app-config.js')).text();
  assert.match(config,/api-proxy-v2/);assert.doesNotMatch(config,/__demo\/api|"demo":true/);
  const old=await(await fetch(base+'/'+release.metadata.prefix+'legacy/login.html')).text();
  assert.match(old,/wcsdjfsohqanxcppcvvk\.supabase\.co/);assert.match(old,/РЕАЛНАТА БАЗА/);
  assert.equal(await(await fetch(base+'/auth.js')).text(),text('auth.js'));
  for(const endpoint of ['__demo/api','__legacy/api'])assert.equal((await fetch(base+'/'+endpoint,{method:'POST',body:'{}'})).status,405);
});
