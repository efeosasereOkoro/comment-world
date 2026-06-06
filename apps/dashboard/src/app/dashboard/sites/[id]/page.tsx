import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WIDGET_SRC } from "@/lib/env";
import { INSTALL_CHECK_PAGE } from "@/lib/constants";
import type { Site, CommentRow, CommentSnapshot } from "@/lib/types";
import CopyBlock from "@/components/CopyBlock";
import VerifyInstall from "@/components/VerifyInstall";
import DeleteSiteButton from "@/components/DeleteSiteButton";
import {
  updateOrigins,
  deleteComment,
  setModeration,
  approveComment,
  setTriage,
} from "../../actions";

export const dynamic = "force-dynamic";

function snippet(siteId: string): string {
  return (
    `<script>window.CommentWidget = { siteId: "${siteId}" };</script>\n` +
    `<script async src="${WIDGET_SRC}"></script>`
  );
}

/** Group TOP-LEVEL comments by page (replies are nested under their parent). */
function groupByPage(rows: CommentRow[]): Record<string, CommentRow[]> {
  const groups: Record<string, CommentRow[]> = {};
  for (const r of rows) {
    if (r.parent_id) continue; // replies are rendered nested, not as page rows
    (groups[r.page] = groups[r.page] || []).push(r);
  }
  return groups;
}

/** Map of parent comment id → its replies (oldest first). */
function repliesByParent(rows: CommentRow[]): Record<string, CommentRow[]> {
  const map: Record<string, CommentRow[]> = {};
  for (const r of rows) {
    if (!r.parent_id) continue;
    (map[r.parent_id] = map[r.parent_id] || []).push(r);
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  }
  return map;
}

const TRIAGE_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

function SnapshotContext({ snapshot }: { snapshot: CommentSnapshot | null }) {
  if (!snapshot) return null;
  const { url, title, tag, context, viewport, rect } = snapshot;
  if (!url && !title && !tag && !context) return null;
  return (
    <details className="snapshot">
      <summary className="muted small">Captured context</summary>
      <div className="small" style={{ marginTop: ".4rem", display: "grid", gap: ".25rem" }}>
        {title && (
          <div>
            <strong>Page:</strong> {title}
          </div>
        )}
        {url && (
          <div style={{ wordBreak: "break-all" }}>
            <strong>URL:</strong>{" "}
            <a href={url} target="_blank" rel="noreferrer noopener">
              {url}
            </a>
          </div>
        )}
        {tag && (
          <div>
            <strong>Element:</strong> <code>&lt;{tag}&gt;</code>
          </div>
        )}
        {context && (
          <div style={{ fontStyle: "italic" }}>“{context}”</div>
        )}
        {rect && (rect.width != null || rect.height != null) && (
          <div className="muted">
            Position: {rect.left ?? "?"},{rect.top ?? "?"} · size {rect.width ?? "?"}×
            {rect.height ?? "?"}
            {viewport && viewport.w != null
              ? ` · viewport ${viewport.w}×${viewport.h ?? "?"}`
              : ""}
          </div>
        )}
      </div>
    </details>
  );
}

