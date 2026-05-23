-- V1.2 — adds in-app unsubscribe support.
-- Apply by pasting into the Supabase SQL editor. Idempotent.

create table if not exists sender_unsubscribe (
  from_email      text primary key,
  unsubscribe_url text,
  one_click       boolean default false,
  source_msg_id   text,
  updated_at      timestamptz default now()
);
create index if not exists idx_sender_unsubscribe_updated on sender_unsubscribe(updated_at desc);
