alter table public.user_roles add column if not exists microsoft_oid uuid;
alter table public.user_roles add column if not exists tenant_id uuid;
create unique index if not exists user_roles_microsoft_identity on public.user_roles(tenant_id, microsoft_oid);

create table if not exists public.registered_devices (
  id uuid primary key default gen_random_uuid(), name text not null,
  mechanic text not null, token_hash text not null unique check(length(token_hash)=64),
  created_by uuid not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null, revoked_at timestamptz
);
alter table public.work_cards add column if not exists submission_id uuid;
alter table public.work_cards add column if not exists submission_actor uuid;
alter table public.work_cards add column if not exists submission_payload jsonb;
create unique index if not exists work_cards_submission_id on public.work_cards(submission_id);
create index if not exists service_requests_assigned_idx on public.service_requests using gin(assigned_mechanics);
create index if not exists work_cards_mechanic_idx on public.work_cards using gin(mechanic);

-- No direct Data API access with an anon/publishable key or Supabase user JWT.
-- The Edge Function verifies Microsoft/device identity and authorizes each call.
do $$
declare t text;
begin
  foreach t in array array['nomenclatures','user_roles','service_requests','work_cards','work_card_materials','request_log','work_card_log','registered_devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.submit_work_card(
  p_card jsonb, p_materials jsonb, p_submission_id uuid,
  p_actor text, p_actor_id uuid, p_mechanic text default null
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  c public.work_cards; existing public.work_cards; req public.service_requests;
  m jsonb; result public.work_cards;
  payload jsonb := jsonb_build_object('card',p_card,'materials',p_materials);
begin
  if p_submission_id is null or p_actor_id is null then raise exception 'Missing submission identity' using errcode='22023'; end if;
  -- Serializes retries, including a retry while the first request is still running.
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text, 0));
  select * into existing from public.work_cards where submission_id=p_submission_id;
  if found then
    if existing.submission_actor is distinct from p_actor_id or existing.submission_payload is distinct from payload then
      raise exception 'Submission identifier already used for another payload' using errcode='23505';
    end if;
    return jsonb_build_object('id',existing.id,'replayed',true);
  end if;
  c := jsonb_populate_record(null::public.work_cards,p_card);
  if coalesce(array_length(c.mechanic,1),0)=0 or c.work_hours is null or c.work_hours<=0 or c.work_hours>1000
    or nullif(trim(c.vehicle),'') is null or nullif(trim(c.reg_number),'') is null
    or nullif(trim(c.client),'') is null or nullif(trim(c.activity_type),'') is null or c.work_date is null
    or c.has_materials is null or c.km_traveled<0 then
    raise exception 'Invalid card' using errcode='22023';
  end if;
  if jsonb_typeof(p_materials) is distinct from 'array' or (not c.has_materials and jsonb_array_length(p_materials)>0) then
    raise exception 'Invalid materials' using errcode='22023';
  end if;
  if c.request_id is not null then
    select * into req from public.service_requests where id=c.request_id for update;
    if not found or req.status is null or req.status not in ('Разпределена','В изпълнение') or req.work_card_id is not null then
      raise exception 'Request is missing or already completed';
    end if;
    if p_mechanic is not null and (not p_mechanic=any(coalesce(req.assigned_mechanics,'{}')) or not c.mechanic <@ req.assigned_mechanics or not p_mechanic=any(c.mechanic)) then
      raise exception 'Not assigned to this request' using errcode='42501';
    end if;
  elsif p_mechanic is not null and c.mechanic is distinct from array[p_mechanic] then
    raise exception 'Free card must belong to the registered mechanic' using errcode='42501';
  end if;
  insert into public.work_cards (mechanic,work_date,vehicle,reg_number,km_hours,client,activity_type,services,repair_systems,repair_type,repair_description,has_materials,other_materials,work_hours,km_traveled,notes,request_id,external_service,external_service_note,submission_id,submission_actor,submission_payload)
  values(c.mechanic,c.work_date,c.vehicle,c.reg_number,c.km_hours,c.client,c.activity_type,coalesce(c.services,'{}'),coalesce(c.repair_systems,'{}'),c.repair_type,c.repair_description,c.has_materials,c.other_materials,c.work_hours,c.km_traveled,c.notes,c.request_id,coalesce(c.external_service,false),c.external_service_note,p_submission_id,p_actor_id,payload)
  returning * into result;
  for m in select value from jsonb_array_elements(p_materials) loop
    if jsonb_typeof(m->'quantity') is distinct from 'number' or (m->>'quantity')::numeric<=0 or nullif(m->>'item_type','') is null or nullif(m->>'category','') is null or nullif(m->>'unit','') is null then
      raise exception 'Invalid material' using errcode='22023';
    end if;
    insert into public.work_card_materials(work_card_id,category,item_type,quantity,unit)
    values(result.id,m->>'category',m->>'item_type',(m->>'quantity')::numeric,m->>'unit');
  end loop;
  insert into public.work_card_log(work_card_id,action,performed_by,details) values(result.id,'created',p_actor,'Нова работна карта');
  if c.request_id is not null then
    update public.service_requests set status='Изпълнена',work_card_id=result.id,completed_at=now(),updated_at=now() where id=c.request_id;
    insert into public.request_log(request_id,action,performed_by,details) values(c.request_id,'completed',p_actor,'Работна карта: '||result.id);
  end if;
  return jsonb_build_object('id',result.id,'replayed',false);
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

revoke all on function public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.start_work_task(uuid,text,text) from public,anon,authenticated;
revoke all on function public.update_work_card(uuid,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.delete_work_card(uuid,text) from public,anon,authenticated;
grant execute on function public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text) to service_role;
grant execute on function public.start_work_task(uuid,text,text) to service_role;
grant execute on function public.update_work_card(uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.delete_work_card(uuid,text) to service_role;
