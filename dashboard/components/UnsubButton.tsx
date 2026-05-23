"use client";

import { useState } from "react";
import { setSenderState } from "@/lib/sender-state";

type State = "idle" | "pending" | "ok" | "failed";

interface Props {
  url: string | null;
  /** True when sender ships `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). */
  one_click?: boolean;
  /** Sender's address — used to record local "unsubscribed" state. */
  fromEmail?: string | null;
  /** Visual size. */
  size?: "sm" | "md";
}

/**
 * Unsubscribe entrypoint.
 *
 *  - `one_click=true` (RFC 8058) — URL is POST-only (LinkedIn, Mailchimp, etc.).
 *    GETting it returns 404. We POST via /api/unsubscribe; on success the
 *    button flips to "✓ Unsubscribed". If sender rejects POST (Taskade-style
 *    fake-one-click), button morphs into a real <a> labeled "Open page ↗".
 *
 *  - `one_click=false` — URL is meant to be opened in a browser. Just an
 *    anchor that opens in a new tab.
 *
 * In either path we record sender state locally so a status badge can show
 * the sender as "unsubscribed" without waiting for the next refresh.
 */
export function UnsubButton({ url, one_click = false, fromEmail = null, size = "sm" }: Props) {
  const [state, setState] = useState<State>("idle");

  if (!url) return null;

  const base =
    "font-semibold rounded-full transition-colors whitespace-nowrap inline-block";
  const sizing =
    size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";

  // Non-one-click → plain anchor.
  if (!one_click) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          setSenderState(fromEmail, "unsubscribed");
        }}
        title={url}
        className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33]`}
      >
        Unsubscribe ↗
      </a>
    );
  }

  if (state === "ok") {
    return (
      <span className={`${base} ${sizing} bg-[#5C8A4F] text-white`}>
        ✓ Unsubscribed
      </span>
    );
  }

  if (state === "failed") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          setSenderState(fromEmail, "unsubscribed");
        }}
        title={`One-click unsubscribe was rejected — open ${url} to confirm manually`}
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
      if (res.ok && data.ok) {
        setSenderState(fromEmail, "unsubscribed");
        setState("ok");
      } else {
        setState("failed");
      }
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
