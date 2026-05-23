"use client";
import { useRouter, useSearchParams } from "next/navigation";
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
  const router = useRouter();
  const params = useSearchParams();

  function toggleArray(key: string, value: string) {
    const p = new URLSearchParams(Array.from(params.entries()));
    const cur = (p.get(key) ?? "").split(",").filter(Boolean);
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    if (next.length) p.set(key, next.join(","));
    else p.delete(key);
    p.delete("page");
    router.replace(`/archive?${p.toString()}`);
  }
  function setRange(value: string) {
    const p = new URLSearchParams(Array.from(params.entries()));
    p.set("range", value);
    p.delete("page");
    router.replace(`/archive?${p.toString()}`);
  }

  const selectedCats = (params.get("cat") ?? "").split(",").filter(Boolean);
  const selectedAccts = (params.get("acct") ?? "").split(",").filter(Boolean);
  const range = params.get("range") ?? "30d";

  function chip(active: boolean, onClick: () => void, label: React.ReactNode, color?: string) {
    return (
      <button
        type="button"
        onClick={onClick}
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
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {CATEGORY_ORDER.map((c) =>
          chip(
            selectedCats.includes(c),
            () => toggleArray("cat", c),
            CATEGORY_LABEL[c],
            CATEGORY_COLOR[c as Category]
          )
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {accounts.map((a) =>
          chip(
            selectedAccts.includes(String(a.id)),
            () => toggleArray("acct", String(a.id)),
            a.email
          )
        )}
      </div>
      <div className="flex gap-1.5">
        {RANGES.map((r) =>
          chip(range === r.key, () => setRange(r.key), r.label)
        )}
      </div>
    </div>
  );
}
