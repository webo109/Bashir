# Bashir audit — findings

## Summary

The codebase is small, well-organized, and largely matches the spec. `npm run build` and `npm test` both pass cleanly (10/10 unit tests). The dashboard never leaks the Supabase secret key to the client. However, there are **three correctness bugs that will cause real data loss / broken UX in production**: (1) the daily fetcher advances the Gmail history cursor before persist.py runs, so a crash between the two phases silently loses that day's emails forever; (2) `fetch.py backfill --limit N` does the full fetch first and only trims afterward, so the loop pattern documented in `CLAUDE.md` and `README.md` re-fetches all 12 months on every iteration (and on a real Nova-sized backfill, simply will never finish); (3) the `searchArchive` category filter is applied client-side AFTER pagination, so the "Older →" link gives wrong results whenever a category chip is selected. There are also two **security** issues worth fixing soon: the `subject`/`body` search input is interpolated unsanitized into a PostgREST `.or()` clause (no escaping of `,` or `%`), and the spec's redirect-after-login lacks any open-redirect protection (currently hard-coded so safe today, but worth keeping locked). Everything else is nits.

## Critical (must fix)

- [ ] **Daily fetch advances `last_history_id` before persist.py runs → data loss on partial failure** — `scripts/fetch.py:109-111`. `fetch_daily_for_account` writes the new `latest_history_id` to Supabase immediately after fetching. If classification or `persist.py` fails (network blip, Claude error, Supabase outage), the next daily run starts from a cursor AFTER the unpersisted emails, and `existing_gmail_ids` can't catch them because they were never inserted. Those emails are lost forever. Fix: only update `last_history_id` from `persist.py` after a successful insert (move the cursor write into `persist_emails_and_classifications` or have `persist.py` read the new cursor from a sidecar file in `tmp/` and commit it transactionally with the inserts).

- [ ] **`fetch.py backfill --limit N` re-does the full 12-month fetch on every iteration** — `scripts/fetch.py:60-84,113,115-116`. `fetch_backfill_for_account` calls `gmail.list_since(...)`, looks up `existing_gmail_ids` for ALL of them, and calls `gmail.get_message()` per ID for ALL of them *before* returning. The `--limit` slice only happens AFTER all that work, in `main()`. The "loop in 50-message chunks" pattern documented in `CLAUDE.md:35-38` and `README.md:74` therefore re-fetches every unprocessed message in the entire 12-month window on every iteration — quadratic API cost on Gmail, and on a real Nova-sized inbox it will either get rate-limited or never complete. Fix: push `--limit` (or a `--max` parameter) down into `fetch_backfill_for_account` and stop fetching messages once the cap is hit.

- [ ] **`searchArchive` category pagination is broken when a category chip is selected** — `dashboard/lib/queries.ts:88,108-117`. The DB query fetches `pageSize+1` rows unfiltered, then category filtering is applied in JS. `hasMore = filtered.length > pageSize` is therefore wrong: if 51 fetched rows reduce to 5 after the category filter, the page shows 5 rows and reports `hasMore=false` — even though older matching rows exist further back. The "Older →" link disappears and the user thinks they've seen everything. Fix: do category filtering in the SQL query. Because `classifications` is 1:many per email, use a Postgres view or do a sub-select; alternatively, paginate over a `latest_classification` view that flattens to one row per email and supports `.in("category", ...)` server-side.

- [ ] **PostgREST `.or()` filter is built with unsanitized URL input — query breakage and possible filter injection** — `dashboard/lib/queries.ts:90-93`. The user's search term is interpolated as `%${q}%` and shoved into a comma-separated `.or()` clause. A search for `foo,bar` becomes `subject.ilike.%foo,bar%,from_email.ilike.%foo,bar%,...` — the `,` is a PostgREST separator, so the parser sees broken filters and either errors out or applies different filters than intended. A `*` or `(` will similarly mangle the query. Fix: escape commas, parentheses, and percent signs (e.g., wrap the value in PostgREST's quoting: `"%foo,bar%"`), or use `.textSearch()` / a per-column `.ilike()` chained with manual OR aggregation, or strip non-alphanumeric characters from `q` before interpolating.

## Important (should fix soon)

