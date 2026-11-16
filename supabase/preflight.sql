-- READ ONLY. Run before applying these migrations to an existing database.
-- This baseline was reconstructed from the frontend, not a production dump.
do $$
declare spec record; actual text;
begin
  for spec in select * from (values
    ('nomenclatures','id','uuid'),('nomenclatures','group_name','text'),('nomenclatures','value','text'),
    ('user_roles','id','uuid'),('user_roles','role','text'),
    ('service_requests','id','uuid'),('service_requests','assigned_mechanics','_text'),
    ('service_requests','activity_type','_text'),('service_requests','work_card_id','uuid'),
    ('work_cards','id','uuid'),('work_cards','mechanic','_text'),('work_cards','services','_text'),
    ('work_cards','repair_systems','_text'),('work_cards','request_id','uuid'),
    ('work_card_materials','work_card_id','uuid'),('request_log','request_id','uuid'),
    ('work_card_log','work_card_id','uuid')
  ) as fields(table_name,column_name,udt_name) loop
    if to_regclass('public.'||spec.table_name) is null then continue; end if;
    select c.udt_name into actual from information_schema.columns c
      where c.table_schema='public' and c.table_name=spec.table_name and c.column_name=spec.column_name;
    if actual is distinct from spec.udt_name then
      raise exception 'Schema mismatch: %.% expected %, found %. Reconcile the baseline with a schema dump first.',spec.table_name,spec.column_name,spec.udt_name,coalesce(actual,'MISSING');
    end if;
  end loop;
end $$;

select table_name,column_name,udt_name from information_schema.columns
where table_schema='public' and table_name in ('nomenclatures','user_roles','service_requests','work_cards','work_card_materials','request_log','work_card_log')
order by table_name,ordinal_position;
