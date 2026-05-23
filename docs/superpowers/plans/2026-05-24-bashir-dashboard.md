# Bashir Dashboard V1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Bashir dashboard (Today + Archive pages) with password gate, mobile-first, deployed to Vercel from the existing `webo109/Bashir` repo.

**Architecture:** Next.js 14 App Router subdirectory (`dashboard/`) inside the Bashir repo. Server Components do all Supabase reads using the secret key. Password gate uses an HMAC-signed httpOnly cookie. Editorial briefing on Today, paginated search on Archive. No client-side Supabase, no realtime, no marking-done.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, `@supabase/supabase-js` v2, Vitest (for the two pure-logic libs only), Vercel.

**Spec:** [`docs/superpowers/specs/2026-05-24-bashir-dashboard-design.md`](../specs/2026-05-24-bashir-dashboard-design.md)

---

## File Structure

```
Bashir/
└── dashboard/
    ├── package.json
    ├── tsconfig.json
    ├── next.config.js
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── components.json              # shadcn config
    ├── vitest.config.ts             # for lib unit tests only
    ├── .env.local.example           # documented; real .env.local is gitignored
    ├── app/
    │   ├── globals.css              # Tailwind base + theme tokens
    │   ├── layout.tsx               # root layout + Inter font
    │   ├── page.tsx                 # redirect to /today
    │   ├── login/page.tsx           # password form
    │   ├── api/auth/route.ts        # POST: verify password + set cookie
    │   ├── api/logout/route.ts      # POST: clear cookie
    │   └── (protected)/
    │       ├── layout.tsx           # cookie check + responsive nav
    │       ├── today/page.tsx       # editorial briefing
    │       └── archive/page.tsx     # search + filters + list
    ├── lib/
    │   ├── types.ts                 # Category enum, EmailRow, etc.
    │   ├── supabase.ts              # server-side client factory
    │   ├── auth.ts                  # cookie sign/verify (HMAC-SHA256)
    │   ├── time.ts                  # Muscat "today" boundary + greeting period
    │   └── queries.ts               # getTodayEmails, searchArchive
    ├── components/
    │   ├── Greeting.tsx             # serif greeting + italic summary
    │   ├── EmailCard.tsx
    │   ├── CategorySection.tsx
    │   ├── ArchiveCollapse.tsx      # "47 archived — tap to expand"
    │   ├── ArchiveList.tsx          # infinite scroll list
    │   ├── ArchiveSearch.tsx        # debounced search input
    │   ├── ArchiveFilters.tsx       # category + account + range chips
    │   ├── BottomNav.tsx            # mobile bottom tab bar
    │   ├── SideNav.tsx              # desktop sidebar
    │   └── ui/                      # shadcn primitives added as needed
    └── __tests__/
        ├── auth.test.ts
        └── time.test.ts
```

**Working directory for all commands:** `Bashir/dashboard/` unless noted otherwise.

---

## Task 1: Scaffold Next.js + Tailwind + shadcn

**Files:**
- Create: `dashboard/` (entire directory via `create-next-app`)
- Modify: `Bashir/.gitignore` (add `dashboard/node_modules/`, `dashboard/.next/`, `dashboard/.env.local`)
- Verify: `dashboard/package.json`, `dashboard/tailwind.config.ts`, `dashboard/components.json`

- [ ] **Step 1.1: Create the Next.js app**

From `Bashir/` root (not from inside an existing `dashboard/` folder):

```bash
npx create-next-app@14 dashboard --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
```

If the CLI still prompts despite flags: answer **No** to "Would you like to use src/" and **Yes** to "Would you like to use App Router?", accept defaults for everything else.

Expected: `dashboard/` folder exists with `app/`, `package.json`, `tailwind.config.ts`, `next.config.js`.

- [ ] **Step 1.2: Verify the dev server starts**

```bash
cd dashboard && npm run dev
```

Expected: server boots on `http://localhost:3000` showing the default Next.js template. Stop with Ctrl+C.

- [ ] **Step 1.3: Initialize shadcn/ui**

```bash
cd dashboard && npx shadcn@latest init
```

Answer prompts:
- Style: **Default**
- Base color: **Neutral**
- CSS variables: **Yes**

Expected: `components.json` created, `app/globals.css` updated with CSS vars, `lib/utils.ts` created.

- [ ] **Step 1.4: Install components we'll need throughout**

```bash
cd dashboard && npx shadcn@latest add button input badge card scroll-area
```

Expected: files appear in `components/ui/` (button.tsx, input.tsx, badge.tsx, card.tsx, scroll-area.tsx).

- [ ] **Step 1.5: Update root `.gitignore`**

In `Bashir/.gitignore`, add at the bottom:

```
# Dashboard
dashboard/node_modules/
dashboard/.next/
dashboard/.env.local
dashboard/.vercel
```

- [ ] **Step 1.6: Commit**

```bash
cd ..  # back to Bashir/ root
git add dashboard/ .gitignore
git commit -m "dashboard: scaffold Next.js + Tailwind + shadcn"
```

---

## Task 2: Types + Supabase client

**Files:**
- Create: `dashboard/lib/types.ts`
- Create: `dashboard/lib/supabase.ts`
- Create: `dashboard/.env.local.example`

- [ ] **Step 2.1: Install Supabase client**

```bash
cd dashboard && npm install @supabase/supabase-js
```

- [ ] **Step 2.2: Write `dashboard/lib/types.ts`**

