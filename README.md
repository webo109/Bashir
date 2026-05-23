# Bashir

> بشير — "bearer of good news." A personal email triage agent across Nova's 5–6 Gmail accounts. Classifies, surfaces, archives. Read-only V1.

Cost target: **$0 on top of an existing Claude Max subscription.**

## What it does

Every morning Bashir reads new emails across every authorized inbox, classifies each into one of five categories (`reply_today`, `important_fyi`, `opportunities`, `diploma_learning`, `archive`), and writes the result to Supabase. The dashboard surfaces what matters, archives the noise, and once a month spits out an analytics report with suggested senders to block.

Bashir does not reply. V1 is read-only.

## Architecture

```
Gmail accounts ──► scripts/{backfill,daily}.py ──► Claude (classifier.py) ──► Supabase
                                                                                │
                                  ┌─────────────────────────────────────────────┤
                                  ▼                                             ▼
                         scripts/monthly.py                          dashboard/ (Lovable → Vercel)
```

- `backfill.py` — local, one-time. Last 12 months of inbox + sent per account.
- `daily.py` — Claude Code Remote Routine, 7am Muscat daily. Delta sync via Gmail History API. Sends a nudge email if anything lands in `reply_today`.
- `monthly.py` — Claude Code Remote Routine, 1st of month. Writes analytics to `monthly_reports`.

## Initial setup

You need to do these in order, once. Steps 1–3 are clicks; everything after is `python …`.

### 1. Supabase
1. Open https://yrmycgebhqlwptflkceb.supabase.co → SQL editor → New query.
2. Paste the contents of `sql/schema.sql` and run.
3. Confirm five tables exist: `accounts`, `emails`, `classifications`, `monthly_reports`, `run_log`.

### 2. Google Cloud OAuth
1. https://console.cloud.google.com → create project "Bashir".
2. APIs & Services → Library → enable **Gmail API**.
3. OAuth consent screen → External → fill required fields → add your own Gmail addresses as "test users" (one per inbox you'll authorize).
4. Credentials → Create credentials → OAuth client ID → Desktop app or Web app.
   - If Web: add `http://localhost:8765/oauth/callback` as an authorized redirect URI.
5. Copy the client ID + secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

### 3. Anthropic API key
- Get a key at https://console.anthropic.com and paste it into `.env` (`ANTHROPIC_API_KEY`).
- (The Max subscription covers Claude Code Routines runs; the API key here is used by Python scripts that call the Claude API directly. If you only run scripts via Claude Code itself, you can leave this empty — see "Two ways to invoke" below.)

### 4. Python env
```powershell
cd Bashir
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 5. Authorize each Gmail account
For each inbox you want Bashir to read:
```powershell
python scripts/oauth_setup.py
```
A browser opens, you pick a Google account and consent. The refresh token is saved to the `accounts` table. Repeat for each of the 5–6 inboxes.

### 6. Backfill (last 12 months)
```powershell
python scripts/backfill.py                 # all authorized accounts
python scripts/backfill.py one@gmail.com   # just one
```
Safe to interrupt and resume — already-processed emails are skipped via `UNIQUE(gmail_msg_id)`.

### 7. Tune the prompt
1. Add 30–50 labeled examples to `evals/cases.jsonl` (the file ships with 5 examples to show the format).
2. `python evals/run.py` — prints a confusion matrix.
3. Edit `prompts/triage.md` if accuracy on `reply_today` or `opportunities` < 85%, or archive leak > 5%.
4. Bump the `version:` line in `prompts/triage.md` and `PROMPT_VERSION` in `.env` if you make a meaningful change.

### 8. Notification target
Set `NOTIFY_TO_EMAIL` (where you'll receive the daily nudge) and `NOTIFY_FROM_EMAIL` (one of the authorized Gmail accounts Bashir will send the nudge from) in `.env`.

### 9. Set up the routines
In Claude Code with this repo open:
```
/schedule create
```
Configure two:
- **Daily** at 07:00 Muscat (Asia/Muscat). Prompt: `Run python scripts/daily.py and report the result.`
- **Monthly** on the 1st at 08:00 Muscat. Prompt: `Run python scripts/monthly.py and report the result.`

In the routine environment settings, add all the variables from `.env` and confirm `googleapis.com`, `*.supabase.co`, and `api.anthropic.com` are reachable (default "Trusted" network policy covers these).

## Two ways to invoke

Each script (`daily.py`, `monthly.py`) is plain Python and works standalone. The Claude Code Routine just runs `python scripts/…` via Bash. This means:

- **Determinism:** Claude is in the loop only for the classification call inside `lib/classifier.py`. The orchestration is deterministic Python — no LLM-driven control flow.
- **Local testing:** any time, you can run `python scripts/daily.py` locally to debug.

## Layout

```
Bashir/
├── README.md         — this file
├── CLAUDE.md         — instructions for the routine
├── .env / .env.example
├── requirements.txt
├── sql/schema.sql
├── prompts/triage.md — Bashir's system prompt (versioned)
├── lib/
│   ├── config.py
│   ├── supabase_client.py
│   ├── gmail.py
│   ├── classifier.py
│   ├── batching.py
│   └── notifier.py
├── scripts/
│   ├── oauth_setup.py
│   ├── backfill.py
│   ├── daily.py
│   └── monthly.py
├── evals/
│   ├── cases.jsonl
│   └── run.py
└── dashboard/        — Phase 5, generated from Lovable then iterated in Claude Code
```

## Security notes

- `.env` is `.gitignore`d. Never commit it.
- If you're storing this repo in OneDrive/iCloud/Dropbox, your `.env` will sync to the cloud. Either accept that risk or move the repo outside the synced folder.
- Supabase secret key bypasses RLS — treat like a root password.
- The dashboard (Phase 5) must ship with Supabase Auth gated to your single email on day 1.

## Cost reality check

"$0" assumes:
- You already pay for Claude Max (which covers Routines).
- Supabase, Vercel free tiers stay below their thresholds (you will).
- Local backfill calls the Anthropic API directly — that does cost real money. With prompt caching and 12-month scope it should be a few dollars total, not hundreds. Watch your console.anthropic.com usage during backfill.

## V1.1+

- One-tap reply suggestions in the dashboard.
- Block-sender export to Gmail filters.
- Eventually (V2): give Bashir reply permissions for specific categories.
