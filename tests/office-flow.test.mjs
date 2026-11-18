import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDemoApi} from '../scripts/demo-api.mjs';

test('office roles can create, correct, assign, report, edit and reopen a request without device enrollment',async()=>{
  const api=createDemoApi();
  const profiles={};
  for(const role of ['coordinator','manager','admin'])profiles[role]=(await api({action:'demo_login',role})).data;
  const call=(role,input)=>api(input,{authorization:'Bearer '+profiles[role].token});
  const created=await call('coordinator',{path:'service_requests',method:'POST',body:{client_name:'Примерен клиент',vehicle:'Машина',reg_number:'ПРИМЕР-01',description:'Проверка'}});
  assert.equal(created.status,200);
  const id=created.data[0].id,path='service_requests?id=eq.'+id;
  assert.equal((await call('coordinator',{path,method:'PATCH',body:{description:'Коригирана заявка',client_phone:'0123456789'}})).status,200);
  assert.equal((await call('coordinator',{path,method:'PATCH',body:{assigned_mechanics:['Демо механик']}})).status,403);
  assert.equal((await call('manager',{path,method:'PATCH',body:{assigned_mechanics:['Демо механик'],responsible_mechanic:'Демо механик',status:'Разпределена'}})).status,200);
  assert.equal((await call('coordinator',{path,method:'PATCH',body:{notes:'Потвърден час'}})).status,200);
  const assigned=(await call('admin',{path})).data[0];
  assert.equal(assigned.status,'Разпределена');assert.deepEqual(assigned.assigned_mechanics,['Демо механик']);
  assert.equal((await call('manager',{action:'start_task',id,mechanic:'Демо механик'})).status,200);
  const card={mechanic:['Демо механик'],request_id:id,work_date:'2026-11-13',vehicle:'Машина',reg_number:'ПРИМЕР-01',client:'Примерен клиент',activity_type:'РЕМОНТ',work_hours:2,has_materials:true};
  const materials=[{category:'oil',item_type:'Масло',quantity:2,unit:'литри'}];
  const submitted=await call('manager',{action:'submit_work_card',submissionId:randomUUID(),card,materials});
  assert.equal(submitted.status,200);
  for(const role of ['coordinator','manager','admin']){
    assert.equal((await call(role,{path:'work_cards'})).data.length,1);
    assert.equal((await call(role,{path})).data[0].status,'Изпълнена');
  }
  assert.equal((await call('coordinator',{action:'update_work_card',id:submitted.data.id,card,materials})).status,403);
  assert.equal((await call('manager',{action:'update_work_card',id:submitted.data.id,card:{...card,work_hours:3},materials})).status,200);
  assert.equal((await call('admin',{path:'work_cards'})).data[0].work_hours,3);
  assert.equal((await call('admin',{path:'work_card_materials'})).data.length,1);
  assert.equal((await call('admin',{path:'work_cards?id=eq.'+submitted.data.id,method:'DELETE'})).status,200);
  assert.equal((await call('manager',{path})).data[0].status,'В изпълнение');
  assert.equal((await call('manager',{path:'work_card_materials'})).data.length,0);
});

test('the request editor renders stored descriptions and machine fields as text',async()=>{
  const history=await readFile(new URL('../history.html',import.meta.url),'utf8');
  const auth=await readFile(new URL('../auth.js',import.meta.url),'utf8');
  const description='</textarea><img src=x onerror=alert(1)>';
  const attribute='" autofocus onfocus="alert(1)';
  const record={id:randomUUID(),description};
  for(const field of ['brand','model','reg_number','year_of_manufacture','frame_number','km_hours','desired_date'])record[field]=attribute;
  const elements=[];
  const WC={};
  const context=vm.createContext({WC,WC_AUTH:WC,WC_PLAN_EDITOR:{mount(){}},allServiceRequests:[record],document:{createElement:()=>({style:{},querySelector:()=>({before(){}})}),body:{appendChild:el=>elements.push(el)}}});
  vm.runInContext(auth.slice(auth.indexOf('WC.escapeHTML = function'),auth.indexOf('WC.isMechanic = function')),context);
  vm.runInContext(history.slice(history.indexOf('function escAttr(v)'),history.indexOf('let editClientType')),context);
  vm.runInContext('function sanitize(s){return WC_AUTH.escapeHTML(s);}',context);
  vm.runInContext(history.slice(history.indexOf('function editRequest(requestId)'),history.indexOf('async function saveEditRequest(requestId)')),context);
  context.editRequest(record.id);
  assert.equal(elements.length,1);
  const html=elements[0].innerHTML;
  assert.ok(!html.includes(description));assert.ok(!html.includes(attribute));
  assert.match(html,/&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  for(const id of ['Brand','Model','Reg','Year','Frame','Km','Date'])assert.ok(html.includes('id="editReq'+id+'"'));
  assert.equal((html.match(/value="&quot; autofocus onfocus=&quot;alert\(1\)"/g)||[]).length,7);
});
