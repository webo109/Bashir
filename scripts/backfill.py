"""One-time backfill: last 12 months of inbox + sent items, per account.

Run locally with Nova present:

    python scripts/backfill.py                # all authorized accounts
    python scripts/backfill.py user@gmail.com # one account

Safe to re-run — already-ingested emails are skipped via UNIQUE(gmail_msg_id).

Strategy:
1. List inbox + sent message IDs received in the last 12 months.
2. Filter to ones not yet in the DB.
3. Fetch each in full, parse, batch-classify, persist.
4. Update last_history_id to current so daily routine has a delta cursor.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import batching, gmail, supabase_client  # noqa: E402


BACKFILL_MONTHS = 12


def backfill_account(account: dict) -> int:
    email = account["email"]
    run_id = supabase_client.start_run("backfill", email)
    total = 0
    try:
        service = gmail.build_service(account["oauth_refresh_token"])
        after = datetime.now(timezone.utc) - timedelta(days=30 * BACKFILL_MONTHS)

        for folder in ("inbox", "sent"):
            print(f"[{email}] listing {folder} since {after.date()}…")
            ids = list(gmail.list_since(service, after, folder=folder))
            print(f"[{email}] found {len(ids)} {folder} message IDs")

            # Filter against DB to skip already-processed.
            unseen = list(supabase_client.existing_gmail_ids(ids))
            unseen_set = set(unseen)
            new_ids = [i for i in ids if i not in unseen_set]
            print(f"[{email}] {len(new_ids)} new {folder} messages to fetch")

            # Process in groups of 50 to keep memory bounded.
            for group in batching.chunks(new_ids, 50):
                parsed = [gmail.get_message(service, mid) for mid in group]
                count, _ = batching.process_and_persist(account, parsed)
                total += count
                print(f"[{email}] processed {total} so far…")

        # Set the history cursor so daily.py can do delta sync from here.
        current = gmail.get_current_history_id(service)
        supabase_client.update_history_id(account["id"], current)
        print(f"[{email}] backfill done. last_history_id={current}, total={total}")
        supabase_client.finish_run(run_id, "success", total)
    except Exception as e:
        supabase_client.finish_run(run_id, "error", total, str(e))
        raise
    return total


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if target:
        acct = supabase_client.get_account_by_email(target)
        if not acct:
            print(f"No account found for {target}. Run scripts/oauth_setup.py first.")
            sys.exit(1)
        backfill_account(acct)
    else:
        accounts = supabase_client.list_accounts()
        if not accounts:
            print("No accounts. Run scripts/oauth_setup.py first.")
            sys.exit(1)
        for a in accounts:
            backfill_account(a)


if __name__ == "__main__":
    main()
