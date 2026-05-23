"""Sends the daily 'reply_today is non-empty' nudge email.

Uses one of Nova's existing Gmail accounts (NOTIFY_FROM_EMAIL) as the sender.
Keeps everything inside the Gmail API auth Bashir already has — no SMTP/SES setup.
"""
from __future__ import annotations

from typing import Any

from . import config, gmail, supabase_client


def send_reply_today_nudge(reply_today_emails: list[dict[str, Any]]) -> bool:
    """If there's anything in reply_today, send a short summary email.

    `reply_today_emails` is a list of dicts with from_name, subject, summary, gmail_url.
    Returns True if sent.
    """
    if not reply_today_emails or not config.NOTIFY_TO_EMAIL:
        return False

    sender = supabase_client.get_account_by_email(config.NOTIFY_FROM_EMAIL)
    if not sender:
        # Fall back: any account that has a refresh token.
        accounts = supabase_client.list_accounts()
        if not accounts:
            return False
        sender = accounts[0]

    service = gmail.build_service(sender["oauth_refresh_token"])

    lines = [
        f"Bashir here. {len(reply_today_emails)} email(s) need your reply today:",
        "",
    ]
    for e in reply_today_emails[:10]:
        lines.append(f"• {e.get('from_name') or '(unknown)'} — {e.get('subject') or '(no subject)'}")
        if e.get("summary"):
            lines.append(f"  {e['summary']}")
        if e.get("gmail_url"):
            lines.append(f"  {e['gmail_url']}")
        lines.append("")
    if len(reply_today_emails) > 10:
        lines.append(f"…and {len(reply_today_emails) - 10} more on the dashboard.")

    body = "\n".join(lines)
    subject = f"Bashir: {len(reply_today_emails)} email(s) to reply today"
    gmail.send_email(service, config.NOTIFY_TO_EMAIL, subject, body)
    return True
