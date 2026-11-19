import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const scripts=['draft-store.js','drafts.js'].map(f=>readFileSync(new URL('../'+f,import.meta.url),'utf8'));
function harness(data=new Map(),fail=false){
  const listeners={},handlers={},fields=[{id:'vehicle',type:'text',value:'Демо машина',dataset:{}}];
  const form={inert:false,prepend(){},addEventListener(name,fn){handlers[name]=fn;}};
  const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('QuotaExceededError');data.set(k,v);},removeItem:k=>data.delete(k)};
  const context={crypto:{randomUUID},setTimeout,clearTimeout,Date,JSON,localStorage:storage,sessionStorage:{getItem:k=>k==='workcard_identity'?'verified-user':null},navigator:{onLine:true},WC_CONFIG:{demo:true},hasMaterials:true,currentStep:4,
    updateMechanicUI(){},onActivityChange(){},toggleMaterials(){},goStep(){},
    document:{createElement:()=>({style:{},setAttribute(){},insertAdjacentElement(){}}),getElementById:()=>form,querySelectorAll:selector=>selector.includes('#workCardForm input')?fields:[]},
    addEventListener:(name,fn)=>{listeners[name]=fn;}};
  context.window=context;vm.createContext(context);scripts.forEach(s=>vm.runInContext(s,context));context.WC_DRAFTS.init();
  return {context,store:context.WC_DRAFTS,data,form,fields,listeners,handlers};
}
const card={vehicle:'Демо машина',work_hours:2,mechanic:['Механик']},materials=[];
test('an ambiguous network result survives reload with the same submission key and frozen fields',()=>{
  const first=harness();const payload=first.store.submission(card,materials);assert.equal(first.form.inert,true);
  first.listeners.pagehide();
  const restored=harness(first.data);assert.equal(restored.form.inert,true);
  assert.equal(restored.store.submission(card,materials).submissionId,payload.submissionId);
  assert.throws(()=>restored.store.submission({...card,work_hours:3},materials),/Предишният опит/);
});
test('successful submission stays cleared even when pagehide runs after the form reset',()=>{
  const h=harness();h.store.submission(card,materials);assert.equal(h.data.size,1);
  h.store.clear();h.listeners.pagehide();assert.equal(h.data.size,0);assert.equal(h.form.inert,false);
});
test('definite server rejection unlocks editing; storage failure prevents an untracked submission',()=>{
  const h=harness();const old=h.store.submission(card,materials).submissionId;h.store.reject();assert.equal(h.form.inert,false);
  assert.notEqual(h.store.submission(card,materials).submissionId,old);
  const blocked=harness(new Map(),true);assert.throws(()=>blocked.store.submission(card,materials),/черновата/);assert.equal(blocked.form.inert,false);
});
test('legacy pending IDs and quantities survive reload; storage failure prevents the first write',()=>{
  const first=harness();const pending=first.store.legacySubmission(card,[{quantity:10}]);
  const restored=harness(first.data);assert.equal(restored.form.inert,true);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.store.legacyPending())),JSON.parse(JSON.stringify(pending)));
  assert.equal(restored.store.legacySubmission({...card,work_hours:7},[]).card.id,pending.card.id);
  assert.equal(restored.store.legacyPending().materials[0].quantity,10);
  const blocked=harness(new Map(),true);assert.throws(()=>blocked.store.legacySubmission(card,[]),/не може да се запази/);
});
