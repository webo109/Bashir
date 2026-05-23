# Instructions for Claude when running Bashir

Bashir's classifications are done **by you, the Claude in this session**, using
your Max subscription — not by calling the Anthropic API. The Python scripts
handle Gmail fetching and Supabase writes. You handle reading emails and
writing the JSON file of classifications between those two steps.

## Where to find things
- `prompts/triage.md` — the rules you classify by (read this first every run).
- `tmp/pending.jsonl` — emails to classify (one per line). Written by `scripts/fetch.py`.
- `tmp/classifications.jsonl` — your output (one per line). Read by `scripts/persist.py`.

## Daily routine
> Triggered by Claude Code Routine at 07:00 Muscat / 03:00 UTC.

Steps:
1. Run `python scripts/fetch.py daily`. Note the total pending count it prints. If 0, skip to step 5.
2. Read `prompts/triage.md`.
3. Read `tmp/pending.jsonl`. Classify each email per the rules. Write one JSON object per line to `tmp/classifications.jsonl` with fields:
   ```
   {"gmail_msg_id": "...", "category": "...", "summary": "...", "why_priority": "..."}
   ```
   For `archive`, `summary` and `why_priority` may be `null`.
4. Run `python scripts/persist.py`.
5. Run `python scripts/refresh_unsubscribe.py --new-senders-only` to enrich any newly-seen senders with List-Unsubscribe URLs (fast — only touches senders without a row yet).
6. Report: total emails, count per category, whether the reply_today nudge was sent.

## Monthly routine
> Triggered by Claude Code Routine on the 1st at 08:00 Muscat / 04:00 UTC.

Steps:
1. Run `python scripts/monthly.py`.
2. Report the row written to `monthly_reports` and any errors.

## Backfill (local, one-time, with Nova present)
1. Run `python scripts/fetch.py backfill nova@example.com --months 12 --limit 50`.
2. Read `prompts/triage.md`, classify per the rules, write `tmp/classifications.jsonl`.
3. Run `python scripts/persist.py`.
4. Repeat steps 1–3 until `scripts/fetch.py` reports 0 pending. Each iteration of step 1 will write the *next* 50 unprocessed emails.

## Evals
1. `cp evals/cases.jsonl tmp/pending.jsonl` (or read cases.jsonl directly).
2. Read `prompts/triage.md`, classify each case, write `evals/_classifications.jsonl`.
3. Run `python evals/run.py` to see the confusion matrix.

## Rules of behavior
- Do not modify code from inside a routine.
- Do not call any external tools beyond running the scripts above.
- Never invent details in `summary` or `why_priority`. If unclear, write "unclear."
- If `scripts/fetch.py` errors, surface the error and stop. The next scheduled run will catch up.
- Always re-read `prompts/triage.md` at the start of each run — its `version:` line is the source of truth.

## Network allowlist for the routine environment
- `googleapis.com`, `gmail.googleapis.com`, `oauth2.googleapis.com`
- `*.supabase.co`

(`api.anthropic.com` is NOT required — Bashir doesn't call the API.)

## Secrets (environment variables on the routine)
All from `.env.example`. There is **no `ANTHROPIC_API_KEY`** — classification is done by Claude itself using the Max subscription that already powers this routine.
