import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config";
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
 * Owns the live feed of comments for a single page key. Encapsulates fetch +
 * realtime subscription + insert so {@link init} carries no module-level state.
 *
 * Phase 3 will add a `site_id` filter to every query and route inserts through the
 * origin-checked `post-comment` Edge Function instead of a direct table insert.
 */
export class CommentStore {
  private channel: RealtimeChannel | null = null;

  constructor(
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
    const res = await supabase.from("comments").select("*").eq("page", this.pageKey);
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
    this.channel = supabase
      .channel("comments:" + this.pageKey)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: "page=eq." + this.pageKey },
        () => {
          void this.fetch();
        }
      )
      .subscribe();
  }

  async add(comment: NewComment): Promise<void> {
    const supabase = getClient();
    if (!supabase) {
      alert("Comments are unavailable: the backend is not configured yet.");
      throw new Error("supabase not configured");
    }
    const res = await supabase.from("comments").insert({
      page: this.pageKey,
      selector: comment.selector,
      quote: comment.quote,
      author: comment.name,
      content: comment.text,
    });
    if (res.error) throw res.error;
    await this.fetch();
  }

  dispose(): void {
    if (this.channel) {
      void this.channel.unsubscribe();
      this.channel = null;
    }
  }
}
