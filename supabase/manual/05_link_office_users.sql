-- Replace __TENANT_ID__ and __LINKS_JSON__ before executing.
-- LINKS_JSON is an array of {email, oid, role}; role is checked, never changed.
-- All links commit together. No new users or roles are created.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare
  v_tenant constant uuid := '__TENANT_ID__';
  v_links constant jsonb := '__LINKS_JSON__'::jsonb;
  v_link record;
  v_user public.user_roles;
  v_total integer;
  v_emails integer;
  v_oids integer;
  v_matches integer;
begin
  select count(*), count(distinct lower(btrim(email))),
    count(distinct oid)
  into v_total, v_emails, v_oids
  from jsonb_to_recordset(v_links) as x(email text, oid uuid, role text);

  if v_total = 0 or v_emails <> v_total or v_oids <> v_total then
    raise exception 'Input contains missing or duplicate emails/Object IDs';
  end if;

  for v_link in
    select * from jsonb_to_recordset(v_links)
      as x(email text, oid uuid, role text)
    order by oid, email
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant::text || ':' || v_link.oid::text, 0)
    );

    select count(*) into v_matches
    from public.user_roles
    where lower(btrim(email)) = lower(btrim(v_link.email));

    if v_matches <> 1 then
      raise exception 'Expected one existing record for %, found %',
        v_link.email, v_matches;
    end if;

    select * into strict v_user
    from public.user_roles
    where lower(btrim(email)) = lower(btrim(v_link.email))
    for update;

    if v_user.is_active is distinct from true
      or v_user.role is distinct from v_link.role
      or v_user.role not in ('admin', 'manager', 'coordinator')
    then
      raise exception 'Inactive or unexpected existing role for %', v_link.email;
    end if;

    if (v_user.microsoft_oid is not null
          and v_user.microsoft_oid <> v_link.oid)
      or (v_user.tenant_id is not null
          and v_user.tenant_id <> v_tenant)
    then
      raise exception 'Different Microsoft identity already linked to %', v_link.email;
    end if;

    if exists (
      select 1 from public.user_roles
      where id <> v_user.id
        and microsoft_oid = v_link.oid
        and tenant_id = v_tenant
    ) then
      raise exception 'Microsoft identity for % is linked to another record', v_link.email;
    end if;

    update public.user_roles
    set microsoft_oid = v_link.oid, tenant_id = v_tenant
    where id = v_user.id;
  end loop;
end $$;

commit;

select name, email, role, is_active, microsoft_oid, tenant_id,
  (microsoft_oid is not null and tenant_id is not null) as microsoft_linked
from public.user_roles
where is_active is true
order by role, name, email;
