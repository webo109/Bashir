"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function BottomNav() {
  const path = usePathname();
  const items: Array<{ href: string; label: string; icon: string }> = [
    { href: "/today", label: "Today", icon: "●" },
    { href: "/archive", label: "Archive", icon: "○" },
    { href: "/senders", label: "Senders", icon: "◆" },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-[#ECE7DD] flex justify-around py-2 pb-4 md:hidden z-10">
      {items.map((it) => {
        const active = path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex flex-col items-center gap-0.5 text-xs ${
              active ? "text-[#1A1614] font-semibold" : "text-[#7A7066]"
            }`}
          >
            <span className="text-base leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </Link>
        );
      })}
      {/* FIX-15: logout lives in its own form element with an explicit submit
          button so an accidental Enter inside the nav can't trigger it. */}
      <form action="/api/logout" method="POST" className="flex">
        <button
          type="submit"
          className="flex flex-col items-center gap-0.5 text-xs text-[#7A7066]"
        >
          <span className="text-base leading-none">⏻</span>
          <span>Logout</span>
        </button>
      </form>
    </nav>
  );
}
