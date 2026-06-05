import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser, isPlatformAdmin } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import type { Site, Profile, CommentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) redirect("/dashboard");

  const supabase = createClient();
  // As a platform admin, RLS lets us read all profiles, sites, and comments
  // (including pending ones, via the owner-or-admin select policy). This view is
  // strictly read-only oversight — no moderation controls, preserving the per-owner
  // moderation boundary.
  const [{ data: profiles }, { data: sites }, { data: comments }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("sites").select("*"),
    supabase.from("comments").select("id, site_id"),
  ]);

  const profileList = (profiles ?? []) as Profile[];
  const siteList = (sites ?? []) as Site[];
  const commentList = (comments ?? []) as Pick<CommentRow, "id" | "site_id">[];

  const sitesByOwner = new Map<string, Site[]>();
  for (const site of siteList) {
    const arr = sitesByOwner.get(site.owner_id) ?? [];
    arr.push(site);
    sitesByOwner.set(site.owner_id, arr);
  }
  const commentsBySite = new Map<string, number>();
  for (const c of commentList) {
    commentsBySite.set(c.site_id, (commentsBySite.get(c.site_id) ?? 0) + 1);
  }
  const commentsForOwner = (ownerId: string) =>
    (sitesByOwner.get(ownerId) ?? []).reduce(
      (sum, site) => sum + (commentsBySite.get(site.id) ?? 0),
      0
    );

  return (
    <>
      <header className="topbar">
        <Link href="/dashboard" className="topbar__brand">
          commentbox
        </Link>
        <span className="pill">Platform admin</span>
        <div className="topbar__spacer" />
        <nav>
          <Link href="/dashboard">My sites</Link>
          <span className="muted small">{user.email}</span>
          <LogoutButton />
        </nav>
      </header>

      <main className="container container--wide">
        <h1>Platform overview</h1>
        <p className="muted">Read-only oversight across every owner and site.</p>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat__num">{profileList.length}</div>
            <div className="stat__label">Users</div>
          </div>
          <div className="stat">
            <div className="stat__num">{siteList.length}</div>
            <div className="stat__label">Sites</div>
          </div>
          <div className="stat">
            <div className="stat__num">{commentList.length}</div>
            <div className="stat__label">Comments</div>
          </div>
        </div>

        <div className="card">
          <h2>Users</h2>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th style={{ width: 90 }}>Sites</th>
                <th style={{ width: 110 }}>Comments</th>
                <th style={{ width: 160 }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {profileList.map((p) => (
                <tr key={p.id}>
                  <td>{p.email || <span className="muted">(no email)</span>}</td>
                  <td>{(sitesByOwner.get(p.id) ?? []).length}</td>
                  <td>{commentsForOwner(p.id)}</td>
                  <td className="muted small">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {profileList.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Sites</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th style={{ width: 110 }}>Comments</th>
                <th>Allowed origins</th>
              </tr>
            </thead>
            <tbody>
              {siteList.map((site) => {
                const owner = profileList.find((p) => p.id === site.owner_id);
                return (
                  <tr key={site.id}>
                    <td>{site.name}</td>
                    <td className="muted small">{owner?.email || site.owner_id}</td>
                    <td>{commentsBySite.get(site.id) ?? 0}</td>
                    <td className="muted small">
                      {site.allowed_origins.length ? site.allowed_origins.join(", ") : "—"}
                    </td>
                  </tr>
                );
              })}
              {siteList.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No sites yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
