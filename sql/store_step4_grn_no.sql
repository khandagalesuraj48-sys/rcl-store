-- =====================================================================
-- RCL ERP – STORE, step 4 (28-10-2026, asked: "new grn kartana new grn number auto yeil ok ani manually pn edit krta yeil")
-- A NEW GRN WITH THE GRN NO TYPED IN ITS FORM. The form shows the next number by itself; it can be changed by hand. Saved in one go
-- with the GRN (all or nothing):
--   * a whole number not used yet (as a GRN's number or as its GRN No) is the GRN's number – and the next new GRN goes on after it
--     when it is higher than the next one;
--   * any other GRN No ("342-A") is kept as typed and shown and printed; the GRN gets a number of its own beyond 1,000,000,000
--     (the same as the register's import of step 3);
--   * a GRN No already used: refused (STORE_REF_USED) – nothing saved;
--   * nothing typed: the next number (as before).
-- Run once in EVERY site's Supabase → SQL Editor → New query → paste → Run (after step 3). It only ADDS a function: no table, no row is
-- changed. It can be run twice.
-- Rollback: drop function public.store_grn_new(jsonb, jsonb, text, text, text);
-- =====================================================================
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
  insert into public.store_grn (no, ref, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, po_no, taxable, gst, tcs, gross, remark, created_by, created_name)
  values (v_no, v_ref, (p_head ->> 'date')::date, p_head ->> 'supplier', p_head ->> 'challan_no', p_head ->> 'invoice_no', nullif(p_head ->> 'invoice_date', '')::date, p_head ->> 'vehicle_no',
    nullif(p_head ->> 'po_no', '')::bigint, coalesce((p_head ->> 'taxable')::numeric, 0), coalesce((p_head ->> 'gst')::numeric, 0), coalesce((p_head ->> 'tcs')::numeric, 0),
    coalesce((p_head ->> 'gross')::numeric, 0), p_head ->> 'remark', p_by, p_name);
  insert into public.store_grn_lines (grn_no, line, code, name, unit, qty, rate, taxable, gst_pct, gst, gross, po_line, remark)
    select v_no, x.line, x.code, x.name, x.unit, x.qty, coalesce(x.rate, 0), coalesce(x.taxable, 0), x.gst_pct, coalesce(x.gst, 0), coalesce(x.gross, 0), x.po_line, x.remark
    from jsonb_to_recordset(p_lines) as x(line int, code text, name text, unit text, qty numeric, rate numeric, taxable numeric, gst_pct numeric, gst numeric, gross numeric, po_line int, remark text);
  select array_agg(distinct code) into v_new from public.store_grn_lines where grn_no = v_no;
  perform public.store_short(v_new);
  return v_no;
end $$;

revoke all on function public.store_grn_new(jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.store_grn_new(jsonb, jsonb, text, text, text) to service_role;

notify pgrst, 'reload schema';
select 'Store step 4 done · next GRN ' || (select next_no from public.store_numbers where kind = 'GRN') as done;
