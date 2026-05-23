import { greetingPeriod, muscatDateLabel } from "@/lib/time";
import type { Category, EmailRow } from "@/lib/types";

export function Greeting({ emails }: { emails: EmailRow[] }) {
  const period = greetingPeriod();
  const counts = emails.reduce<Record<Category, number>>(
    (acc, e) => {
      if (e.category) acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    },
    {
      reply_today: 0,
      important_fyi: 0,
      opportunities: 0,
      diploma_learning: 0,
      archive: 0,
    }
  );

  const summary = buildSummary(counts, period);

  return (
    <header className="mb-2">
      <div className="flex items-baseline justify-between">
        <div className="font-serif text-xl">
          Bashir <span className="text-[#9C7847] text-lg">بشير</span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#7A7066]">
          {muscatDateLabel()}
        </div>
      </div>
      <h1 className="font-serif text-[1.6rem] leading-tight mt-2 mb-3">
        Good {period}, Nova.
      </h1>
      <p className="font-serif italic bg-[#F2EDE2] border-l-[3px] border-[#9C7847] px-3.5 py-2.5 rounded-r-md text-[#3D362F] leading-relaxed">
        {summary}
      </p>
    </header>
  );
}

function buildSummary(
  counts: Record<Category, number>,
  period: "morning" | "afternoon" | "evening" = "morning"
): string {
  const parts: string[] = [];
  const r = counts.reply_today;
  const o = counts.opportunities;
  const a = counts.archive;
  const f = counts.important_fyi;
  const d = counts.diploma_learning;
  const total = r + o + a + f + d;

  if (total === 0) {
    // NIT-2: use the actual greeting period instead of hard-coding "morning".
    return `Quiet ${period}. Bashir found nothing worth your attention.`;
  }

  if (r > 0) {
    parts.push(`${r} email${r === 1 ? "" : "s"} need${r === 1 ? "s" : ""} your reply`);
  } else {
    parts.push("nothing needs your reply");
  }
  if (o > 0) parts.push(`${o} opportunit${o === 1 ? "y" : "ies"} surfaced`);
  if (f > 0) parts.push(`${f} FYI`);
  if (d > 0) parts.push(`${d} from the diploma`);
  if (a > 0) parts.push(`${a} sent straight to archive`);

  // Capitalize first, comma-join, period.
  const sentence = parts
    .map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(", ");
  return sentence + ".";
}
