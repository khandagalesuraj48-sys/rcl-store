-- =====================================================================
-- RCL ERP – STORE step 7: a requirement's photos (29-10-2026 – "requirement madhe attachment cha option add karaycha aahe attachment
-- madhe material photo je aahet te user add kru shakel multiple photos … app madhun photo kadhla tri laptop web madhe yeil"; his answers:
-- for the whole requirement, many photos; in the print too)
-- Run once in EVERY site's Supabase → SQL Editor (VTR NH 848, 18B KOLHAPUR, HEAD OFFICE, …), after the Store's steps 1–6.
-- Safe to run again. It only ADDS:
--   1. one column "photos" to store_req – the list of the requirement's photos (the fingerprint, SHA-256, of each, its size, who
--      added it and when); every requirement of before gets an empty list;
--   2. the PRIVATE place for the files (Storage bucket "erp-files") – only if it is not there yet: Mechanical's step 1ze made it in
--      every site (the Log Book's attachments); it is not changed here. A photo is kept ONCE under its fingerprint
--      (store/req/<2>/<sha>.jpg), never overwritten or deleted; it opens only through the app, with a link that works for 15 minutes.
-- No existing column, row, function or rule is changed. Until it is run the Store works as before; adding a photo says this file
-- must be run first.
-- Rollback (only while no requirement has a photo): alter table public.store_req drop column photos;
--   (the bucket erp-files is Mechanical's – it stays).
-- =====================================================================
alter table public.store_req add column if not exists photos jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('erp-files', 'erp-files', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;      -- (there already – Mechanical's step 1ze: kept as it is)

notify pgrst, 'reload schema';
select 'Store step 7 done · requirements ' || (select count(*) from public.store_req)
  || ' · store_req.photos ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_req' and column_name = 'photos')
  || ' · bucket erp-files ' || coalesce((select case when public then 'PUBLIC – run Mechanical''s step 1ze again' else 'private' end from storage.buckets where id = 'erp-files'), 'missing') as done;
