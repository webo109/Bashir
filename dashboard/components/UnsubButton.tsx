"use client";

import { useEffect, useState } from "react";
import {
  getSenderState,
  onSenderStateChange,
  setSenderState,
} from "@/lib/sender-state";

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

  // After mount, restore "ok" state from localStorage so the button remembers
  // the user already unsubscribed (badge persists across refresh; button
  // visual should too). Also re-syncs across tabs / pages within the session.
  useEffect(() => {
    const sync = () => {
      const persisted = getSenderState(fromEmail);
      setState((cur) => {
        if (cur === "pending") return cur;
        if (persisted === "unsubscribed") return "ok";
        if (persisted === "resubscribed") return "idle";
        return cur;
      });
    };
    sync();
    return onSenderStateChange(sync);
  }, [fromEmail]);

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

  // After a one-click attempt — success or failure — render the same copper
  // anchor pointing at the sender's URL. Labels differ but the visual is
  // identical (matches the "non-one-click" anchor too). Status badge on
  // /senders shows whether the unsubscribe was actually applied.
  if (state === "ok" || state === "failed") {
    const label = state === "ok" ? "✓ Unsubscribed ↗" : "Open page ↗";
    const tooltip =
      state === "ok"
        ? "Bashir submitted the unsubscribe. Tap to open the sender's page if you want to confirm."
        : `One-click unsubscribe was rejected — open ${url} to confirm manually`;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          setSenderState(fromEmail, "unsubscribed");
        }}
        title={tooltip}
        className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33]`}
      >
        {label}
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
