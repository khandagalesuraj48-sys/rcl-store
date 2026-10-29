-- =====================================================================
-- RCL ERP – STORE step 8: the requirement's Indent No., its contact and its maintenance log book; a requirement changed after its
-- approval or deleted; a purchase order deleted (29-10-2026, his words: "indent number … RCL … VTR … financial year … mechanical cha
-- aahe ki material purchase cha … short letter … 4 digit number … 0001 pasun"; "contact name ani number je default ahe te auto yetil";
-- "vehicle che maintanace log book … attach"; "ekda banwaleli requirement edit delet krta yeil … approval nantr tri … po banli aahe …
-- adhi po delet")
-- Run once in EVERY site's Supabase → SQL Editor (VTR NH 848, 18B KOLHAPUR, HEAD OFFICE, …), after the Store's steps 1–7.
-- Safe to run again. It only ADDS:
--   1. six empty columns to store_req: indent_fy ("2026-27"), indent_kind (M = Mechanical – for a machinery, P = Material Purchase),
--      indent_no (from 1 in each financial year and letter), contact_name, contact_phone, logbook (the machinery's maintenance log book
--      attached: which machinery, up to which date, how many bills, when and by whom);
--   2. the requirements made before get their Indent No. – in the order they were made, each financial year and letter from 0001
--      (nothing else of them is changed);
--   3. a requirement made from now gets its Indent No. here (one at a time on the site – never twice); one changed to another letter or
--      financial year gets the next number of that one;
--   4. a requirement changed (also after its approval – then it waits for its approval again) or deleted, and a purchase order deleted –
--      here, one at a time with the purchase orders: never a requirement that a PO (not cancelled) has; never a PO whose material came.
-- No existing row is changed but the Indent No. of the requirements of before; no other column, table or rule is changed.
-- Until it is run the Store works as before (a requirement's number as before; changed only while nobody approved it).
-- Rollback (only while nobody used it): drop function public.store_req_change(bigint, timestamptz, jsonb, text), public.store_req_del(bigint, timestamptz),
--   public.store_po_del(bigint), public.store_req_indent(bigint); drop index public.store_req_indent; alter table public.store_req drop column indent_fy,
--   drop column indent_kind, drop column indent_no, drop column contact_name, drop column contact_phone, drop column logbook;
--   then run store_step2_work.sql again (its store_req_put).
-- =====================================================================
alter table public.store_req add column if not exists indent_fy text;
alter table public.store_req add column if not exists indent_kind text;
alter table public.store_req add column if not exists indent_no int;
alter table public.store_req add column if not exists contact_name text;
alter table public.store_req add column if not exists contact_phone text;
alter table public.store_req add column if not exists logbook jsonb;

-- the financial year of a date (April to March): 2026-10-29 → "2026-27"
create or replace function public.store_fy(p_date date) returns text language sql immutable set search_path = '' as $$
  select (case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end)::text || '-' ||
    lpad((((case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end) + 1) % 100)::text, 2, '0');
$$;

-- the requirements of before: their Indent No., in the order they were made
do $$ declare r record; v_n int; begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  for r in select no, public.store_fy(date) as fy, case when for_kind = 'Machinery' then 'M' else 'P' end as k from public.store_req where indent_no is null order by no loop
    select coalesce(max(indent_no), 0) + 1 into v_n from public.store_req where indent_fy = r.fy and indent_kind = r.k;
    update public.store_req set indent_fy = r.fy, indent_kind = r.k, indent_no = v_n where no = r.no;
  end loop;
  -- each year's and letter's next number past the ones given
  for r in select indent_fy, indent_kind, max(indent_no) as m from public.store_req where indent_no is not null group by 1, 2 loop
    insert into public.store_numbers (kind, next_no) values ('IND ' || r.indent_fy || ' ' || r.indent_kind, r.m + 1)
    on conflict (kind) do update set next_no = greatest(public.store_numbers.next_no, excluded.next_no);
  end loop;
end $$;
create unique index if not exists store_req_indent on public.store_req (indent_fy, indent_kind, indent_no) where indent_no is not null;

-- a requirement's Indent No.: given once; given again (the next of the other one) when its letter or financial year changed
create or replace function public.store_req_indent(p_no bigint) returns jsonb language plpgsql set search_path = '' as $$
declare r record; v_fy text; v_k text; v_n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  select no, date, for_kind, indent_fy, indent_kind, indent_no into r from public.store_req where no = p_no;
  if not found then raise exception 'STORE_GONE'; end if;
  v_fy := public.store_fy(r.date); v_k := case when r.for_kind = 'Machinery' then 'M' else 'P' end;
  if r.indent_no is not null and r.indent_fy = v_fy and r.indent_kind = v_k then return jsonb_build_object('fy', v_fy, 'kind', v_k, 'no', r.indent_no); end if;
  loop v_n := public.store_next('IND ' || v_fy || ' ' || v_k); exit when not exists (select 1 from public.store_req where indent_fy = v_fy and indent_kind = v_k and indent_no = v_n); end loop;
  update public.store_req set indent_fy = v_fy, indent_kind = v_k, indent_no = v_n where no = p_no;
  return jsonb_build_object('fy', v_fy, 'kind', v_k, 'no', v_n);
end $$;

-- a REQUIREMENT made (its number and its Indent No. given here) – as step 2's, with its contact and its log book
create or replace function public.store_req_put(p_row jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
  loop v_no := public.store_next('REQ'); exit when not exists (select 1 from public.store_req where no = v_no); end loop;
  insert into public.store_req (no, date, need_by, for_kind, for_text, remark, lines, status, level, approvals, created_by, created_name, contact_name, contact_phone, logbook)
  values (v_no, (p_row ->> 'date')::date, nullif(p_row ->> 'need_by', '')::date, p_row ->> 'for_kind', p_row ->> 'for_text', p_row ->> 'remark',
    p_row -> 'lines', coalesce(p_row ->> 'status', 'Pending'), coalesce((p_row ->> 'level')::int, 0), coalesce(p_row -> 'approvals', '[]'::jsonb), p_by, p_name,
    nullif(p_row ->> 'contact_name', ''), nullif(p_row ->> 'contact_phone', ''), case when jsonb_typeof(p_row -> 'logbook') = 'object' then p_row -> 'logbook' end);
  perform public.store_req_indent(v_no);
  return v_no;
end $$;

-- the POs (not cancelled) that have a requirement – the first one's number, or null
create or replace function public.store_req_po(p_no bigint) returns bigint language sql stable set search_path = '' as $$
  select p.no from public.store_po p, jsonb_array_elements(p.lines) l where p.status <> 'Cancelled' and (l ->> 'req_no') ~ '^[0-9]+$' and (l ->> 'req_no')::bigint = p_no order by p.no limit 1;
$$;

-- a REQUIREMENT changed – as it was when the page read it (p_at), never while a PO has it; also after its approval (the server sends its
-- status, level and approvals again: it waits for its approval again)
create or replace function public.store_req_change(p_no bigint, p_at timestamptz, p_row jsonb, p_by text) returns jsonb language plpgsql set search_path = '' as $$
declare r record; v_po bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
  select no, status, updated_at into r from public.store_req where no = p_no;
  if not found then raise exception 'STORE_GONE'; end if;
  if r.updated_at is distinct from p_at then raise exception 'STORE_CHANGED'; end if;
  if r.status not in ('Pending', 'Approved', 'Rejected') then raise exception 'STORE_REQ_STATE %|%', p_no, r.status; end if;
  v_po := public.store_req_po(p_no);
  if v_po is not null then raise exception 'STORE_REQ_ORDERED %|%', p_no, v_po; end if;
  update public.store_req set date = (p_row ->> 'date')::date, need_by = nullif(p_row ->> 'need_by', '')::date, for_kind = p_row ->> 'for_kind', for_text = p_row ->> 'for_text',
    remark = p_row ->> 'remark', lines = p_row -> 'lines', contact_name = nullif(p_row ->> 'contact_name', ''), contact_phone = nullif(p_row ->> 'contact_phone', ''),
    photos = case when p_row ? 'photos' then coalesce(p_row -> 'photos', '[]'::jsonb) else photos end,
    logbook = case when p_row ? 'logbook' then case when jsonb_typeof(p_row -> 'logbook') = 'object' then p_row -> 'logbook' end else logbook end,
    status = coalesce(p_row ->> 'status', status), level = coalesce((p_row ->> 'level')::int, level), approvals = coalesce(p_row -> 'approvals', approvals),
    close_note = case when p_row ? 'status' then null else close_note end, updated_by = p_by
  where no = p_no;
  perform public.store_req_indent(p_no);
  return (select jsonb_build_object('status', status, 'level', level) from public.store_req where no = p_no);
end $$;

-- a REQUIREMENT deleted – as it was when the page read it, never while a PO (not cancelled) has it
create or replace function public.store_req_del(p_no bigint, p_at timestamptz) returns void language plpgsql set search_path = '' as $$
declare r record; v_po bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  select no, updated_at into r from public.store_req where no = p_no;
  if not found then raise exception 'STORE_GONE'; end if;
  if r.updated_at is distinct from p_at then raise exception 'STORE_CHANGED'; end if;
  v_po := public.store_req_po(p_no);
  if v_po is not null then raise exception 'STORE_REQ_ORDERED %|%', p_no, v_po; end if;
  delete from public.store_req where no = p_no;
end $$;

-- a PURCHASE ORDER deleted – never one whose material came (a GRN has it)
create or replace function public.store_po_del(p_no bigint) returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if not exists (select 1 from public.store_po where no = p_no) then raise exception 'STORE_GONE'; end if;
  if exists (select 1 from public.store_grn where po_no = p_no) then raise exception 'STORE_PO_RECEIVED %', p_no; end if;
  delete from public.store_po where no = p_no;
end $$;

do $$ declare f text; begin
  foreach f in array array['store_fy(date)', 'store_req_indent(bigint)', 'store_req_put(jsonb,text,text)', 'store_req_po(bigint)', 'store_req_change(bigint,timestamptz,jsonb,text)',
    'store_req_del(bigint,timestamptz)', 'store_po_del(bigint)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

notify pgrst, 'reload schema';
select 'Store step 8 done · requirements ' || (select count(*) from public.store_req) || ' · with their Indent No. ' || (select count(*) from public.store_req where indent_no is not null)
  || ' · store_req columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_req'
     and column_name in ('indent_fy', 'indent_kind', 'indent_no', 'contact_name', 'contact_phone', 'logbook')) || ' of 6' as done;