export default async function SitePage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: site } = await supabase
    .from("sites")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!site) notFound();
  const s = site as Site;

  const { data: comments } = await supabase
    .from("comments")
    .select(
      "id, site_id, page, selector, quote, author, content, status, created_at, parent_id, triage_status, assignee, tags, snapshot"
    )
    .eq("site_id", s.id)
    // Hide the install verifier's throwaway test comments, in case a post-test
    // cleanup ever failed and left residue on the hidden check page.
    .neq("page", INSTALL_CHECK_PAGE)
    .order("created_at", { ascending: false });
  const rows = (comments ?? []) as CommentRow[];
  const groups = groupByPage(rows);
  const replies = repliesByParent(rows);
  const firstOrigin = s.allowed_origins.find((o) => o !== "*") ?? "";
  const pendingCount = rows.filter((c) => c.status === "pending").length;
  const topLevelCount = rows.filter((c) => !c.parent_id).length;
  const openCount = rows.filter((c) => !c.parent_id && c.triage_status === "open").length;

  return (
    <main className="container">
      <p className="small">
        <Link href="/dashboard">← My sites</Link>
      </p>
      <div className="row-between">
        <h1>{s.name}</h1>
        <DeleteSiteButton siteId={s.id} siteName={s.name} />
      </div>
      <p className="muted small">
        siteId: <code>{s.id}</code>
      </p>

      <div className="card">
        <h2>Install</h2>
        <p className="muted small">Paste these two tags into your site, just before &lt;/body&gt;.</p>
        <CopyBlock text={snippet(s.id)} />
      </div>

      <div className="card">
        <h2>Verify installation</h2>
        <p className="muted small">
          We&apos;ll fetch the page and confirm the widget script and your siteId are present.
        </p>
        <VerifyInstall siteId={s.id} defaultUrl={firstOrigin ? firstOrigin + "/" : ""} />
      </div>

      <div className="card">
        <h2>Allowed origins</h2>
        <p className="muted small">
          The write endpoint rejects comments whose origin isn&apos;t listed here. One per line.
          Enter the site origin only — scheme + host, e.g. <code>https://example.com</code>, not a
          full page URL. Entries are normalized automatically (any path is stripped on save).
          Use <code>*</code> to accept any origin (testing only).
        </p>
        <form action={updateOrigins} className="stack">
          <input type="hidden" name="site_id" value={s.id} />
          <textarea
            name="allowed_origins"
            rows={4}
            defaultValue={s.allowed_origins.join("\n")}
            placeholder={"https://example.com"}
          />
          <button className="btn" type="submit">
            Save origins
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Moderation</h2>
        <p className="muted small">
          When enabled, new comments arrive as <strong>pending</strong> and stay hidden
          from the widget until you approve them here.
        </p>
        <form action={setModeration} className="row-between">
          <label className="small" style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
            <input
              type="checkbox"
              name="moderation_enabled"
              defaultChecked={s.moderation_enabled}
            />
            Require approval before comments are shown
          </label>
          <input type="hidden" name="site_id" value={s.id} />
          <button className="btn btn--sm" type="submit">
            Save
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 style={{ margin: 0 }}>Comments</h2>
          <span className="pill">
            {topLevelCount} total
            {openCount > 0 ? ` · ${openCount} open` : ""}
            {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
          </span>
        </div>

        {topLevelCount === 0 ? (
          <p className="muted">No comments yet on this site.</p>
        ) : (
          Object.keys(groups).map((page) => (
            <div key={page} style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ marginBottom: ".6rem" }}>
                {page} <span className="muted small">({groups[page].length})</span>
              </h3>
              <div className="stack">
                {groups[page].map((c) => (
                  <div key={c.id} className="comment">
                    <div className="row-between" style={{ alignItems: "baseline" }}>
                      <div>
                        <strong>{c.author || "Anonymous"}</strong>{" "}
                        <span className="muted small">
                          {new Date(c.created_at).toLocaleString()}
                        </span>
                        {c.status === "pending" && (
                          <span className="pill pill--warn" style={{ marginLeft: ".4rem" }}>
                            Pending
                          </span>
                        )}
                        <span
                          className={`pill triage triage--${c.triage_status}`}
                          style={{ marginLeft: ".4rem" }}
                        >
                          {TRIAGE_LABEL[c.triage_status] ?? c.triage_status}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: ".4rem" }}>
                        {c.status === "pending" && (
                          <form action={approveComment}>
                            <input type="hidden" name="comment_id" value={c.id} />
                            <input type="hidden" name="site_id" value={s.id} />
                            <button className="btn btn--sm" type="submit">
                              Approve
                            </button>
                          </form>
                        )}
                        <form action={deleteComment}>
                          <input type="hidden" name="comment_id" value={c.id} />
                          <input type="hidden" name="site_id" value={s.id} />
                          <button className="btn btn--danger btn--sm" type="submit">
                            {c.status === "pending" ? "Reject" : "Delete"}
                          </button>
                        </form>
                      </div>
                    </div>

                    {c.quote && (
                      <div className="muted small" style={{ fontStyle: "italic", marginTop: ".3rem" }}>
                        “{c.quote}”
                      </div>
                    )}
                    <div style={{ marginTop: ".3rem", whiteSpace: "pre-wrap" }}>{c.content}</div>

                    {c.tags.length > 0 && (
                      <div style={{ marginTop: ".4rem", display: "flex", gap: ".3rem", flexWrap: "wrap" }}>
                        {c.tags.map((t) => (
                          <span key={t} className="pill pill--tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <SnapshotContext snapshot={c.snapshot} />

                    {/* Nested replies */}
                    {(replies[c.id] ?? []).map((r) => (
                      <div key={r.id} className="comment comment--reply">
                        <div className="row-between" style={{ alignItems: "baseline" }}>
                          <div>
                            <strong>{r.author || "Anonymous"}</strong>{" "}
                            <span className="muted small">
                              {new Date(r.created_at).toLocaleString()}
                            </span>
                            {r.status === "pending" && (
                              <span className="pill pill--warn" style={{ marginLeft: ".4rem" }}>
                                Pending
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: ".4rem" }}>
                            {r.status === "pending" && (
                              <form action={approveComment}>
                                <input type="hidden" name="comment_id" value={r.id} />
                                <input type="hidden" name="site_id" value={s.id} />
                                <button className="btn btn--sm" type="submit">
                                  Approve
                                </button>
                              </form>
                            )}
                            <form action={deleteComment}>
                              <input type="hidden" name="comment_id" value={r.id} />
                              <input type="hidden" name="site_id" value={s.id} />
                              <button className="btn btn--danger btn--sm" type="submit">
                                {r.status === "pending" ? "Reject" : "Delete"}
                              </button>
                            </form>
                          </div>
                        </div>
                        <div style={{ marginTop: ".3rem", whiteSpace: "pre-wrap" }}>{r.content}</div>
                      </div>
                    ))}

                    {/* Triage controls (owner-facing workflow) */}
                    <form action={setTriage} className="triage-form">
                      <input type="hidden" name="comment_id" value={c.id} />
                      <input type="hidden" name="site_id" value={s.id} />
                      <label className="small">
                        Status
                        <select name="triage_status" defaultValue={c.triage_status}>
                          <option value="open">Open</option>
                          <option value="in_progress">In progress</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </label>
                      <label className="small">
                        Assignee
                        <input
                          type="text"
                          name="assignee"
                          defaultValue={c.assignee ?? ""}
                          placeholder="e.g. alex"
                        />
                      </label>
                      <label className="small">
                        Tags
                        <input
                          type="text"
                          name="tags"
                          defaultValue={c.tags.join(", ")}
                          placeholder="bug, copy"
                        />
                      </label>
                      <button className="btn btn--sm" type="submit">
                        Save triage
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
