"""Identify noise generators and produce a one-click cleanup sheet.

A "noise generator" = a sender where (almost) every email went to archive.
For each one, this script outputs:
  - the actual List-Unsubscribe URL pulled from Gmail headers
  - a ready-to-paste Gmail filter
  - a Gmail search URL for bulk deleting existing messages

Output: tmp/noise_report.md

Usage:
  python scripts/noise_report.py                    # all accounts
  python scripts/noise_report.py one@gmail.com      # one account
  python scripts/noise_report.py --min-count 5      # only senders with >=5 emails
  python scripts/noise_report.py --threshold 0.95   # 95% archive (default 1.0)
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.parse
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import config, gmail, supabase_client  # noqa: E402


def collect_noise_generators(account_email: str | None,
                              min_count: int,
                              threshold: float) -> dict[str, dict]:
    """Return {from_email: {name, total, archive, pct, sample_gmail_msg_id, account_email}}."""
    client = supabase_client.client()
    page_size = 1000
    page = 0
    by_sender: dict[str, dict] = defaultdict(
        lambda: {"name": "", "total": 0, "archive": 0, "samples": [], "account_email": ""}
    )

    while True:
        q = (
            client.table("emails")
            .select(
                "gmail_msg_id, from_email, from_name, folder, accounts(email), classifications(category)"
            )
            .eq("folder", "inbox")
            .range(page * page_size, page * page_size + page_size - 1)
        )
        res = q.execute()
        batch = res.data or []
        if not batch:
            break
        for row in batch:
            addr = (row.get("from_email") or "").lower()
            if not addr:
                continue
            acct = row.get("accounts") or {}
            acct_email = (acct.get("email") if isinstance(acct, dict)
                          else (acct[0].get("email") if acct else "")) or ""
            if account_email and acct_email != account_email:
                continue
            cls = row.get("classifications") or []
            cat = cls[0]["category"] if cls else None

            rec = by_sender[addr]
            rec["name"] = rec["name"] or (row.get("from_name") or "")
            rec["account_email"] = acct_email
            rec["total"] += 1
            if cat == "archive":
                rec["archive"] += 1
                rec["samples"].append(row["gmail_msg_id"])

        if len(batch) < page_size:
            break
        page += 1

    # Filter to noise generators.
    filtered = {}
    for addr, rec in by_sender.items():
        if rec["total"] < min_count:
            continue
        pct = rec["archive"] / rec["total"]
        if pct < threshold:
            continue
        filtered[addr] = {
            **rec,
            "pct": pct,
            "sample_gmail_msg_id": rec["samples"][0] if rec["samples"] else None,
        }
    return filtered


def extract_list_unsubscribe(service, gmail_msg_id: str) -> tuple[str | None, bool]:
    """Returns (url, supports_one_click). Looks at the List-Unsubscribe header."""
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
    except Exception:
        return None, False
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
    raw = headers.get("list-unsubscribe", "")
    post = headers.get("list-unsubscribe-post", "")
    one_click = "List-Unsubscribe=One-Click" in post

    # Header format: <mailto:...>, <https://...>
    urls = re.findall(r"<([^>]+)>", raw)
    # Prefer https over mailto.
    https_urls = [u for u in urls if u.startswith("http")]
    mailto_urls = [u for u in urls if u.startswith("mailto:")]
    chosen = (https_urls + mailto_urls)[0] if (https_urls or mailto_urls) else None
    return chosen, one_click


def gmail_search_url(addr: str) -> str:
    q = urllib.parse.quote(f"from:{addr}")
    return f"https://mail.google.com/mail/u/0/#search/{q}"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("account", nargs="?", help="Restrict to this account email")
    p.add_argument("--min-count", type=int, default=3, help="Minimum total emails to qualify (default 3)")
    p.add_argument("--threshold", type=float, default=1.0,
                   help="Fraction archived to qualify, 0.0–1.0 (default 1.0 = 100%)")
    p.add_argument("--top", type=int, default=30, help="Cap to top N senders by count")
    args = p.parse_args()

    print(f"Querying Supabase for noise generators (min_count={args.min_count}, "
          f"threshold={args.threshold * 100:.0f}%, account={args.account or 'all'})…")
    noise = collect_noise_generators(args.account, args.min_count, args.threshold)
    if not noise:
        print("No noise generators matched.")
        sys.exit(0)

    ranked = sorted(noise.items(), key=lambda kv: -kv[1]["total"])[: args.top]
    print(f"Found {len(noise)} senders, showing top {len(ranked)}.")

    # Group sample fetches by account so we open one Gmail service per account.
    by_account: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for addr, rec in ranked:
        by_account[rec["account_email"]].append((addr, rec))

    enrichment: dict[str, tuple[str | None, bool]] = {}
    for acct_email, senders in by_account.items():
        acct = supabase_client.get_account_by_email(acct_email)
        if not acct:
            print(f"  skipping {acct_email} (no account row)")
            for addr, _ in senders:
                enrichment[addr] = (None, False)
            continue
        print(f"  fetching List-Unsubscribe for {len(senders)} senders via {acct_email}…")
        service = gmail.build_service(acct["oauth_refresh_token"])
        for addr, rec in senders:
            if not rec.get("sample_gmail_msg_id"):
                enrichment[addr] = (None, False)
                continue
            enrichment[addr] = extract_list_unsubscribe(service, rec["sample_gmail_msg_id"])

    # Render Markdown.
    config.TMP_DIR.mkdir(parents=True, exist_ok=True)
    out = config.TMP_DIR / "noise_report.md"
    lines: list[str] = []
    lines.append("# Bashir noise generators — cleanup sheet")
    lines.append("")
    lines.append(f"Account: {args.account or 'all'}  ·  Threshold: {args.threshold * 100:.0f}% archive  ·  Min: {args.min_count}")
    lines.append("")
    lines.append(f"**{len(ranked)} sender(s)** — work through these top-down. Each row gives you one-click options.")
    lines.append("")

    total_to_kill = sum(rec["total"] for _, rec in ranked)
    lines.append(f"_If you clear all of these, you'll remove approx **{total_to_kill}** existing inbox messages and stop the bleed of future ones._")
    lines.append("")

    for i, (addr, rec) in enumerate(ranked, 1):
        unsub_url, one_click = enrichment.get(addr, (None, False))
        name = rec["name"] or addr
        lines.append(f"## {i}. {name}  · {rec['total']} emails")
        lines.append(f"- `from:{addr}`")
        if unsub_url and unsub_url.startswith("http"):
            tag = " (one-click)" if one_click else ""
            lines.append(f"- **Unsubscribe**{tag}: {unsub_url}")
        elif unsub_url and unsub_url.startswith("mailto:"):
            lines.append(f"- **Unsubscribe via email**: `{unsub_url}` (send an empty email to that address)")
        else:
            lines.append(f"- **Unsubscribe**: no `List-Unsubscribe` header — open one of these manually: {gmail_search_url(addr)}")
        lines.append(f"- **Bulk-delete in Gmail**: {gmail_search_url(addr)} → click search → select all → trash")
        lines.append(f"- **Gmail filter**: in Gmail → Settings → Filters → Create new → From: `{addr}` → Delete it (and Apply to matching conversations)")
        lines.append("")

    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWrote {out}")
    print(f"Open it: file:///{out.as_posix()}")


if __name__ == "__main__":
    main()
