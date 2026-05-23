"""Daily routine: fetch new emails via Gmail History API, classify, persist.

Invoked by Claude Code Remote Routine, 7am Muscat time. Routine prompt:

    Run `python scripts/daily.py` and report the count and any errors.

Behavior:
- For each account, use last_history_id to delta-sync new messages.
- If the history id is missing or too old, fall back to a 24h date range.
- Classify everything through Claude (no pre-filter — design decision).
- If any classifications are reply_today, send one nudge email via notifier.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import batching, gmail, notifier, supabase_client  # noqa: E402


FALLBACK_LOOKBACK_HOURS = 24


def daily_for_account(account: dict) -> list[dict[str, Any]]:
    email = account["email"]
    run_id = supabase_client.start_run("daily", email)
    reply_today_for_nudge: list[dict[str, Any]] = []
    total = 0
    try:
        service = gmail.build_service(account["oauth_refresh_token"])

        new_ids: list[str] = []
        latest_history_id: str | None = None
        if account.get("last_history_id"):
            new_ids, latest_history_id = gmail.list_history(service, account["last_history_id"])
            if latest_history_id is None:
                print(f"[{email}] history id too old, falling back to date range")
        if latest_history_id is None:
            after = datetime.now(timezone.utc) - timedelta(hours=FALLBACK_LOOKBACK_HOURS)
            new_ids = list(gmail.list_since(service, after, folder="inbox"))
            latest_history_id = gmail.get_current_history_id(service)

        # Dedupe against DB.
        existing = supabase_client.existing_gmail_ids(new_ids)
        new_ids = [i for i in new_ids if i not in existing]
        print(f"[{email}] {len(new_ids)} new messages")

        if new_ids:
            parsed = [gmail.get_message(service, mid) for mid in new_ids]
            count, reply_today_ids = batching.process_and_persist(account, parsed)
            total = count
            # Build nudge payload from parsed messages tagged reply_today.
            id_to_msg = {m["gmail_msg_id"]: m for m in parsed}
            reply_today_for_nudge = [
                {
                    "from_name": id_to_msg[mid].get("from_name"),
                    "subject": id_to_msg[mid].get("subject"),
                    "summary": None,  # filled below
                    "gmail_url": id_to_msg[mid].get("gmail_url"),
                }
                for mid in reply_today_ids
                if mid in id_to_msg
            ]

        supabase_client.update_history_id(account["id"], latest_history_id)
        supabase_client.finish_run(run_id, "success", total)
    except Exception as e:
        supabase_client.finish_run(run_id, "error", total, str(e))
        raise
    return reply_today_for_nudge


def main() -> None:
    accounts = supabase_client.list_accounts()
    if not accounts:
        print("No accounts. Run scripts/oauth_setup.py first.")
        sys.exit(1)

    all_reply_today: list[dict[str, Any]] = []
    for a in accounts:
        all_reply_today.extend(daily_for_account(a))

    if all_reply_today:
        sent = notifier.send_reply_today_nudge(all_reply_today)
        print(f"reply_today: {len(all_reply_today)} item(s). nudge sent={sent}")
    else:
        print("reply_today: 0. no nudge.")


if __name__ == "__main__":
    main()
