"""Persist classified emails to Supabase + send reply_today nudge.

Reads tmp/pending.jsonl (from fetch.py) and tmp/classifications.jsonl
(written by Claude) and:
  - inserts the email rows
  - inserts the classification rows (UNIQUE on email_id + prompt_version)
  - sends one nudge email if any reply_today
  - clears the tmp files
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import batching, notifier, supabase_client  # noqa: E402


def main() -> None:
    messages = batching.read_pending()
    classifications = batching.read_classifications()

    if not messages:
        print("tmp/pending.jsonl is empty — nothing to persist.")
        return

    if not classifications:
        print("ERROR: tmp/classifications.jsonl is empty.")
        print("Claude has not written classifications yet. Run the classify step first.")
        sys.exit(1)

    # Group messages by account so each account is one run_log row.
    by_account: dict[int, list[dict]] = {}
    for m in messages:
        by_account.setdefault(m["account_id"], []).append(m)

    total_persisted = 0
    nudge_payload = []
    for account_id, msgs in by_account.items():
        run_id = supabase_client.start_run("persist", msgs[0].get("account_email"))
        try:
            # Only classifications matching these messages
            local_class = {m["gmail_msg_id"]: classifications[m["gmail_msg_id"]]
                           for m in msgs if m["gmail_msg_id"] in classifications}
            missing = len(msgs) - len(local_class)
            if missing:
                print(f"[{msgs[0]['account_email']}] WARNING: {missing} message(s) missing classifications")

            count, reply_today = batching.persist_emails_and_classifications(msgs, local_class)
            total_persisted += count
            nudge_payload.extend(reply_today)
            supabase_client.finish_run(run_id, "success", count)
        except Exception as e:
            supabase_client.finish_run(run_id, "error", 0, str(e))
            raise

    print(f"Persisted {total_persisted} email(s).")

    if nudge_payload:
        sent = notifier.send_reply_today_nudge(nudge_payload)
        print(f"reply_today: {len(nudge_payload)} item(s). nudge sent={sent}")
    else:
        print("reply_today: 0. no nudge.")

    batching.clear_handoff()
    print("Cleaned tmp/.")


if __name__ == "__main__":
    main()
