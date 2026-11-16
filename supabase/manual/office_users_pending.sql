-- Read only: active office accounts still needing identity mapping.
select name, email, role
from public.user_roles
where is_active is true
  and (microsoft_oid is null or tenant_id is null)
order by role, name, email;
