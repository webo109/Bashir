-- FIX-11: trigram indexes for archive search.
-- The dashboard's searchArchive runs leading-wildcard `ilike '%foo%'` against
-- subject / from_email / from_name. Without these indexes Postgres sequentially
-- scans every row in `emails` once data crosses a few thousand messages.
-- pg_trgm + GIN gives sub-linear lookup for arbitrary substring matches.
--
-- Optional but recommended at scale. Paste into Supabase SQL editor once.

create extension if not exists pg_trgm;

create index if not exists idx_emails_subject_trgm
  on emails using gin (subject gin_trgm_ops);

create index if not exists idx_emails_from_email_trgm
  on emails using gin (from_email gin_trgm_ops);

create index if not exists idx_emails_from_name_trgm
  on emails using gin (from_name gin_trgm_ops);
