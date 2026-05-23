"use client";

interface Props {
  url: string | null;
  /** Kept for API compatibility with earlier in-app POST flow; ignored. */
  one_click?: boolean;
  /** Visual size; corner-of-card vs row-of-buttons. */
  size?: "sm" | "md";
}

/**
 * Direct link to the sender's List-Unsubscribe URL. Opens in a new tab on
 * a single click — the same URL Gmail's native "Unsubscribe" feature would
 * open, displayed as a copper button so it's findable on every email card
 * and on the /senders page.
 *
 * (Earlier versions tried POSTing one-click unsubscribes server-side and
 * falling back to opening the page when the POST failed. That worked for
 * a small minority of senders but most "one-click" advertised URLs really
 * route to a confirmation page anyway — net was two clicks instead of one
 * and a confusing intermediate state. One click → open page is simpler
 * and matches user expectation.)
 */
export function UnsubButton({ url, size = "sm" }: Props) {
  if (!url) return null;

  const base =
    "font-semibold rounded-full transition-colors whitespace-nowrap inline-block";
  const sizing =
    size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";

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
