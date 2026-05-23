# Bashir In-App Unsubscribe (V1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `List-Unsubscribe` URLs in the Bashir dashboard so Nova can kill noise senders with one tap, without leaving the app.

**Architecture:** New `sender_unsubscribe` table populated from Gmail headers by a one-shot script (also called from the daily routine). Dashboard queries LEFT JOIN it. EmailCards gain an "Unsub ↗" link when present. A new `/senders` page ranks noise generators.

**Tech Stack:** Same as V1.0 — Python for backend, Next.js + Tailwind + shadcn for dashboard, Supabase for storage.

**Spec:** [`docs/superpowers/specs/2026-05-24-bashir-unsubscribe-design.md`](../specs/2026-05-24-bashir-unsubscribe-design.md)

---

## File Structure (deltas only)

```
Bashir/
├── sql/
│   └── unsubscribe.sql              # NEW — migration to add sender_unsubscribe table
├── lib/
│   ├── gmail.py                     # MODIFY — add get_unsubscribe_header()
│   └── supabase_client.py           # MODIFY — add 3 helpers
├── scripts/
│   └── refresh_unsubscribe.py       # NEW — populates sender_unsubscribe
├── CLAUDE.md                        # MODIFY — daily routine step 5b
└── dashboard/
    ├── lib/
    │   ├── types.ts                 # MODIFY — extend EmailRow + add SenderStats
    │   └── queries.ts               # MODIFY — JOIN sender_unsubscribe + add getNoiseGenerators
    ├── components/
    │   ├── EmailCard.tsx            # MODIFY — Unsub ↗ link
    │   ├── BottomNav.tsx            # MODIFY — add Senders
    │   └── SideNav.tsx              # MODIFY — add Senders
    └── app/(protected)/
        └── senders/page.tsx         # NEW — noise generator management
```

**Working directory:** root of the Bashir repo unless noted.

---

## Task 1: Schema migration

**Files:**
- Create: `sql/unsubscribe.sql`

- [ ] **Step 1.1: Write `sql/unsubscribe.sql`**

```sql
-- V1.2 — adds in-app unsubscribe support.
-- Apply by pasting into the Supabase SQL editor. Idempotent.

create table if not exists sender_unsubscribe (
  from_email      text primary key,
  unsubscribe_url text,
  one_click       boolean default false,
  source_msg_id   text,
  updated_at      timestamptz default now()
);
create index if not exists idx_sender_unsubscribe_updated on sender_unsubscribe(updated_at desc);
```

- [ ] **Step 1.2: Apply manually**

The user pastes this into the Supabase SQL editor and runs it. (Document in README.)

- [ ] **Step 1.3: Verify table exists**

```bash
.venv/Scripts/python.exe -c "from lib import supabase_client; print(supabase_client.client().table('sender_unsubscribe').select('from_email', count='exact').execute().count)"
```

Expected: `0` (empty table).

- [ ] **Step 1.4: Commit**

```bash
git add sql/unsubscribe.sql
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "sql: add sender_unsubscribe table (V1.2 migration)"
```

---

## Task 2: Gmail header helper

**Files:**
- Modify: `lib/gmail.py`

- [ ] **Step 2.1: Append to `lib/gmail.py`** (after the `send_email` function)

```python
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
```

- [ ] **Step 2.2: Quick smoke test**

```bash
.venv/Scripts/python.exe -c "
from lib import supabase_client, gmail
acct = supabase_client.list_accounts()[0]
svc = gmail.build_service(acct['oauth_refresh_token'])
sample = supabase_client.client().table('emails').select('gmail_msg_id').limit(1).execute().data[0]['gmail_msg_id']
print(gmail.get_unsubscribe_header(svc, sample))
"
```

Expected: prints a `(url, bool)` tuple, no exceptions.

- [ ] **Step 2.3: Commit**

```bash
git add lib/gmail.py
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "lib/gmail: add get_unsubscribe_header()"
```

---

## Task 3: Supabase client helpers

**Files:**
- Modify: `lib/supabase_client.py`

