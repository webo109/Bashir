"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SideNav() {
  const path = usePathname();
  return (
    <aside className="hidden md:flex md:flex-col md:w-56 md:fixed md:inset-y-0 md:left-0 bg-white border-r border-[#ECE7DD] py-6 px-4 z-10">
      <div className="font-serif text-2xl mb-8">
        Bashir <span className="text-[#9C7847] text-xl">بشير</span>
      </div>
      <Link
        href="/today"
        className={`block py-2 px-3 rounded-md mb-1 text-sm ${
          path.startsWith("/today") ? "bg-[#F2EDE2] font-semibold" : "text-[#3D362F]"
        }`}
      >
        Today
      </Link>
      <Link
        href="/archive"
        className={`block py-2 px-3 rounded-md mb-1 text-sm ${
          path.startsWith("/archive") ? "bg-[#F2EDE2] font-semibold" : "text-[#3D362F]"
        }`}
      >
        Archive
      </Link>
      <Link
        href="/senders"
        className={`block py-2 px-3 rounded-md mb-1 text-sm ${
          path.startsWith("/senders") ? "bg-[#F2EDE2] font-semibold" : "text-[#3D362F]"
        }`}
      >
        Senders
      </Link>
      <div className="mt-auto">
        <form action="/api/logout" method="POST">
          <button className="text-sm text-[#9C9189] hover:text-[#1A1614]">⏻ Logout</button>
        </form>
      </div>
    </aside>
  );
}
