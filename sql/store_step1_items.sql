-- =====================================================================
-- RCL ERP – STORE, step 1: the Item Master (and the Store's sign-ins).
-- Run ONCE in EVERY site's Supabase project (the same project as that site's Mechanical): RCL - VTR NH 848, 18B, …
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely; it only ADDS – nothing of Mechanical is
-- touched, no data is changed or deleted.
--
--   items           the Item Master of this site: code (ITM-0001 …, given by the database), name, unit, category, HSN,
--                   GST %, min stock, Active / Inactive. A name is there once (name_key: small letters and digits only).
--                   Common to every module of the site (Mechanical's maintenance will use the same items later).
--   store_sessions  the Store's sign-ins (only a fingerprint of each)
--   store_tickets   the Portal tickets already used (a ticket opens the Store once)
--   store_activity  who did what in the Store, when
-- Every table is for the server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while no item is entered): drop table public.store_activity, public.store_tickets, public.store_sessions, public.items; drop sequence public.items_code_seq;
-- =====================================================================
create sequence if not exists public.items_code_seq;
create table if not exists public.items (
  code text primary key default ('ITM-' || lpad(nextval('public.items_code_seq')::text, 4, '0')),
  name text not null, name_key text not null, unit text not null, category text not null,
  hsn text, gst_pct numeric, min_stock numeric,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  similar_note text,          -- "Sugaar: not the same as ITM-0001 Sugar – said by …" (a near name saved on purpose)
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists items_name_key on public.items (name_key);
create table if not exists public.store_sessions (
  id_hash text primary key, email text not null, name text, is_admin boolean not null default false,
  info jsonb, created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists store_sessions_email on public.store_sessions (email);
create table if not exists public.store_tickets (jti text primary key, expires_at timestamptz not null);
create table if not exists public.store_activity (
  id bigserial primary key, at timestamptz not null default now(), email text, action text not null, target text, detail jsonb
);
create index if not exists store_activity_at on public.store_activity (at desc);

create or replace function public.store_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.store_touch();

do $$ declare t text; begin
  foreach t in array array['items', 'store_sessions', 'store_tickets', 'store_activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.items_code_seq from public, anon, authenticated;
grant usage, select on sequence public.items_code_seq, public.store_activity_id_seq to service_role;
revoke all on function public.store_touch() from public, anon, authenticated;

notify pgrst, 'reload schema';
select 'Store step 1 done · items ' || (select count(*) from public.items) as done;
