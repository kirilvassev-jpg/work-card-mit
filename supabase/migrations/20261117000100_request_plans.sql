-- Nullable fields keep every existing request/client compatible.
alter table public.service_requests add column if not exists planned_operations text[];
alter table public.service_requests add column if not exists planned_materials jsonb;
