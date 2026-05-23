import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

// V1.2 in-app unsubscribe.
//
// Three modes, decided by what the sender's List-Unsubscribe header looks like:
//
//   one_click=true       → POST to the URL with "List-Unsubscribe=One-Click" body
//                          (RFC 8058). Returns {ok, status}.
//   one_click=false      → Don't fetch from server (CSRF / preview risk).
//                          Tells the client to open the URL in a new tab. Returns
//                          {ok: true, action: "open", url}.
//   url is null/missing  → Returns 400. The client should fall back to opening
//                          the Gmail message itself (footer usually has a link).

export async function POST(req: NextRequest) {
  const cookie = cookies().get(COOKIE_NAME)?.value;
  const secret = process.env.DASHBOARD_SESSION_SECRET || "";
  if (!secret || !verifySession(secret, cookie)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { url?: string; one_click?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { url, one_click } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "non-http url" }, { status: 400 });
  }

  if (!one_click) {
    return NextResponse.json({ ok: true, action: "open", url });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    return NextResponse.json({ ok: res.ok, status: res.status, action: "posted" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "request failed";
    return NextResponse.json({ ok: false, error: msg, action: "posted" }, { status: 502 });
  }
}
