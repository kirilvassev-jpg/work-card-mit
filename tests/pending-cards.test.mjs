import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=['draft-store.js','pending-cards.js','drafts.js','legacy-submit.js'].map(file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'));
const scope='https://api.invalid/original',user='Механик';
function harness(data=new Map(),requestId=null){
  const session=new Map([['workcard_user',user],['workcard_role','mechanic']]);
  const form={inert:false,prepend(){},addEventListener(){}};
  let failWrites=false;
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)||null,setItem(key,value){if(failWrites)throw Error('QuotaExceeded');data.set(key,value);},removeItem:key=>data.delete(key)};
  const c={crypto:{randomUUID},setTimeout,clearTimeout,Date,JSON,console,localStorage:storage,sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,String(value)),removeItem:key=>session.delete(key),clear:()=>session.clear()},
    navigator:{onLine:true},WC_CONFIG:{legacyDrafts:true,storageScope:scope},_currentRequestId:requestId,hasMaterials:true,currentStep:4,
    updateMechanicUI(){},onActivityChange(){},toggleMaterials(){},goStep(){},addEventListener(){},
    document:{createElement:()=>({style:{},setAttribute(){},insertAdjacentElement(){}}),getElementById:()=>form,querySelectorAll:()=>[]}};
  c.window=c;vm.createContext(c);code.forEach(script=>vm.runInContext(script,c));c.WC_DRAFTS.init();
  return {c,form,storage,session,data,blockStorage(){failWrites=true;}};
}
const card={mechanic:[user],work_hours:2,vehicle:'Машина',reg_number:'ДЕМО',client:'Клиент',activity_type:'ТО / ППП'};
function database(requestId){
  const tables=new Map([['service_requests',new Map([[requestId,{id:requestId,status:'В изпълнение',work_card_id:null}]])]]);
  let failCompletedLog=true;
  const fetcher=async(_,options)=>{
    const {path,method,body}=JSON.parse(options.body),[table,query]=path.split('?'),key=new URLSearchParams(query).get('id')?.slice(3);
    if(!tables.has(table))tables.set(table,new Map());const rows=tables.get(table);
    if(method==='GET')return {ok:true,status:200,json:async()=>rows.has(key)?[rows.get(key)]:[]};
    if(method==='POST'){
      if(table==='request_log'&&failCompletedLog)return {ok:false,status:503};
      if(rows.has(body.id))return {ok:false,status:409};rows.set(body.id,body);
    }else if(method==='PATCH')rows.set(key,{...rows.get(key),...body});
    return {ok:true,status:200,json:async()=>[body]};
  };
  return {tables,fetcher,allowCompletedLog(){failCompletedLog=false;}};
}

test('a completed request with a failed final log remains discoverable after logout and resumes identical IDs',async()=>{
  const requestId=randomUUID(),first=harness(new Map(),requestId),db=database(requestId);
  const pending=first.c.WC_DRAFTS.legacySubmission({...card,request_id:requestId},[{category:'oil',item_type:'Масло',quantity:10,unit:'литри'}]);
  await assert.rejects(first.c.WC_LEGACY_SUBMIT.submit(scope,pending,db.fetcher));
  assert.equal(db.tables.get('service_requests').get(requestId).status,'Изпълнена');
  first.c.sessionStorage.clear(); // The original request context is gone.
  const afterLogin=harness(first.data);
  const items=afterLogin.c.WC_PENDING_CARDS.list(afterLogin.storage,scope,user);
  assert.equal(items.length,1);assert.equal(items[0].card.id,pending.card.id);
  assert.equal(afterLogin.c.WC_PENDING_CARDS.list(afterLogin.storage,scope,'Друг механик').length,0);
  afterLogin.c.WC_PENDING_CARDS.resume(afterLogin.c.sessionStorage,items[0],user);
  assert.equal(afterLogin.session.get('workcard_request_id'),requestId);
  assert.equal(JSON.parse(afterLogin.session.get('workcard_request_data')).vehicle,card.vehicle);
  const restored=harness(first.data,requestId);db.allowCompletedLog();
  await restored.c.WC_LEGACY_SUBMIT.submit(scope,restored.c.WC_DRAFTS.legacyPending(),db.fetcher);
  for(const table of ['work_cards','work_card_materials','work_card_log','request_log'])assert.equal(db.tables.get(table).size,1,table);
  restored.c.WC_DRAFTS.clear();assert.equal(restored.c.WC_PENDING_CARDS.list(restored.storage,scope,user).length,0);
});

test('a terminal conflict archives the same card for review and frees the form without discarding its data',async()=>{
  const requestId=randomUUID(),h=harness(new Map(),requestId),db=database(requestId),pending=h.c.WC_DRAFTS.legacySubmission({...card,request_id:requestId},[]);
  db.tables.set('work_cards',new Map([[pending.card.id,{...pending.card,work_hours:3}]]));
  let terminal;
  await assert.rejects(h.c.WC_LEGACY_SUBMIT.submit(scope,pending,db.fetcher),error=>{terminal=error;return error.terminal===true&&error.cardId===pending.card.id;});
  assert.equal(h.form.inert,true);
  h.c.WC_DRAFTS.archivePending(terminal.message);
  assert.equal(h.form.inert,false);assert.equal(h.c.WC_DRAFTS.legacyPending(),null);
  assert.equal(h.c.WC_PENDING_CARDS.list(h.storage,scope,user).length,0);
  const records=h.c.WC_PENDING_CARDS.list(h.storage,scope,user,true);
  assert.equal(records.length,1);assert.equal(records[0].card.id,pending.card.id);assert.equal(records[0].card.work_hours,2);
  assert.match(records[0].data.reason,/променен/);
});

test('full storage leaves the original pending submission available instead of silently losing it',()=>{
  const h=harness(),pending=h.c.WC_DRAFTS.legacySubmission(card,[]);h.blockStorage();
  assert.throws(()=>h.c.WC_DRAFTS.archivePending('Нужна е проверка'),/QuotaExceeded/);
  assert.equal(h.form.inert,true);assert.equal(h.c.WC_DRAFTS.legacyPending().card.id,pending.card.id);
  assert.equal(h.c.WC_PENDING_CARDS.list(h.storage,scope,user).length,1);
});
