-- =====================================================================
-- RCL ERP – STORE, step 2: the Store's work – Material Requirement, Purchase Order, Opening stock, Inward (GRN), Issue (Outward)
-- and Return; the stock of every item.
-- Run ONCE in EVERY site's Supabase project (the same project as that site's Mechanical and the Store's step 1): VTR, 18B, HO, …
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely; it only ADDS tables, one view and functions –
-- nothing of Mechanical or of the Item Master is touched, no data is changed or deleted.
--
--   store_numbers    the next number of each paper of this site (REQ, PO, GRN, OUT, RET); the Store Admin may set where the
--                    GRN and Outward numbers go on from (the old registers)
--   store_settings   the site's Store settings – who approves the requirements, level by level (given in the Portal)
--   store_req        Material Requirements: date, for what, the items and quantities, each level's approval, the state
--   store_po         Purchase Orders (made by HO Purchase for this site): vendor, items, rate, GST, the state
--   store_opening    the opening stock of an item (one row an item): date, quantity, rate
--   store_grn, store_grn_lines         Inward (GRN): supplier, challan, invoice, vehicle, its PO; each item, quantity, rate, GST
--   store_issue, store_issue_lines     Issue (Outward): to site work / a sub-contractor / a machinery / office; location, side,
--                                      use for, receiver; each item, quantity and value, returnable or not
--   store_return, store_return_lines   what comes back to the store of an issue
--   store_moves      (a view) every movement of every item: + opening, + GRN, + return, − issue
--   store_stock_on, store_statement   an item's stock on a date; a period's opening / inward / return / issue / closing
--   store_*_put / store_*_del / store_*_many   the saves (many: an Excel import, all or none): one at a time on the site, all in one go, the stock checked – an item's stock never
--                    goes below zero on any date (else nothing is saved)
-- Every table is for the server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop the functions store_*_put / store_*_del / store_next / store_short /
-- store_stock_on / store_statement, the view
-- store_moves, then the tables store_return_lines, store_return, store_issue_lines, store_issue, store_grn_lines, store_grn,
-- store_opening, store_po, store_req, store_settings, store_numbers.
-- =====================================================================
create table if not exists public.store_numbers (kind text primary key, next_no bigint not null default 1 check (next_no >= 1));
insert into public.store_numbers (kind) values ('REQ'), ('PO'), ('GRN'), ('OUT'), ('RET') on conflict (kind) do nothing;

create table if not exists public.store_settings (id text primary key, value jsonb, updated_by text, updated_at timestamptz not null default now());

create table if not exists public.store_req (
  no bigint primary key, date date not null, need_by date,
  for_kind text not null, for_text text, remark text,
  lines jsonb not null,                    -- [{ line, code, name, unit, qty, note }]
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled', 'Closed')),
  level int not null default 0,            -- the level it waits for (0: none)
  approvals jsonb not null default '[]',   -- [{ level, email, name, at, ok, note }]
  close_note text,
  created_by text, created_name text, created_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now()
);
create index if not exists store_req_status on public.store_req (status);

create table if not exists public.store_po (
  no bigint primary key, date date not null, vendor text not null, vendor_gst text, deliver_by date, terms text, remark text,
  lines jsonb not null,                    -- [{ line, code, name, unit, qty, rate, gst_pct, taxable, gst, total, req_no, req_line }]
  taxable numeric not null default 0, gst numeric not null default 0, total numeric not null default 0,
  status text not null default 'Open' check (status in ('Open', 'Cancelled', 'Closed')), close_note text,
  created_by text, created_name text, created_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now()
);
create index if not exists store_po_status on public.store_po (status);

create table if not exists public.store_opening (
  code text primary key, date date not null, qty numeric not null check (qty >= 0), rate numeric not null default 0 check (rate >= 0),
  remark text, updated_by text, updated_at timestamptz not null default now()
);

