-- =====================================================================
-- RCL ERP – STORE step 10: the site's copy of a PURCHASE ORDER of the Purchase Department (10-11-2026, Purchase Phase 2).
-- The owner's decisions: D-2 (confirmed again 09-11-2026) – the PO's MASTER copy is kept in Purchase (the Purchase Supabase, every
-- site in one); the SITE keeps a copy in its own Store, written ONLY through the Store's own server (api/purpo.js – a signed call of
-- Purchase's server); an older revision never overwrites a newer one. G-6 – no extra PO approval after the comparative statement's
-- final approval: the copy comes approved (the site's own PO approval and verification do not stop it). The site's GRNs and bills
-- use the copy as any PO (each GRN lowers its balance); the copy carries each line's requirement and line, so what is still to order
-- of a requirement falls by itself. The site cannot change, cancel or delete a Purchase PO.
-- Run ONCE in EVERY site's Supabase project (VTR NH 848, 18B KOLHAPUR, HEAD OFFICE, …), AFTER the Store's steps 1–9.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again: it only ADDS three empty columns to store_po, one index and two
-- functions. No existing row, column, function, rule or stock figure is changed; a PO of before stays exactly as it is.
-- Until it is run at a site, Purchase's POs of that site stay in Purchase as "Not yet at the site" (Send again works after it).
--
--   store_po.pur_no    Purchase's PO number (PO-0001 …) – the mark that the PO is Purchase's (read-only at the site); its unique index
--                      keeps ONE copy of a Purchase PO at a site (a copy sent twice is the same copy)
--   store_po.pur_rev   the revision of Purchase's PO the copy is (1 now; a later revision – an amendment – comes later): an older
--                      revision never overwrites a newer one
--   store_po.pur       what Purchase gives that a Store PO has no column for: its number as printed (PO-0001), its CS and enquiry, the
--                      payment terms, the supplier's address / mobile / e-mail / GST no. (Purchase's own supplier list – not in the
--                      site's Vendor Master), who made it in Purchase and when it came; when cancelled: who, when, why
--   store_po_pur_put(row, by, name)          the copy written (made, or the same one again: nothing changes) – one save at a time on
--                      the site, the same check as every PO: a requirement's line never ordered more than asked, only an approved one
--   store_po_pur_cancel(row, note, by, name) the copy cancelled – only while no GRN is made against it (one at a time with the GRN
--                      saves); a PO that never reached the site is kept as Cancelled (a late copy of it then changes nothing)
-- Rollback (only while no Purchase PO is at the site): drop function public.store_po_pur_put(jsonb, text, text);
--   drop function public.store_po_pur_cancel(jsonb, text, text, text); drop index public.store_po_pur_no;
--   alter table public.store_po drop column pur_no, drop column pur_rev, drop column pur;
-- =====================================================================
alter table public.store_po add column if not exists pur_no bigint;
alter table public.store_po add column if not exists pur_rev int;
alter table public.store_po add column if not exists pur jsonb;
create unique index if not exists store_po_pur_no on public.store_po (pur_no) where pur_no is not null;

-- the copy of a Purchase PO written: made with the site's next PO number, approved and Open (G-6 – its "Approved By" is who approved
-- the comparative statement in Purchase); the same Purchase PO and revision
-- again – nothing changes (its number is answered); an older revision than the copy's – nothing changes; a newer one – not yet (an
-- amendment comes later); a cancelled copy stays cancelled. Then the check of every PO (as store_po_put): a requirement's line never
-- ordered more than asked (POs not cancelled), only an approved requirement – "STORE_OVER_ORDER …", "STORE_REQ_NOT_APPROVED …"
-- → { no, rev, result: made | same | older | cancelled }
create or replace function public.store_po_pur_put(p_row jsonb, p_by text, p_name text) returns jsonb language plpgsql set search_path = '' as $$
declare v_pur bigint := nullif(p_row ->> 'pur_no', '')::bigint; v_rev int := coalesce(nullif(p_row ->> 'pur_rev', '')::int, 1);
  v_no bigint; v_has int; v_st text; r record;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if v_pur is null or v_pur < 1 or v_rev < 1 then raise exception 'STORE_PUR_BAD'; end if;
  if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
  select p.no, p.pur_rev, p.status into v_no, v_has, v_st from public.store_po p where p.pur_no = v_pur;
  if v_no is not null then
    if v_st = 'Cancelled' then return jsonb_build_object('no', v_no, 'rev', v_has, 'result', 'cancelled'); end if;
    if coalesce(v_has, 1) = v_rev then return jsonb_build_object('no', v_no, 'rev', v_has, 'result', 'same'); end if;
    if coalesce(v_has, 1) > v_rev then return jsonb_build_object('no', v_no, 'rev', v_has, 'result', 'older'); end if;
    raise exception 'STORE_PUR_AMEND %|%', v_no, v_rev;
  end if;
  loop v_no := public.store_next('PO'); exit when not exists (select 1 from public.store_po where no = v_no); end loop;
  insert into public.store_po (no, date, vendor, vendor_gst, deliver_by, terms, remark, lines, taxable, gst, total, created_by, created_name,
    credit_days, site_contact, ship_to, freight, load_unload, disc, appr, appr_by, appr_name, appr_at, appr_note, wf, status, pur_no, pur_rev, pur)
  values (v_no, (p_row ->> 'date')::date, p_row ->> 'vendor', p_row ->> 'vendor_gst', nullif(p_row ->> 'deliver_by', '')::date, p_row ->> 'terms', p_row ->> 'remark',
    p_row -> 'lines', coalesce((p_row ->> 'taxable')::numeric, 0), coalesce((p_row ->> 'gst')::numeric, 0), coalesce((p_row ->> 'total')::numeric, 0), p_by, p_name,
    null, p_row ->> 'site_contact', p_row ->> 'ship_to', coalesce((p_row ->> 'freight')::numeric, 0), coalesce((p_row ->> 'load_unload')::numeric, 0),
    coalesce((p_row ->> 'disc')::numeric, 0), 'Approved', coalesce(nullif(p_row ->> 'appr_by', ''), p_by), coalesce(nullif(p_row ->> 'appr_name', ''), p_name), now(), nullif(p_row ->> 'appr_note', ''),
    null, 'Open', v_pur, v_rev, p_row -> 'pur');
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
  return jsonb_build_object('no', v_no, 'rev', v_rev, 'result', 'made');
