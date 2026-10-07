-- Phase 3 / 3 — devices, FCM tokens, device credentials, pairing tokens,
--               device_rules, device_permissions

create table public.devices (
  id                uuid primary key default gen_random_uuid(),
  child_id          uuid not null references public.children (id) on delete cascade,
  device_name       text not null check (char_length(btrim(device_name)) between 1 and 100),
  manufacturer      text check (char_length(manufacturer) <= 100),
  model             text check (char_length(model) <= 100),
  android_version   text check (char_length(android_version) <= 32),
  app_version       text check (char_length(app_version) <= 32),
  device_status     text not null default 'UNKNOWN' check (device_status in ('ONLINE','OFFLINE','UNKNOWN')),
  enrollment_status text not null default 'PENDING' check (enrollment_status in ('PENDING','ENROLLED','REVOKED')),
  battery_level     int  check (battery_level between 0 and 100),
  is_charging       boolean,
  network_type      text check (network_type in ('WIFI','CELLULAR','ETHERNET','VPN','NONE','UNKNOWN')),
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index devices_child_id_idx on public.devices (child_id);
create index devices_last_seen_idx on public.devices (last_seen_at) where enrollment_status = 'ENROLLED';

-- One FCM token per device; NEVER exposed to parent clients (no parent policy in Phase 4).
create table public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null unique references public.devices (id) on delete cascade,
  fcm_token   text not null unique check (char_length(fcm_token) between 20 and 4096),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Refresh-token chain with rotation + reuse detection. Only SHA-256 hashes stored.
-- credential id is the `cid` claim in the device access JWT (revocation lookup, Phase 11).
create table public.device_credentials (
  id                  uuid primary key default gen_random_uuid(),
  device_id           uuid not null references public.devices (id) on delete cascade,
  token_family_id     uuid not null default gen_random_uuid(),
  refresh_token_hash  bytea not null unique check (octet_length(refresh_token_hash) = 32),
  issued_at           timestamptz not null default now(),
  expires_at          timestamptz not null,
  rotated_at          timestamptz,
  revoked_at          timestamptz,
  replaced_by         uuid references public.device_credentials (id) on delete set null,
  created_at          timestamptz not null default now(),
  check (expires_at > issued_at)
);
create index device_credentials_device_idx on public.device_credentials (device_id);
create index device_credentials_family_idx on public.device_credentials (token_family_id);
-- at most one live refresh token per device
create unique index device_credentials_one_live_per_device
  on public.device_credentials (device_id)
  where rotated_at is null and revoked_at is null;

-- Short-lived, single-use pairing tokens. Only the SHA-256 hash is stored.
create table public.pairing_tokens (
  id                  uuid primary key default gen_random_uuid(),
  child_id            uuid not null references public.children (id) on delete cascade,
  created_by          uuid not null references public.profiles (id) on delete cascade,
  token_hash          bytea not null unique check (octet_length(token_hash) = 32),
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  consumed_device_id  uuid references public.devices (id) on delete set null,
  failed_attempts     int not null default 0 check (failed_attempts >= 0),
  created_at          timestamptz not null default now(),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '1 hour')
);
create index pairing_tokens_child_idx on public.pairing_tokens (child_id);
create index pairing_tokens_expires_idx on public.pairing_tokens (expires_at);

create table public.device_rules (
  id                         uuid primary key default gen_random_uuid(),
  device_id                  uuid not null unique references public.devices (id) on delete cascade,
  daily_screen_limit_minutes int check (daily_screen_limit_minutes between 0 and 1440),
  bedtime_enabled            boolean not null default false,
  bedtime_start              time,
  bedtime_end                time,
  school_mode_enabled        boolean not null default false,
  location_enabled           boolean not null default false,
  location_history_enabled   boolean not null default false,
  geofence_enabled           boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (not bedtime_enabled or (bedtime_start is not null and bedtime_end is not null and bedtime_start <> bedtime_end)),
  -- privacy: history / geofencing only make sense with location collection on
  check (not location_history_enabled or location_enabled),
  check (not geofence_enabled or location_enabled)
);

-- Synchronized representation of OS state, NOT proof of it (Android app is the source).
create table public.device_permissions (
  id                          uuid primary key default gen_random_uuid(),
  device_id                   uuid not null unique references public.devices (id) on delete cascade,
  camera_status               text not null default 'NOT_REQUESTED' check (camera_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  microphone_status           text not null default 'NOT_REQUESTED' check (microphone_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  contacts_status             text not null default 'NOT_REQUESTED' check (contacts_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  sms_status                  text not null default 'NOT_REQUESTED' check (sms_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  call_log_status             text not null default 'NOT_REQUESTED' check (call_log_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  location_status             text not null default 'NOT_REQUESTED' check (location_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  precise_location_status     text not null default 'NOT_REQUESTED' check (precise_location_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  background_location_status  text not null default 'NOT_REQUESTED' check (background_location_status in ('GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED')),
  last_verified_at            timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger devices_updated_at            before update on public.devices            for each row execute function public.set_updated_at();
create trigger device_tokens_updated_at      before update on public.device_tokens      for each row execute function public.set_updated_at();
create trigger device_rules_updated_at       before update on public.device_rules       for each row execute function public.set_updated_at();
create trigger device_permissions_updated_at before update on public.device_permissions for each row execute function public.set_updated_at();

-- Every device starts with all monitoring OFF and all permissions NOT_REQUESTED.
create or replace function public.handle_new_device()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.device_rules (device_id) values (new.id);
  insert into public.device_permissions (device_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.handle_new_device() from public, anon, authenticated;

create trigger on_device_created
  after insert on public.devices
  for each row execute function public.handle_new_device();

alter table public.devices             enable row level security;
alter table public.device_tokens       enable row level security;
alter table public.device_credentials  enable row level security;
alter table public.pairing_tokens      enable row level security;
alter table public.device_rules        enable row level security;
alter table public.device_permissions  enable row level security;
