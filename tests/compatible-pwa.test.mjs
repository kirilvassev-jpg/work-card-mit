import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {renderCompatibleRelease,pages} from '../scripts/build-compatible-release.mjs';
const release=await renderCompatibleRelease();
const prefix=release.metadata.prefix;
const base='https://example.invalid/work-card-mit/';
const text=file=>release.files.get(file).toString();

function worker({missing=null}={}){
  let online=true,skipped=false,claimed=false;
  const listeners={},stores=new Map(),requests=[];
  async function network(input){
    const url=typeof input==='string'?input:input.url;requests.push(url);
    if(!online)throw Error('offline');
    const path=new URL(url).pathname.slice('/work-card-mit/'.length)||'index.html';
    const data=path===missing?null:release.files.get(path);
    return data?new Response(data):new Response('Missing',{status:404});
  }
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
      return {
        async addAll(inputs){
          const pending=await Promise.all(inputs.map(async input=>{const response=await network(input);if(!response.ok)throw Error('Precache failed');return [typeof input==='string'?input:input.url,response];}));
          pending.forEach(([key,value])=>entries.set(key,value));
        },
        async put(key,response){entries.set(key,response);},
        async match(key){return entries.get(typeof key==='string'?key:key.url)?.clone();}
      };
    },
    async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
  };
  const self={location:{href:base+'sw.js'},addEventListener:(name,fn)=>{listeners[name]=fn;},skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}}};
  vm.runInNewContext(text('sw.js'),{self,caches,fetch:network,URL,Request,Response,Set});
  const dispatch=async name=>{let pending;listeners[name]({waitUntil(p){pending=p;}});return pending;};
  async function fetcher(input,options){
    const request=input instanceof Request?input:new Request(new URL(input,base),options);
    let response;listeners.fetch({request,respondWith(p){response=p;}});
    return response||network(request);
  }
  return {stores,requests,install:()=>dispatch('install'),activate:()=>dispatch('activate'),fetch:fetcher,offline(){online=false;},get skipped(){return skipped;},get claimed(){return claimed;}};
}

test('fresh installation opens every routed page offline without a prior visit to its router or payload',async()=>{
  const w=worker();await w.install();await w.activate();w.offline();
  assert.equal(w.skipped,true);assert.equal(w.claimed,true);
  const router=await(await w.fetch(prefix+'router.js')).text();
  for(const page of pages)for(const role of ['mechanic','admin','coordinator','manager']){
    assert.equal((await w.fetch(page)).status,200);
    let html;
    await vm.runInNewContext(router,{URL,location:{href:base+page,pathname:'/work-card-mit/'+page},sessionStorage:{getItem:key=>key==='workcard_role'?role:null},fetch:w.fetch,
      document:{open(){},write(value){html=value;},close(){},getElementById(){return {};}}});
    const variant=page==='login.html'||role==='mechanic'?'legacy':'office';
    assert.equal(html,text(prefix+variant+'/'+page));
  }
  for(const file of ['shared/drafts.js','shared/plan-model.mjs','office/plan-editor.mjs','vendor/chartjs-4.4.1/chart.umd.js','vendor/msal-browser-2.38.0/msal-browser.min.js'])assert.equal((await w.fetch(prefix+file)).status,200,file);
});

test('API calls, credentials, foreign origins and unknown files never enter the offline cache',async()=>{
  const w=worker();await w.install();const entries=[...w.stores.values()][0],count=entries.size;
  for(const request of [
    new Request('https://project.supabase.co/functions/v1/api-proxy',{method:'POST',body:'private'}),
    new Request(base+'private.json'),new Request('https://third-party.invalid/example.js'),
    new Request(base+'login.html',{headers:{Authorization:'Bearer private'}}),
    new Request(base+'login.html',{headers:{'x-device-token':'private'}})
  ])await w.fetch(request);
  await w.fetch(base+'login.html?code=private-auth-code');
  assert.equal(entries.size,count);
  assert.ok([...entries.keys()].every(url=>url.startsWith(base)&&!url.includes('?')&&!url.includes('supabase')));
});