create table if not exists public.store_grn (
  no bigint primary key, date date not null, supplier text not null, challan_no text, invoice_no text, invoice_date date,
  vehicle_no text, po_no bigint, taxable numeric not null default 0, gst numeric not null default 0, tcs numeric not null default 0,
  gross numeric not null default 0, remark text,
  created_by text, created_name text, created_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now()
);
create index if not exists store_grn_date on public.store_grn (date);
create index if not exists store_grn_po on public.store_grn (po_no);
create table if not exists public.store_grn_lines (
  id bigserial primary key, grn_no bigint not null references public.store_grn (no) on delete cascade, line int not null,
  code text not null, name text not null, unit text not null, qty numeric not null check (qty > 0), rate numeric not null default 0 check (rate >= 0),
  taxable numeric not null default 0, gst_pct numeric, gst numeric not null default 0, gross numeric not null default 0, po_line int, remark text
);
create index if not exists store_grn_lines_no on public.store_grn_lines (grn_no);
create index if not exists store_grn_lines_code on public.store_grn_lines (code);

create table if not exists public.store_issue (
  no bigint primary key, date date not null,
  to_kind text not null check (to_kind in ('Site work', 'Sub-contractor', 'Machinery', 'Office')),
  party text, machinery text, reading numeric, location text, side text, use_for text, receiver text,
  debit boolean not null default false, amount numeric not null default 0, remark text,
  created_by text, created_name text, created_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now()
);
create index if not exists store_issue_date on public.store_issue (date);
create index if not exists store_issue_machinery on public.store_issue (machinery);
create table if not exists public.store_issue_lines (
  id bigserial primary key, issue_no bigint not null references public.store_issue (no) on delete cascade, line int not null,
  code text not null, name text not null, unit text not null, qty numeric not null check (qty > 0),
  rate numeric not null default 0, amount numeric not null default 0, gst_pct numeric, gst numeric not null default 0,
  returnable boolean not null default false, serial text, remark text
);
create index if not exists store_issue_lines_no on public.store_issue_lines (issue_no);
create index if not exists store_issue_lines_code on public.store_issue_lines (code);

create table if not exists public.store_return (
  no bigint primary key, date date not null, issue_no bigint not null references public.store_issue (no), party text, remark text,
  created_by text, created_name text, created_at timestamptz not null default now(), updated_by text, updated_at timestamptz not null default now()
);
create index if not exists store_return_issue on public.store_return (issue_no);
create table if not exists public.store_return_lines (
  id bigserial primary key, return_no bigint not null references public.store_return (no) on delete cascade, line int not null,
  issue_line bigint not null references public.store_issue_lines (id), code text not null, name text not null, unit text not null,
  qty numeric not null check (qty > 0), remark text
);
create index if not exists store_return_lines_no on public.store_return_lines (return_no);
create index if not exists store_return_lines_issue on public.store_return_lines (issue_line);

-- every movement of every item (+ in, − out) – the stock, the reports and the checks all read it
create or replace view public.store_moves with (security_invoker = true) as
  select o.code, o.date, o.qty as q, 'OPN'::text as kind, 0::bigint as no, o.rate, 'OPN:' || o.code as id from public.store_opening o where o.qty > 0
  union all select l.code, g.date, l.qty, 'GRN', g.no, l.rate, 'GRN:' || l.id from public.store_grn_lines l join public.store_grn g on g.no = l.grn_no
  union all select l.code, r.date, l.qty, 'RET', r.no, null::numeric, 'RET:' || l.id from public.store_return_lines l join public.store_return r on r.no = l.return_no
  union all select l.code, i.date, -l.qty, 'OUT', i.no, l.rate, 'OUT:' || l.id from public.store_issue_lines l join public.store_issue i on i.no = l.issue_no;

