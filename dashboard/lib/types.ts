export type Category =
  | "reply_today"
  | "important_fyi"
  | "opportunities"
  | "diploma_learning"
  | "archive";

export const CATEGORY_ORDER: Category[] = [
  "reply_today",
  "opportunities",
  "important_fyi",
  "diploma_learning",
  "archive",
];

export const CATEGORY_LABEL: Record<Category, string> = {
  reply_today: "Reply today",
  opportunities: "Opportunities",
  important_fyi: "Important FYI",
  diploma_learning: "Diploma & learning",
  archive: "Archive",
};

export const CATEGORY_COLOR: Record<Category, string> = {
  reply_today: "#C45A3D",
  opportunities: "#5C8A4F",
  important_fyi: "#3D6B8A",
  diploma_learning: "#7A4F8A",
  archive: "#9C9189",
};

export interface EmailRow {
  id: number;
  gmail_msg_id: string;
  account_id: number;
  account_email?: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  received_at: string; // ISO
  gmail_url: string | null;
  folder: string;
  category: Category | null;
  summary: string | null;
  why_priority: string | null;
  unsubscribe_url: string | null;
  unsubscribe_one_click: boolean;
}

export interface SenderStats {
  from_email: string;
  from_name: string | null;
  total: number;
  archive_count: number;
  archive_pct: number;
  unsubscribe_url: string | null;
  unsubscribe_one_click: boolean;
}
