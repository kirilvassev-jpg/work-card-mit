-- Stage 1: additive preparation for the existing, running application.
-- Does not change existing data, grants, RLS, functions, or login behavior.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.user_roles
  add column if not exists microsoft_oid uuid,
  add column if not exists tenant_id uuid;

alter table public.work_cards
  add column if not exists submission_id uuid,
  add column if not exists submission_actor uuid,
  add column if not exists submission_payload jsonb;

-- IF NOT EXISTS must not silently accept an existing column of the wrong type.
do $$
declare spec record; actual text;
begin
  for spec in select * from (values
    ('user_roles', 'microsoft_oid', 'uuid'),
    ('user_roles', 'tenant_id', 'uuid'),
    ('work_cards', 'submission_id', 'uuid'),
    ('work_cards', 'submission_actor', 'uuid'),
    ('work_cards', 'submission_payload', 'jsonb')
  ) as expected(table_name, column_name, udt_name) loop
    select c.udt_name into actual
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = spec.table_name
      and c.column_name = spec.column_name;
    if actual is distinct from spec.udt_name then
      raise exception 'Unexpected type for %.%: expected %, found %',
        spec.table_name, spec.column_name, spec.udt_name, actual;
    end if;
  end loop;
end $$;

commit;

select table_name, column_name, udt_name as column_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'user_roles'
      and column_name in ('microsoft_oid', 'tenant_id'))
    or (table_name = 'work_cards'
      and column_name in (
        'submission_id', 'submission_actor', 'submission_payload'
      ))
  )
order by table_name, column_name;