test('incomplete installation does not activate or discard an existing cache; activation only removes owned caches',async()=>{
  const failed=worker({missing:prefix+'shared/request-plan.mjs'});failed.stores.set('work-card-v16',new Map());
  await assert.rejects(failed.install(),/Precache failed/);assert.equal(failed.skipped,false);assert.ok(failed.stores.has('work-card-v16'));
  const w=worker();w.stores.set('work-card-v16',new Map());w.stores.set('another-application',new Map());
  await w.install();await w.activate();assert.equal(w.stores.has('work-card-v16'),false);assert.ok(w.stores.has('another-application'));
});

test('office and mechanic pages use the original install identity and same public start address',()=>{
  const manifest=JSON.parse(text('manifest.json'));
  assert.equal(manifest.start_url,'/work-card-mit/login.html');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons)assert.ok(release.files.has(icon.src));
  for(const page of pages){
    for(const html of [text(page),text(prefix+'office/'+page),text(prefix+'legacy/'+page)])assert.match(html,/<link\b[^>]*rel="manifest"[^>]*href="manifest.json"/);
  }
});

test('both variants load local pinned libraries in parser order; office and mechanic forms share one module copy',()=>{
  for(const variant of ['office','legacy'])for(const page of pages){
    const html=text(prefix+variant+'/'+page);
    for(const script of html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g))assert.ok(!/^https?:\/\//.test(script[1]),page+': '+script[1]);
  }
  for(const file of ['draft-store.js','drafts.js','plan-model.mjs','request-plan.mjs','work-plan.css']){
    assert.ok(release.files.has(prefix+'shared/'+file));assert.equal(release.files.has(prefix+'office/'+file),false);
  }
  assert.match(text(prefix+'office/plan-editor.mjs'),/from '\.\.\/shared\/plan-model.mjs'/);
  for(const variant of ['office','legacy'])assert.ok(text(prefix+variant+'/index.html').includes(prefix+'shared/drafts.js'));
  assert.match(text(prefix+'office/auth.js'),/MSAL_SRC: 'compat\/releases\/[0-9a-f]+\/vendor\/msal-browser-2.38.0\/msal-browser.min.js'/);
});

test('the audit rejects HTML or module dependencies removed from both editable hash and cache lists',async()=>{
  const fixtures=fileURLToPath(new URL('../.cache/test-fixtures/',import.meta.url));
  await mkdir(fixtures,{recursive:true});
  const root=await mkdtemp(path.join(fixtures,'dependency-check-'));
  const hash=data=>createHash('sha256').update(data).digest('hex');
  const baseline=JSON.parse(await readFile(new URL('../compat/baseline/source.json',import.meta.url),'utf8'));
  const baselineGit={};
  for(const file of baseline.files){
    const data=await readFile(new URL('../compat/baseline/'+file,import.meta.url));
    baselineGit[file]=createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
  }
  for(const [file,data] of release.files){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),data);}
  await mkdir(path.join(root,'.github'));
  const manifest={pages,prefix,version:release.metadata.version,baselineGit,releaseHashes:Object.fromEntries([...release.files].map(([file,data])=>[file,hash(data)]))};
  const audit=fileURLToPath(new URL('../scripts/check-compatible-release.mjs',import.meta.url));
  const run=()=>spawnSync(process.execPath,[audit,root],{encoding:'utf8'});
  await writeFile(path.join(root,'.github/compatible-release-checks.json'),JSON.stringify(manifest));
  const initial=run();assert.equal(initial.status,0,initial.stderr);
  for(const missing of [prefix+'office/login.js',prefix+'shared/plan-model.mjs']){
    const changed=structuredClone(manifest);delete changed.releaseHashes[missing];
    const sw=text('sw.js').replace(/const ASSETS=(.*);/,(_,json)=>'const ASSETS='+JSON.stringify(JSON.parse(json).filter(file=>file!==missing))+';');
    changed.releaseHashes['sw.js']=hash(sw);
    await writeFile(path.join(root,'sw.js'),sw);
    await writeFile(path.join(root,'.github/compatible-release-checks.json'),JSON.stringify(changed));
    const result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/Missing (?:HTML|module|runtime) dependency/);
  }
});