- [ ] **No rate-limit / lockout on `/api/auth` POST** — `dashboard/app/api/auth/route.ts`. Acknowledged in the spec as a V1.1 trade-off, but with a single-password gate and no other auth layer this lets an attacker brute-force the password via raw POSTs (no captcha, no slowdown, constant-time only protects against timing — not throughput). At minimum add a per-IP exponential backoff or a sleep-on-failure. Fix: 200–500ms `setTimeout` on failure, or upstash-style rate-limit middleware.

- [ ] **`gmail.modify` not requested but `gmail.send` is granted for every account** — `lib/gmail.py:25-28`. The Gmail scopes include `gmail.send` so the notifier can fire — but that scope is requested on EVERY account during OAuth, including accounts that will never be the sender. If a refresh token leaks, the attacker can send mail from any authorized inbox. Fix: split scopes — request `gmail.readonly` for all accounts, and `gmail.send` only on the `NOTIFY_FROM_EMAIL` account (separate OAuth flow / separate row in `accounts`).

- [ ] **`getTodayEmails` and `searchArchive` over-fetch nested classifications** — `dashboard/lib/queries.ts:57,84`. The select grabs ALL classifications per email (one per prompt_version) and `flatten()` discards every row except the newest. After a few prompt-version bumps, every email row carries N classifications down the wire. Fix: either order+limit the join (`classifications!inner(...).order(classified_at, ascending=false).limit(1)`) or, better, expose a SQL view `emails_with_latest_classification` and select from that — solves both the over-fetch and the category-filter issue above.

- [ ] **Monthly report `quiet_conversations` window may double-count or miss threads at the edge** — `scripts/monthly.py:124-153`. `quiet_conversations` only looks at messages within the 30-day window. If Nova's last sent message in a thread was 35 days ago and the thread has no inbound since, the thread is invisible to this report — even though it's exactly the "quiet conversation" the metric tries to surface. Fix: don't gate `quiet_conversations` on the 30-day window — query all threads where the latest message overall is `folder='sent'` and is between `QUIET_DAYS` and `~90d` old.

- [ ] **`existing_gmail_ids` IN-clause is unbounded** — `lib/supabase_client.py:56-68` called from `scripts/fetch.py:48,69`. On backfill an account with 50k emails passes 50k IDs in one `.in_()`. Supabase/PostgREST will reject or silently truncate very large IN lists (usually around 1000–5000 items, depending on URL length). Fix: chunk the IDs (e.g., 500 per call) and union the results, or skip the pre-check entirely on backfill and rely on `INSERT … ON CONFLICT DO NOTHING` (which `insert_emails` already uses).

- [ ] **`searchArchive` body-search will be slow once data grows** — `dashboard/lib/queries.ts:90-93`, `sql/schema.sql`. There's no index on `body` (or any of the `ilike`-searched columns), and `body` can be 4000 chars. With even a few thousand emails an unindexed leading-wildcard `ilike '%foo%'` will sequential-scan the whole table. Fix: ship a `pg_trgm` GIN index on `(subject, from_name, from_email)` (and optionally `body`), or move to Postgres full-text search (`to_tsvector` + GIN).

- [ ] **`useEffect` in `ArchiveSearch` runs once mounted with stale `params` snapshot** — `dashboard/components/ArchiveSearch.tsx:11-21`. The effect depends only on `[q]` (explicitly silenced lint warning) but reads `params` from the closure — if the user changes filters via the chip row, `params` updates but the search effect uses the stale snapshot, accidentally clobbering the URL on the next keystroke. Fix: include `params.toString()` in the dep array, or read the URL fresh via `window.location.search` at submission time.