-- the stock of every item on a date (none = today and after), with what came in up to then (its quantity and basic value – for the
-- average rate); and a period's statement: opening, inward, return, issue, closing, the purchase in the period
create or replace function public.store_stock_on(p_date date default null) returns table (code text, qty numeric, in_qty numeric, in_value numeric)
language sql stable set search_path = '' as $$
  select m.code, sum(m.q), sum(case when m.kind in ('GRN', 'OPN') then m.q else 0 end), sum(case when m.kind in ('GRN', 'OPN') then m.q * coalesce(m.rate, 0) else 0 end)
  from public.store_moves m where p_date is null or m.date <= p_date group by m.code
$$;
create or replace function public.store_statement(p_from date, p_to date) returns table (code text, opening numeric, inward numeric, returned numeric, issued numeric, closing numeric,
  in_qty numeric, in_value numeric, buy_qty numeric, buy_value numeric)
language sql stable set search_path = '' as $$
  select m.code,
    sum(case when m.date < p_from then m.q else 0 end),
    sum(case when m.date >= p_from and m.kind in ('GRN', 'OPN') then m.q else 0 end),
    sum(case when m.date >= p_from and m.kind = 'RET' then m.q else 0 end),
    sum(case when m.date >= p_from and m.kind = 'OUT' then -m.q else 0 end),
    sum(m.q),
    sum(case when m.kind in ('GRN', 'OPN') then m.q else 0 end),
    sum(case when m.kind in ('GRN', 'OPN') then m.q * coalesce(m.rate, 0) else 0 end),
    sum(case when m.date >= p_from and m.kind = 'GRN' then m.q else 0 end),
    sum(case when m.date >= p_from and m.kind = 'GRN' then m.q * coalesce(m.rate, 0) else 0 end)
  from public.store_moves m where m.date <= p_to group by m.code
$$;

do $$ declare t text; begin
  foreach t in array array['store_req', 'store_po', 'store_opening', 'store_grn', 'store_issue', 'store_return', 'store_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.store_touch()', t || '_touch', t);
  end loop;
end $$;

-- the next number of a paper of this site
create or replace function public.store_next(p_kind text) returns bigint language plpgsql set search_path = '' as $$
declare v bigint;
begin
  update public.store_numbers set next_no = next_no + 1 where kind = p_kind returning next_no - 1 into v;
  if v is null then insert into public.store_numbers (kind, next_no) values (p_kind, 2) returning 1 into v; end if;
  return v;
end $$;

-- an item's stock below zero on any date (after a save): the save stops – "STORE_SHORT code|date|balance"
create or replace function public.store_short(p_codes text[]) returns void language plpgsql set search_path = '' as $$
declare r record;
begin
  if p_codes is null or cardinality(p_codes) = 0 then return; end if;
  select b.code, b.d, b.bal into r from (
    select a.code, a.d, sum(a.q) over (partition by a.code order by a.d) as bal from (
      select m.code, m.date as d, sum(m.q) as q from public.store_moves m where m.code = any (p_codes) group by m.code, m.date) a) b
  where b.bal < -0.0005 order by b.d, b.code limit 1;
  if found then raise exception 'STORE_SHORT %|%|%', r.code, r.d, r.bal; end if;
end $$;

