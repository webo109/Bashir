"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function ArchiveSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  // FIX-12: snapshot the params as a string so the effect re-runs when the
  // chip row (or any other URL change) updates them. The previous
  // implementation read `params` from the closure with [q] as the only
  // dependency, so changing filters mid-typing would clobber them.
  const paramsKey = params.toString();

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(Array.from(params.entries()));
      if (q) p.set("q", q);
      else p.delete("q");
      p.delete("page");
      router.replace(`/archive?${p.toString()}`);
    }, 200);
    return () => clearTimeout(t);
  }, [q, paramsKey, params, router]);

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
