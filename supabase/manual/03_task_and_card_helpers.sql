-- Stage 3: install task/card helpers; existing table access is unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare spec record;
begin
  for spec in select * from (values
    ('start_work_task', 'public.start_work_task(uuid,text,text)', 'work-card-mit:start_work_task:v1'),
    ('update_work_card', 'public.update_work_card(uuid,jsonb,jsonb,text)', 'work-card-mit:update_work_card:v1'),
    ('delete_work_card', 'public.delete_work_card(uuid,text)', 'work-card-mit:delete_work_card:v1')
  ) as expected(name, signature, marker) loop
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = spec.name
        and (
          p.oid is distinct from to_regprocedure(spec.signature)::oid
          or obj_description(p.oid, 'pg_proc') is distinct from spec.marker
        )
    ) then
      raise exception 'A different % function already exists. Review it before continuing.', spec.name;
    end if;
  end loop;
end $$;

create or replace function public.start_work_task(p_request_id uuid,p_mechanic text,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.service_requests;
begin
  select * into r from public.service_requests where id=p_request_id for update;
  if not found or not coalesce(p_mechanic=any(r.assigned_mechanics),false) then raise exception 'Not assigned' using errcode='42501'; end if;
  if r.status='В изпълнение' then return jsonb_build_object('ok',true); end if;
  if r.status is distinct from 'Разпределена' then raise exception 'Task cannot be started'; end if;
  update public.service_requests set status='В изпълнение',started_at=now(),updated_at=now() where id=p_request_id;
  insert into public.request_log(request_id,action,performed_by,details) values(p_request_id,'started',p_actor,'Задачата е започната');
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.update_work_card(p_id uuid,p_card jsonb,p_materials jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare old public.work_cards; c public.work_cards; m jsonb;
begin
  select * into old from public.work_cards where id=p_id for update;
  if not found then raise exception 'Card not found'; end if;
  c := jsonb_populate_record(old,p_card);
  if c.request_id is distinct from old.request_id or c.work_hours is null or c.work_hours<=0 or c.work_hours>1000
    or coalesce(array_length(c.mechanic,1),0)=0 or nullif(trim(c.vehicle),'') is null
    or nullif(trim(c.client),'') is null or nullif(trim(c.reg_number),'') is null
    or nullif(trim(c.activity_type),'') is null or c.work_date is null or c.has_materials is null or c.km_traveled<0 then
    raise exception 'Invalid card' using errcode='22023';
  end if;
  if jsonb_typeof(p_materials) is distinct from 'array' or (not c.has_materials and jsonb_array_length(p_materials)>0) then raise exception 'Invalid materials' using errcode='22023'; end if;
  update public.work_cards set mechanic=c.mechanic,work_date=c.work_date,vehicle=c.vehicle,reg_number=c.reg_number,km_hours=c.km_hours,client=c.client,
    activity_type=c.activity_type,services=c.services,repair_systems=c.repair_systems,repair_type=c.repair_type,repair_description=c.repair_description,
    has_materials=c.has_materials,other_materials=c.other_materials,work_hours=c.work_hours,km_traveled=c.km_traveled,notes=c.notes,
    external_service=c.external_service,external_service_note=c.external_service_note where id=p_id;
  delete from public.work_card_materials where work_card_id=p_id;
  for m in select value from jsonb_array_elements(p_materials) loop
    if jsonb_typeof(m->'quantity') is distinct from 'number' or (m->>'quantity')::numeric<=0 or nullif(m->>'item_type','') is null or nullif(m->>'category','') is null or nullif(m->>'unit','') is null then raise exception 'Invalid material' using errcode='22023'; end if;
    insert into public.work_card_materials(work_card_id,category,item_type,quantity,unit) values(p_id,m->>'category',m->>'item_type',(m->>'quantity')::numeric,m->>'unit');
  end loop;
  insert into public.work_card_log(work_card_id,action,performed_by,details) values(p_id,'edited',p_actor,jsonb_build_object('before',to_jsonb(old)-'submission_payload','after',p_card)::text);
  return jsonb_build_object('id',p_id);
end $$;

create or replace function public.delete_work_card(p_id uuid,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.work_cards;
begin
  select * into c from public.work_cards where id=p_id for update;
  if not found then raise exception 'Card not found'; end if;
  update public.service_requests set work_card_id=null,status='В изпълнение',completed_at=null,updated_at=now() where work_card_id=p_id;
  update public.work_card_log set work_card_id=null where work_card_id=p_id;
  delete from public.work_card_materials where work_card_id=p_id;
  delete from public.work_cards where id=p_id;
  insert into public.work_card_log(work_card_id,action,performed_by,details) values(null,'deleted',p_actor,'Изтрита карта: '||p_id||' / '||c.reg_number);
  if c.request_id is not null then insert into public.request_log(request_id,action,performed_by,details) values(c.request_id,'edited',p_actor,'Картата е изтрита; заявката е отворена отново'); end if;
  return jsonb_build_object('ok',true);
end $$;

comment on function public.start_work_task(uuid,text,text) is 'work-card-mit:start_work_task:v1';
revoke all on function public.start_work_task(uuid,text,text) from public, anon, authenticated;
grant execute on function public.start_work_task(uuid,text,text) to service_role;

comment on function public.update_work_card(uuid,jsonb,jsonb,text) is 'work-card-mit:update_work_card:v1';
revoke all on function public.update_work_card(uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.update_work_card(uuid,jsonb,jsonb,text) to service_role;

comment on function public.delete_work_card(uuid,text) is 'work-card-mit:delete_work_card:v1';
revoke all on function public.delete_work_card(uuid,text) from public, anon, authenticated;
grant execute on function public.delete_work_card(uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;

select name,
  to_regprocedure(signature) is not null as function_ready,
  has_function_privilege('anon', signature, 'EXECUTE') as anonymous_execution,
  has_function_privilege('authenticated', signature, 'EXECUTE') as authenticated_execution,
  has_function_privilege('service_role', signature, 'EXECUTE') as service_role_execution
from (values
  ('start_work_task', 'public.start_work_task(uuid,text,text)'),
  ('update_work_card', 'public.update_work_card(uuid,jsonb,jsonb,text)'),
  ('delete_work_card', 'public.delete_work_card(uuid,text)')
) as functions(name, signature);
