"use client";
import { useState } from "react";
import type { EmailRow } from "@/lib/types";
import { relativeTime } from "@/lib/time";

export function ArchiveCollapse({ emails }: { emails: EmailRow[] }) {
  const [open, setOpen] = useState(false);
  if (!emails.length) return null;
  return (
    <section className="mt-7">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-center bg-[#F2EDE2] rounded-xl py-3 text-sm text-[#564B40]"
      >
        <strong className="text-[#1A1614]">{emails.length} archived today</strong>{" "}
        — tap to {open ? "collapse" : "expand"}
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {emails.map((e) => (
            <li key={e.id} className="text-[12px] text-[#7A7066] truncate fade-up">
              <a
                href={e.gmail_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#1A1614]"
              >
                <span className="text-[#3D362F]">{e.from_name || e.from_email}</span> —{" "}
                {e.subject || "(no subject)"}{" "}
                <span className="text-[#9C9189]">· {relativeTime(e.received_at)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