- [ ] **Step 3.1: Append to `lib/supabase_client.py`**

```python
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
```

- [ ] **Step 3.2: Commit**

```bash
git add lib/supabase_client.py
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "lib/supabase_client: helpers for sender_unsubscribe"
```

---

## Task 4: Refresh script

**Files:**
- Create: `scripts/refresh_unsubscribe.py`

- [ ] **Step 4.1: Write `scripts/refresh_unsubscribe.py`**

```python
"""Populate sender_unsubscribe by fetching List-Unsubscribe headers per sender.

Idempotent. Re-fetches rows older than --stale-days. Safe to run any time.

Usage:
  python scripts/refresh_unsubscribe.py                    # all accounts, all stale
  python scripts/refresh_unsubscribe.py --stale-days 7     # be more aggressive about refresh
  python scripts/refresh_unsubscribe.py --new-senders-only # skip refresh, only fill new gaps
  python scripts/refresh_unsubscribe.py one@gmail.com      # restrict to one account
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import gmail, supabase_client  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("account", nargs="?", help="Restrict to this account email")
    p.add_argument("--stale-days", type=int, default=30)
    p.add_argument("--new-senders-only", action="store_true",
                   help="Treat stale-days as infinite — only fill genuinely missing senders")
    args = p.parse_args()

    stale = 10**6 if args.new_senders_only else args.stale_days
    pending = supabase_client.get_senders_needing_unsubscribe_refresh(stale_days=stale)
    print(f"{len(pending)} sender(s) need refresh.")
    if not pending:
        return

    # Group by account so we open one Gmail service per account.
    accounts = supabase_client.list_accounts()
    if args.account:
        accounts = [a for a in accounts if a["email"] == args.account]
    if not accounts:
        print("No matching accounts. Run scripts/oauth_setup.py first.")
        sys.exit(1)

    # We need to know which account each gmail_msg_id belongs to.
    db = supabase_client.client()
    msg_ids = [mid for _, mid in pending]
    if not msg_ids:
        return
    rows = db.table("emails").select("gmail_msg_id, account_id").in_("gmail_msg_id", msg_ids).execute().data or []
    msg_to_account = {r["gmail_msg_id"]: r["account_id"] for r in rows}

    grouped: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for addr, mid in pending:
        acct_id = msg_to_account.get(mid)
        if acct_id is not None:
            grouped[acct_id].append((addr, mid))

    run_id = supabase_client.start_run("refresh_unsubscribe")
    processed = 0
    try:
        for account in accounts:
            todo = grouped.get(account["id"], [])
            if not todo:
                continue
            print(f"[{account['email']}] refreshing {len(todo)} sender(s)…")
            service = gmail.build_service(account["oauth_refresh_token"])
            for addr, mid in todo:
                try:
                    url, one_click = gmail.get_unsubscribe_header(service, mid)
                except Exception as e:
                    print(f"  ! {addr} — error: {e}")
                    url, one_click = None, False
                supabase_client.upsert_sender_unsubscribe(addr, url, one_click, mid)
                processed += 1
                if processed % 25 == 0:
                    print(f"  ... {processed}")
        supabase_client.finish_run(run_id, "success", processed)
    except Exception as e:
        supabase_client.finish_run(run_id, "error", processed, str(e))
        raise

    print(f"Done. Updated {processed} sender row(s).")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4.2: Run it once on the current data**

```bash
.venv/Scripts/python.exe scripts/refresh_unsubscribe.py
```

Expected: enumerates senders, prints progress every 25, ends with "Done. Updated N sender row(s)."

- [ ] **Step 4.3: Verify population**

```bash
.venv/Scripts/python.exe -c "
from lib import supabase_client
c = supabase_client.client()
total = c.table('sender_unsubscribe').select('from_email', count='exact').execute().count
with_url = c.table('sender_unsubscribe').select('from_email', count='exact').not_.is_('unsubscribe_url', None).execute().count
print(f'sender_unsubscribe rows: {total}, with URL: {with_url}')
"
```

Expected: total > 0 and with_url > 0.

- [ ] **Step 4.4: Commit**

```bash
git add scripts/refresh_unsubscribe.py
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "scripts/refresh_unsubscribe: populate List-Unsubscribe per sender"
```

---

## Task 5: Daily routine integration

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 5.1: Update `CLAUDE.md` daily routine section**

Find the daily routine block in `CLAUDE.md`. After the `python scripts/persist.py` step, insert:

```markdown
5. Run `python scripts/refresh_unsubscribe.py --new-senders-only` to enrich any newly-seen senders with List-Unsubscribe URLs (fast — only touches senders without a row yet).
```

Renumber subsequent steps.

- [ ] **Step 5.2: Commit**

```bash
git add CLAUDE.md
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "CLAUDE.md: daily routine refreshes unsubscribe metadata"
```

---

## Task 6: Dashboard types + queries

**Files:**
- Modify: `dashboard/lib/types.ts`
- Modify: `dashboard/lib/queries.ts`

- [ ] **Step 6.1: Update `dashboard/lib/types.ts`**

Find the `EmailRow` interface and add at the end (before closing brace):

```ts
  unsubscribe_url: string | null;
  unsubscribe_one_click: boolean;
