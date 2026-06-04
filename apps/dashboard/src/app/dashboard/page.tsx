import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth";
import type { Site } from "@/lib/types";
import { createSite } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUser();
  const supabase = createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("*")
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: false });

  const list = (sites ?? []) as Site[];

  return (
    <main className="container">
      <h1>My sites</h1>
      <p className="muted">Each site gets an embed snippet and its own comment stream.</p>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Add a site</h2>
        <form action={createSite} className="stack">
          <div className="field">
            <label htmlFor="name">Site name</label>
            <input id="name" name="name" type="text" placeholder="My marketing site" required />
          </div>
          <div className="field">
            <label htmlFor="allowed_origins">
              Allowed origins <span className="muted small">(one per line; use * to allow any while testing)</span>
            </label>
            <textarea
              id="allowed_origins"
              name="allowed_origins"
              rows={3}
              placeholder={"https://example.com\nhttps://www.example.com"}
            />
          </div>
          <button className="btn" type="submit">
            Create site
          </button>
        </form>
      </div>

      {list.length === 0 ? (
        <p className="muted">No sites yet — create your first one above.</p>
      ) : (
        list.map((site) => (
          <div className="card" key={site.id}>
            <div className="row-between">
              <div>
                <h3 style={{ marginBottom: 2 }}>
                  <Link href={`/dashboard/sites/${site.id}`}>{site.name}</Link>
                </h3>
                <div className="muted small">
                  {site.allowed_origins.length
                    ? site.allowed_origins.join(", ")
                    : "No origins set — comments will be rejected until you add one."}
                </div>
              </div>
              <Link className="btn btn--secondary btn--sm" href={`/dashboard/sites/${site.id}`}>
                Manage
              </Link>
            </div>
          </div>
        ))
      )}
    </main>
  );
}
