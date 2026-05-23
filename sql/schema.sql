-- Bashir schema v1
-- Apply by pasting into the Supabase SQL editor (Project → SQL).
-- Idempotent: safe to re-run.

create table if not exists accounts (
  id                  serial primary key,
  email               text unique not null,
  oauth_refresh_token text not null,
  -- Gmail History API delta sync cursor. NULL = never synced (first run uses date-range fetch).
  last_history_id     text,
  created_at          timestamptz default now()
);

create table if not exists emails (
  id            serial primary key,
  gmail_msg_id  text unique not null,
  account_id    integer references accounts(id) on delete cascade,
  thread_id     text,
  from_name     text,
  from_email    text,
  subject       text,
  snippet       text,
  body          text,
  received_at   timestamptz,
  gmail_url     text,
  folder        text default 'inbox',          -- 'inbox' or 'sent' (for monthly metrics)
  created_at    timestamptz default now()
);

create table if not exists classifications (
  id              serial primary key,
  email_id        integer references emails(id) on delete cascade,
  category        text not null
                    check (category in (
                      'reply_today',
                      'important_fyi',
                      'opportunities',
                      'diploma_learning',
                      'archive'
                    )),
  summary         text,
  why_priority    text,
  classified_at   timestamptz default now(),
  prompt_version  text not null,
  -- One classification per email per prompt version. Lets us A/B prompts without dupes.
  unique (email_id, prompt_version)
);

create table if not exists monthly_reports (
  id            serial primary key,
  year_month    text unique not null,           -- e.g. '2026-05'
  json_payload  jsonb not null,
  generated_at  timestamptz default now()
);

create table if not exists run_log (
  id                serial primary key,
  script_name       text not null,              -- 'backfill' | 'daily' | 'monthly'
  account_email     text,
  started_at        timestamptz default now(),
  finished_at       timestamptz,
  status            text default 'running',     -- 'running' | 'success' | 'error'
  emails_processed  integer default 0,
  errors            text
);

create index if not exists idx_emails_account_received on emails(account_id, received_at desc);
create index if not exists idx_emails_received           on emails(received_at desc);
create index if not exists idx_classifications_category  on classifications(category);
create index if not exists idx_classifications_email     on classifications(email_id);
create index if not exists idx_runlog_script_started     on run_log(script_name, started_at desc);
