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
}

/** Raw row shape returned by the backend `comments` table. */
export interface CommentRow {
  id: string;
  page: string;
  selector: string | null;
  quote: string | null;
  author: string | null;
  content: string | null;
  created_at: string | null;
}

declare global {
  interface Window {
    CommentWidget?: WidgetGlobal;
  }
}