```

Append a new export at the bottom of the file:

```ts
export interface SenderStats {
  from_email: string;
  from_name: string | null;
  total: number;
  archive_count: number;
  archive_pct: number;
  unsubscribe_url: string | null;
  unsubscribe_one_click: boolean;
}
```

- [ ] **Step 6.2: Update `dashboard/lib/queries.ts`**

Update the `RawRow` interface to include the new join:

```ts
interface RawRow {
  // ...existing fields...
  sender_unsubscribe: { unsubscribe_url: string | null; one_click: boolean } | { unsubscribe_url: string | null; one_click: boolean }[] | null;
}
```

Update the `flatten` function — at the end, after computing `top`, add:

```ts
  const su = Array.isArray(row.sender_unsubscribe) ? row.sender_unsubscribe[0] : row.sender_unsubscribe;
```

And in the returned object, add:

```ts
    unsubscribe_url: su?.unsubscribe_url ?? null,
    unsubscribe_one_click: su?.one_click ?? false,
```

Update the SELECT strings in BOTH `getTodayEmails` and `searchArchive` to include the join. Replace the existing select string with:

```ts
"id, gmail_msg_id, account_id, from_name, from_email, subject, snippet, body, received_at, gmail_url, folder, accounts(email), classifications(category, summary, why_priority, classified_at), sender_unsubscribe!emails_from_email_fkey(unsubscribe_url, one_click)"
```

**Note:** Supabase needs the explicit FK hint because `from_email` is not a declared FK. If the `!` hint fails (no FK exists), use the alternative form below.

**Alternative if FK hint fails:** drop the join from queries, fetch all senders' unsubscribe data once, hydrate in memory. Replace `flatten` callers with a wrapper:

```ts
async function hydrateUnsubscribe(rows: EmailRow[]): Promise<EmailRow[]> {
  const emails = Array.from(new Set(rows.map(r => r.from_email).filter(Boolean))) as string[];
  if (!emails.length) return rows;
  const { data } = await supabase()
    .from("sender_unsubscribe")
    .select("from_email, unsubscribe_url, one_click")
    .in("from_email", emails);
  const map = new Map((data || []).map(r => [r.from_email, r]));
  return rows.map(r => {
    const m = r.from_email ? map.get(r.from_email) : undefined;
    return { ...r, unsubscribe_url: m?.unsubscribe_url ?? null, unsubscribe_one_click: m?.one_click ?? false };
  });
}
```

Apply this wrapper inside `getTodayEmails` (return `await hydrateUnsubscribe(rows)`) and inside `searchArchive` (return `{ rows: await hydrateUnsubscribe(filtered.slice(0, pageSize)), hasMore }`).

**Use the alternative form** — it's simpler and avoids Supabase FK declaration. Remove the `!emails_from_email_fkey` join attempts from the SELECT strings (keep the original SELECTs without sender_unsubscribe).

Add a new exported function `getNoiseGenerators`:

```ts
export async function getNoiseGenerators(opts: {
  minCount?: number;
  archiveThreshold?: number;
  limit?: number;
} = {}): Promise<SenderStats[]> {
  const minCount = opts.minCount ?? 3;
  const archiveThreshold = opts.archiveThreshold ?? 1.0;
  const limit = opts.limit ?? 50;

  // Pull inbox emails with their classification. Iterate pages until done.
  const pageSize = 1000;
  let page = 0;
  const stats = new Map<string, { name: string | null; total: number; archive: number }>();
  for (;;) {
    const { data, error } = await supabase()
      .from("emails")
      .select("from_email, from_name, classifications(category)")
      .eq("folder", "inbox")
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    const batch = (data as any[]) || [];
    if (!batch.length) break;
    for (const r of batch) {
      const addr = (r.from_email || "").toLowerCase();
      if (!addr) continue;
      const cls = (r.classifications || []) as Array<{ category: string }>;
      const cat = cls[0]?.category;
      const cur = stats.get(addr) ?? { name: r.from_name ?? null, total: 0, archive: 0 };
      cur.total++;
      if (cat === "archive") cur.archive++;
      stats.set(addr, cur);
    }
    if (batch.length < pageSize) break;
    page++;
  }

  // Filter + sort.
  const filtered: Array<{ addr: string; name: string | null; total: number; archive: number }> = [];
  for (const [addr, s] of stats) {
    if (s.total < minCount) continue;
    if (s.archive / s.total < archiveThreshold) continue;
    filtered.push({ addr, ...s });
  }
  filtered.sort((a, b) => b.total - a.total);
  const top = filtered.slice(0, limit);

  // Hydrate unsubscribe URLs in one query.
  const addrs = top.map(t => t.addr);
  const { data: unsubRows } = await supabase()
    .from("sender_unsubscribe")
    .select("from_email, unsubscribe_url, one_click")
    .in("from_email", addrs);
  const unsubMap = new Map((unsubRows || []).map(r => [r.from_email, r]));

  return top.map(t => ({
    from_email: t.addr,
    from_name: t.name,
    total: t.total,
    archive_count: t.archive,
    archive_pct: t.archive / t.total,
    unsubscribe_url: unsubMap.get(t.addr)?.unsubscribe_url ?? null,
    unsubscribe_one_click: unsubMap.get(t.addr)?.one_click ?? false,
  }));
}
```

- [ ] **Step 6.3: Verify build still passes**

```bash
cd dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 6.4: Commit**