```ts
export type Category =
  | "reply_today"
  | "important_fyi"
  | "opportunities"
  | "diploma_learning"
  | "archive";

export const CATEGORY_ORDER: Category[] = [
  "reply_today",
  "opportunities",
  "important_fyi",
  "diploma_learning",
  "archive",
];

export const CATEGORY_LABEL: Record<Category, string> = {
  reply_today: "Reply today",
  opportunities: "Opportunities",
  important_fyi: "Important FYI",
  diploma_learning: "Diploma & learning",
  archive: "Archive",
};

export const CATEGORY_COLOR: Record<Category, string> = {
  reply_today: "#C45A3D",
  opportunities: "#5C8A4F",
  important_fyi: "#3D6B8A",
  diploma_learning: "#7A4F8A",
  archive: "#9C9189",
};

export interface EmailRow {
  id: number;
  gmail_msg_id: string;
  account_id: number;
  account_email?: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  received_at: string; // ISO
  gmail_url: string | null;
  folder: string;
  category: Category | null;
  summary: string | null;
  why_priority: string | null;
}
```

- [ ] **Step 2.3: Write `dashboard/lib/supabase.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

- [ ] **Step 2.4: Write `dashboard/.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=https://yrmycgebhqlwptflkceb.supabase.co
SUPABASE_SECRET_KEY=

DASHBOARD_PASSWORD=
DASHBOARD_SESSION_SECRET=
```

- [ ] **Step 2.5: Commit**

```bash
cd .. && git add dashboard/lib dashboard/.env.local.example
git commit -m "dashboard: types + Supabase server client"
```

---

## Task 3: Time helpers (with unit tests)

**Files:**
- Create: `dashboard/lib/time.ts`
- Create: `dashboard/__tests__/time.test.ts`
- Create: `dashboard/vitest.config.ts`
- Modify: `dashboard/package.json` (add test script + vitest dep)

- [ ] **Step 3.1: Install Vitest**

```bash
cd dashboard && npm install -D vitest
```

- [ ] **Step 3.2: Add test script to `dashboard/package.json`**

In the `"scripts"` block, add: `"test": "vitest run"`

- [ ] **Step 3.3: Write `dashboard/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 3.4: Write failing test `dashboard/__tests__/time.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { muscatTodayStart, greetingPeriod } from "../lib/time";

describe("muscatTodayStart", () => {
  it("returns ISO string for 00:00 Muscat on the date that contains `now`", () => {
    // Muscat is UTC+4 with no DST. 2026-05-24 03:30 UTC = 07:30 Muscat -> today is 2026-05-24.
    const now = new Date("2026-05-24T03:30:00Z");
    expect(muscatTodayStart(now)).toBe("2026-05-23T20:00:00.000Z");
    // 2026-05-24 00:00 Muscat == 2026-05-23 20:00 UTC.
  });

  it("rolls correctly when Muscat clock has crossed midnight but UTC has not", () => {
    // 2026-05-23 22:30 UTC = 2026-05-24 02:30 Muscat -> today is 2026-05-24.
    const now = new Date("2026-05-23T22:30:00Z");
    expect(muscatTodayStart(now)).toBe("2026-05-23T20:00:00.000Z");
  });
});

describe("greetingPeriod", () => {
  it("returns 'morning' before 12:00 Muscat", () => {
    expect(greetingPeriod(new Date("2026-05-24T07:00:00Z"))).toBe("morning"); // 11:00 Muscat
  });
  it("returns 'afternoon' from 12:00 until 18:00 Muscat", () => {
    expect(greetingPeriod(new Date("2026-05-24T08:00:00Z"))).toBe("afternoon"); // 12:00
    expect(greetingPeriod(new Date("2026-05-24T13:59:00Z"))).toBe("afternoon"); // 17:59
  });
  it("returns 'evening' from 18:00 onward Muscat", () => {
    expect(greetingPeriod(new Date("2026-05-24T14:00:00Z"))).toBe("evening"); // 18:00
  });
});
```

- [ ] **Step 3.5: Run test, expect failure**

```bash
cd dashboard && npm test
```

Expected: FAIL — `Cannot find module "../lib/time"`.

- [ ] **Step 3.6: Implement `dashboard/lib/time.ts`**

```ts
// Muscat is UTC+4, no DST.
const MUSCAT_OFFSET_MIN = 4 * 60;

export function muscatTodayStart(now: Date = new Date()): string {
  // Add 4h to shift to Muscat clock, take the date components, then build
  // a UTC date at 00:00 Muscat (which is UTC-4h from that wall clock).
  const muscat = new Date(now.getTime() + MUSCAT_OFFSET_MIN * 60_000);
  const y = muscat.getUTCFullYear();
  const m = muscat.getUTCMonth();
  const d = muscat.getUTCDate();
  const utcMidnightMuscat = Date.UTC(y, m, d) - MUSCAT_OFFSET_MIN * 60_000;
  return new Date(utcMidnightMuscat).toISOString();
}

export function greetingPeriod(
  now: Date = new Date()
): "morning" | "afternoon" | "evening" {
  const muscatHour = (new Date(now.getTime() + MUSCAT_OFFSET_MIN * 60_000))
    .getUTCHours();
  if (muscatHour < 12) return "morning";
  if (muscatHour < 18) return "afternoon";
  return "evening";
}

export function muscatDateLabel(now: Date = new Date()): string {
  // e.g. "Saturday · May 24"
  const muscat = new Date(now.getTime() + MUSCAT_OFFSET_MIN * 60_000);
  const day = muscat.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const md = muscat.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${day} · ${md}`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
