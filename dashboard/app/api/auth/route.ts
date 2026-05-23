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
