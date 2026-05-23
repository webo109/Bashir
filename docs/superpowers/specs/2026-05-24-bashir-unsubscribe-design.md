# Bashir Dashboard — In-App Unsubscribe (V1.2)

**Status:** Approved 2026-05-24
**Owner:** Nova
**Builds on:** [V1.0 dashboard spec](2026-05-24-bashir-dashboard-design.md)

## Context

After the V1.0 dashboard shipped, 95% of inbox volume was being routed to `archive` and 30 senders accounted for 274 of those archived emails. The `scripts/noise_report.py` script extracted `List-Unsubscribe` URLs from Gmail headers and produced a Markdown cleanup sheet — but Nova still had to leave the dashboard and click through external URLs.

V1.2 brings those unsubscribe actions into the dashboard so noise can be killed without leaving the app. It is still **read-only toward Gmail itself** — Bashir doesn't delete emails or modify subscriptions server-side; it just surfaces the publicly-documented `List-Unsubscribe` URLs each sender already shipped in their headers, and Nova taps them.

## Scope

### V1.2 (this spec)
- A new `sender_unsubscribe` table that stores one `List-Unsubscribe` URL per distinct sender
- A new script `scripts/refresh_unsubscribe.py` that populates the table by walking Gmail headers
- The daily routine extends to refresh the table when a new sender is seen
- Every `<EmailCard>` in the dashboard surfaces an `Unsub ↗` link when a URL exists
- A new **`/senders`** page in the dashboard ranks the noise generators and offers one-tap unsubscribe + a deep-link to Gmail search for bulk deletion

### Explicit non-goals
- Bashir does not call the unsubscribe URL server-side — clicking opens the sender's own URL in a new tab
- Bashir does not delete emails from Gmail (that needs `gmail.modify` scope and is V2)
- No "blocklist" / "hide from archive" — a sender stays visible in archive even after unsubscribing
- No support for `mailto:` `List-Unsubscribe` URLs in V1.2 (we surface them as plain text only; user can copy the address)

### V2 (later, not this spec)
- Add `gmail.modify` scope, let Nova one-click delete archived emails for a sender
- Add per-sender hide preferences (`sender_overrides` table)
- Server-side unsubscribe (POST to one-click URLs for `RFC 8058` senders)

## Schema additions

```sql
create table if not exists sender_unsubscribe (
  from_email      text primary key,
  unsubscribe_url text,
  one_click       boolean default false,
  source_msg_id   text,
  updated_at      timestamptz default now()
);
create index if not exists idx_sender_unsubscribe_updated on sender_unsubscribe(updated_at desc);
```

Backwards-compatible — new table only, no changes to existing tables. The V1.0 dashboard keeps working if this table is empty.

## Backend changes

### `lib/gmail.py`
Add:
```python
def get_unsubscribe_header(service, gmail_msg_id: str) -> tuple[str | None, bool]:
    """Return (preferred_url, supports_one_click). url is None if header missing."""
```
Fetches `List-Unsubscribe` and `List-Unsubscribe-Post` headers via `format='metadata'`, parses out the first `https://` URL (or `mailto:` if no http), and detects RFC 8058 one-click support.

### `lib/supabase_client.py`
Add:
```python
def upsert_sender_unsubscribe(from_email: str, url: str | None,
                               one_click: bool, source_msg_id: str | None) -> None
def get_senders_missing_unsubscribe() -> list[str]
def get_sender_for_unsubscribe_refresh(stale_after_days: int = 30) -> list[tuple[str, str]]
    """Returns (from_email, sample_gmail_msg_id) for senders that need (re-)fetching."""
```

### `scripts/refresh_unsubscribe.py` (new)
- For each distinct `from_email` in `emails` not in `sender_unsubscribe` (or stale), find one recent `gmail_msg_id`, fetch headers, upsert
- Idempotent — safe to rerun
- Used both manually and from daily routine

