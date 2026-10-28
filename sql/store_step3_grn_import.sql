-- =====================================================================
-- RCL ERP – STORE, step 3: the OLD INWARD REGISTER imported with its own GRN numbers (28-10-2026, his file "INWARD UPTO GRN …":
-- "je GRN number chalu aahet tech continue hotil … next GRN ata jo continue ahe tyach pudhcha auto yeil"; his answer: the file's GRN
-- No kept as it is – a supplier / date / invoice of one GRN No its own GRN, the number shown as in the file, "342-A" too).
-- Run ONCE in EVERY site's Supabase project (the same project as that site's Mechanical and the Store's steps 1 and 2): VTR, 18B, HO, …
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely. It only ADDS: a column of store_grn (ref – the GRN No
-- as shown), its index, the vendor's type column of the Vendor Master when that site does not have it yet (empty), and one function
-- (store_grn_import); the GRN save (store_grn_put) is the same as step 2 and now also keeps a new GRN's number as its GRN No.
-- Nothing is deleted; the only data written: ref = the number for the GRNs already there.
--
--   store_grn.ref        the GRN No as shown and printed: a new GRN – its number; an imported GRN – the old register's GRN No
--   store_grn_import     the import of a part of the register (all of the part or none): each GRN gets its GRN No as its number when that
--                        is a whole number not used yet, else a number of its own beyond 1,000,000,000 (its GRN No shown is still the
--                        file's); a GRN without a GRN No gets the next number. Then the next new GRN goes on after the highest GRN No
--                        of the file. The stock checked once for the whole part.
-- Rollback (only while nothing is imported): drop function public.store_grn_import(jsonb,text,text); run store_grn_put of step 2 again;
-- alter table public.store_grn drop column ref. (The vendor's type column is Mechanical's own – it stays.)
-- =====================================================================
alter table public.store_grn add column if not exists ref text;
-- the suppliers of the register go into the site's Vendor Master (Mechanical's vendors, the same database) as "Material Supplier":
-- the column of the vendor's type – the same as Mechanical's sql/supabase_step1p_vendor_type.sql, which not every site has run; only
-- the column is added (empty), no vendor is changed
do $$ begin
  if to_regclass('public.vendors') is not null then alter table public.vendors add column if not exists vendor_type text; end if;
end $$;
update public.store_grn set ref = no::text where ref is null;
create index if not exists store_grn_ref on public.store_grn (ref);

-- a GRN made or changed (as step 2) – a new GRN keeps its number as its GRN No
create or replace function public.store_grn_put(p_no bigint, p_head jsonb, p_lines jsonb, p_by text, p_name text) returns bigint language plpgsql set search_path = '' as $$
declare v_no bigint := p_no; v_old text[] := '{}'; v_new text[];
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'STORE_NO_LINES'; end if;
  if v_no is null then
    loop v_no := public.store_next('GRN'); exit when not exists (select 1 from public.store_grn where no = v_no) and not exists (select 1 from public.store_grn where ref = v_no::text); end loop;
    insert into public.store_grn (no, ref, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, po_no, taxable, gst, tcs, gross, remark, created_by, created_name)
    values (v_no, v_no::text, (p_head ->> 'date')::date, p_head ->> 'supplier', p_head ->> 'challan_no', p_head ->> 'invoice_no', nullif(p_head ->> 'invoice_date', '')::date, p_head ->> 'vehicle_no',
      nullif(p_head ->> 'po_no', '')::bigint, coalesce((p_head ->> 'taxable')::numeric, 0), coalesce((p_head ->> 'gst')::numeric, 0), coalesce((p_head ->> 'tcs')::numeric, 0),
      coalesce((p_head ->> 'gross')::numeric, 0), p_head ->> 'remark', p_by, p_name);
  else
    if not exists (select 1 from public.store_grn where no = v_no) then raise exception 'STORE_GONE'; end if;
    select coalesce(array_agg(distinct code), '{}') into v_old from public.store_grn_lines where grn_no = v_no;
    delete from public.store_grn_lines where grn_no = v_no;
    update public.store_grn set date = (p_head ->> 'date')::date, supplier = p_head ->> 'supplier', challan_no = p_head ->> 'challan_no', invoice_no = p_head ->> 'invoice_no',
      invoice_date = nullif(p_head ->> 'invoice_date', '')::date, vehicle_no = p_head ->> 'vehicle_no', po_no = nullif(p_head ->> 'po_no', '')::bigint,
      taxable = coalesce((p_head ->> 'taxable')::numeric, 0), gst = coalesce((p_head ->> 'gst')::numeric, 0), tcs = coalesce((p_head ->> 'tcs')::numeric, 0),
      gross = coalesce((p_head ->> 'gross')::numeric, 0), remark = p_head ->> 'remark', ref = coalesce(ref, v_no::text), updated_by = p_by where no = v_no;
  end if;
  insert into public.store_grn_lines (grn_no, line, code, name, unit, qty, rate, taxable, gst_pct, gst, gross, po_line, remark)
    select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.taxable, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.gross, 0), x.po_line, x.remark
    from jsonb_to_recordset(p_lines) as x(line int, code text, name text, unit text, qty numeric, rate numeric, taxable numeric, gst_pct numeric, gst numeric, gross numeric, po_line int, remark text);
  select array_agg(distinct code) into v_new from public.store_grn_lines where grn_no = v_no;
  perform public.store_short(v_old || v_new);
  return v_no;