end $$;

-- the copy cancelled (Purchase cancelled its PO): only while no GRN is made against it – "STORE_PO_RECEIVED no"; a closed one is not
-- cancelled – "STORE_PUR_CLOSED no"; cancelled already – nothing changes; never at the site – kept here as Cancelled (with the site's
-- next PO number), so a copy of it arriving late changes nothing → { no, result: cancelled | same }
create or replace function public.store_po_pur_cancel(p_row jsonb, p_note text, p_by text, p_name text) returns jsonb language plpgsql set search_path = '' as $$
declare v_pur bigint := nullif(p_row ->> 'pur_no', '')::bigint; v_no bigint; v_st text; v_pur_j jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rcl-store'));
  if v_pur is null or v_pur < 1 then raise exception 'STORE_PUR_BAD'; end if;
  v_pur_j := coalesce(p_row -> 'pur', '{}'::jsonb) || jsonb_build_object('cancelled', jsonb_build_object('by', p_by, 'name', p_name, 'at', now(), 'why', coalesce(nullif(p_row ->> 'why', ''), p_note)));
  select p.no, p.status into v_no, v_st from public.store_po p where p.pur_no = v_pur;
  if v_no is null then
    if jsonb_typeof(p_row -> 'lines') is distinct from 'array' or jsonb_array_length(p_row -> 'lines') = 0 then raise exception 'STORE_NO_LINES'; end if;
    loop v_no := public.store_next('PO'); exit when not exists (select 1 from public.store_po where no = v_no); end loop;
    insert into public.store_po (no, date, vendor, vendor_gst, deliver_by, terms, remark, lines, taxable, gst, total, created_by, created_name,
      site_contact, ship_to, freight, load_unload, disc, appr, appr_by, appr_name, appr_at, appr_note, status, close_note, updated_by, pur_no, pur_rev, pur)
    values (v_no, (p_row ->> 'date')::date, p_row ->> 'vendor', p_row ->> 'vendor_gst', nullif(p_row ->> 'deliver_by', '')::date, p_row ->> 'terms', p_row ->> 'remark',
      p_row -> 'lines', coalesce((p_row ->> 'taxable')::numeric, 0), coalesce((p_row ->> 'gst')::numeric, 0), coalesce((p_row ->> 'total')::numeric, 0), p_by, p_name,
      p_row ->> 'site_contact', p_row ->> 'ship_to', coalesce((p_row ->> 'freight')::numeric, 0), coalesce((p_row ->> 'load_unload')::numeric, 0),
      coalesce((p_row ->> 'disc')::numeric, 0), 'Approved', coalesce(nullif(p_row ->> 'appr_by', ''), p_by), coalesce(nullif(p_row ->> 'appr_name', ''), p_name), now(), nullif(p_row ->> 'appr_note', ''),
      'Cancelled', p_note, p_by, v_pur,
      coalesce(nullif(p_row ->> 'pur_rev', '')::int, 1), v_pur_j);
    return jsonb_build_object('no', v_no, 'result', 'cancelled');
  end if;
  if v_st = 'Cancelled' then return jsonb_build_object('no', v_no, 'result', 'same'); end if;
  if exists (select 1 from public.store_grn g where g.po_no = v_no) then raise exception 'STORE_PO_RECEIVED %', v_no; end if;
  if v_st <> 'Open' then raise exception 'STORE_PUR_CLOSED %', v_no; end if;
  update public.store_po set status = 'Cancelled', close_note = p_note, updated_by = p_by, pur = coalesce(pur, '{}'::jsonb) || jsonb_build_object('cancelled', v_pur_j -> 'cancelled')
  where no = v_no and status = 'Open';
  return jsonb_build_object('no', v_no, 'result', 'cancelled');
end $$;

revoke all on function public.store_po_pur_put(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.store_po_pur_put(jsonb, text, text) to service_role;
revoke all on function public.store_po_pur_cancel(jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.store_po_pur_cancel(jsonb, text, text, text) to service_role;

notify pgrst, 'reload schema';
select 'Store step 10 done · Purchase POs here ' || (select count(*) from public.store_po where pur_no is not null)
  || ' · new columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_po'
       and column_name in ('pur_no', 'pur_rev', 'pur')) || ' of 3' as done;
