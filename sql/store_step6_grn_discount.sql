-- =====================================================================
-- RCL ERP – STORE step 6: the GRN's discounts (29-10-2026 – "bill madh discount pn kadhi kdhi dettat mg to kadhi basic war asu shakto
-- tr kadhi gst war … perfect hawa"; his answers: on a line and on the whole bill, each on the Basic or after GST; the stock's rate with
-- both deducted – what we really paid)
-- Run once in EVERY site's Supabase → SQL Editor (VTR NH 848, 18B KOLHAPUR, HEAD OFFICE, …), after the Store's steps 1–5.
-- Safe to run again. It only ADDS columns and puts the GRN's two save functions in again (as steps 3 / 4, with the new fields):
--   store_grn_lines: basic (qty × rate), disc (its own discount ₹), disc_pct, disc_on ('basic' / 'gst'), bill_disc (its part of the
--                    bill's discount ₹), net_rate (the stock's rate: what was paid without GST, per unit)
--   store_grn:       basic, disc (all discounts ₹), bill_disc, bill_disc_pct, bill_disc_on
-- and the view of every movement (store_moves) takes a GRN line's net_rate – its basic rate where it has none (every GRN of before).
-- No row is changed: a GRN made before this step keeps its figures (no discount, its rate as before).
-- Step 6 LAST: it puts in again store_grn_put, store_grn_new and store_moves – if step 2, 3 or 4 is ever run again, run step 6 after it.
-- Rollback (only while no GRN has a discount): run store_moves of step 2, store_grn_put of step 3 and store_grn_new of step 4 again;
--   then alter table public.store_grn_lines drop column basic, drop column disc, drop column disc_pct, drop column disc_on,
--   drop column bill_disc, drop column net_rate; alter table public.store_grn drop column basic, drop column disc,
--   drop column bill_disc, drop column bill_disc_pct, drop column bill_disc_on.
-- =====================================================================
alter table public.store_grn_lines add column if not exists basic numeric;
alter table public.store_grn_lines add column if not exists disc numeric not null default 0;
alter table public.store_grn_lines add column if not exists disc_pct numeric;
alter table public.store_grn_lines add column if not exists disc_on text;
alter table public.store_grn_lines add column if not exists bill_disc numeric not null default 0;
alter table public.store_grn_lines add column if not exists net_rate numeric;
alter table public.store_grn add column if not exists basic numeric;
alter table public.store_grn add column if not exists disc numeric not null default 0;
alter table public.store_grn add column if not exists bill_disc numeric not null default 0;
alter table public.store_grn add column if not exists bill_disc_pct numeric;
alter table public.store_grn add column if not exists bill_disc_on text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'store_grn_lines_disc_on_check') then
    alter table public.store_grn_lines add constraint store_grn_lines_disc_on_check check (disc_on is null or disc_on in ('basic', 'gst'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'store_grn_bill_disc_on_check') then
    alter table public.store_grn add constraint store_grn_bill_disc_on_check check (bill_disc_on is null or bill_disc_on in ('basic', 'gst'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'store_grn_lines_net_rate_check') then
    alter table public.store_grn_lines add constraint store_grn_lines_net_rate_check check (net_rate is null or net_rate >= 0);
  end if;
end $$;

-- every movement of every item (+ in, − out): a GRN line at its NET rate (what was paid without GST; its basic rate when it has none)
create or replace view public.store_moves with (security_invoker = true) as
  select o.code, o.date, o.qty as q, 'OPN'::text as kind, 0::bigint as no, o.rate, 'OPN:' || o.code as id from public.store_opening o where o.qty > 0
  union all select l.code, g.date, l.qty, 'GRN', g.no, coalesce(l.net_rate, l.rate), 'GRN:' || l.id from public.store_grn_lines l join public.store_grn g on g.no = l.grn_no
  union all select l.code, r.date, l.qty, 'RET', r.no, null::numeric, 'RET:' || l.id from public.store_return_lines l join public.store_return r on r.no = l.return_no
  union all select l.code, i.date, -l.qty, 'OUT', i.no, l.rate, 'OUT:' || l.id from public.store_issue_lines l join public.store_issue i on i.no = l.issue_no;

-- a GRN saved (new or changed) – as step 3's, with the discounts and the net rate
create or replace function public.store_grn_put(p_no bigint, p_head jsonb, p_lines jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; v_old text[] := '{}'; v_new text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_no is null then
    loop v_no := public.store_next('GRN'); exit when not exists (select 1 from public.store_grn where no = v_no) and not exists (select 1 from public.store_grn where ref = v_no::text); end loop;
    insert into public.store_grn (no, ref, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, po_no, taxable, gst, tcs, gross, remark, created_by, created_name,
      basic, disc, bill_disc, bill_disc_pct, bill_disc_on)
    values (v_no, v_no::text, (p_head ->> 'date')::date, p_head ->> 'supplier', p_head ->> 'challan_no', p_head ->> 'invoice_no', nullif(p_head ->> 'invoice_date', '')::date, p_head ->> 'vehicle_no',
      nullif(p_head ->> 'po_no', '')::bigint, coalesce((p_head ->> 'taxable')::numeric, 0), coalesce((p_head ->> 'gst')::numeric, 0), coalesce((p_head ->> 'tcs')::numeric, 0),
      coalesce((p_head ->> 'gross')::numeric, 0), p_head ->> 'remark', p_by, p_name,
      (p_head ->> 'basic')::numeric, coalesce((p_head ->> 'disc')::numeric, 0), coalesce((p_head ->> 'bill_disc')::numeric, 0), (p_head ->> 'bill_disc_pct')::numeric, nullif(p_head ->> 'bill_disc_on', ''));
  else
    if not exists (select 1 from public.store_grn where no = v_no) then raise exception 'STORE_GONE'; end if;
    select coalesce(array_agg(distinct code), '{}') into v_old from public.store_grn_lines where grn_no = v_no;
    delete from public.store_grn_lines where grn_no = v_no;
    update public.store_grn set date = (p_head ->> 'date')::date, supplier = p_head ->> 'supplier', challan_no = p_head ->> 'challan_no', invoice_no = p_head ->> 'invoice_no',
      invoice_date = nullif(p_head ->> 'invoice_date', '')::date, vehicle_no = p_head ->> 'vehicle_no', po_no = nullif(p_head ->> 'po_no', '')::bigint,
      taxable = coalesce((p_head ->> 'taxable')::numeric, 0), gst = coalesce((p_head ->> 'gst')::numeric, 0), tcs = coalesce((p_head ->> 'tcs')::numeric, 0),
      gross = coalesce((p_head ->> 'gross')::numeric, 0), remark = p_head ->> 'remark', ref = coalesce(ref, v_no::text), updated_by = p_by,
      basic = (p_head ->> 'basic')::numeric, disc = coalesce((p_head ->> 'disc')::numeric, 0), bill_disc = coalesce((p_head ->> 'bill_disc')::numeric, 0),
      bill_disc_pct = (p_head ->> 'bill_disc_pct')::numeric, bill_disc_on = nullif(p_head ->> 'bill_disc_on', '') where no = v_no;
  end if;
  insert into public.store_grn_lines (grn_no, line, code, name, unit, qty, rate, taxable, gst_pct, gst, gross, po_line, remark, basic, disc, disc_pct, disc_on, bill_disc, net_rate)
    select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.taxable, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.gross, 0), x.po_line, x.remark,
      x.basic, coalesce(x.disc, 0), x.disc_pct, nullif(x.disc_on, ''), coalesce(x.bill_disc, 0), x.net_rate
    from jsonb_to_recordset(p_lines) as x(line int, code text, name text, unit text, qty numeric, rate numeric, taxable numeric, gst_pct numeric, gst numeric, gross numeric, po_line int, remark text,
      basic numeric, disc numeric, disc_pct numeric, disc_on text, bill_disc numeric, net_rate numeric);
  select array_agg(distinct code) into v_new from public.store_grn_lines where grn_no = v_no;
  perform public.store_short(v_old || v_new);
  return v_no;
end $$;
revoke all on function public.store_grn_put(bigint, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.store_grn_put(bigint, jsonb, jsonb, text, text) to service_role;

-- a NEW GRN with the GRN No typed in its form – as step 4's, with the discounts and the net rate
create or replace function public.store_grn_new(p_head jsonb, p_lines jsonb, p_ref text, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint; v_ref text := nullif(trim(coalesce(p_ref, '')), ''); v_new text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_ref is null then
    loop v_no := public.store_next('GRN'); exit when not exists (select 1 from public.store_grn where no = v_no) and not exists (select 1 from public.store_grn where ref = v_no::text); end loop;
    v_ref := v_no::text;
  else
    if exists (select 1 from public.store_grn where upper(ref) = upper(v_ref))
       or (v_ref ~ '^[0-9]{1,9}$' and exists (select 1 from public.store_grn where no = v_ref::bigint or ref = (v_ref::bigint)::text)) then
      raise exception 'STORE_REF_USED %', v_ref;
    end if;
    if v_ref ~ '^[0-9]{1,9}$' and v_ref::bigint > 0 then
      v_no := v_ref::bigint;
      update public.store_numbers set next_no = greatest(next_no, v_no + 1) where kind = 'GRN';
    else
      select greatest(coalesce(max(no), 0), 1000000000) + 1 into v_no from public.store_grn where no > 1000000000;
    end if;
  end if;
  insert into public.store_grn (no, ref, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, po_no, taxable, gst, tcs, gross, remark, created_by, created_name,
    basic, disc, bill_disc, bill_disc_pct, bill_disc_on)
  values (v_no, v_ref, (p_head ->> 'date')::date, p_head ->> 'supplier', p_head ->> 'challan_no', p_head ->> 'invoice_no', nullif(p_head ->> 'invoice_date', '')::date, p_head ->> 'vehicle_no',
    nullif(p_head ->> 'po_no', '')::bigint, coalesce((p_head ->> 'taxable')::numeric, 0), coalesce((p_head ->> 'gst')::numeric, 0), coalesce((p_head ->> 'tcs')::numeric, 0),
    coalesce((p_head ->> 'gross')::numeric, 0), p_head ->> 'remark', p_by, p_name,
    (p_head ->> 'basic')::numeric, coalesce((p_head ->> 'disc')::numeric, 0), coalesce((p_head ->> 'bill_disc')::numeric, 0), (p_head ->> 'bill_disc_pct')::numeric, nullif(p_head ->> 'bill_disc_on', ''));
  insert into public.store_grn_lines (grn_no, line, code, name, unit, qty, rate, taxable, gst_pct, gst, gross, po_line, remark, basic, disc, disc_pct, disc_on, bill_disc, net_rate)
    select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.taxable, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.gross, 0), x.po_line, x.remark,
      x.basic, coalesce(x.disc, 0), x.disc_pct, nullif(x.disc_on, ''), coalesce(x.bill_disc, 0), x.net_rate
    from jsonb_to_recordset(p_lines) as x(line int, code text, name text, unit text, qty numeric, rate numeric, taxable numeric, gst_pct numeric, gst numeric, gross numeric, po_line int, remark text,
      basic numeric, disc numeric, disc_pct numeric, disc_on text, bill_disc numeric, net_rate numeric);
  select array_agg(distinct code) into v_new from public.store_grn_lines where grn_no = v_no;
  perform public.store_short(v_new);
  return v_no;
end $$;
revoke all on function public.store_grn_new(jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.store_grn_new(jsonb, jsonb, text, text, text) to service_role;

notify pgrst, 'reload schema';
select 'Store step 6 done · GRNs ' || (select count(*) from public.store_grn)
  || ' · new columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'store_grn_lines'
       and column_name in ('basic', 'disc', 'disc_pct', 'disc_on', 'bill_disc', 'net_rate')) or (table_name = 'store_grn' and column_name in ('basic', 'disc', 'bill_disc', 'bill_disc_pct', 'bill_disc_on')))) || ' of 11' as done;
