-- =====================================================================
-- RCL ERP – STORE step 5: the purchase order in the company's own format, and its approval (28-10-2026)
-- Run once in Supabase → SQL Editor, in EVERY site's project (VTR NH 848, 18B KOLHAPUR, HEAD OFFICE, …), after the Store's steps 1–4.
-- Safe to run again. It only ADDS columns to store_po and puts in store_po_put again (as step 2's, with the new fields):
--   credit_days, site_contact, ship_to   the PO Details of his format (Credit Period, Site Contact, Shipping Address)
--   freight, load_unload, disc           Total Freight Charges, Total Load / Unload Amount, Total Disc. Amount
--   appr, appr_by, appr_name, appr_at, appr_note   its approval (Waiting / Approved / Rejected – who, when, why)
-- No row is changed: a PO made before this step keeps its number, its figures and its state (it counts as approved).
-- Rollback (only while no PO has the new fields): alter table public.store_po drop column credit_days, drop column site_contact,
--   drop column ship_to, drop column freight, drop column load_unload, drop column disc, drop column appr, drop column appr_by,
--   drop column appr_name, drop column appr_at, drop column appr_note; and run step 2's store_po_put again.
-- =====================================================================
alter table public.store_po add column if not exists credit_days int;
alter table public.store_po add column if not exists site_contact text;
alter table public.store_po add column if not exists ship_to text;
alter table public.store_po add column if not exists freight numeric not null default 0;
alter table public.store_po add column if not exists load_unload numeric not null default 0;
alter table public.store_po add column if not exists disc numeric not null default 0;
alter table public.store_po add column if not exists appr text;
alter table public.store_po add column if not exists appr_by text;
alter table public.store_po add column if not exists appr_name text;
alter table public.store_po add column if not exists appr_at timestamptz;
alter table public.store_po add column if not exists appr_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'store_po_appr_check') then
    alter table public.store_po add constraint store_po_appr_check check (appr is null or appr in ('Waiting', 'Approved', 'Rejected'));
  end if;
end $$;

-- a PURCHASE ORDER saved (new or changed): as step 2's, with the fields of step 5. appr: 'Waiting' (it waits for the one who approves –
-- a changed PO waits again) or 'Approved' (nobody approves POs at this site: approved when made, appr_note says so); who approved it is
-- written only by the approval itself (the server's poDecide)
create or replace function public.store_po_put(p_no bigint, p_row jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; r record; v_appr text := nullif(p_row ->> 'appr', '');
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_appr is not null and v_appr not in ('Waiting', 'Approved') then raise exception 'STORE_BAD_APPR'; end if;
  if v_no is null then
    loop v_no := public.store_next('PO'); exit when not exists (select 1 from public.store_po where no = v_no); end loop;
    insert into public.store_po (no, date, vendor, vendor_gst, deliver_by, terms, remark, lines, taxable, gst, total, created_by, created_name,
      credit_days, site_contact, ship_to, freight, load_unload, disc, appr, appr_by, appr_name, appr_at, appr_note)
    values (v_no, (p_row ->> 'date')::date, p_row ->> 'vendor', p_row ->> 'vendor_gst', nullif(p_row ->> 'deliver_by', '')::date, p_row ->> 'terms', p_row ->> 'remark',
      p_row -> 'lines', coalesce((p_row ->> 'taxable')::numeric, 0), coalesce((p_row ->> 'gst')::numeric, 0), coalesce((p_row ->> 'total')::numeric, 0), p_by, p_name,
      nullif(p_row ->> 'credit_days', '')::int, p_row ->> 'site_contact', p_row ->> 'ship_to', coalesce((p_row ->> 'freight')::numeric, 0), coalesce((p_row ->> 'load_unload')::numeric, 0),
      coalesce((p_row ->> 'disc')::numeric, 0), v_appr, null, null, case when v_appr = 'Approved' then now() end, case when v_appr = 'Approved' then nullif(p_row ->> 'appr_note', '') end);
  else
    update public.store_po set date = (p_row ->> 'date')::date, vendor = p_row ->> 'vendor', vendor_gst = p_row ->> 'vendor_gst', deliver_by = nullif(p_row ->> 'deliver_by', '')::date,
      terms = p_row ->> 'terms', remark = p_row ->> 'remark', lines = p_row -> 'lines', taxable = coalesce((p_row ->> 'taxable')::numeric, 0), gst = coalesce((p_row ->> 'gst')::numeric, 0),
      total = coalesce((p_row ->> 'total')::numeric, 0), updated_by = p_by,
      credit_days = nullif(p_row ->> 'credit_days', '')::int, site_contact = p_row ->> 'site_contact', ship_to = p_row ->> 'ship_to', freight = coalesce((p_row ->> 'freight')::numeric, 0),
      load_unload = coalesce((p_row ->> 'load_unload')::numeric, 0), disc = coalesce((p_row ->> 'disc')::numeric, 0),
      appr = v_appr, appr_by = null, appr_name = null, appr_at = case when v_appr = 'Approved' then now() end, appr_note = case when v_appr = 'Approved' then nullif(p_row ->> 'appr_note', '') end
    where no = v_no and status = 'Open';
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
revoke all on function public.store_po_put(bigint, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.store_po_put(bigint, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
select 'Store step 5 done · POs ' || (select count(*) from public.store_po)
  || ' · new columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_po'
       and column_name in ('credit_days', 'site_contact', 'ship_to', 'freight', 'load_unload', 'disc', 'appr', 'appr_by', 'appr_name', 'appr_at', 'appr_note')) || ' of 11' as done;
