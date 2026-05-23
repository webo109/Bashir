"""Batch + persist logic shared by backfill and daily."""
from __future__ import annotations

from typing import Iterable, Iterator

from . import classifier, config, supabase_client


BATCH_SIZE = 50


def chunks(seq: list, n: int) -> Iterator[list]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def filter_unseen(messages: list[dict]) -> list[dict]:
    """Drop messages whose gmail_msg_id is already in the DB."""
    if not messages:
        return []
    ids = [m["gmail_msg_id"] for m in messages]
    seen = supabase_client.existing_gmail_ids(ids)
    return [m for m in messages if m["gmail_msg_id"] not in seen]


def process_and_persist(account: dict, messages: list[dict]) -> tuple[int, list[str]]:
    """For one account's batch of parsed messages: insert emails, classify, write classifications.

    Returns (count_processed, reply_today_gmail_ids).
    """
    if not messages:
        return 0, []

    # Tag with account_id + account_email for downstream steps.
    account_email = account["email"]
    account_id = account["id"]
    for m in messages:
        m["account_id"] = account_id
        m["account_email"] = account_email

    # Persist emails first so we have email_id to attach classifications to.
    rows_to_insert = [
        {
            "gmail_msg_id": m["gmail_msg_id"],
            "account_id": m["account_id"],
            "thread_id": m.get("thread_id"),
            "from_name": m.get("from_name"),
            "from_email": m.get("from_email"),
            "subject": m.get("subject"),
            "snippet": m.get("snippet"),
            "body": m.get("body"),
            "received_at": m.get("received_at"),
            "gmail_url": m.get("gmail_url"),
            "folder": m.get("folder", "inbox"),
        }
        for m in messages
    ]
    inserted = supabase_client.insert_emails(rows_to_insert)

    # Map gmail_msg_id → email_id (upsert returns the rows incl. ids).
    id_map = {row["gmail_msg_id"]: row["id"] for row in inserted}

    # Inbox emails get classified; sent items are stored but not classified.
    to_classify = [m for m in messages if m.get("folder", "inbox") == "inbox"]

    reply_today: list[str] = []
    for batch in chunks(to_classify, BATCH_SIZE):
        results = classifier.classify_batch(batch)
        rows = []
        for r in results:
            gid = r.get("gmail_msg_id")
            email_id = id_map.get(gid)
            if not email_id or not r.get("category"):
                continue
            rows.append(
                {
                    "email_id": email_id,
                    "category": r["category"],
                    "summary": r.get("summary"),
                    "why_priority": r.get("why_priority"),
                    "prompt_version": config.PROMPT_VERSION,
                }
            )
            if r["category"] == "reply_today":
                reply_today.append(gid)
        supabase_client.insert_classifications(rows)

    return len(messages), reply_today
