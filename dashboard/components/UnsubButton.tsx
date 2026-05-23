"use client";

import { useState } from "react";

type State = "idle" | "pending" | "ok" | "err";

interface Props {
  url: string | null;
  one_click?: boolean;
  /** Fallback link to open if there's no List-Unsubscribe URL — usually the Gmail message URL. */
  fallbackUrl?: string | null;
  /** Visual size; corner-of-card vs row-of-buttons. */
  size?: "sm" | "md";
}

export function UnsubButton({
  url,
  one_click = false,
  fallbackUrl = null,
  size = "sm",
}: Props) {
  const [state, setState] = useState<State>("idle");

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // No List-Unsubscribe header — open the Gmail message so user can find the
    // footer "unsubscribe" link manually.
    if (!url) {
      if (fallbackUrl) window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      return;
    }

    // Non-one-click — open the sender's page in a new tab. We don't fetch
    // server-side because most non-one-click URLs are confirmation pages
    // that shouldn't be "previewed" by Bashir.
    if (!one_click) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    // RFC 8058 one-click — actually unsubscribe via Bashir's server route.
    setState("pending");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, one_click: true }),
      });
      const data = await res.json().catch(() => ({}));
      setState(res.ok && data.ok ? "ok" : "err");
    } catch {
      setState("err");
    }
  }

  const label =
    state === "pending"
      ? "…"
      : state === "ok"
      ? "✓ Unsubscribed"
      : state === "err"
      ? "Retry"
      : !url
      ? "Find in Gmail"
      : one_click
      ? "Unsubscribe"
      : "Unsubscribe ↗";

  const tooltip = !url
    ? "No List-Unsubscribe header — opens the message in Gmail (the footer usually has the link)"
    : !one_click
    ? "Opens the sender's unsubscribe page in a new tab"
    : "Sends a one-click unsubscribe to the sender (you stay here)";

  const base =
    "font-semibold rounded-full transition-colors disabled:cursor-default whitespace-nowrap";
  const sizing =
    size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";

  const palette =
    state === "ok"
      ? "bg-[#5C8A4F] text-white"
      : state === "err"
      ? "bg-[#C45A3D] text-white hover:bg-[#A84B33]"
      : !url
      ? "bg-[#F2EDE2] text-[#7A7066] hover:bg-[#ECE7DD]"
      : "bg-[#9C7847] text-white hover:bg-[#7A5A33]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "pending" || state === "ok"}
      title={tooltip}
      aria-label={tooltip}
      className={`${base} ${sizing} ${palette}`}
    >
      {label}
    </button>
  );
}
