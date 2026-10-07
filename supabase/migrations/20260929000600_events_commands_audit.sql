-- Phase 3 / 6 — device_events, device_commands, audit_logs

create table public.device_events (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices (id) on delete cascade,
  event_type  text not null check (event_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  metadata    jsonb not null default '{}'::jsonb
                check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  created_at  timestamptz not null default now()
);
create index device_events_device_time_idx on public.device_events (device_id, created_at desc);
create index device_events_type_idx on public.device_events (device_id, event_type, created_at desc);

create table public.device_commands (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices (id) on delete cascade,
  command_type  text not null check (command_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  payload       jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  status        text not null default 'PENDING' check (status in ('PENDING','DELIVERED','EXECUTED','FAILED','EXPIRED')),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  executed_at   timestamptz,
  check (expires_at > created_at),
  check (status <> 'EXECUTED' or executed_at is not null)
);
create index device_commands_pending_idx
  on public.device_commands (device_id, expires_at)
  where status in ('PENDING','DELIVERED');
create index device_commands_device_time_idx on public.device_commands (device_id, created_at desc);

-- Replay / expiry protection at the DB level:
--  * identity fields are immutable
--  * forward-only state machine; terminal states are final (a command can execute once)
--  * cannot become EXECUTED after expires_at
create or replace function public.enforce_command_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.device_id <> old.device_id or new.command_type <> old.command_type
     or new.payload is distinct from old.payload or new.expires_at <> old.expires_at
     or new.created_at <> old.created_at then
    raise exception 'device_commands identity fields are immutable' using errcode = '42501';
  end if;

  if new.status = old.status then
    if new.executed_at is distinct from old.executed_at then
      raise exception 'executed_at is write-once' using errcode = '42501';
    end if;
    return new;
  end if;

  if not (
       (old.status = 'PENDING'   and new.status in ('DELIVERED','FAILED','EXPIRED'))
    or (old.status = 'DELIVERED' and new.status in ('EXECUTED','FAILED','EXPIRED'))
  ) then
    raise exception 'illegal command status transition % -> %', old.status, new.status using errcode = '23514';
  end if;

  if new.status = 'EXECUTED' and clock_timestamp() > old.expires_at then
    raise exception 'command expired' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_command_transition() from public, anon, authenticated;

create trigger device_commands_transition
  before update on public.device_commands
  for each row execute function public.enforce_command_transition();

-- Append-only. device_id survives device removal (DEVICE_REMOVED must stay auditable).
-- Never store sensitive content (coordinates, contacts, message text) in metadata.
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null references public.profiles (id) on delete cascade,
  device_id   uuid references public.devices (id) on delete set null,
  action      text not null check (action ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  metadata    jsonb not null default '{}'::jsonb
                check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  ip_address  inet,
  created_at  timestamptz not null default now()
);
create index audit_logs_parent_time_idx on public.audit_logs (parent_id, created_at desc);
create index audit_logs_device_time_idx on public.audit_logs (device_id, created_at desc) where device_id is not null;
create index audit_logs_created_idx on public.audit_logs (created_at); -- retention purge (180 d)

-- ON DELETE SET NULL on device_id is the only permitted change; block all other updates.
create or replace function public.audit_logs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.device_id is null and old.device_id is not null
     and (to_jsonb(new) - 'device_id') = (to_jsonb(old) - 'device_id') then
    return new;
  end if;
  raise exception 'audit_logs rows are immutable' using errcode = '42501';
end;
$$;
revoke all on function public.audit_logs_guard() from public, anon, authenticated;

create trigger audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.audit_logs_guard();

alter table public.device_events   enable row level security;
alter table public.device_commands enable row level security;
alter table public.audit_logs      enable row level security;
