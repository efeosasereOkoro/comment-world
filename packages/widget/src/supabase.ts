import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY, FUNCTIONS_URL } from "./config";
import type { Comment, CommentRow } from "./types";

// Lazy-init: supabase-js is bundled into widget.js, but the client itself is only
// constructed the first time the widget actually needs the backend (deferred
// createClient). `undefined` = not yet attempted; `null` = no usable config.
let client: SupabaseClient | null | undefined;

export function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    client = null;
    return client;
  }
  try {
    client = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error("[commentbox] Supabase init failed", e);
    client = null;
  }
  return client;
}

export interface NewComment {
  selector: string;
  quote: string;
  name: string;
  text: string;
}

/**
 * Owns the live feed of comments for a single site + page. Encapsulates fetch +
 * realtime subscription + insert so {@link init} carries no module-level state.
 *
 * Reads are scoped by `site_id` AND `page` (tenant isolation). Inserts are NOT done
 * directly against the table — they are POSTed to the origin-checked `post-comment`
 * Edge Function, the only path allowed to write comments (RLS blocks anon inserts).
 */
export class CommentStore {
  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly siteId: string,
    private readonly pageKey: string,
    private readonly onChange: (comments: Comment[]) => void
  ) {}

  private normalize(rows: CommentRow[] | null): Comment[] {
    const list = (rows || []).map((r) => ({
      id: r.id,
      selector: r.selector || "",
      quote: r.quote || "",
      name: r.author || "Anonymous",
      text: r.content || "",
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    }));
    list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  }

  async fetch(): Promise<void> {
    const supabase = getClient();
    if (!supabase) return;
    const res = await supabase
      .from("comments")
      .select("*")
      .eq("site_id", this.siteId)
      .eq("page", this.pageKey);
    if (res.error) {
      console.error("[commentbox] fetch error", res.error);
      return;
    }
    this.onChange(this.normalize(res.data as CommentRow[]));
  }

  async subscribe(): Promise<void> {
    const supabase = getClient();
    if (!supabase) return;
    await this.fetch();
    // Realtime postgres_changes supports a single filter expression, so we filter on
    // the more selective site_id and re-fetch (which re-scopes by site_id AND page).
    this.channel = supabase
      .channel("comments:" + this.siteId + ":" + this.pageKey)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: "site_id=eq." + this.siteId },
        () => {
          void this.fetch();
        }
      )
      .subscribe();
  }

  async add(comment: NewComment): Promise<void> {
    if (!FUNCTIONS_URL || !SUPABASE_KEY) {
      alert("Comments are unavailable: the backend is not configured yet.");
      throw new Error("supabase not configured");
    }
    // Writes go through the origin-checked Edge Function, never a direct insert.
    const res = await fetch(FUNCTIONS_URL + "/post-comment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
      },
      body: JSON.stringify({
        siteId: this.siteId,
        page: this.pageKey,
        selector: comment.selector,
        quote: comment.quote,
        name: comment.name,
        text: comment.text,
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: string })?.error ?? "";
      } catch {
        /* ignore non-JSON body */
      }
      throw new Error("post-comment failed: " + res.status + (detail ? " " + detail : ""));
    }
    // Realtime will deliver the new row; refetch immediately as a fallback.
    await this.fetch();
  }

  dispose(): void {
    if (this.channel) {
      void this.channel.unsubscribe();
      this.channel = null;
    }
  }
}
