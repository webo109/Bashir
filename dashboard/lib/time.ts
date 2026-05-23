// Muscat is UTC+4, no DST.
const MUSCAT_OFFSET_MIN = 4 * 60;

export function muscatTodayStart(now: Date = new Date()): string {
  // Add 4h to shift to Muscat clock, take the date components, then build
  // a UTC date at 00:00 Muscat (which is UTC-4h from that wall clock).
  const muscat = new Date(now.getTime() + MUSCAT_OFFSET_MIN * 60_000);
  const y = muscat.getUTCFullYear();
  const m = muscat.getUTCMonth();
  const d = muscat.getUTCDate();
  const utcMidnightMuscat = Date.UTC(y, m, d) - MUSCAT_OFFSET_MIN * 60_000;
  return new Date(utcMidnightMuscat).toISOString();
}

export function greetingPeriod(
  now: Date = new Date()
): "morning" | "afternoon" | "evening" {
  const muscatHour = (new Date(now.getTime() + MUSCAT_OFFSET_MIN * 60_000))
    .getUTCHours();
  if (muscatHour < 12) return "morning";
  if (muscatHour < 18) return "afternoon";
  return "evening";
}

export function muscatDateLabel(now: Date = new Date()): string {
  // e.g. "Saturday · May 24"
  // FIX-13: format directly in Asia/Muscat instead of shifting the Date by
  // +4h and formatting with timeZone: "UTC". Less surprising for the next
  // person who reads this.
  const day = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Muscat" });
  const md = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "Asia/Muscat" });
  return `${day} · ${md}`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  // NIT-1: floor so 30s shows "just now" not "1m ago".
  const diffMin = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
