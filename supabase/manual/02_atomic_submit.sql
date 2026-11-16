-- Stage 2: install the atomic submit helper; existing application access is unchanged.
-- The running client will use this only after its API and frontend are updated.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Do not overwrite an unrelated pre-existing function or overload.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_work_card'
      and (
        p.oid is distinct from to_regprocedure('public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)')::oid
        or obj_description(p.oid, 'pg_proc') is distinct from 'work-card-mit:submit_work_card:v1'
      )
  ) then
    raise exception 'A different submit_work_card function already exists. Review it before continuing.';
  end if;
end $$;

create unique index if not exists work_cards_submission_id
  on public.work_cards(submission_id);

do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indexrelid = 'public.work_cards_submission_id'::regclass
      and i.indrelid = 'public.work_cards'::regclass
      and i.indisunique and i.indisvalid and i.indnkeyatts = 1 and i.indnatts = 1
      and i.indpred is null and i.indexprs is null and a.attname = 'submission_id'
  ) then
    raise exception 'Unexpected index definition for work_cards_submission_id';
  end if;
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

comment on function public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)
  is 'work-card-mit:submit_work_card:v1';
revoke all on function public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)
  to service_role;
notify pgrst, 'reload schema';
commit;

select
  to_regprocedure('public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)') is not null as function_ready,
  has_function_privilege('anon', 'public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)', 'EXECUTE') as anonymous_execution,
  has_function_privilege('authenticated', 'public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)', 'EXECUTE') as authenticated_execution,
  has_function_privilege('service_role', 'public.submit_work_card(jsonb,jsonb,uuid,text,uuid,text)', 'EXECUTE') as service_role_execution;
