import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WIDGET_SRC } from "@/lib/env";
import type { Site, CommentRow } from "@/lib/types";
import CopyBlock from "@/components/CopyBlock";
import VerifyInstall from "@/components/VerifyInstall";
import DeleteSiteButton from "@/components/DeleteSiteButton";
import {
  updateOrigins,
  deleteComment,
  setModeration,
  approveComment,
} from "../../actions";

export const dynamic = "force-dynamic";

function snippet(siteId: string): string {
  return (
    `<script>window.CommentWidget = { siteId: "${siteId}" };</script>\n` +
    `<script async src="${WIDGET_SRC}"></script>`
  );
}

function groupByPage(rows: CommentRow[]): Record<string, CommentRow[]> {
  const groups: Record<string, CommentRow[]> = {};
  for (const r of rows) (groups[r.page] = groups[r.page] || []).push(r);
  return groups;
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
    .select("id, site_id, page, selector, quote, author, content, status, created_at")
    .eq("site_id", s.id)
    .order("created_at", { ascending: false });
  const rows = (comments ?? []) as CommentRow[];
  const groups = groupByPage(rows);
  const firstOrigin = s.allowed_origins.find((o) => o !== "*") ?? "";
  const pendingCount = rows.filter((c) => c.status === "pending").length;

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
            {rows.length} total
            {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="muted">No comments yet on this site.</p>
        ) : (
          Object.keys(groups).map((page) => (
            <div key={page} style={{ marginBottom: "1.25rem" }}>
              <h3 style={{ marginBottom: ".5rem" }}>
                {page} <span className="muted small">({groups[page].length})</span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "20%" }}>Author</th>
                    <th>Comment</th>
                    <th style={{ width: "18%" }}>When</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {groups[page].map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.author || "Anonymous"}
                        {c.status === "pending" && (
                          <div>
                            <span className="pill pill--warn">Pending</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {c.quote && (
                          <div className="muted small" style={{ fontStyle: "italic" }}>
                            “{c.quote}”
                          </div>
                        )}
                        {c.content}
                      </td>
                      <td className="muted small">
                        {new Date(c.created_at).toLocaleString()}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: ".4rem", justifyContent: "flex-end" }}>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
