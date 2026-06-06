export interface Site {
  id: string;
  owner_id: string;
  name: string;
  allowed_origins: string[];
  moderation_enabled: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export type TriageStatus = "open" | "in_progress" | "resolved";

/** Capture-time visual/page context recorded by the widget (sanitized server-side). */
export interface CommentSnapshot {
  url?: string | null;
  title?: string | null;
  tag?: string | null;
  context?: string | null;
  viewport?: { w: number | null; h: number | null } | null;
  rect?: {
    top: number | null;
    left: number | null;
    width: number | null;
    height: number | null;
  } | null;
}

export interface CommentRow {
  id: string;
  site_id: string;
  page: string;
  selector: string | null;
  quote: string | null;
  author: string | null;
  content: string | null;
  status: "approved" | "pending";
  created_at: string;
  /** Threaded replies: parent comment id, or null for a top-level comment. */
  parent_id: string | null;
  /** Owner-facing triage workflow (orthogonal to public-visibility `status`). */
  triage_status: TriageStatus;
  assignee: string | null;
  tags: string[];
  snapshot: CommentSnapshot | null;
}
