-- Armada's 1805 accounts. Paste this whole file into the Supabase SQL editor.
-- The game server uses SUPABASE_SECRET_KEY; browsers use the publishable key
-- and may only read or update their own profile row.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint profiles_display_name_length
    check (char_length(display_name) between 2 and 24)
);

-- Usernames are unique without regard to case.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- One row is enough for the daily keepalive query.
create table if not exists public.keepalive (
  id integer primary key check (id = 1),
  touched_at timestamptz not null default now()
);
insert into public.keepalive (id) values (1) on conflict (id) do nothing;

-- Create a profile with the username sent in the sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_username text;
  chosen_display text;
begin
  chosen_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(new.email, 'sailor'), '@', 1)
  );
  chosen_display := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    chosen_username
  );
  insert into public.profiles (id, username, display_name)
  values (new.id, chosen_username, left(chosen_display, 24));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security: every table is closed except the owner's profile read
-- and update. The server's secret key bypasses these policies.
alter table public.profiles enable row level security;
alter table public.keepalive enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No browser policies for keepalive: only the server reads it.
