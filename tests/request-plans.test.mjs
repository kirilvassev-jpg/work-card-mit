import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {operations,plannedMaterials,actualCard,mergeMaterials} from '../plan-model.mjs';
import {createPlanSession} from '../request-plan.mjs';
import {authorizePath} from '../supabase/functions/api-proxy/policy.mjs';
import {renderCompatibleRelease} from '../scripts/build-compatible-release.mjs';
const id='11111111-1111-4111-8111-111111111111';
const oil={category:'oil',item_type:'Двигателно масло',quantity:12,unit:'литри'};
const filter={category:'filter',item_type:'Маслен филтър',quantity:1,unit:'брой'};
const record={planned_operations:['Смяна на масло','Смяна на филтър'],planned_materials:[oil,filter]};
const card={mechanic:['Механик'],work_date:'2026-11-17',vehicle:'Машина',reg_number:'ДЕМО',client:'Клиент',activity_type:'ТО / ППП',has_materials:true,work_hours:2,notes:'Бележка'};

test('office planning validates positions but never changes request assignment/completion or material records',()=>{
  const result=authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:record},{role:'coordinator',name:'Проверен координатор'});
  assert.deepEqual(result.body,record);
  assert.throws(()=>authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:{...record,status:'Изпълнена'}},{role:'coordinator'}));
  for(const bad of [[{...oil,quantity:0}],[{...filter,quantity:1.5}],[oil,oil],[{...oil,unit:'неизвестна'}]])assert.throws(()=>plannedMaterials(bad));
  assert.throws(()=>operations(['Операция','операция']));
  assert.throws(()=>authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:{planned_materials:[{...oil,quantity:-1}]}},{role:'manager'}),error=>error.status===400);
});

test('only confirmed operations and materials are reported; actual quantities override the proposal',()=>{
  const session=createPlanSession(record);
  assert.throws(()=>session.prepare(card,[]),/Отбележи/);
  session.tasks[0].done=true;
  assert.deepEqual(session.prepare(card,[]).materials,[]);
  session.materials[0].used=true;session.materials[0].quantity=10;
  const result=session.prepare(card,[]);
  assert.deepEqual(result.materials,[{...oil,quantity:10}]);
  assert.match(result.card.notes,/Бележка/);assert.match(result.card.notes,/Смяна на масло/);assert.doesNotMatch(result.card.notes,/Смяна на филтър/);
  assert.deepEqual(record.planned_materials,[oil,filter]);
  assert.throws(()=>session.prepare({...card,has_materials:false},[]),/потвърдени материали/);
});

test('the normal form list and suggestions cannot double-count the same material',()=>{
  assert.deepEqual(mergeMaterials([oil],[oil]),[oil]);
  assert.throws(()=>mergeMaterials([oil],[{...oil,quantity:10}]),/два пъти/);
  assert.throws(()=>actualCard(card,[{...oil,quantity:0}],[],[]));
});

test('drafts restore confirmations, added work and even an unfinished zero quantity for correction',()=>{
  const session=createPlanSession(record);session.tasks[0].done=true;session.materials[0].used=true;session.materials[0].quantity=0;
  session.addTask('Проверка на ремък');session.addMaterial({category:'other',item_type:'Уплътнение',quantity:2,unit:'брой'});
  const restored=createPlanSession(record);restored.restore(JSON.parse(JSON.stringify(session.snapshot())));
  assert.equal(restored.tasks[0].done,true);assert.equal(restored.tasks.at(-1).name,'Проверка на ремък');assert.equal(restored.materials[0].quantity,0);
  assert.throws(()=>restored.prepare(card,[]),/количеството/);
  restored.materials[0].quantity=10;
  assert.equal(restored.prepare(card,[]).materials.length,2);
  restored.clear();assert.ok(restored.tasks.every(item=>!item.done));assert.ok(restored.materials.every(item=>!item.used));
});

test('browser/server plan validation is the same and the dashboard artifact contains it',async()=>{
  assert.equal(await readFile(new URL('../plan-model.mjs',import.meta.url),'utf8'),await readFile(new URL('../supabase/functions/_shared/plan-model.mjs',import.meta.url),'utf8'));
});

async function legacyHarness({cancel=false,invalid=false}={}){
  const release=await renderCompatibleRelease(),html=release.files.get(release.metadata.prefix+'legacy/index.html').toString('utf8');
  const source=html.slice(html.indexOf('async function submitForm()'),html.indexOf('function showStatus(msg, type)'));
  const plan=createPlanSession(record);plan.tasks[0].done=true;plan.materials[0].used=true;plan.materials[0].quantity=invalid?0:10;
  const values={workDate:'2026-11-17',vehicle:'Машина',regNumber:'ДЕМО',kmHours:'100',client:'Клиент',workHours:'2',otherMaterials:'',kmTraveled:'',workNotes:'Бележка'};
  const writes=[],messages=[];let cleared=0;
  const context={navigator:{onLine:true},validate:()=>true,confirm:text=>{messages.push(text);return !cancel;},document:{getElementById:id=>({value:values[id]??'',disabled:false,textContent:''}),querySelectorAll:()=>[{dataset:{value:'Механик'}}]},getActivities:()=>['ТО / ППП'],hasTO:()=>true,hasRepair:()=>false,hasMaterials:true,getCheckedValues:()=>[],collectMaterials:()=>[],WC_REQUEST_PLAN:plan,
    WC_DRAFTS:{save:()=>true,clear:()=>cleared++,legacyPending:()=>null,legacySubmission:(card,materials)=>({card,materials})},
    WC_LEGACY_SUBMIT:{submit:async(_,pending)=>{writes.push({table:'work_cards',data:pending.card},{table:'work_card_materials',data:pending.materials});return id;}},
    API_URL:'http://mock.invalid',sessionStorage:{getItem:()=>null,removeItem(){}},resetForm(){},showStatus:()=>{},setTimeout(){},console:{error(){}},window:{_currentRequestId:null}};
  vm.runInNewContext(source,context);await context.submitForm();
  return {writes,messages,cleared};
}
test('the preserved mechanic submission reviews first, sends only confirmed actuals, and clears after success',async()=>{
  const result=await legacyHarness();
  assert.equal(result.writes[0].table,'work_cards');assert.match(result.writes[0].data.notes,/Смяна на масло/);assert.doesNotMatch(result.writes[0].data.notes,/Смяна на филтър/);
  assert.equal(result.writes[1].table,'work_card_materials');assert.equal(result.writes[1].data.length,1);assert.equal(result.writes[1].data[0].quantity,10);assert.equal(result.cleared,1);
  assert.match(result.messages[0],/10 литри/);
  assert.equal((await legacyHarness({cancel:true})).writes.length,0);
  assert.equal((await legacyHarness({invalid:true})).writes.length,0);
});
