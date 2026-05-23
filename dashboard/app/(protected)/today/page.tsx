import { getTodayEmails } from "@/lib/queries";
import { CATEGORY_ORDER } from "@/lib/types";
import type { Category } from "@/lib/types";
import { Greeting } from "@/components/Greeting";
import { CategorySection } from "@/components/CategorySection";
import { ArchiveCollapse } from "@/components/ArchiveCollapse";

export const dynamic = "force-dynamic"; // reload on every visit

export default async function TodayPage() {
  let emails;
  try {
    emails = await getTodayEmails();
  } catch {
    return (
      <div className="text-center py-16">
        <p className="text-[#7A7066]">Bashir is offline. Try again in a minute.</p>
      </div>
    );
  }

  const byCategory = CATEGORY_ORDER.reduce<Record<Category, typeof emails>>(
    (acc, cat) => {
      acc[cat] = emails.filter((e) => e.category === cat);
      return acc;
    },
    {} as Record<Category, typeof emails>
  );

  return (
    <>
      <Greeting emails={emails} />
      {CATEGORY_ORDER.filter((c) => c !== "archive").map((cat) => (
        <CategorySection key={cat} category={cat} emails={byCategory[cat]} />
      ))}
      <ArchiveCollapse emails={byCategory.archive} />
    </>
  );
}
