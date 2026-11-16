-- Prepare the registry only; issue device codes after every API is secured.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if to_regclass('public.registered_devices') is not null
    and obj_description(to_regclass('public.registered_devices'), 'pg_class')
      is distinct from 'work-card-mit:registered_devices:v1'
  then
    raise exception 'An unrelated registered_devices relation already exists; inspect it before continuing';
  end if;
end $$;

create table if not exists public.registered_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mechanic text not null,
  token_hash text not null unique check(length(token_hash) = 64),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
comment on table public.registered_devices
  is 'work-card-mit:registered_devices:v1';

alter table public.registered_devices enable row level security;
revoke all on table public.registered_devices from public, anon, authenticated;
grant all on table public.registered_devices to service_role;
commit;

select
  true as registry_ready,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'SELECT') as anonymous_read,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_read,
  (has_table_privilege('service_role', c.oid, 'SELECT')
    and has_table_privilege('service_role', c.oid, 'INSERT')
    and has_table_privilege('service_role', c.oid, 'UPDATE')) as service_role_access
from pg_class c
where c.oid = 'public.registered_devices'::regclass;
