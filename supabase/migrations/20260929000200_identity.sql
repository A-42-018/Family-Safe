-- Phase 3 / 2 — profiles, families, children (+ auth.users sync triggers)

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique check (char_length(email) between 3 and 320),
  full_name   text check (full_name is null or char_length(full_name) <= 200),
  avatar_url  text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.families (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index families_parent_id_idx on public.families (parent_id);

create table public.children (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 100),
  date_of_birth  date check (date_of_birth is null or date_of_birth >= date '1900-01-01'),
  avatar_url     text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048)),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index children_family_id_idx on public.children (family_id);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger families_updated_at before update on public.families for each row execute function public.set_updated_at();
create trigger children_updated_at before update on public.children for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.children enable row level security;

-- auth.users -> profiles ------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avatar text := new.raw_user_meta_data ->> 'avatar_url';
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 200),
    case when v_avatar ~ '^https://' and char_length(v_avatar) <= 2048 then v_avatar end
  );
  return new;
end;
$$;

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke all on function public.handle_new_user()          from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email and new.email is not null)
  execute function public.handle_user_email_change();
