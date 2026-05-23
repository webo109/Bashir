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
              active ? "text-[#1A1614] font-semibold" : "text-[#9C9189]"
            }`}
          >
            <span className="text-base leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </Link>
        );
      })}
      <form action="/api/logout" method="POST" className="contents">
        <button className="flex flex-col items-center gap-0.5 text-xs text-[#9C9189]">
          <span className="text-base leading-none">⏻</span>
          <span>Logout</span>
        </button>
      </form>
    </nav>
  );
}
