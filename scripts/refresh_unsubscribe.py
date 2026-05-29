"""Populate sender_unsubscribe by fetching List-Unsubscribe headers per sender.

Idempotent. Re-fetches rows older than --stale-days. Safe to run any time.

Usage:
  python scripts/refresh_unsubscribe.py                    # all accounts, all stale
  python scripts/refresh_unsubscribe.py --stale-days 7     # be more aggressive about refresh
  python scripts/refresh_unsubscribe.py --new-senders-only # skip refresh, only fill new gaps
  python scripts/refresh_unsubscribe.py one@gmail.com      # restrict to one account
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import gmail, supabase_client  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("account", nargs="?", help="Restrict to this account email")
    p.add_argument("--stale-days", type=int, default=30)
    p.add_argument("--new-senders-only", action="store_true",
                   help="Skip refresh of existing rows — only fill genuinely missing senders")
    args = p.parse_args()

    # --new-senders-only means "every existing row counts as fresh" → set a
    # very high stale-days so the staleness cutoff lands far in the past and
    # all existing rows are considered fresh. (Earlier this was 10**6 which
    # overflowed timedelta — datetime can't represent dates that far back.)
    stale = 36_500 if args.new_senders_only else args.stale_days  # ~100 years
    pending = supabase_client.get_senders_needing_unsubscribe_refresh(stale_days=stale)
    print(f"{len(pending)} sender(s) need refresh.")
    if not pending:
        return

    # Group by account so we open one Gmail service per account.
    accounts = supabase_client.list_accounts()
    if args.account:
        accounts = [a for a in accounts if a["email"] == args.account]
    if not accounts:
        print("No matching accounts. Run scripts/oauth_setup.py first.")
        sys.exit(1)

    # We need to know which account each gmail_msg_id belongs to.
    db = supabase_client.client()
    msg_ids = [mid for _, mid in pending]
    if not msg_ids:
        return
    rows = db.table("emails").select("gmail_msg_id, account_id").in_("gmail_msg_id", msg_ids).execute().data or []
    msg_to_account = {r["gmail_msg_id"]: r["account_id"] for r in rows}

    grouped: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for addr, mid in pending:
        acct_id = msg_to_account.get(mid)
        if acct_id is not None:
            grouped[acct_id].append((addr, mid))

    run_id = supabase_client.start_run("refresh_unsubscribe")
    processed = 0
    try:
        for account in accounts:
            todo = grouped.get(account["id"], [])
            if not todo:
                continue
            print(f"[{account['email']}] refreshing {len(todo)} sender(s)…")
            service = gmail.build_service(account["oauth_refresh_token"])
            for addr, mid in todo:
                try:
                    url, one_click = gmail.get_unsubscribe_header(service, mid)
                except Exception as e:
                    print(f"  ! {addr} — error: {e}")
                    url, one_click = None, False
                supabase_client.upsert_sender_unsubscribe(addr, url, one_click, mid)
                processed += 1
                if processed % 25 == 0:
                    print(f"  ... {processed}")
        supabase_client.finish_run(run_id, "success", processed)
    except Exception as e:
        supabase_client.finish_run(run_id, "error", processed, str(e))
        raise

    print(f"Done. Updated {processed} sender row(s).")


if __name__ == "__main__":
    main()
