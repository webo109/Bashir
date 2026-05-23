# Bashir Dashboard — Design Spec

**Status:** Approved 2026-05-24
**Owner:** Nova
**Version:** V1.0 (web dashboard, read-only)

## Context

The Bashir backend (Python pipeline + Supabase + Claude Code Routines) classifies every incoming email across Nova's 5–6 Gmail accounts into five categories and writes the results to Supabase. Without a UI, those classifications are invisible — Nova has to query the DB by hand.

The dashboard is the surface that turns Bashir's daily output into something Nova actually reads. The product personality is "editorial briefing" — Bashir greets Nova with the day's news, gives a short narrative summary, and lists what matters with his voice on each item. Phone is the primary device (morning briefing over coffee). The dashboard does not replace Gmail — it triages so Nova knows what to open next.

## Scope

### V1.0 (this spec)
- Two pages: **Today** and **Archive**
- Password-gated (single env-var password)
- Mobile-first responsive layout
- Read-only — tapping an email opens it in Gmail in a new tab; no marking done, no snoozing, no replying
- Server-side data reads only (Supabase secret key never reaches the browser)
- Manual refresh (page reload) — no realtime, no auto-refresh

### Explicit non-goals for V1.0
- Monthly reports view (data only exists after June 1; ship in V1.1)
- Settings page for accounts/signals (manage via SQL initially; ship in V1.1)
- Marking emails done, snoozing, dismissing (V2 — would need a `dashboard_state` table and write-side auth)
- Realtime updates (Supabase realtime channels)
- Dark mode (V1.1)
- Multi-user (single allowlisted user — Nova)

