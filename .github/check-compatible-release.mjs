import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const root=path.resolve(process.argv[2]||process.cwd());
const read=file=>readFile(path.join(root,file));
const hash=(data,algorithm='sha256')=>createHash(algorithm).update(data).digest('hex');
const blob=data=>createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
const manifest=JSON.parse(await read('.github/compatible-release-checks.json'));
const requiredPages=['login.html','requests.html','assign.html','schedule.html','history.html','dashboard.html','index.html','tablet.html'];
const requiredAssets=['auth.js','sw.js','manifest.json','theme.css','ui.js','datepicker.js','Repairs.png','icons/icon-192.png','icons/icon-512.png'];
assert.deepEqual([...manifest.pages].sort(),[...requiredPages].sort(),'The complete public page set is required');
assert.match(manifest.prefix,/^compat\/releases\/[0-9a-f]{16}\/$/);
for(const file of [...requiredPages,...requiredAssets]){
  assert.match(manifest.baselineGit[file]||'',/^[0-9a-f]{40}$/,'Missing baseline: '+file);
  assert.match(manifest.releaseHashes[file]||'',/^[0-9a-f]{64}$/,'Missing release entry: '+file);
}
const shared=['draft-store.js','drafts.js','plan-model.mjs','request-plan.mjs','work-plan.css'];
for(const file of [...requiredPages.flatMap(p=>['office/'+p,'legacy/'+p]),'router.js','office-bridge.js','shared/safe-render.js','shared/legacy-submit.js',...shared.map(p=>'shared/'+p),'vendor/chartjs-4.4.1/chart.umd.js','vendor/msal-browser-2.38.0/msal-browser.min.js']){
  assert.match(manifest.releaseHashes[manifest.prefix+file]||'',/^[0-9a-f]{64}$/,'Missing runtime dependency: '+file);
}
const pages=manifest.pages;
const current=new Map(await Promise.all(pages.map(async file=>[file,await read(file)])));
const release=pages.every(file=>hash(current.get(file))===manifest.releaseHashes[file]);
const rollback=pages.every(file=>blob(current.get(file))===manifest.baselineGit[file]);
assert.ok(release||rollback,'Mixed or unexpected public entry pages: do not deploy');
for(const [file,expected] of Object.entries(manifest.baselineGit)){
  if(pages.includes(file))continue;
  if(file==='sw.js'&&release)continue; // The worker is the sole explicitly allowed root asset update.
  assert.equal(blob(await read(file)),expected,'Existing file changed: '+file);
}
for(const [file,expected] of Object.entries(manifest.releaseHashes)){
  if(rollback&&(pages.includes(file)||file==='sw.js'))continue;
  assert.equal(hash(await read(file)),expected,'Release asset changed: '+file);
  const data=(await read(file)).toString('utf8');
  if(file.endsWith('.html'))for(const [,reference] of data.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)){
    if(reference.startsWith(manifest.prefix))assert.match(manifest.releaseHashes[reference]||'',/^[0-9a-f]{64}$/,'Missing HTML dependency: '+reference);
  }
  if(file.endsWith('.mjs')&&file.startsWith(manifest.prefix))for(const [,reference] of data.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)){
    if(!reference.startsWith('.'))continue;
    const target=new URL(reference,'https://example.invalid/'+file).pathname.slice(1);
    assert.match(manifest.releaseHashes[target]||'',/^[0-9a-f]{64}$/,'Missing module dependency: '+target);
  }
  if(file.endsWith('.js'))assert.doesNotThrow(()=>new vm.Script(data,{filename:file}));
  if(file.endsWith('.mjs')&&file.startsWith(manifest.prefix))await import(pathToFileURL(path.join(root,file)));
  if(file.endsWith('.html'))for(const script of data.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))new vm.Script(script[1],{filename:file});
  if(file.startsWith(manifest.prefix))assert.ok(!data.includes('preview-only-existing-device'),'A demo credential leaked into the release');
}
for(const file of shared)await assert.rejects(read(manifest.prefix+'office/'+file),{code:'ENOENT'},'Shared modules must have one copy: '+file);
if(release){
  const workerContext={URL,self:{location:{href:'https://example.invalid/work-card-mit/sw.js'},addEventListener(){}}};
  vm.runInNewContext((await read('sw.js')).toString('utf8')+'\nglobalThis.precache=ASSETS;',workerContext);
  const precache=Array.from(workerContext.precache);
  const requiredCache=['',...pages,...requiredAssets.filter(f=>f!=='sw.js'),...Object.keys(manifest.releaseHashes).filter(f=>f.startsWith(manifest.prefix)&&/\.(?:html|m?js|css|json|png)$/.test(f))];
  for(const file of requiredCache)assert.ok(precache.includes(file),'Missing offline dependency: '+file);
  for(const file of precache){
    const url=new URL(file,'https://example.invalid/work-card-mit/');
    assert.ok(url.origin==='https://example.invalid'&&url.pathname.startsWith('/work-card-mit/')&&!url.search&&!url.hash,'Unsafe cache URL: '+file);
    if(file)assert.ok(manifest.releaseHashes[file],'Cache entry is outside reviewed files: '+file);
  }
}
const context={window:{}};
vm.runInNewContext((await read(manifest.prefix+'office/app-config.js')).toString('utf8'),context);
assert.equal(context.window.WC_CONFIG.demo,false);
assert.equal(context.window.WC_CONFIG.deviceRegistration,false);
assert.equal(context.window.WC_CONFIG.legacyMechanicLogin,true);
assert.ok(context.window.WC_CONFIG.apiUrl.endsWith('/api-proxy-v2'));
const router=(await read(manifest.prefix+'router.js')).toString('utf8');
for(const page of pages){
  for(const role of ['mechanic','admin','manager','coordinator',null]){
    let written,requested;
    const expected=manifest.prefix+(page==='login.html'||!['admin','manager','coordinator'].includes(role)?'legacy/':'office/')+page;
    const html=(await read(expected)).toString('utf8');
    await vm.runInNewContext(router,{URL,location:{pathname:'/work-card-mit/'+page,href:'https://example.invalid/work-card-mit/'+page},
      sessionStorage:{getItem:key=>key==='workcard_role'?role:null},
      fetch:async url=>{requested=new URL(url).pathname;return {ok:true,text:async()=>html};},
      document:{open(){},write:value=>{written=value;},close(){},getElementById(){return {};}}});
    assert.equal(requested,'/work-card-mit/'+expected);assert.equal(written,html);
  }
}
console.log(JSON.stringify({mode:release?'release':'rollback',version:manifest.version,files:Object.keys(manifest.releaseHashes).length,baseline:manifest.baselineCommit,source:manifest.sourceCommit,checks:'passed'}));
