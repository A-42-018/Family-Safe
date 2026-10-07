-- Phase 3 / 4 — app_rules, usage, schedules

create table public.app_rules (
  id                  uuid primary key default gen_random_uuid(),
  device_id           uuid not null references public.devices (id) on delete cascade,
  package_name        text not null check (
                        char_length(package_name) <= 255
                        and package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'),
  app_name            text not null check (char_length(app_name) between 1 and 200),
  blocked             boolean not null default false,
  daily_limit_minutes int check (daily_limit_minutes between 0 and 1440),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (device_id, package_name)
);

create table public.app_usage_daily (
  id                 uuid primary key default gen_random_uuid(),
  device_id          uuid not null references public.devices (id) on delete cascade,
  package_name       text not null check (
                       char_length(package_name) <= 255
                       and package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'),
  usage_date         date not null,
  foreground_minutes int not null default 0 check (foreground_minutes between 0 and 1440),
  launch_count       int not null default 0 check (launch_count >= 0),
  created_at         timestamptz not null default now(),
  unique (device_id, package_name, usage_date)
);
create index app_usage_daily_device_date_idx on public.app_usage_daily (device_id, usage_date desc);
create index app_usage_daily_date_idx on public.app_usage_daily (usage_date); -- retention purge

create table public.device_usage_daily (
  id                   uuid primary key default gen_random_uuid(),
  device_id            uuid not null references public.devices (id) on delete cascade,
  usage_date           date not null,
  total_screen_minutes int not null default 0 check (total_screen_minutes between 0 and 1440),
  unlock_count         int not null default 0 check (unlock_count >= 0),
  created_at           timestamptz not null default now(),
  unique (device_id, usage_date)
);
create index device_usage_daily_date_idx on public.device_usage_daily (usage_date); -- retention purge

-- days: ISO weekdays 1=Mon..7=Sun. end_time < start_time = overnight window.
create table public.schedules (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  type        text not null check (type in ('BEDTIME','SCHOOL','CUSTOM')),
  start_time  time not null,
  end_time    time not null,
  days        int[] not null check (public.is_valid_day_set(days)),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (start_time <> end_time)
);
create index schedules_device_idx on public.schedules (device_id);

create trigger app_rules_updated_at before update on public.app_rules for each row execute function public.set_updated_at();
create trigger schedules_updated_at before update on public.schedules for each row execute function public.set_updated_at();

alter table public.app_rules           enable row level security;
alter table public.app_usage_daily     enable row level security;
alter table public.device_usage_daily  enable row level security;
alter table public.schedules           enable row level security;