-- a REQUIREMENT made (its number given here)
create or replace function public.store_req_put(p_row jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
  loop v_no := public.store_next('REQ'); exit when not exists (select 1 from public.store_req where no = v_no); end loop;
  insert into public.store_req (no, date, need_by, for_kind, for_text, remark, lines, status, level, approvals, created_by, created_name)
  values (v_no, (p_row ->> 'date')::date, nullif(p_row ->> 'need_by', '')::date, p_row ->> 'for_kind', p_row ->> 'for_text', p_row ->> 'remark',
    p_row -> 'lines', coalesce(p_row ->> 'status', 'Pending'), coalesce((p_row ->> 'level')::int, 0), coalesce(p_row -> 'approvals', '[]'::jsonb), p_by, p_name);
  return v_no;
end $$;

-- a PURCHASE ORDER made or changed: a requirement's item is never ordered more than was asked (POs not cancelled), and only an
-- approved requirement is ordered – "STORE_OVER_ORDER req|item|asked|ordered", "STORE_REQ_NOT_APPROVED req"
create or replace function public.store_po_put(p_no bigint, p_row jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; r record;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_no is null then
    loop v_no := public.store_next('PO'); exit when not exists (select 1 from public.store_po where no = v_no); end loop;
    insert into public.store_po (no, date, vendor, vendor_gst, deliver_by, terms, remark, lines, taxable, gst, total, created_by, created_name)
    values (v_no, (p_row ->> 'date')::date, p_row ->> 'vendor', p_row ->> 'vendor_gst', nullif(p_row ->> 'deliver_by', '')::date, p_row ->> 'terms', p_row ->> 'remark',
      p_row -> 'lines', coalesce((p_row ->> 'taxable')::numeric, 0), coalesce((p_row ->> 'gst')::numeric, 0), coalesce((p_row ->> 'total')::numeric, 0), p_by, p_name);
  else
    update public.store_po set date = (p_row ->> 'date')::date, vendor = p_row ->> 'vendor', vendor_gst = p_row ->> 'vendor_gst', deliver_by = nullif(p_row ->> 'deliver_by', '')::date,
      terms = p_row ->> 'terms', remark = p_row ->> 'remark', lines = p_row -> 'lines', taxable = coalesce((p_row ->> 'taxable')::numeric, 0), gst = coalesce((p_row ->> 'gst')::numeric, 0),
      total = coalesce((p_row ->> 'total')::numeric, 0), updated_by = p_by where no = v_no and status = 'Open';
    if not found then raise exception 'STORE_GONE'; end if;
  end if;
  with mine as (select distinct (l ->> 'req_no')::bigint as rn from jsonb_array_elements(p_row -> 'lines') l where nullif(l ->> 'req_no', '') is not null),
  po as (select (l ->> 'req_no')::bigint as rn, (l ->> 'req_line')::int as rl, sum((l ->> 'qty')::numeric) as q
         from public.store_po p, jsonb_array_elements(p.lines) l
         where p.status <> 'Cancelled' and nullif(l ->> 'req_no', '') is not null and (l ->> 'req_no')::bigint in (select rn from mine) group by 1, 2),
  rq as (select x.no as rn, (l ->> 'line')::int as rl, (l ->> 'qty')::numeric as q, l ->> 'name' as nm, x.status from public.store_req x, jsonb_array_elements(x.lines) l where x.no in (select rn from mine))
  select po.rn, po.rl, po.q as ordered, rq.q as asked, rq.nm, rq.status into r from po left join rq on rq.rn = po.rn and rq.rl = po.rl
  where rq.rn is null or rq.status not in ('Approved', 'Closed') or po.q > rq.q + 0.0005 order by po.rn, po.rl limit 1;
  if found then
    if r.asked is null or r.status not in ('Approved', 'Closed') then raise exception 'STORE_REQ_NOT_APPROVED %', r.rn; end if;
    raise exception 'STORE_OVER_ORDER %|%|%|%', r.rn, r.nm, r.asked, r.ordered;
  end if;
  return v_no;
end $$;

-- the OPENING STOCK of items (one row an item; a row with no quantity takes it out)
create or replace function public.store_open_put(p_rows jsonb, p_by text) returns int language plpgsql set search_path = '' as $$
declare v_codes text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  select array_agg(distinct x.code) into v_codes from jsonb_to_recordset(p_rows) as x(code text);
  delete from public.store_opening where code in (select x.code from jsonb_to_recordset(p_rows) as x(code text, qty numeric) where coalesce(x.qty, 0) = 0);
  insert into public.store_opening (code, date, qty, rate, remark, updated_by)
    select x.code, x.date, x.qty, coalesce(x.rate, 0), x.remark, p_by from jsonb_to_recordset(p_rows) as x(code text, date date, qty numeric, rate numeric, remark text) where coalesce(x.qty, 0) > 0
  on conflict (code) do update set date = excluded.date, qty = excluded.qty, rate = excluded.rate, remark = excluded.remark, updated_by = excluded.updated_by;
  perform public.store_short(v_codes);
  return coalesce(cardinality(v_codes), 0);
end $$;

-- a GRN (inward) made or changed – its lines written again; the stock checked
create or replace function public.store_grn_put(p_no bigint, p_head jsonb, p_lines jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; v_old text[] := '{}'; v_new text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_no is null then
    loop v_no := public.store_next('GRN'); exit when not exists (select 1 from public.store_grn where no = v_no); end loop;
    insert into public.store_grn (no, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, po_no, taxable, gst, tcs, gross, remark, created_by, created_name)
    values (v_no, (p_head ->> 'date')::date, p_head ->> 'supplier', p_head ->> 'challan_no', p_head ->> 'invoice_no', nullif(p_head ->> 'invoice_date', '')::date, p_head ->> 'vehicle_no',
      nullif(p_head ->> 'po_no', '')::bigint, coalesce((p_head ->> 'taxable')::numeric, 0), coalesce((p_head ->> 'gst')::numeric, 0), coalesce((p_head ->> 'tcs')::numeric, 0),
      coalesce((p_head ->> 'gross')::numeric, 0), p_head ->> 'remark', p_by, p_name);
  else
    if not exists (select 1 from public.store_grn where no = v_no) then raise exception 'STORE_GONE'; end if;
    select coalesce(array_agg(distinct code), '{}') into v_old from public.store_grn_lines where grn_no = v_no;
    delete from public.store_grn_lines where grn_no = v_no;
    update public.store_grn set date = (p_head ->> 'date')::date, supplier = p_head ->> 'supplier', challan_no = p_head ->> 'challan_no', invoice_no = p_head ->> 'invoice_no',
      invoice_date = nullif(p_head ->> 'invoice_date', '')::date, vehicle_no = p_head ->> 'vehicle_no', po_no = nullif(p_head ->> 'po_no', '')::bigint,
      taxable = coalesce((p_head ->> 'taxable')::numeric, 0), gst = coalesce((p_head ->> 'gst')::numeric, 0), tcs = coalesce((p_head ->> 'tcs')::numeric, 0),
      gross = coalesce((p_head ->> 'gross')::numeric, 0), remark = p_head ->> 'remark', updated_by = p_by where no = v_no;
  end if;
  insert into public.store_grn_lines (grn_no, line, code, name, unit, qty, rate, taxable, gst_pct, gst, gross, po_line, remark)
    select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.taxable, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.gross, 0), x.po_line, x.remark
    from jsonb_to_recordset(p_lines) as x(line int, code text, name text, unit text, qty numeric, rate numeric, taxable numeric, gst_pct numeric, gst numeric, gross numeric, po_line int, remark text);
  select array_agg(distinct code) into v_new from public.store_grn_lines where grn_no = v_no;
  perform public.store_short(v_old || v_new);
  return v_no;
end $$;
create or replace function public.store_grn_del(p_no bigint) returns void language plpgsql set search_path = '' as $$
declare v_old text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  select array_agg(distinct code) into v_old from public.store_grn_lines where grn_no = p_no;
  delete from public.store_grn where no = p_no;
  if not found then raise exception 'STORE_GONE'; end if;
  perform public.store_short(v_old);
end $$;

-- an ISSUE (outward) made or changed – an issue that has a return is not changed (its return first)
create or replace function public.store_issue_put(p_no bigint, p_head jsonb, p_lines jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; v_old text[] := '{}'; v_new text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_no is null then
    loop v_no := public.store_next('OUT'); exit when not exists (select 1 from public.store_issue where no = v_no); end loop;
    insert into public.store_issue (no, date, to_kind, party, machinery, reading, location, side, use_for, receiver, debit, amount, remark, created_by, created_name)
    values (v_no, (p_head ->> 'date')::date, p_head ->> 'to_kind', p_head ->> 'party', p_head ->> 'machinery', nullif(p_head ->> 'reading', '')::numeric, p_head ->> 'location',
      p_head ->> 'side', p_head ->> 'use_for', p_head ->> 'receiver', coalesce((p_head ->> 'debit')::boolean, false), coalesce((p_head ->> 'amount')::numeric, 0), p_head ->> 'remark', p_by, p_name);
  else
    if not exists (select 1 from public.store_issue where no = v_no) then raise exception 'STORE_GONE'; end if;
    if exists (select 1 from public.store_return where issue_no = v_no) then raise exception 'STORE_HAS_RETURN %', v_no; end if;
    select coalesce(array_agg(distinct code), '{}') into v_old from public.store_issue_lines where issue_no = v_no;
    delete from public.store_issue_lines where issue_no = v_no;
    update public.store_issue set date = (p_head ->> 'date')::date, to_kind = p_head ->> 'to_kind', party = p_head ->> 'party', machinery = p_head ->> 'machinery',
      reading = nullif(p_head ->> 'reading', '')::numeric, location = p_head ->> 'location', side = p_head ->> 'side', use_for = p_head ->> 'use_for', receiver = p_head ->> 'receiver',
      debit = coalesce((p_head ->> 'debit')::boolean, false), amount = coalesce((p_head ->> 'amount')::numeric, 0), remark = p_head ->> 'remark', updated_by = p_by where no = v_no;
  end if;
  insert into public.store_issue_lines (issue_no, line, code, name, unit, qty, rate, amount, gst_pct, gst, returnable, serial, remark)
    select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.amount, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.returnable, false), x.serial, x.remark
    from jsonb_to_recordset(p_lines) as x(line int, code text, name text, unit text, qty numeric, rate numeric, amount numeric, gst_pct numeric, gst numeric, returnable boolean, serial text, remark text);
  select array_agg(distinct code) into v_new from public.store_issue_lines where issue_no = v_no;
  perform public.store_short(v_old || v_new);
  return v_no;
end $$;
create or replace function public.store_issue_del(p_no bigint) returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if exists (select 1 from public.store_return where issue_no = p_no) then raise exception 'STORE_HAS_RETURN %', p_no; end if;
  delete from public.store_issue where no = p_no;      -- (taking stock out back in: nothing can go below zero)
  if not found then raise exception 'STORE_GONE'; end if;
end $$;

-- a RETURN to the store of an issue's items: never more than was issued on that line (all its returns) –
-- "STORE_OVER_RETURN item|issued|returned"
create or replace function public.store_return_put(p_no bigint, p_head jsonb, p_lines jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; v_issue bigint := (p_head ->> 'issue_no')::bigint; v_old text[] := '{}'; v_new text[]; r record;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'STORE_NO_LINES'; end if;
  if not exists (select 1 from public.store_issue where no = v_issue) then raise exception 'STORE_GONE'; end if;
  if v_no is null then
    loop v_no := public.store_next('RET'); exit when not exists (select 1 from public.store_return where no = v_no); end loop;
    insert into public.store_return (no, date, issue_no, party, remark, created_by, created_name) values (v_no, (p_head ->> 'date')::date, v_issue, p_head ->> 'party', p_head ->> 'remark', p_by, p_name);
  else
    if not exists (select 1 from public.store_return where no = v_no and issue_no = v_issue) then raise exception 'STORE_GONE'; end if;
    select coalesce(array_agg(distinct code), '{}') into v_old from public.store_return_lines where return_no = v_no;
    delete from public.store_return_lines where return_no = v_no;
    update public.store_return set date = (p_head ->> 'date')::date, party = p_head ->> 'party', remark = p_head ->> 'remark', updated_by = p_by where no = v_no;
  end if;
  insert into public.store_return_lines (return_no, line, issue_line, code, name, unit, qty, remark)
    select v_no, x.line, l.id, l.code, l.name, l.unit, x.qty, x.remark
    from jsonb_to_recordset(p_lines) as x(line int, issue_line bigint, qty numeric, remark text) join public.store_issue_lines l on l.id = x.issue_line and l.issue_no = v_issue;
  if (select count(*) from public.store_return_lines where return_no = v_no) <> jsonb_array_length(p_lines) then raise exception 'STORE_GONE'; end if;
  select l.name, l.qty as issued, sum(rl.qty) as back into r from public.store_issue_lines l join public.store_return_lines rl on rl.issue_line = l.id
  where l.issue_no = v_issue group by l.id, l.name, l.qty having sum(rl.qty) > l.qty + 0.0005 limit 1;
  if found then raise exception 'STORE_OVER_RETURN %|%|%', r.name, r.issued, r.back; end if;
  if (select date from public.store_issue where no = v_issue) > (p_head ->> 'date')::date then raise exception 'STORE_RETURN_BEFORE_ISSUE'; end if;
  select array_agg(distinct code) into v_new from public.store_return_lines where return_no = v_no;
  perform public.store_short(v_old || v_new);
  return v_no;
end $$;
create or replace function public.store_return_del(p_no bigint) returns void language plpgsql set search_path = '' as $$
declare v_old text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  select array_agg(distinct code) into v_old from public.store_return_lines where return_no = p_no;
  delete from public.store_return where no = p_no;
  if not found then raise exception 'STORE_GONE'; end if;
  perform public.store_short(v_old);
end $$;

-- an Excel import: many GRNs (or issues) in ONE go – all of them or none
create or replace function public.store_grn_many(p_docs jsonb, p_by text, p_name text) returns bigint[] language plpgsql set search_path = '' as $$
declare d jsonb; v_out bigint[] := '{}';
begin
  for d in select value from jsonb_array_elements(p_docs) loop v_out := v_out || public.store_grn_put(null, d -> 'head', d -> 'lines', p_by, p_name); end loop;
  return v_out;
end $$;
create or replace function public.store_issue_many(p_docs jsonb, p_by text, p_name text) returns bigint[] language plpgsql set search_path = '' as $$
declare d jsonb; v_out bigint[] := '{}';
begin
  for d in select value from jsonb_array_elements(p_docs) loop v_out := v_out || public.store_issue_put(null, d -> 'head', d -> 'lines', p_by, p_name); end loop;
  return v_out;
end $$;

do $$ declare t text; begin
  foreach t in array array['store_numbers', 'store_settings', 'store_req', 'store_po', 'store_opening', 'store_grn', 'store_grn_lines', 'store_issue', 'store_issue_lines', 'store_return', 'store_return_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on public.store_moves from public, anon, authenticated;
grant select on public.store_moves to service_role;
grant usage, select on sequence public.store_grn_lines_id_seq, public.store_issue_lines_id_seq, public.store_return_lines_id_seq to service_role;
do $$ declare f text; begin
  foreach f in array array['store_next(text)', 'store_short(text[])', 'store_req_put(jsonb,text,text)', 'store_po_put(bigint,jsonb,text,text)', 'store_open_put(jsonb,text)',
    'store_grn_put(bigint,jsonb,jsonb,text,text)', 'store_grn_del(bigint)', 'store_issue_put(bigint,jsonb,jsonb,text,text)', 'store_issue_del(bigint)',
    'store_return_put(bigint,jsonb,jsonb,text,text)', 'store_return_del(bigint)', 'store_stock_on(date)', 'store_statement(date,date)', 'store_grn_many(jsonb,text,text)', 'store_issue_many(jsonb,text,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

notify pgrst, 'reload schema';
select 'Store step 2 done · requirements ' || (select count(*) from public.store_req) || ' · GRN ' || (select count(*) from public.store_grn) || ' · issues ' || (select count(*) from public.store_issue) as done;
