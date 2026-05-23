import type { EmailRow } from "@/lib/types";
import { CATEGORY_COLOR } from "@/lib/types";
import { relativeTime } from "@/lib/time";

export function EmailCard({ email, showDot = false }: { email: EmailRow; showDot?: boolean }) {
  const href = email.gmail_url || "#";
  const dotColor = email.category ? CATEGORY_COLOR[email.category] : "#9C9189";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white border border-[#ECE7DD] rounded-xl p-3.5 hover:border-[#D6CDB8] transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold text-[#1A1614] text-sm truncate">
          {showDot && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
              style={{ background: dotColor }}
            />
          )}
          {email.from_name || email.from_email || "(unknown)"}
        </div>
        <div className="text-[11px] text-[#9C9189] whitespace-nowrap">
          {relativeTime(email.received_at)}
        </div>
      </div>
      <div className="text-[11px] text-[#9C9189] truncate mt-0.5">
        {email.from_email}
      </div>
      <div className="text-sm text-[#3D362F] mt-1.5 leading-snug line-clamp-2">
        {email.subject || "(no subject)"}
      </div>
      {email.summary && (
        <div className="font-serif italic text-[#564B40] text-sm mt-2 leading-snug">
          {email.summary}
        </div>
      )}
      {email.why_priority && (
        <div className="text-[11px] uppercase tracking-wider text-[#9C9189] mt-2 font-semibold">
          {email.why_priority}
        </div>
      )}
    </a>
  );
}