### V1.1 (next, not this spec)
- Replace password gate with Google OAuth (restricted to Nova's specific Gmail addresses)
- Monthly reports page (charts + noise-generator list with one-tap Gmail filter copy)
- Settings page (accounts, custom signals, prompt version display)
- Rate-limit on password attempts
- Dark mode

## Stack

- **Framework:** Next.js 14, App Router, TypeScript
- **Styling:** Tailwind CSS + shadcn/ui (components installed individually as needed)
- **Data:** `@supabase/supabase-js` v2, server-side only
- **Hosting:** Vercel free tier, repo-connected, auto-deploys from `main`
- **Fonts:** Inter (UI) + Georgia stack (Bashir's voice — editorial summaries, greeting, brand wordmark)

## Project layout

Lives under the existing Bashir repo as a sibling folder to `lib/`, `scripts/`, etc. The Python pipeline is untouched.

```
Bashir/
├── (existing Python pipeline — untouched)
└── dashboard/
    ├── app/
    │   ├── layout.tsx              — root layout, fonts, base CSS
    │   ├── login/page.tsx          — password gate
    │   ├── api/auth/route.ts       — POST: verify password + set cookie
    │   ├── api/logout/route.ts     — POST: clear cookie
    │   └── (protected)/
    │       ├── layout.tsx          — auth check + shared nav
    │       ├── today/page.tsx      — editorial briefing
    │       └── archive/page.tsx    — searchable history
    ├── lib/
    │   ├── supabase.ts             — server client (SUPABASE_SECRET_KEY)
    │   ├── auth.ts                 — cookie sign/verify + middleware helper
    │   └── queries.ts              — getTodayEmails(), searchArchive(...)
    ├── components/
    │   ├── EmailCard.tsx
    │   ├── CategorySection.tsx
    │   ├── ArchiveSearch.tsx
    │   ├── ArchiveFilters.tsx
    │   ├── Greeting.tsx
    │   ├── BottomNav.tsx           — mobile bottom tab bar
    │   ├── SideNav.tsx             — desktop sidebar
    │   └── ui/                     — shadcn primitives (Button, Input, Card, Badge, ScrollArea)
    ├── public/                     — favicon, og image
    ├── package.json
    ├── tailwind.config.ts
    ├── tsconfig.json
    └── next.config.js
```

## Pages

### `/login` (public)
- Centered card, full-viewport background
- Bashir wordmark (serif "Bashir" + Arabic بشير in copper) + tagline "Bearer of good news"
- Single password input, "Enter" button
- Submit → POST `/api/auth` with `{ password }` → 200 + cookie set, redirect to `/today`; 401 → shake input, show "Try again" inline error
- Empty state for invalid attempts in V1.0: just show error message, no lockout

### `/today` (protected)
Top-to-bottom on mobile (≤768px):
1. **Header strip:** brand wordmark + today's date (e.g. "Saturday · May 24")
2. **Greeting:** large serif "Good morning, Nova." (time-of-day aware: "morning" before 12:00, "afternoon" before 18:00, "evening" after, Muscat time)
3. **Summary card:** italic serif paragraph generated from today's counts. Format: "N emails need your reply today, M opportunit{y|ies} from {description}, and K sent straight to archive." Examples:
   - "3 emails need your reply today, 1 fresh opportunity from a café, and 47 sent straight to archive."
   - "Quiet morning — nothing needs your reply. 1 opportunity from a prospect, 12 archived."
   - "Quiet morning. Bashir found nothing worth your attention."
4. **`reply_today` `<CategorySection>`** with count chip and list of `<EmailCard>`s (newest first)
5. **`opportunities` `<CategorySection>`** — same shape
6. **`important_fyi` `<CategorySection>`** — same shape
7. **`diploma_learning` `<CategorySection>`** — same shape
8. **Archive collapse:** "47 archived today — tap to expand" → reveals collapsed list (just from + subject, no Bashir voice; voice is null for archive)

"Today" window: emails received since 00:00 Muscat time today. Order within each category: `received_at DESC`.

### `/archive` (protected)
- Sticky top: search input (debounced 200ms, queries `subject` + `from_email` + `body` with `ilike`)
- Filter chips row (horizontal scroll on mobile):
  - Category chips (multi-select; default = none selected, meaning "all categories included")
  - Account chips (multi-select; default = none selected, meaning "all accounts included")
  - Date range: presets ("24h", "7d", "30d", "12mo", "all" — default = "30d") — V1.0 ships preset chips only; custom date picker is V1.1
- Email list with infinite scroll (50 rows/page, `received_at DESC`)
- Same `<EmailCard>` component as Today (with category color dot)
- Empty search result → "Nothing matches. Try fewer filters."

### Shared `(protected)/layout.tsx`
- Server-side auth check: read `bashir-session` cookie → verify signature + expiry → if invalid, `redirect('/login')`
- Renders `<BottomNav>` on mobile, `<SideNav>` on desktop (Tailwind `md:` breakpoint)
- Logout: cookie clear + redirect to `/login`

## Components

| Component | Purpose | Key props |
|---|---|---|
| `<Greeting>` | Time-of-day-aware salutation + summary card | `counts: Record<Category, number>` |
| `<CategorySection>` | Header (color dot + label + count chip) + email list. Collapses if empty unless category is reply_today. | `category`, `emails`, `defaultCollapsed?` |
| `<EmailCard>` | One email: from (name bold + email muted), relative time, subject, Bashir's `summary` (italic serif), `why_priority` (small label), tap → opens `gmail_url` in new tab | `email: EmailRow` |
| `<ArchiveSearch>` | Debounced search input, controls URL params | `defaultQuery?` |
| `<ArchiveFilters>` | Category + account + date-range chip row | `selected`, `onChange` |
| `<BottomNav>` | Mobile: Today / Archive / Logout | `currentPath` |
| `<SideNav>` | Desktop: same items in sidebar form | `currentPath` |

## Data flow

All Supabase reads happen in **Server Components** or **Server Actions** using the secret key from `SUPABASE_SECRET_KEY`. The browser never sees the key, never talks to Supabase directly. No RLS configuration needed for V1.0.

**Query functions in `lib/queries.ts`:**

```ts
// Today: emails received since today's start in Muscat time, joined with classifications.
getTodayEmails(): Promise<{ category: Category; emails: EmailWithClassification[] }[]>

// Archive: paged, filtered search.
searchArchive(params: {
  q?: string;
  categories?: Category[];
  accountIds?: number[];
  range?: '24h' | '7d' | '30d' | '12mo' | 'all';
  page: number;
}): Promise<{ rows: EmailWithClassification[]; hasMore: boolean }>
```

Both use a join: `emails LEFT JOIN LATERAL (SELECT * FROM classifications WHERE classifications.email_id = emails.id ORDER BY classified_at DESC LIMIT 1) c ON true`. This always picks the most recent classification per email (relevant when a prompt-version bump triggers reclassification — V1.0 only ever shows the newest classification per email; the UNIQUE constraint on `(email_id, prompt_version)` guarantees at most one per version).

## Auth (V1.0 password gate)

- Server-side env var: `DASHBOARD_PASSWORD` (set in Vercel project env + local `.env`)
- Cookie name: `bashir-session`
- Cookie value: `<iat>.<sig>` where `iat` is a unix timestamp (issued-at) and `sig = HMAC-SHA256(DASHBOARD_SESSION_SECRET, iat).hex()`
- Cookie attrs: `httpOnly`, `secure` (in prod), `sameSite=lax`, `maxAge=30 days`, `path=/`
- Verification: split on `.`, recompute HMAC over `iat` with constant-time compare, check `iat + 30d > now`. Any failure → treat as unauthenticated, redirect to `/login`.
- `/api/auth` POST: compare submitted password to env var (constant-time), set cookie, return 200
- `/api/logout` POST: set cookie with `maxAge=0`, redirect to `/login`
- No rate limiting in V1.0 (trade-off accepted; V1.1 adds one)
- V1.1 replaces this with Google OAuth via Supabase Auth — same cookie semantics, different verification

## Visual direction

### Palette
- Background: `#FBFAF7` (bone)
- Surface (cards): `#FFFFFF`
- Secondary surface (summary card bg): `#F2EDE2`
- Text primary: `#1A1614` (charcoal)
- Text secondary: `#3D362F`
- Text muted: `#7A7066`
- Text faint: `#9C9189`
- Borders: `#ECE7DD`
- Accent (Bashir's voice, copper): `#9C7847`

### Category colors (used as 8px dots in section headers and `<EmailCard>`)
- `reply_today` — `#C45A3D` (warm red)
- `opportunities` — `#5C8A4F` (sage green)
- `important_fyi` — `#3D6B8A` (steel blue)
- `diploma_learning` — `#7A4F8A` (plum)
- `archive` — `#9C9189` (warm gray)

### Typography
- **UI:** Inter (Google Fonts), 14–16px body, weights 400/500/600/700
- **Editorial (Bashir's voice):** Georgia stack (`Georgia, 'Times New Roman', serif`) — used for the greeting, summary card, and each email's `summary`/`why_priority` rendered italic. Native stack (no web font load) keeps initial render fast.
- **Brand:** "Bashir" in serif 1.4rem; Arabic "بشير" in system Arabic sans, copper

### Motion
- Cards fade-up on load with 50ms stagger (Framer Motion or Tailwind `animate-in fade-in-0 slide-in-from-bottom-2`)
- Archive section slides open/closed (CSS `grid-template-rows: 0fr → 1fr` transition trick)
- No spinners; show server-rendered content immediately. For search debounce, fade list to 60% opacity during typing.

### Density / sizing
- Email card: ~80–100px tall on mobile
- Tap targets ≥44px
- Page max-width on desktop: 720px (single column, centered) — even on desktop, the editorial briefing should feel like one focused column, not a wide dashboard

## Empty / error states

| State | Treatment |
|---|---|
| No emails today across all categories | Greeting + "Quiet morning. Bashir found nothing worth your attention." No category sections rendered. |
| One category empty | Section header hidden; no "0 emails" placeholder. |
| Supabase unreachable (server error) | Full-page "Bashir is offline. Try again in a minute." + retry button. |
| Wrong password | Inline error under password field, shake input. |
| Archive search returns 0 | "Nothing matches. Try fewer filters." inside the list area. |
| Network failure during archive infinite-scroll | Footer of list shows "Couldn't load more. Retry." |

## Env vars

Added to `.env.example` and Vercel project env:

```
DASHBOARD_PASSWORD=                # V1.0 — replace with OAuth in V1.1
DASHBOARD_SESSION_SECRET=          # random 32-byte hex, used for HMAC signing the session cookie

# Reused from existing Bashir env:
NEXT_PUBLIC_SUPABASE_URL=https://yrmycgebhqlwptflkceb.supabase.co
SUPABASE_SECRET_KEY=               # server-side only — bypasses RLS, never sent to client
```

`NEXT_PUBLIC_SUPABASE_URL` is fine to expose — it's just a hostname. The secret key stays server-side.

## Deployment

- Push to `main` of `webo109/Bashir` → Vercel auto-builds the `dashboard/` subdirectory (Vercel project's Root Directory setting = `dashboard`)
- Build command: `next build` (default)
- Output: serverless functions for the protected pages + static assets
- All five env vars set in Vercel project settings

## Testing notes

- Manual test golden path: load `/today` (no cookie) → redirected to `/login` → wrong password → error → correct password → land on `/today` with real classifications visible.
- Manual archive test: search for a known sender's name → results filtered → click category chip to narrow → click email → opens Gmail in new tab.
- Mobile: test on phone in browser dev tools at iPhone 14 width (390px) — bottom nav visible, cards tappable, summary card readable.
- No automated tests in V1.0 (small surface, manual coverage is sufficient).

## Open questions (deferred to V1.1 or later)

- Avatar/sender icon — skip in V1.0, consider in V1.1 (use Gravatar by email hash or Letter avatars).
- Search ranking — V1.0 is just `ilike`, no relevance scoring. If results are noisy in practice, swap to Postgres full-text search in V1.1.
- Time zone handling — server uses `Asia/Muscat` for "today" boundary; if Nova ever travels, that's still correct (Bashir is Nova-time, not device-time).

## References

- Mockup: `.superpowers/brainstorm/613-1779567426/content/today-mockup.html`
- Backend schema: `sql/schema.sql`
- Classification prompt: `prompts/triage.md`
- Pipeline runbook: `CLAUDE.md`