```bash
cd .. && git add dashboard/lib
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "dashboard/queries: hydrate unsubscribe + getNoiseGenerators"
```

---

## Task 7: EmailCard surfaces Unsub link

**Files:**
- Modify: `dashboard/components/EmailCard.tsx`

- [ ] **Step 7.1: Update `EmailCard.tsx`**

The existing `<a>` wraps the whole card and navigates to Gmail. The Unsub link must NOT trigger that. Convert the card to a `<div>` with a separate `<a>` for Gmail and a separate `<a>` for unsubscribe.

Replace the entire returned JSX with:

```tsx
return (
  <div className="bg-white border border-[#ECE7DD] rounded-xl p-3.5 hover:border-[#D6CDB8] transition-colors relative">
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold text-[#1A1614] text-sm truncate">
          {showDot && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
              style={{ background: dotColor }}
            />
          )}
          {email.from_name || email.from_email || "(unknown)"}
        </div>
        <div className="text-[11px] text-[#9C9189] whitespace-nowrap">
          {relativeTime(email.received_at)}
        </div>
      </div>
      <div className="text-[11px] text-[#9C9189] truncate mt-0.5">
        {email.from_email}
      </div>
      <div className="text-sm text-[#3D362F] mt-1.5 leading-snug line-clamp-2">
        {email.subject || "(no subject)"}
      </div>
      {email.summary && (
        <div className="font-serif italic text-[#564B40] text-sm mt-2 leading-snug">
          {email.summary}
        </div>
      )}
      {email.why_priority && (
        <div className="text-[11px] uppercase tracking-wider text-[#9C9189] mt-2 font-semibold">
          {email.why_priority}
        </div>
      )}
    </a>
    {email.unsubscribe_url && (
      <a
        href={email.unsubscribe_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2.5 right-2.5 text-[10px] uppercase tracking-wider text-[#9C9189] hover:text-[#9C7847] font-semibold"
        title="Unsubscribe from this sender"
      >
        Unsub ↗
      </a>
    )}
  </div>
);
```

