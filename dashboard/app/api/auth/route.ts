import { NextRequest, NextResponse } from "next/server";
import { constantTimePasswordCheck, COOKIE_NAME, newSession } from "@/lib/auth";

// FIX-5: in-memory per-IP failed-attempt tracker. Sufficient for V1's single
// dashboard instance — when we move off Vercel single-region or scale out
// this needs to become Upstash/Redis-backed. Failures within the WINDOW_MS
// cap; after MAX_FAILS the IP gets 429 with a small artificial delay.
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILS = 3;
type Bucket = { count: number; firstFailureAt: number };
const failures = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // First IP in the list is the original client.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || "unknown";
}

function evictExpired(now: number): void {
  Array.from(failures.entries()).forEach(([ip, b]) => {
    if (now - b.firstFailureAt > WINDOW_MS) failures.delete(ip);
  });
}

function recordFailure(ip: string, now: number): number {
  const b = failures.get(ip);
  if (!b || now - b.firstFailureAt > WINDOW_MS) {
    failures.set(ip, { count: 1, firstFailureAt: now });
    return 1;
  }
  b.count += 1;
  return b.count;
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  evictExpired(now);

  const ip = clientIp(req);
  const existing = failures.get(ip);
  if (existing && now - existing.firstFailureAt <= WINDOW_MS && existing.count >= MAX_FAILS) {
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "rate-limited" }, { status: 429 });
  }

  const { password } = (await req.json()) as { password?: string };
  const expected = process.env.DASHBOARD_PASSWORD || "";
  const secret = process.env.DASHBOARD_SESSION_SECRET || "";

  if (!expected || !secret) {
    return NextResponse.json({ error: "server-misconfigured" }, { status: 500 });
  }
  if (!password || !constantTimePasswordCheck(password, expected)) {
    recordFailure(ip, now);
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  // Success — clear any prior failures for this IP.
  failures.delete(ip);

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
