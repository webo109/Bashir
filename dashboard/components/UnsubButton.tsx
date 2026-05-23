"use client";

import { useState } from "react";

type State = "idle" | "pending" | "ok" | "failed";

interface Props {
  url: string | null;
  /** True when sender ships `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). */
  one_click?: boolean;
  /** Visual size. */
  size?: "sm" | "md";
}

/**
 * Unsubscribe entrypoint.
 *
 * Different senders ship different unsubscribe semantics — we honor both:
 *
 *  - `one_click=true` (RFC 8058) — the URL is POST-only. LinkedIn, Mailchimp,
 *    and most major mailers fall here. GETting their URL returns 404. We POST
 *    via /api/unsubscribe; on success the button flips to "✓ Unsubscribed".
 *    If the sender's endpoint rejects the POST (some advertise one-click but
 *    their URL is actually a confirm page — Taskade does this), the button
 *    morphs into a normal link that opens the page on the next click.
 *
 *  - `one_click=false` — the URL is meant to be opened in a browser. Just an
 *    anchor that opens in a new tab.
 */
export function UnsubButton({ url, one_click = false, size = "sm" }: Props) {
  const [state, setState] = useState<State>("idle");

  if (!url) return null;

  const base =
    "font-semibold rounded-full transition-colors whitespace-nowrap inline-block";
  const sizing =
    size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";

  // Non-one-click → plain anchor. Single click, single navigation, reliable.
  if (!one_click) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={url}
        className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33]`}
      >
        Unsubscribe ↗
      </a>
    );
  }

  // Success — fixed, no further action.
  if (state === "ok") {
    return (
      <span className={`${base} ${sizing} bg-[#5C8A4F] text-white`}>
        ✓ Unsubscribed
      </span>
    );
  }

  // POST failed — the sender's URL is probably a confirm page (Taskade-style).
  // Convert button to a real anchor so the next click is a fully-trusted
  // navigation. Popup blockers won't fire on anchor clicks.
  if (state === "failed") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={`One-click unsubscribe was rejected by the sender — open ${url} to confirm manually`}
        className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33]`}
      >
        Open page ↗
      </a>
    );
  }

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setState("pending");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, one_click: true }),
      });
      const data = await res.json().catch(() => ({}));
      setState(res.ok && data.ok ? "ok" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "pending"}
      title="Sends a one-click unsubscribe to the sender (you stay here)"
      className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33] disabled:opacity-70`}
    >
      {state === "pending" ? "…" : "Unsubscribe"}
    </button>
  );
}
