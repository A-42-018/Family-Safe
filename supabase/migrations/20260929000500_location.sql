-- Phase 3 / 5 — location_points, geofences, geofence_events
-- Retention (7/30/90 d) is enforced by the cleanup job in Phase 32; recorded_at index supports it.

create table public.location_points (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices (id) on delete cascade,
  latitude         double precision not null check (latitude between -90 and 90),
  longitude        double precision not null check (longitude between -180 and 180),
  accuracy_meters  double precision not null check (accuracy_meters >= 0),
  altitude         double precision,
  speed_mps        double precision check (speed_mps is null or speed_mps >= 0),
  recorded_at      timestamptz not null,
  created_at       timestamptz not null default now(),
  unique (device_id, recorded_at)  -- idempotent batch uploads
);
create index location_points_device_time_idx on public.location_points (device_id, recorded_at desc);
create index location_points_recorded_idx on public.location_points (recorded_at); -- retention purge

create table public.geofences (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references public.devices (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 100),
  latitude       double precision not null check (latitude between -90 and 90),
  longitude      double precision not null check (longitude between -180 and 180),
  radius_meters  int not null check (radius_meters between 50 and 50000),
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, device_id)  -- target for composite FK from geofence_events
);
create index geofences_device_idx on public.geofences (device_id);

-- Android allows max 100 active geofences per app; enforce per device.
create or replace function public.enforce_geofence_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.geofences where device_id = new.device_id) >= 100 then
    raise exception 'geofence limit (100) reached for device' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_geofence_limit() from public, anon, authenticated;

create trigger geofences_limit before insert on public.geofences for each row execute function public.enforce_geofence_limit();
create trigger geofences_updated_at before update on public.geofences for each row execute function public.set_updated_at();

create table public.geofence_events (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices (id) on delete cascade,
  geofence_id  uuid not null,
  event_type   text not null check (event_type in ('ENTER','EXIT')),
  occurred_at  timestamptz not null,
  created_at   timestamptz not null default now(),
  -- the geofence must belong to the same device
  foreign key (geofence_id, device_id) references public.geofences (id, device_id) on delete cascade
);
create index geofence_events_device_time_idx on public.geofence_events (device_id, occurred_at desc);
create index geofence_events_geofence_idx on public.geofence_events (geofence_id);

alter table public.location_points  enable row level security;
alter table public.geofences        enable row level security;
alter table public.geofence_events  enable row level security;