### Daily routine integration
The daily routine prompt in `CLAUDE.md` gains step 5b: "Run `python scripts/refresh_unsubscribe.py --new-senders-only` to enrich any new senders before reporting counts."

## Dashboard changes

### Types (`dashboard/lib/types.ts`)
Extend `EmailRow`:
```ts
export interface EmailRow {
  // …existing fields…
  unsubscribe_url: string | null;
  unsubscribe_one_click: boolean;
}
```

### Queries (`dashboard/lib/queries.ts`)
Both `getTodayEmails` and `searchArchive` LEFT JOIN `sender_unsubscribe` on `from_email`. New function:
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
export async function getNoiseGenerators(opts: {
  minCount?: number;       // default 3
  archiveThreshold?: number; // default 1.0
  limit?: number;          // default 50
}): Promise<SenderStats[]>
```

### `<EmailCard>` (`dashboard/components/EmailCard.tsx`)
Add a subtle action row at the bottom-right when `unsubscribe_url` is present:
```
[ Unsub ↗ ]
```
- 10px text, muted color, becomes copper on hover
- Opens `unsubscribe_url` in new tab with `rel="noopener noreferrer"`
- Click handler also prevents the card's main `<a>` click (don't navigate to Gmail)

If sender has no URL: nothing extra shown (no placeholder).

### New page `/senders` (`dashboard/app/(protected)/senders/page.tsx`)
A focused "kill the noise" page:

- **Header:** "Manage senders" + summary line ("32 senders sending almost only archive; ~280 emails to clear")
- **Table-style list** (mobile-stacked, desktop-table), one row per noise sender, ranked by `total` desc:
  - Sender name + email
  - Count chip (e.g. "28 emails")
  - Archive percentage badge ("100%" / "95%" / etc.)
  - Two buttons:
    - **"Unsubscribe"** (primary, copper) — opens `unsubscribe_url` in new tab; disabled with tooltip "No List-Unsubscribe header" if URL missing
    - **"Bulk-delete in Gmail"** (secondary, muted) — opens Gmail search URL for that sender in new tab
- Filter chip at top: `[ ≥3 emails ] [ ≥5 emails ] [ ≥10 emails ]` — default ≥3

### Nav
Add **Senders** to both `<BottomNav>` and `<SideNav>` (third item, between Today and Archive on desktop, after Archive on mobile).

### Empty / error states
- Empty `sender_unsubscribe` table (haven't run refresh yet) → "Run `python scripts/refresh_unsubscribe.py` to populate this page."
- No noise generators matched the threshold → "Nice — no sender qualifies as noise at this threshold."
- Supabase error → standard "Bashir is offline" treatment

### Visual direction
Reuses the V1.0 palette and typography. The `/senders` page is a tighter "utility" feel than `/today` (which keeps the editorial flourish). Same warm neutrals.

## Verification

- `python scripts/refresh_unsubscribe.py` populates `sender_unsubscribe` for all known senders
- After running, query: most rows have a URL; ones without are typically transactional senders (Google, GitHub auth)
- Visit `/senders` on the dashboard, see top noise generators ranked by count
- Click an "Unsubscribe" button → opens the sender's URL in a new tab
- Click "Bulk-delete in Gmail" → opens Gmail filtered to that sender
- Visit `/archive`, see "Unsub ↗" links on EmailCards from senders with URLs
- Click an "Unsub ↗" link → opens new tab to unsubscribe URL; does NOT navigate to the Gmail message
- Refresh `/senders` after unsubscribing externally → that sender still appears (we don't auto-remove); they just stop sending new mail

## Risks

- `List-Unsubscribe` headers can change over time (sender rotates URLs or tokens expire). Refresh script defaults to refetching senders older than 30 days
- Some senders ship only `mailto:` unsubscribe links → V1.2 shows them as plain text only, no button
- Clicking unsubscribe is a one-way action with no in-app confirmation — that's intentional for now (matches how Gmail's built-in "unsubscribe" chip works)
