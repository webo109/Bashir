"use client";

import { useState } from "react";

type State = "idle" | "pending" | "ok" | "needs-page";

interface Props {
  url: string | null;
  one_click?: boolean;
  /** Visual size; corner-of-card vs row-of-buttons. */
  size?: "sm" | "md";
}

export function UnsubButton({
  url,
  one_click = false,
  size = "sm",
}: Props) {
  const [state, setState] = useState<State>("idle");

  // No List-Unsubscribe header → render nothing. The user has other ways to
  // handle these senders (Bulk-delete in Gmail, native Gmail unsubscribe).
  if (!url) return null;

  async function onButtonClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Non-one-click: open in new tab. This IS a real user click so popup
    // blockers don't fire.
    if (!one_click) {
      window.open(url!, "_blank", "noopener,noreferrer");
      return;
    }

    // RFC 8058 one-click — try Bashir's server-side POST. If it actually
    // unsubscribes, flip to "✓ Unsubscribed" and we're done. If the sender's
    // endpoint rejected the POST (some senders advertise one-click but their
    // URL is really a confirmation page), switch to "needs-page" state — the
    // button becomes an <a> that opens the URL on next real click (popup
    // blockers won't fire because it's a normal anchor navigation).
    setState("pending");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, one_click: true }),
      });
      const data = await res.json().catch(() => ({}));
      setState(res.ok && data.ok ? "ok" : "needs-page");
    } catch {
      setState("needs-page");
    }
  }

  const base =
    "font-semibold rounded-full transition-colors disabled:cursor-default whitespace-nowrap inline-block";
  const sizing =
    size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";

  // Success state — fixed, no further action.
  if (state === "ok") {
    return (
      <span className={`${base} ${sizing} bg-[#5C8A4F] text-white`}>
        ✓ Unsubscribed
      </span>
    );
  }

  // Sender rejected one-click — convert button to a real anchor that opens
  // the confirmation page in a new tab. The click event is fully trusted so
  // popup blockers won't interfere.
  if (state === "needs-page") {
    return (
      <a
        href={url!}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Sender needs you to confirm on their page — opens in a new tab"
        className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33]`}
      >
        Confirm on page ↗
      </a>
    );
  }

  const label =
    state === "pending" ? "…" : one_click ? "Unsubscribe" : "Unsubscribe ↗";
  const tooltip = !one_click
    ? "Opens the sender's unsubscribe page in a new tab"
    : "Sends a one-click unsubscribe to the sender (you stay here)";

  return (
    <button
      type="button"
      onClick={onButtonClick}
      disabled={state === "pending"}
      title={tooltip}
      aria-label={tooltip}
      className={`${base} ${sizing} bg-[#9C7847] text-white hover:bg-[#7A5A33]`}
    >
      {label}
    </button>
  );
}
