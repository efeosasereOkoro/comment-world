/** Configuration the host supplies via `window.CommentWidget`. */
export interface WidgetGlobal {
  siteId?: string;
  /** Optional override for the page key. Defaults to the normalized pathname. */
  pageId?: string;
}

/** Fully-resolved config passed into {@link init}. */
export interface WidgetConfig {
  siteId: string;
  pageId?: string;
}

/** Capture-time context for a comment: what the anchored spot looked like when the
 *  comment was made, so feedback survives a later redesign. */
export interface CommentSnapshot {
  url?: string | null;
  title?: string | null;
  tag?: string | null;
  context?: string | null;
  viewport?: { w: number | null; h: number | null };
  rect?: {
    top: number | null;
    left: number | null;
    width: number | null;
    height: number | null;
  };
}

/** A comment as used by the UI (normalized from a backend row). */
export interface Comment {
  id: string;
  /** CSS-path anchor for the commented element. */
  selector: string;
  /** Optional quoted text the comment refers to. */
  quote: string;
  name: string;
  text: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Parent comment id when this is a reply; null for a top-level comment. */
  parentId: string | null;
}

/** Raw row shape returned by the backend `comments` table. */
export interface CommentRow {
  id: string;
  site_id: string;
  page: string;
  selector: string | null;
  quote: string | null;
  author: string | null;
  content: string | null;
  created_at: string | null;
  parent_id: string | null;
}

declare global {
  interface Window {
    CommentWidget?: WidgetGlobal;
  }
}
