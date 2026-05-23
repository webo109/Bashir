import type { Category, EmailRow } from "@/lib/types";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/types";
import { EmailCard } from "./EmailCard";

export function CategorySection({
  category,
  emails,
}: {
  category: Category;
  emails: EmailRow[];
}) {
  if (!emails.length) return null;
  return (
    <section className="mt-7">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#1A1614]">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: CATEGORY_COLOR[category] }}
          />
          {CATEGORY_LABEL[category]}
        </div>
        <div className="text-[10px] font-semibold bg-[#1A1614] text-[#FBFAF7] px-2 py-0.5 rounded-full">
          {emails.length}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {emails.map((e, i) => (
          <div key={e.id} className="fade-up" style={{ animationDelay: `${i * 50}ms` }}>
            <EmailCard email={e} />
          </div>
        ))}
      </div>
    </section>
  );
}
