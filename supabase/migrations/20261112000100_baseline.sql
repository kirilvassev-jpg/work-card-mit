-- Reconstructable baseline for a NEW database. Existing tables are preserved.
create table if not exists public.nomenclatures (
  id uuid primary key default gen_random_uuid(), group_name text not null,
  value text not null, label text not null, sort_order integer default 0,
  is_active boolean not null default true, unique(group_name, value)
);
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(), email text not null unique,
  name text not null,
  role text not null check (role in ('admin','manager','coordinator')),
  is_active boolean not null default true
);
create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(), request_number text,
  client_name text not null, client_type text, company_name text, bulstat text,
  contact_person text, client_phone text, client_email text, brand text, model text,
  vehicle text not null, reg_number text not null, year_of_manufacture integer,
  frame_number text, km_hours text, description text not null, photo_data text,
  activity_type text[] not null default '{}', desired_date date,
  priority text default 'Нормален', status text not null default 'Нова',
  assigned_mechanics text[] default '{}', responsible_mechanic text,
  scheduled_at timestamptz, estimated_hours numeric, assigned_at timestamptz,
  started_at timestamptz, completed_at timestamptz, work_card_id uuid,
  notes text, created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.work_cards (
  id uuid primary key default gen_random_uuid(), mechanic text[] not null,
  work_date date not null, vehicle text not null, reg_number text not null,
  km_hours text, client text not null, activity_type text not null,
  services text[] default '{}', repair_systems text[] default '{}',
  repair_type text, repair_description text, has_materials boolean not null,
  other_materials text, work_hours numeric not null check(work_hours > 0),
  km_traveled integer check(km_traveled >= 0), notes text,
  external_service boolean default false, external_service_note text,
  request_id uuid references public.service_requests(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.work_card_materials (
  id uuid primary key default gen_random_uuid(),
  work_card_id uuid not null references public.work_cards(id) on delete cascade,
  category text not null, item_type text not null,
  quantity numeric not null check(quantity > 0), unit text not null
);
create table if not exists public.request_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.service_requests(id) on delete set null,
  action text not null, performed_by text not null, details text,
  created_at timestamptz not null default now()
);
create table if not exists public.work_card_log (
  id uuid primary key default gen_random_uuid(),
  work_card_id uuid references public.work_cards(id) on delete set null,
  action text not null, performed_by text not null, details text,
  created_at timestamptz not null default now()
);
