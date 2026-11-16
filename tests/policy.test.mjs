import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizePath,validateCard} from '../supabase/functions/api-proxy/policy.mjs';
const mechanic={role:'mechanic',mechanic:'Механик "А"',name:'Механик А'};
const id='11111111-1111-4111-8111-111111111111';
export const card={mechanic:['Демо механик'],work_date:'2026-11-12',vehicle:'Машина',reg_number:'ДЕМО-01',client:'Примерен клиент',activity_type:'ТО / ППП',has_materials:true,work_hours:2,services:[],repair_systems:[],request_id:null};
export const materials=[{category:'oil',item_type:'Масло',quantity:2,unit:'литри'}];
test('mechanic filters cannot be overridden or duplicated',()=>{
  const out=authorizePath({path:'service_requests?assigned_mechanics=cs.{"Друг"}&assigned_mechanics=cs.{"Трети"}&select=id',method:'GET'},mechanic);
  const q=new URL(out.path,'https://x').searchParams;
  assert.equal(q.getAll('assigned_mechanics').length,1);
  assert.equal(q.get('assigned_mechanics'),'cs.{"Механик \\"А\\""}'.replaceAll('\\\\','\\'));
});
test('all roles are denied arbitrary paths, RPC calls, relation embedding, and raw card writes',()=>{
  for(const role of ['admin','manager','coordinator','mechanic']){
    for(const path of ['user_roles','registered_devices','rpc/submit_work_card','../user_roles','work_cards?select=*,user_roles(*)','work_cards?select=id&select=*,user_roles(*)','work_cards?or=(id.not.is.null)']){
      assert.throws(()=>authorizePath({path}, {...mechanic,role}),err=>[400,403].includes(err.status));
    }
    assert.throws(()=>authorizePath({path:'work_cards',method:'POST',body:card},{...mechanic,role}));
    assert.throws(()=>authorizePath({path:'work_card_materials?work_card_id=eq.'+id,method:'DELETE'},{...mechanic,role}));
  }
});
test('coordinator can create and edit request details but cannot assign, delete, or complete them',()=>{
  const user={role:'coordinator',name:'Verified user'};
  const result=authorizePath({path:'service_requests',method:'POST',body:{client_name:'Клиент',vehicle:'Машина',reg_number:'А1',description:'Проблем',status:'Изпълнена',created_by:'Impersonator'}},user);
  assert.equal(result.body.created_by,'Verified user');assert.equal(result.body.status,'Нова');
  const edited=authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:{description:'Коригирано описание',client_phone:'0123456789',notes:'Коментар'}},user);
  assert.equal(edited.body.description,'Коригирано описание');
  for(const key of ['status','assigned_mechanics','responsible_mechanic','scheduled_at','estimated_hours','assigned_at','started_at','completed_at','work_card_id','created_by','request_number']){
    assert.throws(()=>authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:{[key]:null}},user),err=>err.status===403,key);
  }
  assert.throws(()=>authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:{status:'Разпределена'}},user));
  assert.throws(()=>authorizePath({path:'service_requests?id=eq.'+id,method:'DELETE'},user));
  assert.throws(()=>authorizePath({path:'service_requests?id=eq.'+id,method:'PATCH',body:{status:'Изпълнена'}},{role:'manager'}));
});
test('bulk modifications and unknown fields are rejected; audit actor is server-owned',()=>{
  assert.throws(()=>authorizePath({path:'service_requests',method:'PATCH',body:{notes:'x'}},{role:'manager'}));
  assert.throws(()=>validateCard({...card,submission_actor:id},materials));
  const result=authorizePath({path:'request_log',method:'POST',body:{request_id:id,action:'edited',details:'x',performed_by:'fake'}},{role:'manager',name:'Real'});
  assert.equal(result.body.performed_by,'Real');
});
test('invalid quantities and incomplete cards never reach the database',()=>{
  assert.deepEqual(validateCard(card,materials),{card,materials});
  for(const work_hours of [0,-1,NaN,Infinity,'2'])assert.throws(()=>validateCard({...card,work_hours},materials));
  assert.throws(()=>validateCard(card,[{...materials[0],quantity:0}]));
  assert.throws(()=>validateCard({...card,has_materials:false},materials));
});
test('photo fields cannot smuggle script schemes or HTML event attributes',()=>{
  const body={client_name:'Клиент',vehicle:'Машина',reg_number:'А1',description:'Проблем'};
  for(const photo_data of ['javascript:alert(1)','x" onerror="alert(1)','data:image/svg+xml,<svg onload=alert(1)>'])assert.throws(()=>authorizePath({path:'service_requests',method:'POST',body:{...body,photo_data}},{role:'coordinator',name:'User'}));
  assert.equal(authorizePath({path:'service_requests',method:'POST',body:{...body,photo_data:'data:image/jpeg;base64,YWJj'}},{role:'coordinator',name:'User'}).body.photo_data,'data:image/jpeg;base64,YWJj');
});