- [ ] **OneDrive / cloud-sync of `.env` exposes live secrets** — `.env` at the repo root contains real `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, and a Supabase anon JWT, and the entire repo lives in a OneDrive-synced path. The README mentions this risk; it should be treated as a real exposure now and rotated. Move the repo out of OneDrive, or move `.env` to a sibling path outside the synced folder and have `lib/config.py` read from there. (The keys are already in cloud-storage history.)

- [ ] **`muscatDateLabel()` runs on the server (Vercel) and uses `Date.toLocaleDateString("en-US", {..., timeZone: "UTC"})` on a pre-shifted Date** — `dashboard/lib/time.ts:25-31`. The function shifts `now` by +4h then formats it with `timeZone: "UTC"`. That works, but it's brittle: anyone copying the pattern and forgetting the manual shift will be wrong by 4h. Fix: use `timeZone: "Asia/Muscat"` directly on the original `now` and drop the manual shift entirely.

- [ ] **No CSP, no `X-Frame-Options`, no other security headers** — `dashboard/next.config.mjs` is empty. The dashboard has a single password, holds session cookies, and currently has nothing preventing it being iframed by a phishing site that then mounts a click-jacking attack to issue logouts (or worse, when V2 adds writes). Fix: add `headers()` to `next.config.mjs` with at minimum `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a basic CSP.

- [ ] **`type=submit` button inside `<form className="contents">` works, but the form has no `id` and is associated with the bottom-nav grid by DOM position only** — `dashboard/components/BottomNav.tsx:28-33`. If a parent layout ever re-renders or the nav re-orders, an enter-keypress while focused on either Today/Archive `<Link>` could submit the logout form (browsers walk up the DOM looking for the closest form). Fix: give the logout `<button>` `type="button"` and an explicit `formAction`, or move the logout form to its own `<li>` with `role="none"`.

## Nits (nice to fix)

- [ ] **`subject?.toLowerCase` not used — no need; just noting `getTodayEmails` ignores `folder='sent'`** — `dashboard/lib/queries.ts:60`. Correct for the editorial view, but worth a comment so future readers don't add sent items.

- [ ] **`relativeTime` rounds with `Math.round`, so 30 seconds shows "1m ago"** — `dashboard/lib/time.ts:35`. The "just now" branch is unreachable when `now - then` is between 30s and 60s. Use `Math.floor` instead.

- [ ] **`Greeting` hard-codes "Quiet morning"** even when `greetingPeriod()==='evening'` — `dashboard/components/Greeting.tsx:52`. The "no emails" branch returns `"Quiet morning. Bashir found nothing worth your attention."` regardless of time of day. Fix: use `Quiet ${period}` or rephrase.

- [ ] **`Greeting.buildSummary` crashes on `parts[0][0]` if `parts` is empty** — `dashboard/components/Greeting.tsx:66-69`. Unreachable in practice (early return on `total===0` guarantees `parts.length >= 1` because the `r > 0` branch always pushes), but the implicit dependency is fragile. Add an `if (!parts.length) return '';` guard.

- [ ] **Empty-state copy is over-specific: "Quiet morning. Bashir found nothing worth your attention." is shown even when archive count > 0 but every category is 0** — `dashboard/components/Greeting.tsx:51-53`. Re-read the condition: total includes archive, so this only fires when *literally nothing* arrived. Fine for V1.0, but the spec's example "Quiet morning — nothing needs your reply. 1 opportunity from a prospect, 12 archived." (line 98 of the spec) is NOT what the code produces — the code would say "Nothing needs your reply, 1 opportunity surfaced, 12 sent straight to archive." Worth aligning either the spec or the code.

- [ ] **`fade-up` animation re-runs on every keystroke in the search box** — `dashboard/components/CategorySection.tsx:29`, `dashboard/app/(protected)/archive/page.tsx`. Each navigation re-renders the server component, server-rendered cards get a fresh `key`, and the CSS keyframes fire again. Distracting on Archive when searching. Fix: scope `fade-up` to Today only, or add `prefers-reduced-motion: reduce` override.

- [ ] **`#9C9189` on `#FFFFFF` is borderline WCAG AA** — palette per `dashboard/app/globals.css:14`. Contrast ratio ≈ 3.1:1; WCAG AA for normal text needs 4.5:1. `from_email`, the relative-time text in `EmailCard.tsx:25,29`, and the "Nothing matches" copy all use this. Fix: darken `--bashir-faint` to `#7A7066` (already in palette as `--bashir-mute`) for body text, keep `#9C9189` for decorative dots only.

