-- =====================================================================
-- RCL ERP – STORE step 9: the workflow of the purchase orders, the GRNs, the issues and the returns – their verification, their
-- approval and Head Office's check (29-10-2026, his words: "pratek kamamadhe … entry krnarana to verification la pathawel …
-- verification kel tr te auto jyanche kadhe approval aahe tyanche kade jail … approval zal ki te direct head office la jail … he sagle
-- kam super admin swatache portel madhun krel"; "pratek task approval nantr HO la nahi janar – konte jail konte nahi jail te super
-- admin tharau shakel"; "standard ERP level je universal aste")
-- Run once in EVERY site's Supabase → SQL Editor (VTR NH 848, 18B KOLHAPUR, HEAD OFFICE, …), after the Store's steps 1–8.
-- Safe to run again. It only ADDS one empty column, wf, to four tables (and a small index on each):
--   store_po      a PO's verification before its approval (its approval stays where it is – appr, appr_by …)
--   store_grn     a GRN's (the supplier's bill's) verification, approval and Head Office's check
--   store_issue   an issue's verification, approval and Head Office's check
--   store_return  a return's verification, approval and Head Office's check
-- wf = { state: verify | approve | done | returned, by, at, steps: [{ step, ok, email, name, at, note }], ho: true, hoOk: { email, name,
-- at, note } } – empty (null) for every row of before and for a paper nobody verifies or approves: as before.
-- No existing row, column, function, rule or stock figure is changed: a GRN, an issue or a return counts in the stock when it is saved,
-- as always – the workflow is the papers' sign-off.
-- Until it is run the Store works as before (no verification of POs, GRNs and issues; the requirements' verification works already).
-- Rollback (only while nobody used it): drop index public.store_po_wf, public.store_grn_wf, public.store_issue_wf, public.store_return_wf;
--   alter table public.store_po drop column wf; alter table public.store_grn drop column wf; alter table public.store_issue drop column wf;
--   alter table public.store_return drop column wf;
-- =====================================================================
alter table public.store_po add column if not exists wf jsonb;
alter table public.store_grn add column if not exists wf jsonb;
alter table public.store_issue add column if not exists wf jsonb;
alter table public.store_return add column if not exists wf jsonb;

-- what waits (to verify / to approve) and what Head Office is to check – found without reading every row
create index if not exists store_po_wf on public.store_po ((wf ->> 'state')) where wf is not null;
create index if not exists store_grn_wf on public.store_grn ((wf ->> 'state')) where wf is not null;
create index if not exists store_issue_wf on public.store_issue ((wf ->> 'state')) where wf is not null;
create index if not exists store_return_wf on public.store_return ((wf ->> 'state')) where wf is not null;

notify pgrst, 'reload schema';
select 'Store step 9 done · columns wf ' || (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'wf'
     and table_name in ('store_po', 'store_grn', 'store_issue', 'store_return')) || ' of 4' as done;
