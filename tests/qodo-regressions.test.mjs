import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderCompatibleRelease} from '../scripts/build-compatible-release.mjs';
const release=await renderCompatibleRelease();
const source=(variant,page)=>release.files.get(release.metadata.prefix+variant+'/'+page).toString();
const safeCode=readFileSync(new URL('../safe-render.js',import.meta.url),'utf8');
function definition(html,name){
  const functions=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)];
  const i=functions.findIndex(f=>f[1]===name);assert.ok(i>=0,name);
  return html.slice(functions[i].index,functions[i+1]?.index??html.indexOf('</script>',functions[i].index));
}
const attack='<img src=x onerror="globalThis.COMPROMISED=true">\' & </textarea><svg onload="globalThis.COMPROMISED=true">';
function context(){
  const elements=new Map();
  const c={Date,console,document:{getElementById(id){if(!elements.has(id))elements.set(id,{style:{},innerHTML:''});return elements.get(id);},querySelector(){return null;}},
    setHTML(el,html){el.innerHTML=html;},UI:{icon(){return '';}}};
  c.window=c;vm.createContext(c);vm.runInContext(safeCode,c);c.sanitize=c.WC_SAFE.text;
  return c;
}
function assertEncoded(html){
  assert.doesNotMatch(html,/<img src=x|<svg onload|<\/textarea>/);
  assert.ok(html.includes('&lt;img src=x'),html.slice(0,100));
}
for(const variant of ['office','legacy']){
  test(variant+': request text, attributes and notes stay inert in assignment, tablet and history views',()=>{
    const record={id:randomUUID(),request_id:randomUUID(),status:'В изпълнение',created_at:'2026-11-18T10:00:00Z',desired_date:null,
      activity_type:[attack],assigned_mechanics:[attack],responsible_mechanic:attack,description:attack,client_name:attack,client_type:attack,
      vehicle:attack,reg_number:attack,client_phone:attack,client_email:attack,company_name:attack,brand:attack,model:attack,
      notes:attack,created_by:attack,photo_data:'x" onerror="globalThis.COMPROMISED=true'};
    const assign=context();Object.assign(assign,{allRequests:[record],currentFilter:'all',mechanics:[],openFullInfo:new Set(),planHtml:()=>'',getWaitingTime:()=>'',isCoordinator:()=>false});
    for(const name of ['esc','buildFullInfo','renderRequests'])vm.runInContext(definition(source(variant,'assign.html'),name),assign);
    assign.renderRequests();assertEncoded(assign.document.getElementById('requestsList').innerHTML);
    const tablet=context();Object.assign(tablet,{allTasks:[record],selectedMechanic:attack,fmtDate:()=>'',planLine:()=>''});
    vm.runInContext(definition(source(variant,'tablet.html'),'renderTasks'),tablet);tablet.renderTasks();
    assertEncoded(tablet.document.getElementById('tasksList').innerHTML);
    const history=context();Object.assign(history,{isCoordinator:()=>false,isManagerAdmin:()=>false,isCoordinatorOrAdmin:()=>false});
    vm.runInContext(definition(source(variant,'history.html'),'renderServiceRequests'),history);history.renderServiceRequests([record]);
    assertEncoded(history.document.getElementById('reqList').innerHTML);
    assert.equal(history.COMPROMISED,undefined);
  });
  test(variant+': request logs are escaped in assignment, history and dashboard',()=>{
    for(const page of ['assign.html','history.html','dashboard.html']){
      const c=context();c.getTimeAgo=()=>'';c.pad=String;
      vm.runInContext(definition(source(variant,page),'renderTimeline'),c);
      c.renderTimeline([{created_at:'2026-11-18',action:attack,performed_by:attack,details:attack}],'timeline');
      assertEncoded(c.document.getElementById('timeline').innerHTML);
    }
  });
}

test('legacy save retries after lost responses without duplicating cards, materials or logs',async()=>{
  const c=context();vm.runInContext(readFileSync(new URL('../legacy-submit.js',import.meta.url),'utf8'),c);
  const id=randomUUID(), tables=new Map(),calls=[];
  let lose='work_cards',offline=false;
  const fetcher=async(_,options)=>{
    const {path,method,body}=JSON.parse(options.body);const [table,query]=path.split('?');
    if(offline)throw Error('offline');
    if(!tables.has(table))tables.set(table,new Map());const rows=tables.get(table);
    if(method==='GET'){const key=new URLSearchParams(query).get('id')?.slice(3);return {ok:true,status:200,json:async()=>rows.has(key)?[rows.get(key)]:[]};}
    calls.push({table,method,body});
    if(method==='POST'){
      if(rows.has(body.id))return {ok:false,status:409};rows.set(body.id,body);
      if(table===lose){offline=true;throw Error('response lost');}
    } else if(method==='PATCH'){const key=new URLSearchParams(query).get('id').slice(3);rows.set(key,{...rows.get(key),...body});}
    return {ok:true,status:200,json:async()=>[body]};
  };
  const pending={card:{id,mechanic:['Механик'],work_hours:2},materials:[{id:randomUUID(),work_card_id:id,quantity:10}],cardLog:{id:randomUUID(),work_card_id:id,action:'created'},completedAt:new Date().toISOString()};
  await assert.rejects(c.WC_LEGACY_SUBMIT.submit('/api',pending,fetcher));
  offline=false;lose='work_card_materials';
  await assert.rejects(c.WC_LEGACY_SUBMIT.submit('/api',pending,fetcher));
  offline=false;lose=null;
  await c.WC_LEGACY_SUBMIT.submit('/api',pending,fetcher);
  await c.WC_LEGACY_SUBMIT.submit('/api',pending,fetcher);
  for(const name of ['work_cards','work_card_materials','work_card_log']){
    assert.equal(tables.get(name).size,1);assert.equal(calls.filter(call=>call.table===name&&call.method==='POST').length,1);
  }
  tables.get('work_cards').get(id).work_hours=3;
  await assert.rejects(c.WC_LEGACY_SUBMIT.submit('/api',pending,fetcher),/променен/);
});

test('logout persists the draft, clears credentials and retains device registration and scoped drafts',()=>{
  const c=context(),values=new Map([['wc_device_token','registered'],['wc_draft:v1:user','draft'],['msal.token','secret']]);
  let saved=0,cleared=0;
  Object.assign(c,{WC_DRAFTS:{save(){saved++;return true;}},location:{},sessionStorage:{clear(){cleared++;}},localStorage:{get length(){return values.size;},key(i){return [...values.keys()][i];},removeItem(key){values.delete(key);}}});
  c.WC_SAFE.logout();assert.equal(saved,1);assert.equal(cleared,1);assert.equal(c.location.href,'login.html');
  assert.equal(values.get('wc_device_token'),'registered');assert.equal(values.get('wc_draft:v1:user'),'draft');assert.equal(values.has('msal.token'),false);
});

test('release validation rejects an emptied page list and missing integrity maps',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'workcard-invalid-manifest-'));
  await mkdir(path.join(root,'.github'));
  for(const manifest of [{pages:[],baselineGit:{},releaseHashes:{}},{pages:release.metadata.changedRootPages,prefix:release.metadata.prefix,baselineGit:{},releaseHashes:{}}]){
    await writeFile(path.join(root,'.github/compatible-release-checks.json'),JSON.stringify(manifest));
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-compatible-release.mjs',import.meta.url)),root],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/complete public page set|Missing baseline/);
  }
});
