import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevServer} from '../scripts/dev-server.mjs';
import {randomUUID} from 'node:crypto';
test('demo is isolated and the complete request/card flow is idempotent',async(t)=>{
  const server=await createDevServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const base='http://127.0.0.1:'+server.address().port;
  async function api(body,token){const response=await fetch(base+'/__demo/api',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
  assert.match(await(await fetch(base+'/app-config.js')).text(),/"demo":true/);
  for(const page of ['login.html','index.html','requests.html','tablet.html','history.html','schedule.html','dashboard.html','assign.html','devices.html','work-card-mit/login.html'])assert.equal((await fetch(base+'/'+page)).status,200,page);
  for(const file of ['.git/config','.env','supabase/seed.sql','package.json','scripts/demo-api.mjs','%2e%2e/package.json'])assert.equal((await fetch(base+'/'+file)).status,404,file);
  assert.equal((await api({path:'work_cards'})).status,401);
  const manager=(await api({action:'demo_login',role:'manager'})).data;
  const mechanic=(await api({action:'demo_login',role:'mechanic',mechanic:'Демо механик'})).data;
  const tasks=(await api({path:'service_requests'},mechanic.token)).data;assert.equal(tasks.length,1);
  assert.equal((await api({action:'start_task',id:tasks[0].id},mechanic.token)).status,200);
  const payload={action:'submit_work_card',submissionId:randomUUID(),card:{mechanic:['Демо механик'],request_id:tasks[0].id,work_date:'2026-11-12',vehicle:'Демо Машина',reg_number:'ДЕМО-01',client:'Клиент',activity_type:'ТО / ППП',work_hours:2,has_materials:true},materials:[{category:'oil',item_type:'Масло',quantity:2,unit:'литри'}]};
  const first=await api(payload,mechanic.token), retry=await api(payload,mechanic.token);assert.equal(first.status,200);assert.equal(first.data.id,retry.data.id);assert.equal(retry.data.replayed,true);
  assert.equal((await api({...payload,submissionId:randomUUID()},mechanic.token)).status,409);
  assert.equal((await api({path:'work_cards'},manager.token)).data.length,1);
  assert.equal((await api({path:'work_card_materials'},manager.token)).data.length,1);
  assert.equal((await api({path:'service_requests?id=eq.'+tasks[0].id},manager.token)).data[0].status,'Изпълнена');
  const hostile=await fetch(base+'/__demo/api',{method:'POST',headers:{Origin:'https://evil.invalid'},body:'{}'});assert.equal(hostile.status,403);
});
test('backend mode points at local Supabase and never offers demo login',async(t)=>{
  const server=await createDevServer({backend:true});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const base='http://127.0.0.1:'+server.address().port;
  const config=await(await fetch(base+'/app-config.js')).text();assert.match(config,/127.0.0.1:54321/);assert.match(config,/"demo":false/);
  assert.equal((await fetch(base+'/__demo/api',{method:'POST',body:'{}'})).status,405);
});
