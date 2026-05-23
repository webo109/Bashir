import { getNoiseGenerators } from "@/lib/queries";
import { UnsubButton } from "@/components/UnsubButton";

export const dynamic = "force-dynamic";

const THRESHOLDS = [
  { key: "3", label: "≥3 emails", value: 3 },
  { key: "5", label: "≥5 emails", value: 5 },
  { key: "10", label: "≥10 emails", value: 10 },
] as const;

function gmailSearch(addr: string) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${addr}`)}`;
}

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const minCountStr = searchParams.min ?? "3";
  const minCount = Number(minCountStr);
  let rows;
  try {
    rows = await getNoiseGenerators({ minCount, archiveThreshold: 1.0, limit: 50 });
  } catch {
    return (
      <div className="text-center py-16">
        <p className="text-[#7A7066]">Bashir is offline. Try again in a minute.</p>
      </div>
    );
  }

  const totalEmails = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <>
      <div className="font-serif text-2xl mb-1">Manage senders</div>
      <p className="text-sm text-[#7A7066] mb-4">
        {rows.length === 0
          ? "No sender qualifies as noise at this threshold."
          : `${rows.length} sender${rows.length === 1 ? "" : "s"} sending only archive — ~${totalEmails} email${totalEmails === 1 ? "" : "s"} to clear.`}
      </p>

      <div className="flex gap-1.5 mb-5">
        {THRESHOLDS.map((t) => {
          const active = minCountStr === t.key;
          return (
            <a
              key={t.key}
              href={`/senders?min=${t.value}`}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? "bg-[#1A1614] text-[#FBFAF7] border-[#1A1614]"
                  : "bg-white text-[#3D362F] border-[#ECE7DD] hover:border-[#D6CDB8]"
              }`}
            >
              {t.label}
            </a>
          );
        })}
      </div>

      {rows.length === 0 && (
        <p className="text-center text-[#7A7066] py-8">
          (If you haven&apos;t run <code className="bg-[#F2EDE2] px-1 rounded">python scripts/refresh_unsubscribe.py</code> yet, do that first to populate unsubscribe URLs.)
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((s) => (
          <div
            key={s.from_email}
            className="bg-white border border-[#ECE7DD] rounded-xl p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[#1A1614] text-sm truncate">
                  {s.from_name || s.from_email}
                </div>
                <div className="text-[11px] text-[#7A7066] truncate mt-0.5">
                  {s.from_email}
                </div>
              </div>
              <div className="text-[10px] font-semibold bg-[#1A1614] text-[#FBFAF7] px-2 py-0.5 rounded-full whitespace-nowrap">
                {s.total} email{s.total === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <UnsubButton
                url={s.unsubscribe_url}
                one_click={s.unsubscribe_one_click}
                size="md"
              />
              <a
                href={gmailSearch(s.from_email)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold bg-white border border-[#ECE7DD] text-[#3D362F] px-3 py-1.5 rounded-full hover:border-[#D6CDB8]"
              >
                Bulk-delete in Gmail ↗
              </a>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
