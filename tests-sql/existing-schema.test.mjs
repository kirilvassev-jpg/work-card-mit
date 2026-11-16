import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const metadata=JSON.parse(await readFile(new URL('./fixtures/existing-schema.json',import.meta.url),'utf8'));
const preparation=await readFile(new URL('../supabase/manual/01_prepare_existing.sql',import.meta.url),'utf8');
const atomicSubmit=await readFile(new URL('../supabase/manual/02_atomic_submit.sql',import.meta.url),'utf8');
const helpers=await readFile(new URL('../supabase/manual/03_task_and_card_helpers.sql',import.meta.url),'utf8');
const identityTemplate=await readFile(new URL('../supabase/manual/04_link_office_user.sql',import.meta.url),'utf8');
const bulkIdentityTemplate=await readFile(new URL('../supabase/manual/05_link_office_users.sql',import.meta.url),'utf8');
const devicePreparation=await readFile(new URL('../supabase/manual/06_prepare_device_registry.sql',import.meta.url),'utf8');
const security=await readFile(new URL('../supabase/migrations/20261112000200_security_and_atomic_cards.sql',import.meta.url),'utf8');
const quote=value=>{assert.match(value,/^[a-z_]+$/);return '"'+value+'"';};
const types={uuid:'uuid',text:'text',_text:'text[]',int4:'integer',bool:'boolean',numeric:'numeric',date:'date',timestamptz:'timestamptz'};
const defaults=new Set(['gen_random_uuid()','now()','0','true','false',"'{}'::text[]","'Нормален'::text","'Нова'::text","'ФЛ'::text"]);
async function existingDatabase(){
  const db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const table of new Set(metadata.columns.map(c=>c.table_name))){
    const cols=metadata.columns.filter(c=>c.table_name===table).map(c=>{
      assert.ok(types[c.column_type]);assert.ok(c.column_default===null || defaults.has(c.column_default));
      return quote(c.column_name)+' '+types[c.column_type]+(c.is_nullable==='NO'?' not null':'')+(c.column_default?' default '+c.column_default:'');
    });
    await db.exec('create table public.'+quote(table)+'('+cols.join(',')+');');
  }
  const constraints=[...metadata.constraints].sort((a,b)=>Number(a.definition.startsWith('FOREIGN KEY'))-Number(b.definition.startsWith('FOREIGN KEY')));
  for(const c of constraints)await db.exec('alter table public.'+quote(c.table_name)+' add constraint '+quote(c.constraint_name)+' '+c.definition);
  for(const g of metadata.permissions){
    assert.ok(['INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'].includes(g.privilege_type));
    await db.exec('grant '+g.privilege_type+' on public.'+quote(g.table_name)+' to '+(g.grantee==='PUBLIC'?'PUBLIC':quote(g.grantee)));
  }
  return db;
}
test('device preparation preserves existing rows and access while protecting the new registry',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());
  const before=(await db.query("insert into user_roles(email,name,role) values('example@example.invalid','Примерен потребител','manager') returning *")).rows;
  const grantsSql="select table_name,grantee,privilege_type from information_schema.table_privileges where table_schema='public' and table_name <> 'registered_devices' order by table_name,grantee,privilege_type";
  const grants=(await db.query(grantsSql)).rows;
  await db.exec(devicePreparation);await db.exec(devicePreparation);
  assert.deepEqual((await db.query('select * from user_roles')).rows,before);
  assert.deepEqual((await db.query(grantsSql)).rows,grants);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.registered_devices'::regclass")).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated','service_role']){
    for(const permission of ['SELECT','INSERT','UPDATE','DELETE']){
      assert.equal((await db.query("select has_table_privilege($1,'public.registered_devices',$2) as allowed",[role,permission])).rows[0].allowed,role==='service_role');
    }
  }
  await db.exec('set role anon;');
  await assert.rejects(db.query('select * from registered_devices'),/permission denied/);
  await db.exec('reset role;');
  await db.query("insert into registered_devices(name,mechanic,token_hash,created_by,expires_at) values('Примерен таблет','Механик',$1,$2,now()+interval '90 days')",['a'.repeat(64),randomUUID()]);
  await db.exec(devicePreparation);
  assert.equal((await db.query('select count(*)::int as n from registered_devices')).rows[0].n,1);
});