end $$;

-- a part of the old register imported: [{ head: { ref, date, supplier, …, gross, remark }, lines: [...] }] → [{ no, ref }]
create or replace function public.store_grn_import(p_docs jsonb, p_by text, p_name text) returns jsonb language plpgsql set search_path = '' as $$
declare d jsonb; v_no bigint; v_ref text; v_out jsonb := '[]'; v_codes text[] := '{}'; v_max bigint := 0; v_far bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if jsonb_typeof(p_docs) is distinct from 'array' then raise exception 'STORE_NO_LINES'; end if;
  -- the highest whole GRN No of this part first: a GRN without its number then comes after it
  select coalesce(max((x.value -> 'head' ->> 'ref')::bigint), 0) into v_max from jsonb_array_elements(p_docs) x
    where coalesce(x.value -> 'head' ->> 'ref', '') ~ '^[0-9]{1,9}$';
  if v_max > 0 then update public.store_numbers set next_no = greatest(next_no, v_max + 1) where kind = 'GRN'; end if;
  for d in select value from jsonb_array_elements(p_docs) loop
    if jsonb_typeof(d -> 'lines') is distinct from 'array' or jsonb_array_length(d -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
    v_ref := nullif(trim(coalesce(d -> 'head' ->> 'ref', '')), '');
    if v_ref is null then
      loop v_no := public.store_next('GRN'); exit when not exists (select 1 from public.store_grn where no = v_no) and not exists (select 1 from public.store_grn where ref = v_no::text); end loop;
      v_ref := v_no::text;
    elsif v_ref ~ '^[0-9]{1,9}$' and not exists (select 1 from public.store_grn where no = v_ref::bigint) then
      v_no := v_ref::bigint;
    else
      select greatest(coalesce(max(no), 0), 1000000000) + 1 into v_far from public.store_grn where no > 1000000000;
      v_no := v_far;
    end if;
    insert into public.store_grn (no, ref, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, po_no, taxable, gst, tcs, gross, remark, created_by, created_name)
    values (v_no, v_ref, (d -> 'head' ->> 'date')::date, d -> 'head' ->> 'supplier', d -> 'head' ->> 'challan_no', d -> 'head' ->> 'invoice_no', nullif(d -> 'head' ->> 'invoice_date', '')::date,
      d -> 'head' ->> 'vehicle_no', null, coalesce((d -> 'head' ->> 'taxable')::numeric, 0), coalesce((d -> 'head' ->> 'gst')::numeric, 0), coalesce((d -> 'head' ->> 'tcs')::numeric, 0),
      coalesce((d -> 'head' ->> 'gross')::numeric, 0), d -> 'head' ->> 'remark', p_by, p_name);
    insert into public.store_grn_lines (grn_no, line, code, name, unit, qty, rate, taxable, gst_pct, gst, gross, po_line, remark)
      select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.taxable, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.gross, 0), null, x.remark
      from jsonb_to_recordset(d -> 'lines') as x(line int, code text, name text, unit text, qty numeric, rate numeric, taxable numeric, gst_pct numeric, gst numeric, gross numeric, remark text);
    v_codes := v_codes || array(select distinct x ->> 'code' from jsonb_array_elements(d -> 'lines') x);
    v_out := v_out || jsonb_build_array(jsonb_build_object('no', v_no, 'ref', v_ref));
  end loop;
  perform public.store_short(array(select distinct unnest(v_codes)));
  return v_out;
end $$;

revoke all on function public.store_grn_import(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.store_grn_import(jsonb, text, text) to service_role;
revoke all on function public.store_grn_put(bigint, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.store_grn_put(bigint, jsonb, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
select 'Store step 3 done · GRN ' || (select count(*) from public.store_grn) || ' · next GRN ' || (select next_no from public.store_numbers where kind = 'GRN') as done;
