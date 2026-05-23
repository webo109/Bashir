"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function ArchiveSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(Array.from(params.entries()));
      if (q) p.set("q", q);
      else p.delete("q");
      p.delete("page");
      router.replace(`/archive?${p.toString()}`);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <Input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search subject, sender, body…"
      className="w-full"
    />
  );
}
