"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type Category,
} from "@/lib/types";

const RANGES = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "12mo", label: "12mo" },
  { key: "all", label: "All" },
] as const;

export function ArchiveFilters({
  accounts,
}: {
  accounts: Array<{ id: number; email: string }>;
}) {
  const params = useSearchParams();

  function urlFor(mutator: (p: URLSearchParams) => void): string {
    const p = new URLSearchParams(Array.from(params.entries()));
    mutator(p);
    p.delete("page");
    const qs = p.toString();
    return qs ? `/archive?${qs}` : "/archive";
  }

  function toggleArrayUrl(key: string, value: string): string {
    return urlFor((p) => {
      const cur = (p.get(key) ?? "").split(",").filter(Boolean);
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      if (next.length) p.set(key, next.join(","));
      else p.delete(key);
    });
  }

  function rangeUrl(value: string): string {
    return urlFor((p) => p.set("range", value));
  }

  const selectedCats = (params.get("cat") ?? "").split(",").filter(Boolean);
  const selectedAccts = (params.get("acct") ?? "").split(",").filter(Boolean);
  const range = params.get("range") ?? "30d";

  function chip(active: boolean, href: string, label: React.ReactNode, color?: string, key?: string) {
    return (
      <Link
        key={key}
        href={href}
        scroll={false}
        className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
          active
            ? "bg-[#1A1614] text-[#FBFAF7] border-[#1A1614]"
            : "bg-white text-[#3D362F] border-[#ECE7DD] hover:border-[#D6CDB8]"
        }`}
      >
        {color && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
            style={{ background: color }}
          />
        )}
        {label}
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {CATEGORY_ORDER.map((c) =>
          chip(
            selectedCats.includes(c),
            toggleArrayUrl("cat", c),
            CATEGORY_LABEL[c],
            CATEGORY_COLOR[c as Category],
            c,
          )
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {accounts.map((a) =>
          chip(
            selectedAccts.includes(String(a.id)),
            toggleArrayUrl("acct", String(a.id)),
            a.email,
            undefined,
            `acct-${a.id}`,
          )
        )}
      </div>
      <div className="flex gap-1.5">
        {RANGES.map((r) =>
          chip(range === r.key, rangeUrl(r.key), r.label, undefined, `range-${r.key}`)
        )}
      </div>
    </div>
  );
}