test('device preparation refuses to alter an unrelated existing registry',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());
  await db.exec('create table registered_devices(note text); grant select on registered_devices to anon;');
  await assert.rejects(db.exec(devicePreparation),/unrelated registered_devices/);
  await db.exec('rollback;');
  assert.equal((await db.query("select has_table_privilege('anon','registered_devices','SELECT') as allowed")).rows[0].allowed,true);
  assert.deepEqual((await db.query("select column_name from information_schema.columns where table_name='registered_devices'")).rows,[{column_name:'note'}]);
});

test('manual preparation is compatible with the supplied live schema, preserves rows and access, and can be repeated',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());
  await db.exec("insert into user_roles(email,name,role) values('example@example.invalid','Примерно име','manager');");
  await db.exec("insert into work_cards(work_date,vehicle,reg_number,client,activity_type,mechanic,synced) values('2026-11-12','Машина','ДЕМО','Клиент','РЕМОНТ',array['Механик'],true);");
  await db.exec('alter table work_cards enable row level security;');
  const roleBefore=(await db.query('select * from user_roles')).rows[0];
  const cardBefore=(await db.query('select * from work_cards')).rows[0];
  const grantsSql="select table_name,grantee,privilege_type from information_schema.table_privileges where table_schema='public' order by table_name,grantee,privilege_type";
  const grantsBefore=(await db.query(grantsSql)).rows;
  await db.exec(preparation);await db.exec(preparation);
  const roleAfter=(await db.query('select * from user_roles')).rows[0];
  const cardAfter=(await db.query('select * from work_cards')).rows[0];
  for(const [key,value] of Object.entries(roleBefore))assert.deepEqual(roleAfter[key],value,key);
  for(const [key,value] of Object.entries(cardBefore))assert.deepEqual(cardAfter[key],value,key);
  assert.deepEqual((await db.query(grantsSql)).rows,grantsBefore);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.work_cards'::regclass")).rows[0].relrowsecurity,true);
  assert.equal(roleAfter.microsoft_oid,null);assert.equal(roleAfter.tenant_id,null);
  assert.equal(cardAfter.submission_id,null);assert.equal(cardAfter.submission_actor,null);assert.equal(cardAfter.submission_payload,null);
});
test('transactional migration works with actual nullable fields, extra sync columns and circular foreign keys',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());
  await db.exec(preparation);await db.exec(security);
  const request=(await db.query("insert into service_requests(client_name,vehicle,reg_number,status,assigned_mechanics) values('Клиент','Машина','ДЕМО','В изпълнение',array['Механик']) returning id")).rows[0].id;
  const card={mechanic:['Механик'],work_date:'2026-11-12',vehicle:'Машина',reg_number:'ДЕМО',client:'Клиент',activity_type:'РЕМОНТ',has_materials:true,work_hours:2,request_id:request};
  const material={category:'oil',item_type:'Масло',quantity:2,unit:'литри'};
  const actor=randomUUID();
  async function submit(m){return (await db.query('select submit_work_card($1,$2,$3,$4,$5,$6) as result',[JSON.stringify(card),JSON.stringify([m]),randomUUID(),'Механик',actor,'Механик'])).rows[0].result;}
  for(const bad of [{...material,quantity:null},{...material,unit:null},{...material,quantity:-1}]){
    await assert.rejects(submit(bad));
    assert.equal((await db.query('select count(*)::int as n from work_cards')).rows[0].n,0);
  }
  const result=await submit(material);
  assert.equal((await db.query('select work_card_id from service_requests where id=$1',[request])).rows[0].work_card_id,result.id);
  assert.equal((await db.query('select synced from work_cards where id=$1',[result.id])).rows[0].synced,false);
  await assert.rejects(db.query('select update_work_card($1,$2,$3,$4)',[result.id,JSON.stringify({work_hours:3}),JSON.stringify([{...material,quantity:null}]),'Ръководител']));
  assert.equal((await db.query('select work_hours from work_cards where id=$1',[result.id])).rows[0].work_hours,'2');
  await db.query('select delete_work_card($1,$2)',[result.id,'Ръководител']);
  assert.equal((await db.query('select status from service_requests where id=$1',[request])).rows[0].status,'В изпълнение');
  assert.equal((await db.query('select count(*)::int as n from work_card_materials')).rows[0].n,0);
});
test('stage 2 adds the atomic helper while preserving existing table grants and rows',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());
  await db.exec(preparation);
  const grantsSql="select table_name,grantee,privilege_type from information_schema.table_privileges where table_schema='public' order by table_name,grantee,privilege_type";
  const before=(await db.query(grantsSql)).rows;
  await db.exec(atomicSubmit);await db.exec(atomicSubmit);
  assert.deepEqual((await db.query(grantsSql)).rows,before);
  for(const role of ['anon','authenticated','service_role']){
    const {rows}=await db.query("select has_function_privilege($1,'public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)','EXECUTE') as allowed",[role]);
    assert.equal(rows[0].allowed,role==='service_role');
  }
  const req=(await db.query("insert into service_requests(client_name,vehicle,reg_number,status,assigned_mechanics) values('Клиент','Машина','ДЕМО','Разпределена',array['Механик']) returning id")).rows[0].id;
  const card={mechanic:['Механик'],work_date:'2026-11-12',vehicle:'Машина',reg_number:'ДЕМО',client:'Клиент',activity_type:'РЕМОНТ',has_materials:true,work_hours:2,request_id:req};
  const actor=randomUUID(),submission=randomUUID(),material={category:'oil',item_type:'Масло',unit:'литри',quantity:2};
  const args=[JSON.stringify(card),JSON.stringify([material]),submission,'Механик',actor,'Механик'];
  const sql='select submit_work_card($1,$2,$3,$4,$5,$6) as result';
  const first=(await db.query(sql,args)).rows[0].result;
  const replay=(await db.query(sql,args)).rows[0].result;
  assert.equal(first.id,replay.id);assert.equal(replay.replayed,true);
  assert.equal((await db.query('select count(*)::int as n from work_cards')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from work_card_materials')).rows[0].n,1);
});
test('stage 2 refuses to replace a function belonging to another implementation',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  await db.exec("create function public.submit_work_card(p_card jsonb) returns jsonb language sql as 'select p_card';");
  await assert.rejects(db.exec(atomicSubmit),/different submit_work_card/);
  await db.exec('rollback;');
  assert.equal((await db.query("select to_regprocedure('public.submit_work_card(jsonb)') is not null as exists")).rows[0].exists,true);
});
test('stage 3 preserves table access, starts tasks idempotently, rolls back failed edits and reopens requests after card deletion',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());
  await db.exec(preparation);await db.exec(atomicSubmit);
  const grantsSql="select table_name,grantee,privilege_type from information_schema.table_privileges where table_schema='public' order by table_name,grantee,privilege_type";
  const before=(await db.query(grantsSql)).rows;
  await db.exec(helpers);await db.exec(helpers);
  assert.deepEqual((await db.query(grantsSql)).rows,before);
  for(const signature of ['public.start_work_task(uuid,text,text)','public.update_work_card(uuid,jsonb,jsonb,text)','public.delete_work_card(uuid,text)']){
    for(const role of ['anon','authenticated','service_role']){
      const result=await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,signature]);
      assert.equal(result.rows[0].allowed,role==='service_role');
    }
  }
  const req=(await db.query("insert into service_requests(client_name,vehicle,reg_number,status,assigned_mechanics) values('Клиент','Машина','ДЕМО','Разпределена',array['Механик',null]) returning id")).rows[0].id;
  await assert.rejects(db.query('select start_work_task($1,$2,$3)',[req,'Друг механик','Друг механик']));
  await db.query('select start_work_task($1,$2,$3)',[req,'Механик','Механик']);
  await db.query('select start_work_task($1,$2,$3)',[req,'Механик','Механик']);
  assert.equal((await db.query("select count(*)::int as n from request_log where action='started'")).rows[0].n,1);
  const card={mechanic:['Механик'],work_date:'2026-11-12',vehicle:'Машина',reg_number:'ДЕМО',client:'Клиент',activity_type:'РЕМОНТ',has_materials:true,work_hours:2,request_id:req};
  const material={category:'oil',item_type:'Масло',unit:'литри',quantity:2};
  const result=(await db.query('select submit_work_card($1,$2,$3,$4,$5,$6) as result',[JSON.stringify(card),JSON.stringify([material]),randomUUID(),'Механик',randomUUID(),'Механик'])).rows[0].result;
  await assert.rejects(db.query('select update_work_card($1,$2,$3,$4)',[result.id,JSON.stringify({work_hours:3}),JSON.stringify([{...material,quantity:null}]),'Ръководител']));
  assert.equal((await db.query('select work_hours from work_cards where id=$1',[result.id])).rows[0].work_hours,'2');
  await db.query('select update_work_card($1,$2,$3,$4)',[result.id,JSON.stringify({work_hours:3}),JSON.stringify([material]),'Ръководител']);
  assert.equal((await db.query('select work_hours from work_cards where id=$1',[result.id])).rows[0].work_hours,'3');
  await db.query('select delete_work_card($1,$2)',[result.id,'Ръководител']);
  const request=(await db.query('select status,work_card_id,completed_at from service_requests where id=$1',[req])).rows[0];
  assert.deepEqual(request,{status:'В изпълнение',work_card_id:null,completed_at:null});
  assert.equal((await db.query('select count(*)::int as n from work_card_materials')).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int as n from work_card_log where action='deleted'")).rows[0].n,1);
});
test('stage 3 refuses to overwrite an unrelated existing helper',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  await db.exec("create function public.delete_work_card(p_id uuid) returns jsonb language sql as 'select jsonb_build_object(''id'',p_id)';");
  await assert.rejects(db.exec(helpers),/different delete_work_card/);
  await db.exec('rollback;');
  assert.equal((await db.query("select to_regprocedure('public.start_work_task(uuid,text,text)') is null as unchanged")).rows[0].unchanged,true);
});
function identitySql(email,oid,tenant){
  return identityTemplate.replaceAll('__EMAIL__',email.replaceAll("'","''")).replaceAll('__USER_OBJECT_ID__',oid).replaceAll('__TENANT_ID__',tenant);
}
test('office identity binding is idempotent and preserves the existing role, name, status and creation date',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  const before=(await db.query("insert into user_roles(email,name,role) values('example@example.invalid','Примерен потребител','manager') returning *")).rows[0];
  const oid=randomUUID(),tenant=randomUUID(),sql=identitySql('example@example.invalid',oid,tenant);
  await db.exec(sql);await db.exec(sql);
  const after=(await db.query('select * from user_roles')).rows[0];
  for(const field of ['id','name','email','role','is_active','created_at'])assert.deepEqual(after[field],before[field],field);
  assert.equal(after.microsoft_oid,oid);assert.equal(after.tenant_id,tenant);
});
test('identity binding rejects absent, inactive, case-ambiguous and previously linked records',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  const oid=randomUUID(),tenant=randomUUID();
  const reject=async(sql,pattern)=>{await assert.rejects(db.exec(sql),pattern);await db.exec('rollback;');};
  await reject(identitySql('missing@example.invalid',oid,tenant),/found 0/);
  assert.equal((await db.query('select count(*)::int as n from user_roles')).rows[0].n,0);
  await db.exec("insert into user_roles(email,name,role,is_active) values('example@example.invalid','Примерен потребител','manager',false);");
  await reject(identitySql('example@example.invalid',oid,tenant),/inactive/);
  await db.exec('update user_roles set is_active=true;');
  await db.exec("insert into user_roles(email,name,role) values('EXAMPLE@example.invalid','Втори запис','admin');");
  await reject(identitySql('example@example.invalid',oid,tenant),/found 2/);
  await db.exec("delete from user_roles where email='EXAMPLE@example.invalid';");
  await db.exec(identitySql('example@example.invalid',oid,tenant));
  await reject(identitySql('example@example.invalid',randomUUID(),tenant),/different Microsoft identity/);
  await db.exec("insert into user_roles(email,name,role) values('another@example.invalid','Друг потребител','coordinator');");
  await reject(identitySql('another@example.invalid',oid,tenant),/another role record/);
  const unchanged=(await db.query("select microsoft_oid,tenant_id,role from user_roles where email='another@example.invalid'")).rows[0];
  assert.deepEqual(unchanged,{microsoft_oid:null,tenant_id:null,role:'coordinator'});
});
function bulkIdentitySql(tenant,links){
  return bulkIdentityTemplate.replaceAll('__TENANT_ID__',tenant).replaceAll('__LINKS_JSON__',JSON.stringify(links).replaceAll("'","''"));
}
const bulkLinks=[
  {email:'admin@example.invalid',oid:'11111111-1111-4111-8111-111111111111',role:'admin'},
  {email:'coordinator@example.invalid',oid:'22222222-2222-4222-8222-222222222222',role:'coordinator'},
  {email:'manager@example.invalid',oid:'33333333-3333-4333-8333-333333333333',role:'manager'}
];
test('bulk identity binding preserves all roles and an already-linked user and is safe to repeat',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  const tenant=randomUUID(),existingOid=randomUUID();
  for(const link of bulkLinks)await db.query('insert into user_roles(email,name,role) values($1,$2,$3)',[link.email,'Примерен потребител',link.role]);
  await db.query("insert into user_roles(email,name,role,microsoft_oid,tenant_id) values('existing@example.invalid','Свързан потребител','manager',$1,$2)",[existingOid,tenant]);
  const before=(await db.query('select * from user_roles order by email')).rows;
  const sql=bulkIdentitySql(tenant,bulkLinks);await db.exec(sql);await db.exec(sql);
  const after=(await db.query('select * from user_roles order by email')).rows;
  for(let i=0;i<before.length;i++)for(const key of ['id','email','name','role','is_active','created_at'])assert.deepEqual(after[i][key],before[i][key],key);
  for(const link of bulkLinks){const row=after.find(r=>r.email===link.email);assert.equal(row.microsoft_oid,link.oid);assert.equal(row.tenant_id,tenant);}
  assert.equal(after.find(r=>r.email==='existing@example.invalid').microsoft_oid,existingOid);
});
test('a conflict on the last bulk record rolls back all preceding identity updates',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  const tenant=randomUUID(),wrongOid=randomUUID();
  for(const link of bulkLinks)await db.query('insert into user_roles(email,name,role) values($1,$2,$3)',[link.email,'Примерен потребител',link.role]);
  await db.query('update user_roles set microsoft_oid=$1,tenant_id=$2 where email=$3',[wrongOid,tenant,bulkLinks[2].email]);
  await assert.rejects(db.exec(bulkIdentitySql(tenant,bulkLinks)),/Different Microsoft identity/);await db.exec('rollback;');
  const rows=(await db.query('select * from user_roles order by email')).rows;
  assert.equal(rows.find(r=>r.email===bulkLinks[0].email).microsoft_oid,null);
  assert.equal(rows.find(r=>r.email===bulkLinks[1].email).microsoft_oid,null);
  assert.equal(rows.find(r=>r.email===bulkLinks[2].email).microsoft_oid,wrongOid);
});
test('bulk binding rejects duplicated identities, missing records and role mismatches',async(t)=>{
  const db=await existingDatabase();t.after(()=>db.close());await db.exec(preparation);
  const tenant=randomUUID();
  for(const link of bulkLinks)await db.query('insert into user_roles(email,name,role) values($1,$2,$3)',[link.email,'Примерен потребител',link.role]);
  const cases=[
    [bulkLinks.map((l,i)=>i===1?{...l,oid:bulkLinks[0].oid}:l),/duplicate/],
    [bulkLinks.map((l,i)=>i===2?{...l,email:'missing@example.invalid'}:l),/found 0/],
    [bulkLinks.map((l,i)=>i===2?{...l,role:'admin'}:l),/unexpected existing role/]
  ];
  for(const [links,error]of cases){
    await assert.rejects(db.exec(bulkIdentitySql(tenant,links)),error);await db.exec('rollback;');
    assert.equal((await db.query('select count(*)::int as n from user_roles where microsoft_oid is not null')).rows[0].n,0);
  }
});
