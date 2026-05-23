"""Gmail API wrapper.

Two fetch modes:
- list_since(date)        — used by backfill, by date range
- list_history(history_id) — used by daily routine, delta sync

Plus parse_message() which turns the Gmail API payload into a flat dict
shaped like Bashir's prompt + DB schema expect.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from email.utils import parseaddr
from typing import Any, Iterator

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from . import config


GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",  # for notifier nudges
]


def build_service(refresh_token: str):
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=config.GOOGLE_CLIENT_ID,
        client_secret=config.GOOGLE_CLIENT_SECRET,
        scopes=GMAIL_SCOPES,
    )
    creds.refresh(GoogleRequest())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# --- listing ---------------------------------------------------------------

def list_since(service, after_date: datetime, folder: str = "inbox") -> Iterator[str]:
    """Yield message IDs received after `after_date` in the given folder.

    folder: 'inbox' or 'sent'.
    """
    label = "INBOX" if folder == "inbox" else "SENT"
    # Gmail's `after:` operator uses unix seconds.
    query = f"after:{int(after_date.timestamp())}"
    page_token = None
    while True:
        resp = (
            service.users()
            .messages()
            .list(
                userId="me",
                labelIds=[label],
                q=query,
                pageToken=page_token,
                maxResults=500,
            )
            .execute()
        )
        for m in resp.get("messages", []):
            yield m["id"]
        page_token = resp.get("nextPageToken")
        if not page_token:
            return


def list_history(service, start_history_id: str) -> tuple[list[str], str | None]:
    """Return (new_message_ids, latest_history_id) since start_history_id.

    Latest history id is returned so the caller can persist it. If Gmail
    rejects the history id (too old, > ~7 days), returns ([], None) and
    the caller should fall back to list_since().
    """
    new_ids: list[str] = []
    latest_history_id = start_history_id
    page_token = None
    try:
        while True:
            resp = (
                service.users()
                .history()
                .list(
                    userId="me",
                    startHistoryId=start_history_id,
                    historyTypes=["messageAdded"],
                    pageToken=page_token,
                )
                .execute()
            )
            for h in resp.get("history", []):
                latest_history_id = h.get("id", latest_history_id)
                for ma in h.get("messagesAdded", []):
                    msg = ma.get("message", {})
                    # Skip messages outside INBOX (drafts, all-mail-only, etc.)
                    if "INBOX" in (msg.get("labelIds") or []):
                        new_ids.append(msg["id"])
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        # If no history events, fetch current profile historyId as the cursor.
        if latest_history_id == start_history_id:
            profile = service.users().getProfile(userId="me").execute()
            latest_history_id = profile.get("historyId", latest_history_id)
        return new_ids, latest_history_id
    except HttpError as e:
        # 404 = startHistoryId too old. Caller falls back to date range.
        if e.resp.status == 404:
            return [], None
        raise


def get_current_history_id(service) -> str:
    return service.users().getProfile(userId="me").execute()["historyId"]


# --- parse -----------------------------------------------------------------

def get_message(service, msg_id: str) -> dict[str, Any]:
    raw = (
        service.users()
        .messages()
        .get(userId="me", id=msg_id, format="full")
        .execute()
    )
    return parse_message(raw)


def parse_message(raw: dict[str, Any]) -> dict[str, Any]:
    headers = {h["name"].lower(): h["value"] for h in raw.get("payload", {}).get("headers", [])}
    from_raw = headers.get("from", "")
    from_name, from_email = parseaddr(from_raw)

    body = _extract_body(raw.get("payload", {}))
    # Trim very long bodies; Bashir doesn't need 50KB of footer per email.
    if len(body) > 4000:
        body = body[:4000] + "\n…[truncated]"

    received_at = None
    if "internalDate" in raw:
        received_at = datetime.fromtimestamp(
            int(raw["internalDate"]) / 1000, tz=timezone.utc
        ).isoformat()

    label_ids = raw.get("labelIds", []) or []
    folder = "sent" if "SENT" in label_ids else "inbox"

    return {
        "gmail_msg_id": raw["id"],
        "thread_id": raw.get("threadId"),
        "from_name": from_name or None,
        "from_email": from_email or None,
        "subject": headers.get("subject"),
        "snippet": raw.get("snippet"),
        "body": body,
        "received_at": received_at,
        "gmail_url": f"https://mail.google.com/mail/u/0/#inbox/{raw['id']}",
        "folder": folder,
    }


def _extract_body(payload: dict[str, Any]) -> str:
    """Walk MIME parts. Prefer text/plain; fall back to text/html stripped."""
    plain = _walk(payload, "text/plain")
    if plain:
        return plain
    html = _walk(payload, "text/html")
    if html:
        return _strip_html(html)
    return ""


def _walk(part: dict[str, Any], wanted_mime: str) -> str | None:
    if part.get("mimeType") == wanted_mime:
        data = part.get("body", {}).get("data")
        if data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
    for child in part.get("parts", []) or []:
        found = _walk(child, wanted_mime)
        if found:
            return found
    return None


def _strip_html(html: str) -> str:
    import re

    text = re.sub(r"<script.*?</script>", "", html, flags=re.S | re.I)
    text = re.sub(r"<style.*?</style>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# --- send (used by notifier) -----------------------------------------------

def send_email(service, to: str, subject: str, body: str) -> None:
    from email.mime.text import MIMEText

    msg = MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    encoded = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": encoded}).execute()


def get_unsubscribe_header(service, gmail_msg_id: str) -> tuple[str | None, bool]:
    """Return (preferred_url, supports_one_click) from List-Unsubscribe headers.

    Prefers https over mailto. URL is None if neither header is set.
    one_click=True iff List-Unsubscribe-Post contains 'List-Unsubscribe=One-Click' (RFC 8058).
    """
    import re as _re
    try:
        msg = (
            service.users()
            .messages()
            .get(
                userId="me",
                id=gmail_msg_id,
                format="metadata",
                metadataHeaders=["List-Unsubscribe", "List-Unsubscribe-Post"],
            )
            .execute()
        )
    except HttpError:
        return None, False
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
    raw = headers.get("list-unsubscribe", "")
    post = headers.get("list-unsubscribe-post", "")
    one_click = "List-Unsubscribe=One-Click" in post

    urls = _re.findall(r"<([^>]+)>", raw)
    https = [u for u in urls if u.startswith("http")]
    mailto = [u for u in urls if u.startswith("mailto:")]
    chosen = (https + mailto)[0] if (https or mailto) else None
    return chosen, one_click
