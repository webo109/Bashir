"""Fetch new emails from Gmail into tmp/pending.jsonl.

Two modes:

  python scripts/fetch.py daily
    For each authorized account, use Gmail History API delta sync from
    last_history_id. Falls back to last 24h if cursor is missing/too old.
    Used by the daily routine.

  python scripts/fetch.py backfill [account_email] [--months 12]
    Fetch the last N months of inbox + sent for the given account (or all
    accounts if not specified). Used by the one-time local backfill.

In both cases:
- Already-ingested emails (UNIQUE on gmail_msg_id) are skipped.
- Output: tmp/pending.jsonl, one parsed email per line.
- Stdout: count fetched per account, ready for Claude to classify next.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import batching, gmail, supabase_client  # noqa: E402


def fetch_daily_for_account(account: dict) -> tuple[list[dict], str]:
    """Returns (new_parsed_messages, latest_history_id)."""
    email = account["email"]
    service = gmail.build_service(account["oauth_refresh_token"])

    new_ids: list[str] = []
    latest_history_id = None
    if account.get("last_history_id"):
        new_ids, latest_history_id = gmail.list_history(service, account["last_history_id"])
        if latest_history_id is None:
            print(f"[{email}] history id too old, falling back to 24h date range")
    if latest_history_id is None:
        after = datetime.now(timezone.utc) - timedelta(hours=24)
        new_ids = list(gmail.list_since(service, after, folder="inbox"))
        latest_history_id = gmail.get_current_history_id(service)

    existing = supabase_client.existing_gmail_ids(new_ids)
    new_ids = [i for i in new_ids if i not in existing]
    if not new_ids:
        return [], latest_history_id

    parsed = [gmail.get_message(service, mid) for mid in new_ids]
    for m in parsed:
        m["account_id"] = account["id"]
        m["account_email"] = email
    return parsed, latest_history_id


def fetch_backfill_for_account(account: dict, months: int) -> list[dict]:
    email = account["email"]
    service = gmail.build_service(account["oauth_refresh_token"])
    after = datetime.now(timezone.utc) - timedelta(days=30 * months)
    parsed_all: list[dict] = []

    for folder in ("inbox", "sent"):
        print(f"[{email}] listing {folder} since {after.date()}…")
        ids = list(gmail.list_since(service, after, folder=folder))
        existing = supabase_client.existing_gmail_ids(ids)
        new_ids = [i for i in ids if i not in existing]
        print(f"[{email}] {len(new_ids)}/{len(ids)} new {folder} messages")
        for mid in new_ids:
            m = gmail.get_message(service, mid)
            m["account_id"] = account["id"]
            m["account_email"] = email
            parsed_all.append(m)

    # Also stash the current history id so daily.py can pick up cleanly.
    try:
        current = gmail.get_current_history_id(service)
        supabase_client.update_history_id(account["id"], current)
    except Exception as e:
        print(f"[{email}] warning: could not update history id: {e}")
    return parsed_all


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["daily", "backfill"])
    p.add_argument("account", nargs="?", help="Email address (backfill only). Omit to process all.")
    p.add_argument("--months", type=int, default=12, help="Backfill window in months (default 12)")
    p.add_argument("--limit", type=int, default=None, help="Cap total emails (useful for testing)")
    args = p.parse_args()

    accounts = supabase_client.list_accounts()
    if args.mode == "backfill" and args.account:
        accounts = [a for a in accounts if a["email"] == args.account]
    if not accounts:
        print("No matching accounts. Run scripts/oauth_setup.py first.")
        sys.exit(1)

    # Truncate pending.jsonl so this is a clean handoff.
    batching.clear_handoff()
    total = 0

    for acct in accounts:
        run_id = supabase_client.start_run(f"fetch_{args.mode}", acct["email"])
        try:
            if args.mode == "daily":
                parsed, latest_hist = fetch_daily_for_account(acct)
                supabase_client.update_history_id(acct["id"], latest_hist)
            else:
                parsed = fetch_backfill_for_account(acct, args.months)

            if args.limit is not None and total + len(parsed) > args.limit:
                parsed = parsed[: max(0, args.limit - total)]

            if parsed:
                batching.write_pending(parsed, append=True)
            total += len(parsed)
            print(f"[{acct['email']}] wrote {len(parsed)} pending")
            supabase_client.finish_run(run_id, "success", len(parsed))

            if args.limit is not None and total >= args.limit:
                break
        except Exception as e:
            supabase_client.finish_run(run_id, "error", 0, str(e))
            raise

    print(f"\nTotal pending: {total} -> {batching.config.PENDING_PATH}")
    if total == 0:
        print("Nothing to classify. (Tip: this is normal if no new mail since last run.)")


if __name__ == "__main__":
    main()
