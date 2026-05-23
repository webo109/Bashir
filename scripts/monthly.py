"""Monthly analytics report. Invoked by Claude Code Routine on the 1st of each month.

Reads the past 30 days from Supabase and writes a row to `monthly_reports`.

Metrics:
  - top_senders_by_volume: who emails Nova the most
  - noise_generators:      senders where >=80% of mail is archive
                           (formatted as ready-to-paste Gmail filter syntax)
  - category_breakdown:    % per category
  - hour_heatmap:          24-bucket count of when reply_today/opportunities arrive
  - quiet_conversations:   prospects Nova replied to who haven't responded in 14+ days
  - never_replied_threads: inbound threads Nova never sent a reply on (last 30 days)
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import supabase_client  # noqa: E402


WINDOW_DAYS = 30
NOISE_THRESHOLD = 0.80
QUIET_DAYS = 14


def _fetch_window(since_iso: str) -> list[dict[str, Any]]:
    """Pull emails + their classifications for the window. Paged."""
    client = supabase_client.client()
    rows: list[dict[str, Any]] = []
    page = 0
    page_size = 1000
    while True:
        res = (
            client.table("emails")
            .select("id, from_email, from_name, subject, received_at, thread_id, folder, classifications(category)")
            .gte("received_at", since_iso)
            .range(page * page_size, page * page_size + page_size - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows


def build_report(year_month: str) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    rows = _fetch_window(since.isoformat())

    inbox = [r for r in rows if r.get("folder", "inbox") == "inbox"]
    sent = [r for r in rows if r.get("folder") == "sent"]

    # Each email has a list of classifications (one per prompt_version).
    # Use the most recent (any) for analytics.
    def category_of(row: dict) -> str | None:
        cls = row.get("classifications") or []
        return cls[0]["category"] if cls else None

    # 1. top senders by volume (inbox)
    sender_counter: Counter[str] = Counter()
    sender_label: dict[str, str] = {}
    for r in inbox:
        addr = (r.get("from_email") or "").lower()
        if not addr:
            continue
        sender_counter[addr] += 1
        sender_label[addr] = (r.get("from_name") or addr)
    top_senders = [
        {"email": addr, "name": sender_label[addr], "count": n}
        for addr, n in sender_counter.most_common(15)
    ]

    # 2. noise generators
    sender_archive: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # [archive, total]
    for r in inbox:
        addr = (r.get("from_email") or "").lower()
        if not addr:
            continue
        sender_archive[addr][1] += 1
        if category_of(r) == "archive":
            sender_archive[addr][0] += 1
    noise = []
    for addr, (a, t) in sender_archive.items():
        if t >= 5 and a / t >= NOISE_THRESHOLD:
            noise.append(
                {
                    "email": addr,
                    "name": sender_label.get(addr, addr),
                    "total": t,
                    "archive_pct": round(100 * a / t),
                    "gmail_filter": f"from:{addr}",
                }
            )
    noise.sort(key=lambda x: x["total"], reverse=True)

    # 3. category breakdown
    category_counter: Counter[str] = Counter()
    for r in inbox:
        c = category_of(r)
        if c:
            category_counter[c] += 1
    total_inbox = sum(category_counter.values()) or 1
    breakdown = {c: round(100 * n / total_inbox, 1) for c, n in category_counter.items()}

    # 4. hour heatmap (when do important emails arrive?)
    heatmap = [0] * 24
    for r in inbox:
        if category_of(r) in ("reply_today", "opportunities") and r.get("received_at"):
            try:
                hour = datetime.fromisoformat(r["received_at"].replace("Z", "+00:00")).hour
                heatmap[hour] += 1
            except (ValueError, TypeError):
                pass

    # 5. quiet conversations: thread_ids where the LAST message is Nova's (sent),
    #    older than QUIET_DAYS, and there's no newer inbound on that thread.
    threads_by_id: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r.get("thread_id"):
            threads_by_id[r["thread_id"]].append(r)

    quiet = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=QUIET_DAYS)
    for tid, msgs in threads_by_id.items():
        msgs.sort(key=lambda m: m.get("received_at") or "")
        last = msgs[-1]
        if last.get("folder") != "sent":
            continue
        if not last.get("received_at"):
            continue
        try:
            ts = datetime.fromisoformat(last["received_at"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts < cutoff:
            quiet.append(
                {
                    "thread_id": tid,
                    "subject": last.get("subject"),
                    "last_sent": last["received_at"],
                    "days_quiet": (datetime.now(timezone.utc) - ts).days,
                }
            )
    quiet.sort(key=lambda x: x["days_quiet"], reverse=True)

    # 6. never replied (inbox threads with no sent reply)
    sent_thread_ids = {r["thread_id"] for r in sent if r.get("thread_id")}
    never_replied = []
    for tid, msgs in threads_by_id.items():
        if tid in sent_thread_ids:
            continue
        # Only consider threads where Bashir flagged at least one as worth replying to.
        if not any(category_of(m) in ("reply_today", "opportunities") for m in msgs):
            continue
        last = max(msgs, key=lambda m: m.get("received_at") or "")
        never_replied.append(
            {
                "thread_id": tid,
                "from": last.get("from_name") or last.get("from_email"),
                "subject": last.get("subject"),
                "received_at": last.get("received_at"),
            }
        )

    return {
        "window_days": WINDOW_DAYS,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "inbox": len(inbox),
            "sent": len(sent),
        },
        "top_senders_by_volume": top_senders,
        "noise_generators": noise,
        "category_breakdown_pct": breakdown,
        "hour_heatmap": heatmap,
        "quiet_conversations": quiet[:20],
        "never_replied_threads": never_replied[:20],
    }


def main() -> None:
    year_month = datetime.now(timezone.utc).strftime("%Y-%m")
    run_id = supabase_client.start_run("monthly")
    try:
        report = build_report(year_month)
        supabase_client.upsert_monthly_report(year_month, report)
        supabase_client.finish_run(run_id, "success", report["totals"]["inbox"])
        print(f"Wrote monthly report for {year_month}: {report['totals']}")
    except Exception as e:
        supabase_client.finish_run(run_id, "error", 0, str(e))
        raise


if __name__ == "__main__":
    main()
