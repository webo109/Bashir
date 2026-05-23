import { supabase } from "./supabase";
import { muscatTodayStart } from "./time";
import type { Category, EmailRow, SenderStats } from "./types";

interface RawRow {
  id: number;
  gmail_msg_id: string;
  account_id: number;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  received_at: string;
  gmail_url: string | null;
  folder: string;
  accounts: { email: string } | { email: string }[] | null;
  classifications: Array<{
    category: Category;
    summary: string | null;
    why_priority: string | null;
    classified_at: string;
  }>;
}

function flatten(row: RawRow): EmailRow {
  // Most recent classification (server-side ordering not guaranteed — sort here).
  const cls = (row.classifications || []).slice().sort(
    (a, b) => Date.parse(b.classified_at) - Date.parse(a.classified_at)
  );
  const top = cls[0];
  const acct = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  return {
    id: row.id,
    gmail_msg_id: row.gmail_msg_id,
    account_id: row.account_id,
    account_email: acct?.email,
    from_name: row.from_name,
    from_email: row.from_email,
    subject: row.subject,
    snippet: row.snippet,
    body: row.body,
    received_at: row.received_at,
    gmail_url: row.gmail_url,
    folder: row.folder,
    category: top?.category ?? null,
    summary: top?.summary ?? null,
    why_priority: top?.why_priority ?? null,
    unsubscribe_url: null,
    unsubscribe_one_click: false,
  };
}

async function hydrateUnsubscribe(rows: EmailRow[]): Promise<EmailRow[]> {
  const emails = Array.from(new Set(rows.map(r => r.from_email).filter(Boolean))) as string[];
  if (!emails.length) return rows;
  const { data } = await supabase()
    .from("sender_unsubscribe")
    .select("from_email, unsubscribe_url, one_click")
    .in("from_email", emails);
  const map = new Map((data || []).map(r => [r.from_email, r]));
  return rows.map(r => {
    const m = r.from_email ? map.get(r.from_email) : undefined;
    return { ...r, unsubscribe_url: m?.unsubscribe_url ?? null, unsubscribe_one_click: m?.one_click ?? false };
  });
}

export async function getTodayEmails(): Promise<EmailRow[]> {
  const since = muscatTodayStart();
  const { data, error } = await supabase()
    .from("emails")
    .select(
      "id, gmail_msg_id, account_id, from_name, from_email, subject, snippet, body, received_at, gmail_url, folder, accounts(email), classifications(category, summary, why_priority, classified_at)"
    )
    .gte("received_at", since)
    .eq("folder", "inbox")
    .order("received_at", { ascending: false });
  if (error) throw error;
  const rows = (data as unknown as RawRow[]).map(flatten);
  return await hydrateUnsubscribe(rows);
}

export interface ArchiveQuery {
  q?: string;
  categories?: Category[];
  accountIds?: number[];
  range?: "24h" | "7d" | "30d" | "12mo" | "all";
  page?: number;
  pageSize?: number;
}

export async function searchArchive(
  params: ArchiveQuery
): Promise<{ rows: EmailRow[]; hasMore: boolean }> {
  const pageSize = params.pageSize ?? 50;
  const page = params.page ?? 0;

  let query = supabase()
    .from("emails")
    .select(
      "id, gmail_msg_id, account_id, from_name, from_email, subject, snippet, body, received_at, gmail_url, folder, accounts(email), classifications(category, summary, why_priority, classified_at)"
    )
    .eq("folder", "inbox")
    .order("received_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize); // +1 to detect hasMore

  if (params.q && params.q.trim()) {
    const q = `%${params.q.trim()}%`;
    query = query.or(`subject.ilike.${q},from_email.ilike.${q},from_name.ilike.${q},body.ilike.${q}`);
  }
  if (params.accountIds && params.accountIds.length) {
    query = query.in("account_id", params.accountIds);
  }
  if (params.range && params.range !== "all") {
    const map = { "24h": 1, "7d": 7, "30d": 30, "12mo": 365 } as const;
    const days = map[params.range];
    const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    query = query.gte("received_at", since);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data as unknown as RawRow[]).map(flatten);

  // Category filter is applied post-fetch since classification is a 1-to-many join
  // and Supabase filters on it would drop unclassified emails.
  let filtered = rows;
  if (params.categories && params.categories.length) {
    const set = new Set(params.categories);
    filtered = rows.filter((r) => r.category && set.has(r.category));
  }

  const hasMore = filtered.length > pageSize;
  return { rows: await hydrateUnsubscribe(filtered.slice(0, pageSize)), hasMore };
}

export async function getAccounts(): Promise<Array<{ id: number; email: string }>> {
  const { data, error } = await supabase()
    .from("accounts")
    .select("id, email")
    .order("email");
  if (error) throw error;
  return data ?? [];
}

export async function getNoiseGenerators(opts: {
  minCount?: number;
  archiveThreshold?: number;
  limit?: number;
} = {}): Promise<SenderStats[]> {
  const minCount = opts.minCount ?? 3;
  const archiveThreshold = opts.archiveThreshold ?? 1.0;
  const limit = opts.limit ?? 50;

  // Pull inbox emails with their classification. Iterate pages until done.
  const pageSize = 1000;
  let page = 0;
  const stats = new Map<string, { name: string | null; total: number; archive: number }>();
  for (;;) {
    const { data, error } = await supabase()
      .from("emails")
      .select("from_email, from_name, classifications(category)")
      .eq("folder", "inbox")
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    type NoiseRow = { from_email: string | null; from_name: string | null; classifications: Array<{ category: string }> | null };
    const batch = (data as unknown as NoiseRow[]) || [];
    if (!batch.length) break;
    for (const r of batch) {
      const addr = (r.from_email || "").toLowerCase();
      if (!addr) continue;
      const cls = (r.classifications || []) as Array<{ category: string }>;
      const cat = cls[0]?.category;
      const cur = stats.get(addr) ?? { name: r.from_name ?? null, total: 0, archive: 0 };
      cur.total++;
      if (cat === "archive") cur.archive++;
      stats.set(addr, cur);
    }
    if (batch.length < pageSize) break;
    page++;
  }

  // Filter + sort.
  const filtered: Array<{ addr: string; name: string | null; total: number; archive: number }> = [];
  Array.from(stats.entries()).forEach(([addr, s]) => {
    if (s.total < minCount) return;
    if (s.archive / s.total < archiveThreshold) return;
    filtered.push({ addr, ...s });
  });
  filtered.sort((a, b) => b.total - a.total);
  const top = filtered.slice(0, limit);

  // Hydrate unsubscribe URLs in one query.
  const addrs = top.map(t => t.addr);
  const { data: unsubRows } = await supabase()
    .from("sender_unsubscribe")
    .select("from_email, unsubscribe_url, one_click")
    .in("from_email", addrs);
  const unsubMap = new Map((unsubRows || []).map(r => [r.from_email, r]));

  return top.map(t => ({
    from_email: t.addr,
    from_name: t.name,
    total: t.total,
    archive_count: t.archive,
    archive_pct: t.archive / t.total,
    unsubscribe_url: unsubMap.get(t.addr)?.unsubscribe_url ?? null,
    unsubscribe_one_click: unsubMap.get(t.addr)?.one_click ?? false,
  }));
}
