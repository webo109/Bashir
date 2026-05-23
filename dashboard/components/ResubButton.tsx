"use client";

interface Props {
  /** Sender's email address (e.g. "updates@taskade.com"). */
  fromEmail: string | null;
  size?: "sm" | "md";
}

/**
 * "Resubscribe" — opens the sender's website so the user can sign up again.
 *
 * There's no standard List-Resubscribe header. Most marketing senders put
 * signup forms front-and-center on their homepage, so we extract the registered
 * domain from the From: address (e.g. `updates@taskade.com` → `taskade.com`)
 * and open `https://<domain>/` in a new tab.
 */
export function ResubButton({ fromEmail, size = "sm" }: Props) {
  const domain = extractDomain(fromEmail);
  if (!domain) return null;
  const href = `https://${domain}/`;

  const base =
    "font-semibold rounded-full transition-colors whitespace-nowrap inline-block";
  const sizing =
    size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Open ${href} to resubscribe`}
      className={`${base} ${sizing} bg-white border border-[#ECE7DD] text-[#3D362F] hover:border-[#D6CDB8]`}
    >
      Resubscribe ↗
    </a>
  );
}

/**
 * Strip common subdomains so `updates@news.figma.com` → `figma.com`.
 * Falls back gracefully — if anything looks off, returns the raw host.
 */
function extractDomain(fromEmail: string | null | undefined): string | null {
  if (!fromEmail) return null;
  const at = fromEmail.indexOf("@");
  if (at < 0) return null;
  const host = fromEmail.slice(at + 1).toLowerCase().replace(/\.+$/, "");
  if (!host || !host.includes(".")) return null;

  // Common mass-mailer subdomain prefixes — strip to land on the brand site.
  const STRIP = ["mail", "email", "e", "m", "news", "newsletter", "updates", "send", "sendgrid", "info"];
  const parts = host.split(".");
  if (parts.length > 2 && STRIP.includes(parts[0])) {
    return parts.slice(1).join(".");
  }
  return host;
}
