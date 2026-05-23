"""Thin wrapper over supabase-py for Bashir's tables.

All functions use the SECRET key (bypasses RLS). Server-side only.
"""
from __future__ import annotations

from typing import Any, Iterable

from supabase import Client, create_client

from . import config


_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        url = config.require("SUPABASE_URL", config.SUPABASE_URL)
        key = config.require("SUPABASE_SECRET_KEY", config.SUPABASE_SECRET_KEY)
        _client = create_client(url, key)
    return _client


# --- accounts --------------------------------------------------------------

def upsert_account(email: str, refresh_token: str) -> dict[str, Any]:
    """Insert or update an account by email. Returns the row."""
    res = (
        client()
        .table("accounts")
        .upsert({"email": email, "oauth_refresh_token": refresh_token}, on_conflict="email")
        .execute()
    )
    return res.data[0]


def get_account_by_email(email: str) -> dict[str, Any] | None:
    res = client().table("accounts").select("*").eq("email", email).limit(1).execute()
    return res.data[0] if res.data else None


def list_accounts() -> list[dict[str, Any]]:
    return client().table("accounts").select("*").execute().data or []


def update_history_id(account_id: int, history_id: str) -> None:
    client().table("accounts").update({"last_history_id": history_id}).eq(
        "id", account_id
    ).execute()


# --- emails ----------------------------------------------------------------

def existing_gmail_ids(gmail_msg_ids: Iterable[str]) -> set[str]:
    """Return the subset of gmail_msg_ids that are already in the DB.

    FIX-10: chunked to ~200 ids per request because PostgREST `.in_()` builds
    a single URL whose length is bounded by Nginx/CloudFront. Large backfills
    on 50k-message inboxes used to either error or silently truncate.
    """
    ids = list(gmail_msg_ids)
    if not ids:
        return set()
    chunk_size = 200
    found: set[str] = set()
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        res = (
            client()
            .table("emails")
            .select("gmail_msg_id")
            .in_("gmail_msg_id", chunk)
            .execute()
        )
        found.update(row["gmail_msg_id"] for row in (res.data or []))
    return found


def insert_emails(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert email rows, ignoring duplicates on gmail_msg_id.

    Returns rows as written (id + gmail_msg_id at minimum).
    """
    if not rows:
        return []
    res = (
        client()
        .table("emails")
        .upsert(rows, on_conflict="gmail_msg_id", ignore_duplicates=False)
        .execute()
    )
    return res.data or []


# --- classifications -------------------------------------------------------

def insert_classifications(rows: list[dict[str, Any]]) -> None:
    """Upsert classifications keyed by (email_id, prompt_version)."""
    if not rows:
        return
    client().table("classifications").upsert(
        rows, on_conflict="email_id,prompt_version"
    ).execute()


# --- run_log ---------------------------------------------------------------

def start_run(script_name: str, account_email: str | None = None) -> int:
    res = (
        client()
        .table("run_log")
        .insert({"script_name": script_name, "account_email": account_email})
        .execute()
    )
    return res.data[0]["id"]


def finish_run(
    run_id: int,
    status: str = "success",
    emails_processed: int = 0,
    errors: str | None = None,
) -> None:
    from datetime import datetime, timezone

    client().table("run_log").update(
        {
            "status": status,
            "emails_processed": emails_processed,
            "errors": errors,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", run_id).execute()


# --- monthly_reports -------------------------------------------------------

def upsert_monthly_report(year_month: str, payload: dict[str, Any]) -> None:
    client().table("monthly_reports").upsert(
        {"year_month": year_month, "json_payload": payload},
        on_conflict="year_month",
    ).execute()


# --- sender_unsubscribe ----------------------------------------------------

def upsert_sender_unsubscribe(
    from_email: str,
    url: str | None,
    one_click: bool,
    source_msg_id: str | None,
) -> None:
    from datetime import datetime, timezone
    client().table("sender_unsubscribe").upsert(
        {
            "from_email": from_email,
            "unsubscribe_url": url,
            "one_click": one_click,
            "source_msg_id": source_msg_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="from_email",
    ).execute()


def get_senders_needing_unsubscribe_refresh(stale_days: int = 30) -> list[tuple[str, str]]:
    """Return (from_email, sample_gmail_msg_id) for senders that need (re-)fetching.

    A sender qualifies if:
      - it appears in emails (inbox folder) AND
      - it has NO row in sender_unsubscribe, OR its row is older than stale_days

    Returns a sample message ID per sender (most recent inbox message).
    """
    from datetime import datetime, timedelta, timezone

    db = client()
    # Senders with existing rows + their updated_at.
    existing = db.table("sender_unsubscribe").select("from_email,updated_at").execute().data or []
    cutoff = datetime.now(timezone.utc) - timedelta(days=stale_days)
    fresh = {
        r["from_email"]
        for r in existing
        if r.get("updated_at") and datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00")) > cutoff
    }

    # Pull distinct senders with their most recent inbox message id.
    # Supabase has no DISTINCT — fetch a wide query and reduce in Python.
    rows = (
        db.table("emails")
        .select("from_email, gmail_msg_id, received_at")
        .eq("folder", "inbox")
        .order("received_at", desc=True)
        .limit(5000)
        .execute()
        .data
        or []
    )
    seen: dict[str, str] = {}
    for r in rows:
        addr = (r.get("from_email") or "").lower()
        if not addr or addr in seen:
            continue
        if addr in fresh:
            continue
        seen[addr] = r["gmail_msg_id"]
    return list(seen.items())