- [ ] **`<Greeting>` uses `<h1>` but the page already has an implicit page title in the meta tag; on `/archive` the `<h1>` slot is filled by a `<div>`** — `dashboard/components/Greeting.tsx:32`, `dashboard/app/(protected)/archive/page.tsx:51`. Inconsistent heading hierarchy across pages. Archive should use `<h1>Archive</h1>` instead of `<div className="font-serif text-2xl">`.

- [ ] **`<a target="_blank">` without `rel="noopener noreferrer"` is fixed in EmailCard — but `ArchiveCollapse.tsx:24-26` and the email `gmail_url` in noise_report.py output do include it** — looks OK; just confirming.

- [ ] **`getTodayEmails` ordering is fine globally but client-side bucketing into categories doesn't preserve within-category order beyond what SQL gave** — `dashboard/app/(protected)/today/page.tsx:22-28`. `emails.filter` preserves order, so this works because the SQL `.order(received_at desc)` is the desired order. Add a comment so future refactors don't break it.

- [ ] **`lib/__init__.py` is empty** — `lib/__init__.py`. Fine, but worth a single-line module docstring noting these are Python helpers shared across `scripts/`.

- [ ] **`scripts/monthly.py` doesn't write a `year_month` value into the JSON payload** — `scripts/monthly.py:174-187`. The DB row has `year_month` but the JSON payload omits it. Add it for self-describing payloads.

- [ ] **`scripts/monthly.py` `category_of` always picks `cls[0]` not the newest** — `scripts/monthly.py:64-66`. Same bug as in the frontend before the `flatten` sort: if there are multiple classifications per email (different prompt versions), this picks an arbitrary one (whichever Supabase chose to return first). Fix: sort by `classified_at desc` or fetch with explicit ORDER + LIMIT 1.

- [ ] **`scripts/persist.py` clears `tmp/` even on partial failure** — `scripts/persist.py:67`. If one account's persist fails mid-loop, the script raises (`raise` at line 57), but if any other account had already inserted, the `clear_handoff()` at line 67 will not run (good). However, if the per-account loop completes for all but the last classification (which is silently dropped because no `email_id`), there's no logging of which message IDs were skipped. Fix: include skipped IDs in the WARNING.

- [ ] **`Greeting.tsx` `period` is computed at render time but the page is `dynamic = "force-dynamic"` so this is OK** — just noting; no fix.

- [ ] **`shake` animation is `<style jsx global>` inside the login page** — `dashboard/app/login/page.tsx:61-67`. `<style jsx>` requires the `styled-jsx` package, which Next ships with by default — but the page is also marked `"use client"` and the `<style jsx global>` block adds a runtime cost. Easier: define `@keyframes shake` in `globals.css` next to `fadeUp`.

- [ ] **`scripts/fetch.py` 30-days-per-month math** — `scripts/fetch.py:63`. `timedelta(days=30 * months)` undercounts: 12 months = 360 days, missing ~5. For a "12-month backfill", use `relativedelta(months=12)` (already pulled in by `google-auth`? no) or 365 days.

- [ ] **`scripts/oauth_setup.py` does not save the email/account_id printed to disk anywhere** — `scripts/oauth_setup.py:80-82`. Stored in Supabase only. If Supabase is down at that moment, the OAuth flow is wasted. Fix: also write to `tmp/oauth_log.txt` as a fallback.

- [ ] **Unused dependencies in `dashboard/package.json`** — `lucide-react`, `tw-animate-css`, `shadcn`, `class-variance-authority` declared but only `cva` is imported (via badge/button); `lucide-react` and `tw-animate-css` never imported. Either remove or actually use.

- [ ] **`dashboard/README.md` is the default `create-next-app` output** — `dashboard/README.md`. Replace with a few lines pointing at the parent `README.md` and noting `npm run dev` / `npm test`.

- [ ] **`dashboard/scripts/smoke.ts` is a one-off probe but is shipped in git** — fine, but no docs say it exists. Mention in the parent README under "Dashboard development".

- [ ] **`gmail.send_email()` doesn't set From header** — `lib/gmail.py:204-211`. Gmail will fill it in with the authenticated account, so this works, but it's surprising. Add the From explicitly.

- [ ] **`_strip_html` imports `re` inside the function** — `lib/gmail.py:194`. Move to top-level for consistency with other modules.

