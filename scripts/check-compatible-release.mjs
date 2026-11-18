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
const pages=manifest.pages;
const current=new Map(await Promise.all(pages.map(async file=>[file,await read(file)])));
const release=pages.every(file=>hash(current.get(file))===manifest.releaseHashes[file]);
const rollback=pages.every(file=>blob(current.get(file))===manifest.baselineGit[file]);
assert.ok(release||rollback,'Mixed or unexpected public entry pages: do not deploy');
for(const [file,expected] of Object.entries(manifest.baselineGit)){
  if(pages.includes(file))continue;
  assert.equal(blob(await read(file)),expected,'Existing file changed: '+file);
}
for(const [file,expected] of Object.entries(manifest.releaseHashes)){
  if(rollback&&pages.includes(file))continue;
  assert.equal(hash(await read(file)),expected,'Release asset changed: '+file);
  const data=(await read(file)).toString('utf8');
  if(file.endsWith('.js'))assert.doesNotThrow(()=>new vm.Script(data,{filename:file}));
  if(file.endsWith('.mjs')&&file.startsWith(manifest.prefix))await import(pathToFileURL(path.join(root,file)));
  if(file.endsWith('.html'))for(const script of data.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))new vm.Script(script[1],{filename:file});
  if(file.startsWith(manifest.prefix))assert.ok(!data.includes('preview-only-existing-device'),'A demo credential leaked into the release');
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