- [ ] **Step 7.2: Verify build + visual smoke**

```bash
cd dashboard && npm run build
```

- [ ] **Step 7.3: Commit**

```bash
cd .. && git add dashboard/components/EmailCard.tsx
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "dashboard/EmailCard: surface Unsub ↗ link when available"
```

---

## Task 8: /senders page

**Files:**
- Create: `dashboard/app/(protected)/senders/page.tsx`

- [ ] **Step 8.1: Write `dashboard/app/(protected)/senders/page.tsx`**

```tsx
import { getNoiseGenerators } from "@/lib/queries";

export const dynamic = "force-dynamic";

const THRESHOLDS = [
  { key: "3", label: "≥3 emails", value: 3 },
  { key: "5", label: "≥5 emails", value: 5 },
  { key: "10", label: "≥10 emails", value: 10 },
] as const;

function gmailSearch(addr: string) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${addr}`)}`;
}

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const minCountStr = searchParams.min ?? "3";
  const minCount = Number(minCountStr);
  let rows;
  try {
    rows = await getNoiseGenerators({ minCount, archiveThreshold: 1.0, limit: 50 });
  } catch {
    return (
      <div className="text-center py-16">
        <p className="text-[#7A7066]">Bashir is offline. Try again in a minute.</p>
      </div>
    );
  }

  const totalEmails = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <>
      <div className="font-serif text-2xl mb-1">Manage senders</div>
      <p className="text-sm text-[#7A7066] mb-4">
        {rows.length === 0
          ? "No sender qualifies as noise at this threshold."
          : `${rows.length} sender${rows.length === 1 ? "" : "s"} sending only archive — ~${totalEmails} email${totalEmails === 1 ? "" : "s"} to clear.`}
      </p>

      <div className="flex gap-1.5 mb-5">
        {THRESHOLDS.map((t) => {
          const active = minCountStr === t.key;
          return (
            <a
              key={t.key}
              href={`/senders?min=${t.value}`}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? "bg-[#1A1614] text-[#FBFAF7] border-[#1A1614]"
                  : "bg-white text-[#3D362F] border-[#ECE7DD] hover:border-[#D6CDB8]"
              }`}
            >
              {t.label}
            </a>
          );
        })}
      </div>

      {rows.length === 0 && (
        <p className="text-center text-[#7A7066] py-8">
          (If you haven't run <code className="bg-[#F2EDE2] px-1 rounded">python scripts/refresh_unsubscribe.py</code> yet, do that first to populate unsubscribe URLs.)
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((s) => (
          <div
            key={s.from_email}
            className="bg-white border border-[#ECE7DD] rounded-xl p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[#1A1614] text-sm truncate">
                  {s.from_name || s.from_email}
                </div>
                <div className="text-[11px] text-[#9C9189] truncate mt-0.5">
                  {s.from_email}
                </div>
              </div>
              <div className="text-[10px] font-semibold bg-[#1A1614] text-[#FBFAF7] px-2 py-0.5 rounded-full whitespace-nowrap">
                {s.total} email{s.total === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {s.unsubscribe_url ? (
                <a
                  href={s.unsubscribe_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold bg-[#9C7847] text-[#FBFAF7] px-3 py-1.5 rounded-full hover:bg-[#7A5A33]"
                >
                  Unsubscribe ↗
                </a>
              ) : (
                <span
                  className="text-xs text-[#9C9189] bg-[#F2EDE2] px-3 py-1.5 rounded-full"
                  title="No List-Unsubscribe header"
                >
                  No unsub link
                </span>
              )}
              <a
                href={gmailSearch(s.from_email)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold bg-white border border-[#ECE7DD] text-[#3D362F] px-3 py-1.5 rounded-full hover:border-[#D6CDB8]"
              >
                Bulk-delete in Gmail ↗
              </a>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 8.2: Commit**

```bash
git add dashboard/app/(protected)/senders
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "dashboard: /senders page (manage noise generators)"
```

---

## Task 9: Nav links

**Files:**
- Modify: `dashboard/components/BottomNav.tsx`
- Modify: `dashboard/components/SideNav.tsx`

- [ ] **Step 9.1: Update `BottomNav.tsx`**

In the `items` array, after the Archive entry, add:

```tsx
    { href: "/senders", label: "Senders", icon: "◆" },
```

- [ ] **Step 9.2: Update `SideNav.tsx`**

After the Archive `<Link>`, add (mirror its style):

```tsx
      <Link
        href="/senders"
        className={`block py-2 px-3 rounded-md mb-1 text-sm ${
          path.startsWith("/senders") ? "bg-[#F2EDE2] font-semibold" : "text-[#3D362F]"
        }`}
      >
        Senders
      </Link>
```

- [ ] **Step 9.3: Verify build**

```bash
cd dashboard && npm run build
```

- [ ] **Step 9.4: Commit**

```bash
cd .. && git add dashboard/components/BottomNav.tsx dashboard/components/SideNav.tsx
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "dashboard: nav adds Senders link"
```

---

## Task 10: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 10.1: Add migration note to "Initial setup" → "1. Supabase" section**

After the line about applying `sql/schema.sql`, add:

> Also apply `sql/unsubscribe.sql` (V1.2 migration) if you want in-app unsubscribe support.

- [ ] **Step 10.2: Add a one-liner under "Tune the prompt" or as a new step:**

> ### Refresh unsubscribe metadata
> Once per backfill (and the daily routine handles this automatically going forward):
> ```powershell
> python scripts/refresh_unsubscribe.py
> ```

- [ ] **Step 10.3: Commit**

```bash
git add README.md
git -c user.email=novaminds.20@gmail.com -c user.name=webo109 commit -m "README: document V1.2 unsubscribe migration + refresh"
```

---

## Self-Review

- ✅ **Schema:** Task 1 adds `sender_unsubscribe`, backwards-compatible
- ✅ **Gmail helper:** Task 2 — returns `(url, one_click)`, handles `HttpError`
- ✅ **Supabase helpers:** Task 3 — `upsert_sender_unsubscribe` + `get_senders_needing_unsubscribe_refresh`
- ✅ **Refresh script:** Task 4 — idempotent, paged, run_log integration
- ✅ **Daily routine:** Task 5 — runs refresh with `--new-senders-only`
- ✅ **Dashboard types/queries:** Task 6 — hydrates unsubscribe in queries, adds `getNoiseGenerators`
- ✅ **EmailCard:** Task 7 — shows Unsub link, stops propagation
- ✅ **/senders page:** Task 8 — list with two action buttons per sender
- ✅ **Nav:** Task 9 — Senders link added
- ✅ **README:** Task 10 — migration + refresh documented

**Placeholder scan:** none — every step has real code.

**Type consistency:** `EmailRow.unsubscribe_url` and `unsubscribe_one_click` defined in types.ts, used in queries.ts + EmailCard.tsx. `SenderStats` defined in types.ts, returned by `getNoiseGenerators`, consumed in `/senders` page.

## Verification (end-to-end)

After all tasks:
1. `python scripts/refresh_unsubscribe.py` returns success with N > 0 senders updated
2. `cd dashboard && npm run build` succeeds
3. `cd dashboard && npm test` still passes (no regressions in time/auth tests)
4. Visiting `/senders` shows ranked senders with Unsub buttons
5. Visiting `/archive` shows EmailCards with `Unsub ↗` in the top-right of cards from senders with URLs
6. Clicking `Unsub ↗` opens the unsubscribe URL in a new tab and does NOT navigate to Gmail
7. Bottom nav (mobile) and side nav (desktop) both show Senders entry
