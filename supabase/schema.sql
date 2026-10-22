-- =============================================================================
-- SCHEMA DATABASE SUPABASE – EDUMAP (EDITOR MAPPE CONCETTUALI)
-- Esegui l'intero contenuto di questo file nel "SQL Editor" di Supabase -> "Run"
-- =============================================================================

-- 1. Tabella profili utente (collegata automaticamente a auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Crea automaticamente la riga profilo quando un nuovo utente si registra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Tabella mappe concettuali (ogni utente vede e modifica esclusivamente le proprie)
create table if not exists public.maps (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text not null default 'Mappa concettuale',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  primary key (user_id, id),
  constraint maps_id_length check (char_length(id) between 1 and 80),
  constraint maps_title_length check (char_length(title) <= 200),
  constraint maps_data_size check (pg_column_size(data) <= 5242880)
);

create index if not exists maps_user_updated_idx
  on public.maps (user_id, updated_at desc);

alter table public.maps enable row level security;

drop policy if exists "maps_select_own" on public.maps;
create policy "maps_select_own"
  on public.maps for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "maps_insert_own" on public.maps;
create policy "maps_insert_own"
  on public.maps for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "maps_update_own" on public.maps;
create policy "maps_update_own"
  on public.maps for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "maps_delete_own" on public.maps;
create policy "maps_delete_own"
  on public.maps for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 3. Funzione RPC per eliminare il proprio account e tutte le proprie mappe
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
