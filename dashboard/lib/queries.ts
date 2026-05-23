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

/**
 * Strip PostgREST-meaningful characters from a `.or()` filter value.
 * `,` `(` `)` are PostgREST list/grouping separators; `%` and `_` are ILIKE
 * wildcards we want to escape so the user's literal text matches literally.
 * (FIX-4)
 */
export function sanitizePostgrestLike(q: string): string {
  if (!q) return "";
  return q
    // Drop PostgREST OR/grouping characters entirely — there's no documented
    // escape for them inside an `.or()` clause.
    .replace(/[,()]/g, " ")
    // Escape ILIKE wildcards so a literal `%` or `_` matches itself.
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    // Strip colon, asterisk, and the PostgREST quote char as well — none of
    // them are needed for a substring search and all can interact badly.
    .replace(/[:*"]/g, " ")
    .trim();
}

function flatten(row: RawRow): EmailRow {
  // Most recent classification first — server-side ordering inside a nested
  // select is best-effort in supabase-js v2, so sort defensively (FIX-8 mirror).
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

// FIX-7 follow-up: the previous attempt embedded `order=...,limit=1` inside
// the nested select column list. That is NOT valid PostgREST syntax (those
// belong in URL params like `classifications.order=...` and `.limit()` only
// applies to the parent query in supabase-js v2). We rely on `flatten()` to
// take the newest classification client-side. Over-fetch is bounded in
// practice because emails rarely have more than 1-2 classifications.
const EMAIL_WITH_LATEST_CLASS_SELECT =
  "id, gmail_msg_id, account_id, from_name, from_email, subject, snippet, body, received_at, gmail_url, folder, accounts(email), classifications(category, summary, why_priority, classified_at)";

export async function getTodayEmails(): Promise<EmailRow[]> {
  const since = muscatTodayStart();
  // Today is the editorial view: only inbox messages from this Muscat day.
  // `getTodayEmails` intentionally ignores folder='sent' (audit nit).
  const { data, error } = await supabase()
    .from("emails")
    .select(EMAIL_WITH_LATEST_CLASS_SELECT)
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

function buildArchiveQuery(
  params: ArchiveQuery,
  offset: number,
  windowSize: number
) {
  let query = supabase()
    .from("emails")
    .select(EMAIL_WITH_LATEST_CLASS_SELECT)
    .eq("folder", "inbox")
    .order("received_at", { ascending: false })
    .range(offset, offset + windowSize - 1);

  if (params.q && params.q.trim()) {
    // FIX-4: sanitize before interpolating into a PostgREST .or() clause.
    // Raw commas and parens break the parser; %/_ become literal wildcards.
    const safe = sanitizePostgrestLike(params.q);
    if (safe) {
      const q = `%${safe}%`;
      query = query.or(
        `subject.ilike.${q},from_email.ilike.${q},from_name.ilike.${q},body.ilike.${q}`
      );
    }
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
  return query;
}

export async function searchArchive(
  params: ArchiveQuery
): Promise<{ rows: EmailRow[]; hasMore: boolean }> {
  const pageSize = params.pageSize ?? 50;
  const page = params.page ?? 0;
  const categorySet =
    params.categories && params.categories.length
      ? new Set(params.categories)
      : null;

  // FIX-3: category filter was applied AFTER pagination, so hasMore was wrong
  // whenever a chip was selected. Server-side filtering through Supabase's
  // nested filter syntax against `classifications.category` is not reliably
  // supported in supabase-js v2 (it would drop emails without classifications
  // anyway, which the audit flagged). Instead we keep the JS filter but
  // paginate over raw DB pages until we have either pageSize+1 matching rows
  // or we hit a hard ceiling — that way Older→ disappears only when there
  // really is no more content matching the filter.
  const dbPageSize = pageSize * 2; // fetch a bit ahead each round
  const maxScans = 10; // cap total work: scan at most 10*dbPageSize raw rows
  const startOffset = page * pageSize;

  const filtered: EmailRow[] = [];
  let hasMore = false;
  let scanOffset = startOffset;

  for (let i = 0; i < maxScans; i++) {
    const { data, error } = await buildArchiveQuery(params, scanOffset, dbPageSize + 1);
    if (error) throw error;
    const batch = (data as unknown as RawRow[]) || [];
    const got = batch.slice(0, dbPageSize);
    const sawMoreFromDb = batch.length > dbPageSize;

    for (const r of got) {
      const row = flatten(r);
      if (categorySet && !(row.category && categorySet.has(row.category))) continue;
      filtered.push(row);
      if (filtered.length > pageSize) break;
    }
    if (filtered.length > pageSize) {
      hasMore = true;
      break;
    }
    if (!sawMoreFromDb) {
      // DB exhausted under current filters.
      break;
    }
    scanOffset += dbPageSize;
  }

  const page_rows = filtered.slice(0, pageSize);
  return { rows: await hydrateUnsubscribe(page_rows), hasMore };
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
      .select("from_email, from_name, classifications(category, classified_at)")
      .eq("folder", "inbox")
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    type NoiseRow = { from_email: string | null; from_name: string | null; classifications: Array<{ category: string; classified_at?: string }> | null };
    const batch = (data as unknown as NoiseRow[]) || [];
    if (!batch.length) break;
    for (const r of batch) {
      const addr = (r.from_email || "").toLowerCase();
      if (!addr) continue;
      // Latest classification wins (FIX-8 mirror). Server-side ordering inside
      // a nested embed isn't guaranteed, so sort defensively.
      const cls = ((r.classifications || []) as Array<{ category: string; classified_at?: string }>)
        .slice()
        .sort((a, b) => Date.parse(b.classified_at || "") - Date.parse(a.classified_at || ""));
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
