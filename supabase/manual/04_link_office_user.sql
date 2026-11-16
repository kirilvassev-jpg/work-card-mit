-- Replace the three placeholders with the verified office user's identifiers.
-- This updates only the identity binding of ONE existing active role record.
-- Names, email addresses, roles and active/inactive status are preserved.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare
  v_email constant text := '__EMAIL__';
  v_oid constant uuid := '__USER_OBJECT_ID__';
  v_tenant constant uuid := '__TENANT_ID__';
  v_user public.user_roles;
  v_matches integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant::text || ':' || v_oid::text, 0)
  );

  select count(*) into v_matches
  from public.user_roles
  where lower(btrim(email)) = lower(btrim(v_email));

  if v_matches <> 1 then
    raise exception
      'Expected exactly one existing user_roles record for %, found %',
      v_email, v_matches;
  end if;

  select * into strict v_user
  from public.user_roles
  where lower(btrim(email)) = lower(btrim(v_email))
  for update;

  if v_user.is_active is distinct from true
    or v_user.role not in ('admin', 'manager', 'coordinator')
  then
    raise exception 'The existing office role is inactive or unsupported';
  end if;

  if (v_user.microsoft_oid is not null
        and v_user.microsoft_oid <> v_oid)
    or (v_user.tenant_id is not null
        and v_user.tenant_id <> v_tenant)
  then
    raise exception
      'This role is already linked to a different Microsoft identity';
  end if;

  if exists (
    select 1 from public.user_roles
    where id <> v_user.id
      and microsoft_oid = v_oid
      and tenant_id = v_tenant
  ) then
    raise exception
      'This Microsoft identity is already linked to another role record';
  end if;

  update public.user_roles
  set microsoft_oid = v_oid,
      tenant_id = v_tenant
  where id = v_user.id;
end $$;

commit;

select name, email, role, is_active, microsoft_oid, tenant_id
from public.user_roles
where lower(btrim(email)) = lower(btrim('__EMAIL__'));