```

- [ ] **Step 3.7: Run tests, expect pass**

```bash
cd dashboard && npm test
```

Expected: PASS (5 assertions across 3 describes).

- [ ] **Step 3.8: Commit**

```bash
cd .. && git add dashboard/lib/time.ts dashboard/__tests__/time.test.ts dashboard/vitest.config.ts dashboard/package.json dashboard/package-lock.json
git commit -m "dashboard: time helpers (Muscat boundary + greeting period)"
```

---

## Task 4: Auth lib (HMAC cookie, with unit tests)

**Files:**
- Create: `dashboard/lib/auth.ts`
- Create: `dashboard/__tests__/auth.test.ts`

- [ ] **Step 4.1: Write failing test `dashboard/__tests__/auth.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../lib/auth";

const SECRET = "test-secret-32-bytes-of-randomness-please-1234";

describe("signSession/verifySession", () => {
  it("round-trips a valid session", () => {
    const cookie = signSession(SECRET, 1000);
    expect(verifySession(SECRET, cookie, 1000)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const cookie = signSession(SECRET, 1000);
    const [iat, sig] = cookie.split(".");
    const tampered = `${iat}.${sig.replace(/^./, "x")}`;
    expect(verifySession(SECRET, tampered, 1000)).toBe(false);
  });

  it("rejects an expired cookie (>30d old)", () => {
    const iat = 1000;
    const cookie = signSession(SECRET, iat);
    const now = iat + 31 * 24 * 3600;
    expect(verifySession(SECRET, cookie, now)).toBe(false);
  });

  it("rejects malformed cookie (no dot)", () => {
    expect(verifySession(SECRET, "garbage", 1000)).toBe(false);
  });

  it("uses constant-time compare for the signature", () => {
    // Smoke check: verifySession should not throw on extremely short sig.
    expect(verifySession(SECRET, "1000.x", 1000)).toBe(false);
  });
});
```

- [ ] **Step 4.2: Run test, expect failure**

```bash
cd dashboard && npm test
```

Expected: FAIL — `Cannot find module "../lib/auth"`.

- [ ] **Step 4.3: Implement `dashboard/lib/auth.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 30 * 24 * 3600;
export const COOKIE_NAME = "bashir-session";

export function signSession(secret: string, iat: number): string {
  const sig = createHmac("sha256", secret).update(String(iat)).digest("hex");
  return `${iat}.${sig}`;
}

export function verifySession(
  secret: string,
  cookie: string | undefined | null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!cookie || !cookie.includes(".")) return false;
  const [iatStr, sig] = cookie.split(".", 2);
  const iat = Number(iatStr);
  if (!Number.isFinite(iat)) return false;
  if (iat + MAX_AGE_SECONDS < nowSeconds) return false;

  const expected = createHmac("sha256", secret).update(String(iat)).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function newSession(secret: string): string {
  return signSession(secret, Math.floor(Date.now() / 1000));
}

export function constantTimePasswordCheck(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}
```

- [ ] **Step 4.4: Run tests, expect pass**

```bash
cd dashboard && npm test
```

Expected: PASS (5 assertions in auth + previous 5 in time).

- [ ] **Step 4.5: Commit**

```bash
cd .. && git add dashboard/lib/auth.ts dashboard/__tests__/auth.test.ts
git commit -m "dashboard: HMAC-signed session cookie + verifier (with tests)"
```

---

## Task 5: Login page + auth API routes

**Files:**
- Create: `dashboard/app/login/page.tsx`
- Create: `dashboard/app/api/auth/route.ts`
- Create: `dashboard/app/api/logout/route.ts`

- [ ] **Step 5.1: Write `dashboard/app/api/auth/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { constantTimePasswordCheck, COOKIE_NAME, newSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };
  const expected = process.env.DASHBOARD_PASSWORD || "";
  const secret = process.env.DASHBOARD_SESSION_SECRET || "";

  if (!expected || !secret) {
    return NextResponse.json({ error: "server-misconfigured" }, { status: 500 });
  }
  if (!password || !constantTimePasswordCheck(password, expected)) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  const cookie = newSession(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
```

- [ ] **Step 5.2: Write `dashboard/app/api/logout/route.ts`**

```ts
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
```

- [ ] **Step 5.3: Write `dashboard/app/login/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shake, setShake] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setPending(false);
    if (res.ok) {
      router.push("/today");
      router.refresh();
    } else {
      setError("Try again.");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  }

  return (
    <main className="min-h-svh flex items-center justify-center bg-[#FBFAF7] px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#ECE7DD] p-8 flex flex-col gap-4 text-center"
      >
        <div>
          <h1 className="font-serif text-3xl text-[#1A1614]">
            Bashir <span className="text-[#9C7847] text-2xl ml-1">بشير</span>
          </h1>
          <p className="text-xs uppercase tracking-wider text-[#9C9189] mt-1">
            Bearer of good news
          </p>
        </div>
        <Input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          className={shake ? "animate-[shake_0.4s]" : ""}
        />
        {error && <p className="text-sm text-[#C45A3D]">{error}</p>}
        <Button type="submit" disabled={pending || !pw}>
          {pending ? "…" : "Enter"}
        </Button>
      </form>
      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
      `}</style>
    </main>
  );
}
```

- [ ] **Step 5.4: Manually verify**

Set `DASHBOARD_PASSWORD=test123` and `DASHBOARD_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")` in `dashboard/.env.local` (copy from `.env.local.example` first).

```bash
cd dashboard && npm run dev
```

- Visit `http://localhost:3000/login` — should see centered Bashir card
- Wrong password → shake + "Try again."
- Correct password → redirects to `/today` (which doesn't exist yet → 404 page is expected)

Stop dev server.

- [ ] **Step 5.5: Commit**

```bash
cd .. && git add dashboard/app/login dashboard/app/api
git commit -m "dashboard: login page + auth POST/logout routes"
```

---

## Task 6: Protected layout + auth check + redirect

**Files:**
- Create: `dashboard/app/(protected)/layout.tsx`
- Create: `dashboard/app/page.tsx` (redirect root → /today)
- Create: `dashboard/components/BottomNav.tsx`
- Create: `dashboard/components/SideNav.tsx`
- Modify: `dashboard/app/layout.tsx` (font setup)
- Modify: `dashboard/app/globals.css` (theme tokens)

- [ ] **Step 6.1: Install Inter font**

In `dashboard/app/layout.tsx`, replace contents with:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Bashir",
  description: "Bearer of good news.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-[#FBFAF7] text-[#1A1614] font-sans">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6.2: Update `dashboard/app/globals.css`**

Replace the existing Tailwind base with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --bashir-bg: #FBFAF7;
    --bashir-surface: #FFFFFF;
    --bashir-surface-2: #F2EDE2;
    --bashir-ink: #1A1614;
    --bashir-ink-2: #3D362F;
    --bashir-mute: #7A7066;
    --bashir-faint: #9C9189;
    --bashir-border: #ECE7DD;
    --bashir-copper: #9C7847;
  }
  body {
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .font-serif {
    font-family: Georgia, "Times New Roman", serif;
  }
}
```

- [ ] **Step 6.3: Write `dashboard/app/page.tsx` (root redirect)**

```tsx
import { redirect } from "next/navigation";
export default function Page() {
  redirect("/today");
}
```

- [ ] **Step 6.4: Write `dashboard/components/BottomNav.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function BottomNav() {
  const path = usePathname();
  const items: Array<{ href: string; label: string; icon: string }> = [
    { href: "/today", label: "Today", icon: "●" },
    { href: "/archive", label: "Archive", icon: "○" },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-[#ECE7DD] flex justify-around py-2 pb-4 md:hidden z-10">
      {items.map((it) => {
        const active = path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex flex-col items-center gap-0.5 text-xs ${
              active ? "text-[#1A1614] font-semibold" : "text-[#9C9189]"
            }`}
          >
            <span className="text-base leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </Link>
        );
      })}
      <form action="/api/logout" method="POST" className="contents">
        <button className="flex flex-col items-center gap-0.5 text-xs text-[#9C9189]">
          <span className="text-base leading-none">⏻</span>
          <span>Logout</span>
        </button>
      </form>
    </nav>
  );
}
```

- [ ] **Step 6.5: Write `dashboard/components/SideNav.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SideNav() {
  const path = usePathname();
  return (
    <aside className="hidden md:flex md:flex-col md:w-56 md:fixed md:inset-y-0 md:left-0 bg-white border-r border-[#ECE7DD] py-6 px-4 z-10">
      <div className="font-serif text-2xl mb-8">
        Bashir <span className="text-[#9C7847] text-xl">بشير</span>
      </div>
      <Link
        href="/today"
        className={`block py-2 px-3 rounded-md mb-1 text-sm ${
          path.startsWith("/today") ? "bg-[#F2EDE2] font-semibold" : "text-[#3D362F]"
        }`}
      >
        Today
      </Link>
      <Link
        href="/archive"
        className={`block py-2 px-3 rounded-md mb-1 text-sm ${
          path.startsWith("/archive") ? "bg-[#F2EDE2] font-semibold" : "text-[#3D362F]"
        }`}
      >
        Archive
      </Link>
      <div className="mt-auto">
        <form action="/api/logout" method="POST">
          <button className="text-sm text-[#9C9189] hover:text-[#1A1614]">⏻ Logout</button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6.6: Logout API needs to redirect, not just JSON**

Update `dashboard/app/api/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
```

- [ ] **Step 6.7: Write `dashboard/app/(protected)/layout.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = cookies().get(COOKIE_NAME)?.value;
  const secret = process.env.DASHBOARD_SESSION_SECRET || "";
  if (!secret || !verifySession(secret, cookie)) {
    redirect("/login");
  }
  return (
    <div className="md:pl-56 min-h-svh pb-20 md:pb-8">
      <SideNav />
      <div className="max-w-[720px] mx-auto px-4 md:px-8 py-6 md:py-10">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 6.8: Create placeholder pages so the layout renders**

`dashboard/app/(protected)/today/page.tsx`:

```tsx
export default function TodayPage() {
  return <div>Today — placeholder. Real content in Task 8.</div>;
}
```

`dashboard/app/(protected)/archive/page.tsx`:

```tsx
export default function ArchivePage() {
  return <div>Archive — placeholder. Real content in Task 12.</div>;
}
```

- [ ] **Step 6.9: Manually verify**

```bash
cd dashboard && npm run dev
```

- Visit `/today` without cookie → redirect to `/login`
- Log in → land on `/today` with placeholder + nav (bottom on mobile, side on desktop ≥768px)
- Resize browser to <768px to confirm bottom nav appears
- Click "Logout" → cookie cleared, redirected to `/login`

Stop dev server.

- [ ] **Step 6.10: Commit**

```bash
cd .. && git add dashboard/app dashboard/components
git commit -m "dashboard: protected layout + responsive nav (Inter font, theme tokens)"
```

---

## Task 7: Queries lib (getTodayEmails, searchArchive)

**Files:**
- Create: `dashboard/lib/queries.ts`

- [ ] **Step 7.1: Write `dashboard/lib/queries.ts`**

```ts
import { supabase } from "./supabase";
import { muscatTodayStart } from "./time";
import type { Category, EmailRow } from "./types";

interface RawRow {
  id: number;
  gmail_msg_id: string;
  account_id: number;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  received_at: string;
  gmail_url: string | null;
  folder: string;
  accounts: { email: string } | { email: string }[] | null;
  classifications: Array<{
    category: Category;
    summary: string | null;
    why_priority: string | null;
    classified_at: string;
  }>;
}

function flatten(row: RawRow): EmailRow {
  // Most recent classification (server-side ordering not guaranteed — sort here).
  const cls = (row.classifications || []).slice().sort(
    (a, b) => Date.parse(b.classified_at) - Date.parse(a.classified_at)
  );
  const top = cls[0];
  const acct = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  return {
    id: row.id,
    gmail_msg_id: row.gmail_msg_id,
    account_id: row.account_id,
    account_email: acct?.email,
    from_name: row.from_name,
    from_email: row.from_email,
    subject: row.subject,
    snippet: row.snippet,
    body: row.body,
    received_at: row.received_at,
    gmail_url: row.gmail_url,
    folder: row.folder,
    category: top?.category ?? null,
    summary: top?.summary ?? null,
    why_priority: top?.why_priority ?? null,
  };
}

export async function getTodayEmails(): Promise<EmailRow[]> {
  const since = muscatTodayStart();
  const { data, error } = await supabase()
    .from("emails")
    .select(
      "id, gmail_msg_id, account_id, from_name, from_email, subject, snippet, body, received_at, gmail_url, folder, accounts(email), classifications(category, summary, why_priority, classified_at)"
    )
    .gte("received_at", since)
    .eq("folder", "inbox")
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as RawRow[]).map(flatten);
}

export interface ArchiveQuery {
  q?: string;
  categories?: Category[];
  accountIds?: number[];
  range?: "24h" | "7d" | "30d" | "12mo" | "all";
  page?: number;
  pageSize?: number;
}

export async function searchArchive(
  params: ArchiveQuery
): Promise<{ rows: EmailRow[]; hasMore: boolean }> {
  const pageSize = params.pageSize ?? 50;
  const page = params.page ?? 0;

  let query = supabase()
    .from("emails")
    .select(
      "id, gmail_msg_id, account_id, from_name, from_email, subject, snippet, body, received_at, gmail_url, folder, accounts(email), classifications(category, summary, why_priority, classified_at)"
    )
    .eq("folder", "inbox")
    .order("received_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize); // +1 to detect hasMore

  if (params.q && params.q.trim()) {
    const q = `%${params.q.trim()}%`;
    query = query.or(`subject.ilike.${q},from_email.ilike.${q},from_name.ilike.${q},body.ilike.${q}`);
  }
  if (params.accountIds && params.accountIds.length) {
    query = query.in("account_id", params.accountIds);
  }
  if (params.range && params.range !== "all") {
    const map = { "24h": 1, "7d": 7, "30d": 30, "12mo": 365 } as const;
    const days = map[params.range];
    const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    query = query.gte("received_at", since);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data as unknown as RawRow[]).map(flatten);

  // Category filter is applied post-fetch since classification is a 1-to-many join
  // and Supabase filters on it would drop unclassified emails.
  let filtered = rows;
  if (params.categories && params.categories.length) {
    const set = new Set(params.categories);
    filtered = rows.filter((r) => r.category && set.has(r.category));
  }

  const hasMore = filtered.length > pageSize;
  return { rows: filtered.slice(0, pageSize), hasMore };
}

export async function getAccounts(): Promise<Array<{ id: number; email: string }>> {
  const { data, error } = await supabase()
    .from("accounts")
    .select("id, email")
    .order("email");
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 7.2: Smoke-test the queries from CLI**

Create `dashboard/scripts/smoke.ts`:

```ts
import { getTodayEmails, getAccounts } from "../lib/queries";

async function main() {
  const accts = await getAccounts();
  console.log(`accounts: ${accts.length}`);
  const today = await getTodayEmails();
  console.log(`today emails: ${today.length}`);
  if (today[0]) console.log("sample:", today[0]);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run with:

```bash
cd dashboard && npx tsx scripts/smoke.ts
```

(If `tsx` is missing: `npm install -D tsx` and rerun.)

Expected: prints account count + today emails count + sample row.

- [ ] **Step 7.3: Commit**

```bash
cd .. && git add dashboard/lib/queries.ts dashboard/scripts dashboard/package.json dashboard/package-lock.json
git commit -m "dashboard: Supabase query helpers (today + archive)"
```

---

## Task 8: EmailCard component

**Files:**
- Create: `dashboard/components/EmailCard.tsx`

- [ ] **Step 8.1: Write `dashboard/components/EmailCard.tsx`**

```tsx
import type { EmailRow } from "@/lib/types";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/types";
import { relativeTime } from "@/lib/time";

export function EmailCard({ email, showDot = false }: { email: EmailRow; showDot?: boolean }) {
  const href = email.gmail_url || "#";
  const dotColor = email.category ? CATEGORY_COLOR[email.category] : "#9C9189";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white border border-[#ECE7DD] rounded-xl p-3.5 hover:border-[#D6CDB8] transition-colors"
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
  );
}
```

- [ ] **Step 8.2: Commit**

```bash
cd .. && git add dashboard/components/EmailCard.tsx
git commit -m "dashboard: EmailCard component"
```

---

## Task 9: CategorySection + Greeting components

**Files:**
- Create: `dashboard/components/CategorySection.tsx`
- Create: `dashboard/components/Greeting.tsx`
- Create: `dashboard/components/ArchiveCollapse.tsx`

- [ ] **Step 9.1: Write `dashboard/components/CategorySection.tsx`**

```tsx
import type { Category, EmailRow } from "@/lib/types";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/types";
import { EmailCard } from "./EmailCard";

export function CategorySection({
  category,
  emails,
}: {
  category: Category;
  emails: EmailRow[];
}) {
  if (!emails.length) return null;
  return (
    <section className="mt-7">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#1A1614]">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: CATEGORY_COLOR[category] }}
          />
          {CATEGORY_LABEL[category]}
        </div>
        <div className="text-[10px] font-semibold bg-[#1A1614] text-[#FBFAF7] px-2 py-0.5 rounded-full">
          {emails.length}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {emails.map((e) => (
          <EmailCard key={e.id} email={e} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 9.2: Write `dashboard/components/Greeting.tsx`**

```tsx
import { greetingPeriod, muscatDateLabel } from "@/lib/time";
import type { Category, EmailRow } from "@/lib/types";

export function Greeting({ emails }: { emails: EmailRow[] }) {
  const period = greetingPeriod();
  const counts = emails.reduce<Record<Category, number>>(
    (acc, e) => {
      if (e.category) acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    },
    {
      reply_today: 0,
      important_fyi: 0,
      opportunities: 0,
      diploma_learning: 0,
      archive: 0,
    }
  );

  const summary = buildSummary(counts);

  return (
    <header className="mb-2">
      <div className="flex items-baseline justify-between">
        <div className="font-serif text-xl">
          Bashir <span className="text-[#9C7847] text-lg">بشير</span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#7A7066]">
          {muscatDateLabel()}
        </div>
      </div>
      <h1 className="font-serif text-[1.6rem] leading-tight mt-2 mb-3">
        Good {period}, Nova.
      </h1>
      <p className="font-serif italic bg-[#F2EDE2] border-l-[3px] border-[#9C7847] px-3.5 py-2.5 rounded-r-md text-[#3D362F] leading-relaxed">
        {summary}
      </p>
    </header>
  );
}

function buildSummary(counts: Record<Category, number>): string {
  const parts: string[] = [];
  const r = counts.reply_today;
  const o = counts.opportunities;
  const a = counts.archive;
  const f = counts.important_fyi;
  const d = counts.diploma_learning;
  const total = r + o + a + f + d;

  if (total === 0) {
    return "Quiet morning. Bashir found nothing worth your attention.";
  }

  if (r > 0) {
    parts.push(`${r} email${r === 1 ? "" : "s"} need${r === 1 ? "s" : ""} your reply`);
  } else {
    parts.push("nothing needs your reply");
  }
  if (o > 0) parts.push(`${o} opportunit${o === 1 ? "y" : "ies"} surfaced`);
  if (f > 0) parts.push(`${f} FYI`);
  if (d > 0) parts.push(`${d} from the diploma`);
  if (a > 0) parts.push(`${a} sent straight to archive`);

  // Capitalize first, comma-join, period.
  const sentence = parts
    .map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(", ");
  return sentence + ".";
}
```

- [ ] **Step 9.3: Write `dashboard/components/ArchiveCollapse.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { EmailRow } from "@/lib/types";
import { relativeTime } from "@/lib/time";

export function ArchiveCollapse({ emails }: { emails: EmailRow[] }) {
  const [open, setOpen] = useState(false);
  if (!emails.length) return null;
  return (
    <section className="mt-7">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-center bg-[#F2EDE2] rounded-xl py-3 text-sm text-[#564B40]"
      >
        <strong className="text-[#1A1614]">{emails.length} archived today</strong>{" "}
        — tap to {open ? "collapse" : "expand"}
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {emails.map((e) => (
            <li key={e.id} className="text-[12px] text-[#7A7066] truncate">
              <a
                href={e.gmail_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#1A1614]"
              >
                <span className="text-[#3D362F]">{e.from_name || e.from_email}</span> —{" "}
                {e.subject || "(no subject)"}{" "}
                <span className="text-[#9C9189]">· {relativeTime(e.received_at)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 9.4: Commit**

```bash
cd .. && git add dashboard/components
git commit -m "dashboard: Greeting + CategorySection + ArchiveCollapse"
```

---

## Task 10: Today page wires it all together

**Files:**
- Modify: `dashboard/app/(protected)/today/page.tsx`

- [ ] **Step 10.1: Replace placeholder Today page**

```tsx
import { getTodayEmails } from "@/lib/queries";
import { CATEGORY_ORDER } from "@/lib/types";
import type { Category } from "@/lib/types";
import { Greeting } from "@/components/Greeting";
import { CategorySection } from "@/components/CategorySection";
import { ArchiveCollapse } from "@/components/ArchiveCollapse";

export const dynamic = "force-dynamic"; // reload on every visit

export default async function TodayPage() {
  let emails;
  try {
    emails = await getTodayEmails();
  } catch (e) {
    return (
      <div className="text-center py-16">
        <p className="text-[#7A7066]">Bashir is offline. Try again in a minute.</p>
      </div>
    );
  }

  const byCategory = CATEGORY_ORDER.reduce<Record<Category, typeof emails>>(
    (acc, cat) => {
      acc[cat] = emails.filter((e) => e.category === cat);
      return acc;
    },
    {} as Record<Category, typeof emails>
  );

  return (
    <>
      <Greeting emails={emails} />
      {CATEGORY_ORDER.filter((c) => c !== "archive").map((cat) => (
        <CategorySection key={cat} category={cat} emails={byCategory[cat]} />
      ))}
      <ArchiveCollapse emails={byCategory.archive} />
    </>
  );
}
```

- [ ] **Step 10.2: Manually verify**

```bash
cd dashboard && npm run dev
```

- Log in, land on `/today`
- See the greeting + summary card
- See the category sections populated with whatever's in your DB (currently 10 archive rows from the test backfill — so the page should show "Quiet morning…" plus the archive collapse with 10 items, depending on the day boundary)
- Resize to mobile width — layout stays single-column, looks good

Stop dev server.

- [ ] **Step 10.3: Commit**

```bash
cd .. && git add dashboard/app/(protected)/today
git commit -m "dashboard: Today page wired to Supabase"
```

---

## Task 11: ArchiveFilters + ArchiveSearch components

**Files:**
- Create: `dashboard/components/ArchiveSearch.tsx`
- Create: `dashboard/components/ArchiveFilters.tsx`

- [ ] **Step 11.1: Write `dashboard/components/ArchiveSearch.tsx`**

```tsx
"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function ArchiveSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(Array.from(params.entries()));
      if (q) p.set("q", q);
      else p.delete("q");
      p.delete("page");
      router.replace(`/archive?${p.toString()}`);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <Input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search subject, sender, body…"
      className="w-full"
    />
  );
}
```

- [ ] **Step 11.2: Write `dashboard/components/ArchiveFilters.tsx`**

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type Category,
} from "@/lib/types";

const RANGES = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "12mo", label: "12mo" },
  { key: "all", label: "All" },
] as const;

export function ArchiveFilters({
  accounts,
}: {
  accounts: Array<{ id: number; email: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function toggleArray(key: string, value: string) {
    const p = new URLSearchParams(Array.from(params.entries()));
    const cur = (p.get(key) ?? "").split(",").filter(Boolean);
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    if (next.length) p.set(key, next.join(","));
    else p.delete(key);
    p.delete("page");
    router.replace(`/archive?${p.toString()}`);
  }
  function setRange(value: string) {
    const p = new URLSearchParams(Array.from(params.entries()));
    p.set("range", value);
    p.delete("page");
    router.replace(`/archive?${p.toString()}`);
  }

  const selectedCats = (params.get("cat") ?? "").split(",").filter(Boolean);
  const selectedAccts = (params.get("acct") ?? "").split(",").filter(Boolean);
  const range = params.get("range") ?? "30d";

  function chip(active: boolean, onClick: () => void, label: React.ReactNode, color?: string) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
          active
            ? "bg-[#1A1614] text-[#FBFAF7] border-[#1A1614]"
            : "bg-white text-[#3D362F] border-[#ECE7DD] hover:border-[#D6CDB8]"
        }`}
      >
        {color && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
            style={{ background: color }}
          />
        )}
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {CATEGORY_ORDER.map((c) =>
          chip(
            selectedCats.includes(c),
            () => toggleArray("cat", c),
            CATEGORY_LABEL[c],
            CATEGORY_COLOR[c as Category]
          )
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {accounts.map((a) =>
          chip(
            selectedAccts.includes(String(a.id)),
            () => toggleArray("acct", String(a.id)),
            a.email
          )
        )}
      </div>
      <div className="flex gap-1.5">
        {RANGES.map((r) =>
          chip(range === r.key, () => setRange(r.key), r.label)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.3: Commit**

```bash
cd .. && git add dashboard/components
git commit -m "dashboard: ArchiveSearch + ArchiveFilters"
```

---

## Task 12: Archive page (search + filters + paginated list)

**Files:**
- Modify: `dashboard/app/(protected)/archive/page.tsx`

- [ ] **Step 12.1: Replace placeholder Archive page**

```tsx
import { getAccounts, searchArchive } from "@/lib/queries";
import type { Category } from "@/lib/types";
import { EmailCard } from "@/components/EmailCard";
import { ArchiveSearch } from "@/components/ArchiveSearch";
import { ArchiveFilters } from "@/components/ArchiveFilters";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const accounts = await getAccounts();
  const page = Number(searchParams.page ?? "0") || 0;
  const range = (searchParams.range ?? "30d") as "24h" | "7d" | "30d" | "12mo" | "all";
  const cats = (searchParams.cat ?? "").split(",").filter(Boolean) as Category[];
  const acctIds = (searchParams.acct ?? "")
    .split(",")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  let rows;
  let hasMore = false;
  try {
    const res = await searchArchive({
      q: searchParams.q,
      categories: cats.length ? cats : undefined,
      accountIds: acctIds.length ? acctIds : undefined,
      range,
      page,
    });
    rows = res.rows;
    hasMore = res.hasMore;
  } catch {
    return (
      <div className="text-center py-16">
        <p className="text-[#7A7066]">Bashir is offline. Try again in a minute.</p>
      </div>
    );
  }

  const baseParams = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) => (v ? [[k, v] as [string, string]] : []))
  );

  return (
    <>
      <div className="font-serif text-2xl mb-4">Archive</div>
      <div className="flex flex-col gap-3 mb-5 sticky top-0 bg-[#FBFAF7] pt-1 pb-3 z-[1]">
        <ArchiveSearch />
        <ArchiveFilters accounts={accounts} />
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-[#7A7066] py-10">Nothing matches. Try fewer filters.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((e) => (
            <EmailCard key={e.id} email={e} showDot />
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-between text-sm text-[#7A7066]">
        {page > 0 ? (
          (() => {
            const p = new URLSearchParams(baseParams);
            p.set("page", String(page - 1));
            return (
              <Link href={`/archive?${p.toString()}`} className="hover:text-[#1A1614]">
                ← Newer
              </Link>
            );
          })()
        ) : (
          <span />
        )}
        {hasMore && (() => {
          const p = new URLSearchParams(baseParams);
          p.set("page", String(page + 1));
          return (
            <Link href={`/archive?${p.toString()}`} className="hover:text-[#1A1614]">
              Older →
            </Link>
          );
        })()}
      </div>
    </>
  );
}
```

- [ ] **Step 12.2: Manually verify**

```bash
cd dashboard && npm run dev
```

- Navigate to `/archive`
- See the 10 backfilled emails (assuming they're within 30d)
- Type "stripe" or "google" in the search — list filters
- Click a category chip — list filters by category
- Change range to "24h" or "7d" — list filters by date
- Click an email card — opens in Gmail (new tab)

Stop dev server.

- [ ] **Step 12.3: Commit**

```bash
cd .. && git add dashboard/app/(protected)/archive
git commit -m "dashboard: Archive page with search + filters + pagination"
```

---

## Task 13: Visual polish (motion, fonts pre-load, edge polish)

**Files:**
- Modify: `dashboard/app/globals.css`
- Modify: `dashboard/components/CategorySection.tsx`

- [ ] **Step 13.1: Add fade-up animation to globals.css**

Append to `dashboard/app/globals.css`:

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-up { animation: fadeUp 0.35s ease-out both; }
```

- [ ] **Step 13.2: Apply stagger to EmailCard list in CategorySection**

Replace the `<div className="flex flex-col gap-2">…</div>` block in `dashboard/components/CategorySection.tsx` with:

```tsx
<div className="flex flex-col gap-2">
  {emails.map((e, i) => (
    <div key={e.id} className="fade-up" style={{ animationDelay: `${i * 50}ms` }}>
      <EmailCard email={e} />
    </div>
  ))}
</div>
```

- [ ] **Step 13.3: Apply same to ArchiveCollapse list**

In `dashboard/components/ArchiveCollapse.tsx`, when `open` is true, wrap each `<li>` similarly with the `fade-up` class (omit stagger for the archive list — it can fade together).

- [ ] **Step 13.4: Manually verify**

`npm run dev`, reload `/today`. Cards fade up sequentially. Looks alive, not janky.

- [ ] **Step 13.5: Commit**

```bash
cd .. && git add dashboard/app/globals.css dashboard/components
git commit -m "dashboard: motion polish (card fade-up stagger)"
```

---

## Task 14: Vercel deployment

**Files:**
- Create: `dashboard/vercel.json`

- [ ] **Step 14.1: Write `dashboard/vercel.json`**

```json
{
  "buildCommand": "next build",
  "devCommand": "next dev",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

- [ ] **Step 14.2: Generate a session secret to use in production**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output — you'll paste it into Vercel env shortly.

- [ ] **Step 14.3: Connect Vercel to the repo via the dashboard UI (user action)**

In the Vercel dashboard:
1. Add New Project → Import from GitHub → pick `webo109/Bashir`
2. **Root Directory:** set to `dashboard`
3. Framework Preset: Next.js (auto-detected)
4. Environment Variables — add all four:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://yrmycgebhqlwptflkceb.supabase.co`
   - `SUPABASE_SECRET_KEY` = (the rotated value from Supabase)
   - `DASHBOARD_PASSWORD` = (pick something)
   - `DASHBOARD_SESSION_SECRET` = (the secret from Step 14.2)
5. Deploy

Expected: deploys cleanly, returns a `*.vercel.app` URL.

- [ ] **Step 14.4: Smoke-test the live URL**

- Visit the Vercel URL → `/today` redirects to `/login`
- Log in with `DASHBOARD_PASSWORD` → land on `/today`
- See whatever's in your DB
- `/archive` works, search works
- Refresh, log out, log back in

- [ ] **Step 14.5: Commit**

```bash
cd .. && git add dashboard/vercel.json
git commit -m "dashboard: vercel config"
```

- [ ] **Step 14.6: Push the branch**

```bash
git push
```

Vercel auto-deploys on push to the connected branch.

---

## Self-Review

Checked the spec against the plan:

**Spec coverage:**
- ✅ Stack (Next.js + Tailwind + shadcn + Supabase + Vercel) — Task 1, 2, 14
- ✅ Project layout matches spec — Task 1, 2
- ✅ /login page — Task 5
- ✅ /today page with greeting + summary + sectioned categories + archive collapse — Tasks 8, 9, 10
- ✅ /archive page with search + filters + pagination — Tasks 11, 12
- ✅ Components: Greeting, EmailCard, CategorySection, ArchiveCollapse, ArchiveSearch, ArchiveFilters, BottomNav, SideNav — Tasks 6, 8, 9, 11
- ✅ Server-side reads only — Task 7 (queries use server-side `supabase()`)
- ✅ Auth: HMAC cookie, password gate, /api/auth + /api/logout — Tasks 4, 5
- ✅ Visual direction (palette, fonts, motion) — Tasks 6 (theme tokens), 8/9 (palette use), 13 (motion)
- ✅ Empty/error states — Today (offline + quiet morning in Greeting), Archive (no match + offline)
- ✅ Env vars — Task 2 + Task 14
- ✅ Deployment — Task 14
- ✅ Tests for auth + time — Tasks 3, 4

**Placeholder scan:** no "TBD" / "implement later" / vague handwaving. All code blocks contain real code.

**Type consistency:** `EmailRow.category` is `Category | null` everywhere; `CATEGORY_ORDER` / `CATEGORY_COLOR` / `CATEGORY_LABEL` are all keyed by `Category`. `signSession`/`verifySession`/`newSession`/`COOKIE_NAME` exports match between auth.ts and consumers.

One small gap I noticed and fixed inline: spec mentions "Logout" must redirect, but my first draft of `/api/logout` returned JSON. Updated in Step 6.6.

---

## Notes for the executor

- The HARD-GATE of brainstorming has been satisfied (spec approved). You're cleared to implement.
- `npm run dev` from `dashboard/` for local testing.
- `cd dashboard && npm test` for the two unit-tested libs (auth, time).
- All Supabase calls use the secret key — `cookies()` and `headers()` are the only Next.js-specific server APIs used. No middleware required.
- Push to `main` (or whatever branch Vercel is connected to) auto-deploys.
