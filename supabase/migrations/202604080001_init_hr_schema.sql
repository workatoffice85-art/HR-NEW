-- Supabase schema for HR Demo migration from Google Apps Script.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.employees (
  id text primary key,
  name text not null,
  email text not null,
  password text not null,
  phone text not null,
  role text not null default 'employee' check (role in ('employee', 'hr')),
  assigned_sites text[] not null default '{}',
  face_descriptor jsonb,
  transport_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employees_email_unique_idx on public.employees (lower(email));
create unique index if not exists employees_phone_unique_idx on public.employees (phone);

create table if not exists public.sites (
  id text primary key,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius double precision not null default 20,
  transport_price numeric not null default 120,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_requests (
  id text primary key,
  employee_id text not null references public.employees(id) on delete cascade,
  employee_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  suggested_name text not null,
  map_link text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'approved_today')),
  timestamp timestamptz not null default now(),
  transport_price numeric not null default 120,
  note text,
  receipt_url text,
  receipt_name text,
  temp_radius double precision,
  approved_at timestamptz,
  map_latitude double precision,
  map_longitude double precision,
  auto_meta text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_requests_employee_status_idx on public.site_requests (employee_id, status);
create index if not exists site_requests_status_timestamp_idx on public.site_requests (status, timestamp desc);

create table if not exists public.attendance (
  id bigserial primary key,
  employee_id text not null,
  employee_name text not null,
  site_id text not null,
  site_name text not null,
  check_in timestamptz not null,
  check_out timestamptz,
  latitude double precision,
  longitude double precision,
  status text not null default 'present' check (status in ('present', 'late', 'overtime')),
  total_hours numeric,
  transport_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_employee_check_in_idx on public.attendance (employee_id, check_in desc);
create index if not exists attendance_open_shift_idx on public.attendance (employee_id, check_out) where check_out is null;

create table if not exists public.settings (
  key text primary key,
  value text not null
);

create table if not exists public.otp_codes (
  email text primary key,
  phone text,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

insert into public.settings (key, value)
values
  ('workStartTime', '09:00'),
  ('workEndTime', '17:00'),
  ('reportEmails', ''),
  ('dailyReportEnabled', 'false'),
  ('monthlyReportEnabled', 'false')
on conflict (key) do nothing;

create trigger trg_employees_touch_updated_at
before update on public.employees
for each row execute function public.touch_updated_at();

create trigger trg_sites_touch_updated_at
before update on public.sites
for each row execute function public.touch_updated_at();

create trigger trg_site_requests_touch_updated_at
before update on public.site_requests
for each row execute function public.touch_updated_at();

create trigger trg_attendance_touch_updated_at
before update on public.attendance
for each row execute function public.touch_updated_at();
