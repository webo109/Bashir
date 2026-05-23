# Bashir

> بشير — "bearer of good news." A personal email triage agent across Nova's 5–6 Gmail accounts. Classifies, surfaces, archives. Read-only V1.

**Cost target: $0 strictly. Classification runs on the Claude Max subscription you already pay for — there is no Anthropic API key, no per-token billing.**

## What it does

Every morning Bashir reads new emails across every authorized inbox, classifies each into one of five categories (`reply_today`, `important_fyi`, `opportunities`, `diploma_learning`, `archive`), and writes the result to Supabase. The dashboard surfaces what matters, archives the noise, and once a month spits out an analytics report with suggested senders to block.

Bashir does not reply. V1 is read-only.

## Architecture

```
Gmail accounts                                          Supabase
     │                                                     ▲
     ▼                                                     │
scripts/fetch.py  →  tmp/pending.jsonl                     │
                          │                                │
                          ▼                                │
                  Claude reads + classifies                │
                  per prompts/triage.md                    │
                          │                                │
                          ▼                                │
                  tmp/classifications.jsonl                │
                          │                                │
                          ▼                                │
                  scripts/persist.py  ────────────────────►┘
                          │
                          └─► reply_today nudge email (Gmail API)
```

Python does the deterministic glue: fetch from Gmail, write/read JSONL, persist to Supabase, send the nudge. **Claude itself does the classification step**, inside the Claude Code Routine (Max subscription) — no paid API.

- **Daily routine** — 7am Muscat. Delta sync via Gmail History API.
- **Monthly routine** — 1st of month. Analytics → `monthly_reports`.
- **Backfill** — local, one-time. Run Claude Code in this repo and tell it to backfill.

## Initial setup

### 1. Supabase
Open the Supabase SQL editor for your project → New query → paste `sql/schema.sql` → Run. Confirm five tables exist: `accounts`, `emails`, `classifications`, `monthly_reports`, `run_log`.

Also apply `sql/unsubscribe.sql` (V1.2 migration) if you want in-app unsubscribe support.

Optional: paste `sql/perf_indexes.sql` to speed up archive search at scale (adds `pg_trgm` GIN indexes on `subject`, `from_email`, `from_name`). Recommended once the inbox crosses a few thousand rows.

### 2. Google Cloud OAuth
1. https://console.cloud.google.com → create project "Bashir".
2. APIs & Services → Library → enable **Gmail API**.
3. OAuth consent screen → External → fill required fields → add your own Gmail addresses as "test users" (one per inbox you'll authorize).
4. Credentials → Create OAuth client → Desktop app (or Web app + add `http://localhost:8765/oauth/callback` as a redirect URI).
5. Copy the client ID + secret into `.env`.

### 3. Python env
```powershell
cd Bashir
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 4. Authorize each Gmail account
For each inbox Bashir will read:
```powershell
python scripts/oauth_setup.py
```
A browser opens, you pick a Google account and consent. The refresh token is saved to `accounts`. Repeat per inbox.

### 5. Notification target
Set `NOTIFY_TO_EMAIL` (where you receive the daily nudge) and `NOTIFY_FROM_EMAIL` (one of the authorized accounts Bashir sends from) in `.env`.

### 6. Backfill (last 12 months)
Open this repo in Claude Code locally. Tell Claude:
> Do a 12-month backfill for nova@example.com.

Claude will follow the steps in `CLAUDE.md` — loop over `python scripts/fetch.py backfill <email> --limit 50` → classify the batch → `python scripts/persist.py`, repeating until done. Runs on the Max subscription. Resumable — already-ingested emails are skipped.

### 7. Refresh unsubscribe metadata
Once per backfill (and the daily routine handles this automatically going forward):
```powershell
python scripts/refresh_unsubscribe.py
```

### 8. Tune the prompt
1. Expand `evals/cases.jsonl` to 30–50 hand-labeled examples (file ships with 5 to show the format).
2. In Claude Code locally, ask Claude to classify the cases into `evals/_classifications.jsonl` per `prompts/triage.md`.
3. `python evals/run.py` — prints a confusion matrix.
4. Edit `prompts/triage.md` if accuracy on `reply_today` or `opportunities` < 85%, or archive leak > 5%.
5. Bump the `version:` line in `prompts/triage.md` and `PROMPT_VERSION` in `.env` after meaningful changes.

### 9. Schedule the routines
In Claude Code with this repo open:
```
/schedule create
```
Configure two:
- **Daily** at 07:00 Muscat. Prompt: `Run Bashir's daily routine per CLAUDE.md.`
- **Monthly** on the 1st at 08:00 Muscat. Prompt: `Run Bashir's monthly routine per CLAUDE.md.`

In the routine environment settings, add the `.env` variables and confirm network access to `googleapis.com` and `*.supabase.co`.

## How a daily run looks (under the hood)

1. Routine fires. Claude reads `CLAUDE.md`.
2. Claude runs `python scripts/fetch.py daily`. Python writes new emails to `tmp/pending.jsonl` and updates `last_history_id` per account.
3. Claude reads `prompts/triage.md` + `tmp/pending.jsonl`.
4. Claude classifies each email in its own context and writes `tmp/classifications.jsonl`.
5. Claude runs `python scripts/persist.py`. Python inserts rows, sends the nudge if `reply_today` is non-empty, cleans `tmp/`.
6. Claude reports the counts back.

## Layout

```
Bashir/
├── README.md          — this file
├── CLAUDE.md          — instructions Claude follows in routines + local runs
├── .env / .env.example
├── requirements.txt
├── sql/schema.sql
├── prompts/triage.md  — Bashir's classification rules (versioned)
├── lib/
│   ├── config.py
│   ├── supabase_client.py
│   ├── gmail.py
│   ├── batching.py    — fetch/classify/persist JSONL handoff
│   └── notifier.py
├── scripts/
│   ├── oauth_setup.py
│   ├── fetch.py       — `daily` or `backfill` mode
│   ├── persist.py
│   └── monthly.py
├── evals/
│   ├── cases.jsonl
│   └── run.py
├── tmp/               — JSONL handoff (gitignored)
└── dashboard/         — Phase 5
```

## Security

- `.env` is `.gitignore`d. Never commit it.
- If this repo lives in OneDrive/iCloud/Dropbox, `.env` will sync to the cloud. Either accept the risk or move the repo outside the synced folder.
- The Supabase **secret** key bypasses RLS — treat like a root password. Rotate immediately if it ever appears in chat, screenshots, or logs.
- The dashboard (Phase 5) must ship with Supabase Auth gated to your single email on day 1.

## Cost

**$0 strictly**, given an existing Claude Max subscription:
- Routines run on Anthropic infra under Max — included.
- Supabase free tier — well under thresholds.
- Vercel free tier (for the dashboard, Phase 5) — well under thresholds.
- **No Anthropic API key is used.** Classification happens in Claude's own context inside the routine.

The only cost surface is rate limits: Max routines are 15 runs/day (we use 2), Max sessions have a 5-hour rolling window for local backfill.

## V1.1+

- One-tap reply suggestions in the dashboard.
- Block-sender export to Gmail filters.
- Eventually (V2): give Bashir reply permissions for specific categories.
