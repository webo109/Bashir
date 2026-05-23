"""Fetch → classify → persist handoff over JSONL files.

The classify step is done by Claude itself (inside the Claude Code Routine,
or local Claude Code), NOT by calling the Anthropic API. Python's job is
just to move emails through the pipeline.

Files exchanged (paths in `config.PENDING_PATH` / `config.CLASSIFICATIONS_PATH`):

  tmp/pending.jsonl          — one parsed email per line, written by fetch_*.py
  tmp/classifications.jsonl  — one classification per line, written by Claude

Each line of pending.jsonl:
  {gmail_msg_id, account_email, from_name, from_email, subject, snippet,
   body, received_at, gmail_url, folder, thread_id}

Each line of classifications.jsonl (what Claude writes):
  {gmail_msg_id, category, summary, why_priority}
"""
from __future__ import annotations

import json
from typing import Any, Iterable, Iterator

from . import config, supabase_client


# --- pending (fetcher writes, Claude reads) --------------------------------

def write_pending(messages: list[dict[str, Any]], append: bool = False) -> int:
    """Write parsed messages to tmp/pending.jsonl. Returns count written."""
    config.TMP_DIR.mkdir(parents=True, exist_ok=True)
    mode = "a" if append else "w"
    with config.PENDING_PATH.open(mode, encoding="utf-8") as f:
        for m in messages:
            f.write(json.dumps(_pending_record(m), ensure_ascii=False) + "\n")
    return len(messages)


def read_pending() -> list[dict[str, Any]]:
    if not config.PENDING_PATH.exists():
        return []
    return [json.loads(line) for line in config.PENDING_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]


def clear_handoff() -> None:
    for p in (config.PENDING_PATH, config.CLASSIFICATIONS_PATH):
        if p.exists():
            p.unlink()


def _pending_record(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "gmail_msg_id": m["gmail_msg_id"],
        "account_email": m.get("account_email"),
        "account_id": m.get("account_id"),
        "thread_id": m.get("thread_id"),
        "from_name": m.get("from_name"),
        "from_email": m.get("from_email"),
        "subject": m.get("subject"),
        "snippet": m.get("snippet"),
        "body": (m.get("body") or "")[:2000],
        "received_at": m.get("received_at"),
        "gmail_url": m.get("gmail_url"),
        "folder": m.get("folder", "inbox"),
    }


# --- classifications (Claude writes, persister reads) ----------------------

def read_classifications() -> dict[str, dict[str, Any]]:
    """Return a dict keyed by gmail_msg_id."""
    if not config.CLASSIFICATIONS_PATH.exists():
        return {}
    out: dict[str, dict[str, Any]] = {}
    for line in config.CLASSIFICATIONS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        gid = rec.get("gmail_msg_id") or rec.get("id")
        if gid:
            out[gid] = rec
    return out


# --- persistence -----------------------------------------------------------

def persist_emails_and_classifications(messages: list[dict[str, Any]],
                                        classifications: dict[str, dict[str, Any]]
                                        ) -> tuple[int, list[dict[str, Any]]]:
    """Insert emails + classifications. Returns (count, reply_today_payload).

    `reply_today_payload` is the list of (from_name, subject, summary, gmail_url)
    items that should be in the daily nudge email.
    """
    if not messages:
        return 0, []

    # Insert emails (UNIQUE on gmail_msg_id deduplicates safely).
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
    id_map = {row["gmail_msg_id"]: row["id"] for row in inserted}

    # Build classification rows + reply_today payload.
    class_rows: list[dict[str, Any]] = []
    reply_today: list[dict[str, Any]] = []
    msg_by_id = {m["gmail_msg_id"]: m for m in messages}

    for gid, rec in classifications.items():
        email_id = id_map.get(gid)
        category = rec.get("category")
        if not email_id or not category:
            continue
        class_rows.append({
            "email_id": email_id,
            "category": category,
            "summary": rec.get("summary"),
            "why_priority": rec.get("why_priority"),
            "prompt_version": config.PROMPT_VERSION,
        })
        if category == "reply_today":
            src = msg_by_id.get(gid, {})
            reply_today.append({
                "from_name": src.get("from_name"),
                "subject": src.get("subject"),
                "summary": rec.get("summary"),
                "gmail_url": src.get("gmail_url"),
            })

    supabase_client.insert_classifications(class_rows)
    return len(messages), reply_today


def chunks(seq: list, n: int) -> Iterator[list]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]
