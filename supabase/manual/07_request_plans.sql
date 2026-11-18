-- Additive only. No rows, existing grants, RLS or card functions are changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.service_requests
  add column if not exists planned_operations text[],
  add column if not exists planned_materials jsonb;
do $$
declare spec record; actual text;
begin
  for spec in select * from (values ('planned_operations','_text'),('planned_materials','jsonb')) as expected(name,udt) loop
    select udt_name into actual from information_schema.columns
      where table_schema='public' and table_name='service_requests' and column_name=spec.name;
    if actual is distinct from spec.udt then raise exception 'Unexpected type for service_requests.%',spec.name; end if;
  end loop;
end $$;
commit;
select column_name,udt_name as column_type from information_schema.columns
where table_schema='public' and table_name='service_requests'
and column_name in ('planned_operations','planned_materials') order by column_name;