- [ ] **`noise_report.py` "Gmail filter" instructions tell user to manually create the filter in Gmail's UI** — `scripts/noise_report.py:199`. The V1.2 spec adds in-app unsubscribe, so this command will be deprecated. Add a comment noting it's a temporary CLI before the V1.2 UI.

## Spec ↔ code drift

- The spec's example summary "Quiet morning — nothing needs your reply. 1 opportunity from a prospect, 12 archived." (`docs/superpowers/specs/2026-05-24-bashir-dashboard-design.md:98`) does NOT match the code's output. The code joins parts with `, ` only (no `—`), and uses "sent straight to archive" instead of just "archived". Either the spec is illustrative-only or the code needs to match. Likely the former, but worth confirming.

- The spec says (line 113) "Category chips … default = none selected, meaning 'all categories included'" — the code matches. ✅

- The spec calls for "infinite scroll" on `/archive` (`spec:114`) but the code uses Older/Newer pagination links. Functional but different UX from spec.

- The spec specifies the join pattern with a `LEFT JOIN LATERAL` SQL note (`spec:155`); the code uses Supabase's nested `classifications(...)` which fetches all then sorts client-side. Different mechanism, same visible result, but with the over-fetch concern flagged above.

- The spec's "Search debounce, fade list to 60% opacity during typing" (`spec:197`) is not implemented. List stays at 100%.

- The spec's "Archive section slides open/closed (CSS grid-template-rows: 0fr → 1fr)" (`spec:196`) is not implemented — `ArchiveCollapse` is a hard `&& open` toggle with no transition.

- The spec says env vars include `DASHBOARD_PASSWORD` and `DASHBOARD_SESSION_SECRET` (`spec:219-221`). Neither is documented in the **root** `.env.example`, only in `dashboard/.env.local.example`. Add to the root `.env.example` so all env vars live in one place (or explicitly note in the root README that dashboard envs are separate).

- `evals/` is referenced in `README.md:77-82` and `CLAUDE.md:40-43` (eval workflow) but the audit doesn't include reviewing `evals/run.py`. Worth confirming it's exercised at least once.

- The spec mentions a `senders` page deferred to V1.1 / V1.2 — not implemented and not required by V1.0. ✅

## Things that look right (don't fix)

- HMAC session cookie (`dashboard/lib/auth.ts`): correct use of `createHmac`, `timingSafeEqual`, length-check before `timingSafeEqual` (which throws on mismatched buffer lengths) — all good. Tests cover the right cases.

- The Supabase secret key never makes it to the client. `dashboard/lib/supabase.ts` is server-only, the env var is unprefixed (`SUPABASE_SECRET_KEY`, not `NEXT_PUBLIC_*`), and all queries run from server components / API routes.

- Cookie attributes (`httpOnly`, `secure` in prod, `sameSite=lax`, `maxAge=30d`) are sensible defaults.

- The HMAC cookie key splits with `cookie.split(".", 2)` — limits to first dot, correctly handles a stray `.` in the (unlikely) future payload.

- `gmail.list_history` correctly handles the 404 "history id too old" case and signals fallback via `None`.

- `gmail.parse_message` correctly walks MIME parts, prefers text/plain, falls back to stripped HTML, truncates very long bodies.

- The CHECK constraint on `classifications.category` mirrors the five categories in `prompts/triage.md` and `dashboard/lib/types.ts`. Cross-file consistency is good.

- `monthly.py` paginates `_fetch_window` correctly (size 1000, breaks when batch < page_size).

- `noise_report.py` correctly handles both shapes (`dict` and `list`) of the nested `accounts` field returned by Supabase — defensive but correct.

- Backend Python imports cleanly via `.venv/Scripts/python.exe -c "from lib import ..."` — no module-level side effects beyond loading `.env`.

- `npm run build` produces a clean Next.js build with the expected route surface (`/`, `/login`, `/today`, `/archive`, `/api/auth`, `/api/logout`) and correct static vs dynamic markings.

- `npm test` passes all 10 unit-test assertions across the `auth` and `time` libs.

- The unit tests for `verifySession` cover tamper, expiry, malformed, and short-sig cases — good coverage for a security primitive.

- Tailwind config, shadcn components, and Next.js App Router setup are conventional and unsurprising.
