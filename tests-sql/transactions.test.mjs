import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('PostgreSQL migrations, rollback, replay and authorization boundaries',async(t)=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const file of ['20261112000100_baseline.sql','20261112000200_security_and_atomic_cards.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    if(file.includes('baseline'))await db.exec('grant select on public.work_cards to public;');
  }
  await db.exec(await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
  const actor=randomUUID();
  const makeCard=request_id=>({mechanic:['Демо механик'],work_date:'2026-11-12',vehicle:'Демо машина',reg_number:'ДЕМО-01',client:'Примерен клиент',activity_type:'ТО / ППП',has_materials:true,work_hours:2,request_id});
  const material={category:'oil',item_type:'Масло',unit:'литри',quantity:2};
  async function request(){return (await db.query("insert into service_requests(client_name,vehicle,reg_number,description,status,assigned_mechanics) values('Демо','Машина','ДЕМО-01','Проблем','В изпълнение',array['Демо механик']) returning id")).rows[0].id;}
  async function submit(card,mats=[material],key=randomUUID(),who='Демо механик'){
    return (await db.query('select submit_work_card($1::jsonb,$2::jsonb,$3::uuid,$4,$5::uuid,$6) as result',[JSON.stringify(card),JSON.stringify(mats),key,'Проверен механик',actor,who])).rows[0].result;
  }
  const count=async table=>(await db.query('select count(*)::int as n from '+table)).rows[0].n;
  await t.test('a material failure rolls back card, both logs and request completion',async()=>{
    const id=await request();const before=await count('work_cards');
    await assert.rejects(submit(makeCard(id),[{...material,quantity:-1}]));
    assert.equal(await count('work_cards'),before);
    assert.equal((await db.query('select status,work_card_id from service_requests where id=$1',[id])).rows[0].status,'В изпълнение');
    assert.equal(await count('work_card_log'),0);assert.equal(await count('request_log'),0);
  });
  await t.test('successful commit is atomic, identical replay is safe, different payload and second completion fail',async()=>{
    const id=await request(),card=makeCard(id),key=randomUUID();const first=await submit(card,[material],key);
    const retry=await submit(card,[material],key);assert.equal(retry.id,first.id);assert.equal(retry.replayed,true);
    assert.equal(await count('work_cards'),1);assert.equal(await count('work_card_materials'),1);
    assert.equal(await count('work_card_log'),1);assert.equal(await count('request_log'),1);
    assert.equal((await db.query('select status from service_requests where id=$1',[id])).rows[0].status,'Изпълнена');
    await assert.rejects(submit({...card,work_hours:3},[material],key));
    await assert.rejects(submit(card));assert.equal(await count('work_cards'),1);
  });
  await t.test('unassigned mechanics cannot start or complete another mechanic task',async()=>{
    const id=await request();await assert.rejects(submit(makeCard(id),[material],randomUUID(),'Друг механик'));
    await assert.rejects(db.query("select start_work_task($1,'Друг механик','Друг механик')",[id]));
  });
  await t.test('editing also rolls back deleted materials and modified card on failure',async()=>{
    const first=(await db.query('select id from work_cards limit 1')).rows[0].id;
    await assert.rejects(db.query('select update_work_card($1,$2,$3,$4)',[first,JSON.stringify({work_hours:9}),JSON.stringify([{...material,quantity:-2}]),'Ръководител']));
    assert.equal((await db.query('select work_hours from work_cards where id=$1',[first])).rows[0].work_hours,'2');
    assert.equal(await count('work_card_materials'),1);
  });
  await t.test('anonymous/authenticated roles cannot read tables or execute privileged RPCs',async()=>{
    assert.equal((await db.query("select has_table_privilege('anon','work_cards','SELECT') as ok")).rows[0].ok,false);
    assert.equal((await db.query("select has_table_privilege('authenticated','registered_devices','SELECT') as ok")).rows[0].ok,false);
    assert.equal((await db.query("select has_function_privilege('anon','public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)','EXECUTE') as ok")).rows[0].ok,false);
    assert.equal((await db.query("select has_function_privilege('service_role','public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)','EXECUTE') as ok")).rows[0].ok,true);
  });
  await t.test('preflight accepts the reconstructed schema and rejects an incompatible existing schema',async()=>{
    const preflight=await readFile(new URL('../supabase/preflight.sql',import.meta.url),'utf8');
    await db.exec(preflight);
    await db.exec('alter table work_cards rename column mechanic to incompatible_mechanic;');
    await assert.rejects(db.exec(preflight),/Schema mismatch/);
    await db.exec('alter table work_cards rename column incompatible_mechanic to mechanic;');
  });
});
