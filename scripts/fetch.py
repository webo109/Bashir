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


def fetch_backfill_for_account(account: dict, months: int, max_total: int | None = None) -> list[dict]:
    """Backfill the last `months` of inbox+sent for one account.

    If max_total is set, stops both listing and per-message fetches once that many
    new messages have been parsed (FIX-2: caps work for each iteration of the
    documented loop-in-N-chunk pattern).
    """
    email = account["email"]
    service = gmail.build_service(account["oauth_refresh_token"])
    # 12 months ~= 365.25 days. 30*months under-counts by ~5 days at 12 months (NIT-4).
    after = datetime.now(timezone.utc) - timedelta(days=int(months * 30.44))
    parsed_all: list[dict] = []

    for folder in ("inbox", "sent"):
        if max_total is not None and len(parsed_all) >= max_total:
            break
        print(f"[{email}] listing {folder} since {after.date()}…")
        # Stream ids; stop the listing once we know we have enough new ones.
        ids: list[str] = []
        for mid in gmail.list_since(service, after, folder=folder):
            ids.append(mid)
            # Periodically check the dedup set so we can stop early when max_total caps us.
            # We don't know which ids are new until we query Supabase, so we batch
            # and dedup every ~500 ids and break the listing if the cap is hit.
            if max_total is not None and len(ids) >= 500:
                existing = supabase_client.existing_gmail_ids(ids)
                fresh = [i for i in ids if i not in existing]
                # Reset for the next probe round; if we already have enough, stop listing.
                if len(parsed_all) + len(fresh) >= max_total:
                    ids = fresh
                    break
                # Drain what we have so we don't redo work — fetch what we got, then keep listing.
                for nid in fresh:
                    if max_total is not None and len(parsed_all) >= max_total:
                        break
                    m = gmail.get_message(service, nid)
                    m["account_id"] = account["id"]
                    m["account_email"] = email
                    parsed_all.append(m)
                ids = []
                if max_total is not None and len(parsed_all) >= max_total:
                    break

        # Finish the tail: fetch any remaining new ids up to max_total.
        if ids:
            existing = supabase_client.existing_gmail_ids(ids)
            new_ids = [i for i in ids if i not in existing]
            print(f"[{email}] {len(new_ids)}/{len(ids)} new {folder} messages (final batch)")
            for mid in new_ids:
                if max_total is not None and len(parsed_all) >= max_total:
                    break
                m = gmail.get_message(service, mid)
                m["account_id"] = account["id"]
                m["account_email"] = email
                parsed_all.append(m)

    # Also stash the current history id so daily.py can pick up cleanly.
    # (Backfill is bookend-isolated: if we got this far, all listed messages
    # are already buffered in parsed_all — writing the cursor here is safe.)
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
            else:
                # FIX-2: push --limit down so backfill doesn't fetch the full
                # window before trimming. Account for what other accounts already
                # contributed to the global total.
                remaining = None if args.limit is None else max(0, args.limit - total)
                parsed = fetch_backfill_for_account(acct, args.months, max_total=remaining)
                latest_hist = None

            if args.limit is not None and total + len(parsed) > args.limit:
                parsed = parsed[: max(0, args.limit - total)]

            if parsed:
                batching.write_pending(parsed, append=True)
            total += len(parsed)
            print(f"[{acct['email']}] wrote {len(parsed)} pending")

            # FIX-1: in daily mode, defer the cursor update to persist.py via
            # tmp/history_cursor.json — only commit AFTER inserts succeed.
            # If anything between here and persist.py fails, the next run will
            # re-fetch the missed window (dedup by gmail_msg_id handles repeats).
            if args.mode == "daily" and latest_hist is not None:
                batching.write_history_cursor(acct["id"], latest_hist)

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
