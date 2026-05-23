import { getAccounts, searchArchive } from "@/lib/queries";
import type { Category } from "@/lib/types";
import { EmailCard } from "@/components/EmailCard";
import { ArchiveSearch } from "@/components/ArchiveSearch";
import { ArchiveFilters } from "@/components/ArchiveFilters";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const accounts = await getAccounts();
  const page = Number(searchParams.page ?? "0") || 0;
  const range = (searchParams.range ?? "30d") as "24h" | "7d" | "30d" | "12mo" | "all";
  const cats = (searchParams.cat ?? "").split(",").filter(Boolean) as Category[];
  const acctIds = (searchParams.acct ?? "")
    .split(",")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  let rows;
  let hasMore = false;
  try {
    const res = await searchArchive({
      q: searchParams.q,
      categories: cats.length ? cats : undefined,
      accountIds: acctIds.length ? acctIds : undefined,
      range,
      page,
    });
    rows = res.rows;
    hasMore = res.hasMore;
  } catch {
    return (
      <div className="text-center py-16">
        <p className="text-[#7A7066]">Bashir is offline. Try again in a minute.</p>
      </div>
    );
  }

  const baseParams = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) => (v ? [[k, v] as [string, string]] : []))
  );

  return (
    <>
      <h1 className="font-serif text-2xl mb-4">Archive</h1>
      <div className="flex flex-col gap-3 mb-5 sticky top-0 bg-[#FBFAF7] pt-1 pb-3 z-[1]">
        <ArchiveSearch />
        <ArchiveFilters accounts={accounts} />
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-[#7A7066] py-10">Nothing matches. Try fewer filters.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((e) => (
            <EmailCard key={e.id} email={e} showDot />
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-between text-sm text-[#7A7066]">
        {page > 0 ? (
          (() => {
            const p = new URLSearchParams(baseParams);
            p.set("page", String(page - 1));
            return (
              <Link href={`/archive?${p.toString()}`} className="hover:text-[#1A1614]">
                ← Newer
              </Link>
            );
          })()
        ) : (
          <span />
        )}
        {hasMore && (() => {
          const p = new URLSearchParams(baseParams);
          p.set("page", String(page + 1));
          return (
            <Link href={`/archive?${p.toString()}`} className="hover:text-[#1A1614]">
              Older →
            </Link>
          );
        })()}
      </div>
    </>
  );
}
