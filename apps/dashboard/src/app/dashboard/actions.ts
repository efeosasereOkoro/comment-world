"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Normalize a single origin entry to exactly what a browser sends in the `Origin`
 * header: scheme + host + (non-default) port, no path/query/hash. This is critical —
 * the post-comment Edge Function compares the request Origin against these values, so
 * a stored full URL like "https://site.tld/page.html" can NEVER match and silently
 * blocks all comments. We parse with the URL API (prepending https:// when the user
 * omits a scheme) and keep only `.origin`. The "*" wildcard is passed through as-is.
 * Returns null for anything unparseable so the caller can drop it.
 */
function normalizeOrigin(entry: string): string | null {
  const s = entry.trim();
  if (!s) return null;
  if (s === "*") return "*";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s;
    return new URL(withScheme).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Parse a textarea of origins (comma- or newline-separated) into a clean, deduped
 *  array of normalized origins. Unparseable entries are dropped. */
function parseOrigins(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map(normalizeOrigin)
        .filter((o): o is string => o !== null)
    )
  );
}

export async function createSite(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") || "").trim();
  const allowed_origins = parseOrigins(String(formData.get("allowed_origins") || ""));
  if (!name) return;

  const { data, error } = await supabase
    .from("sites")
    .insert({ owner_id: user.id, name, allowed_origins })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  redirect(`/dashboard/sites/${data.id}`);
}

export async function updateOrigins(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get("site_id") || "");
  const allowed_origins = parseOrigins(String(formData.get("allowed_origins") || ""));
  if (!id) return;

  const { error } = await supabase
    .from("sites")
    .update({ allowed_origins })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/sites/${id}`);
}

export async function deleteSite(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get("site_id") || "");
  if (!id) return;
  const { error } = await supabase.from("sites").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function setModeration(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get("site_id") || "");
  // Checkbox sends "on" when checked, nothing when unchecked.
  const enabled = String(formData.get("moderation_enabled") || "") === "on";
  if (!id) return;
  const { error } = await supabase
    .from("sites")
    .update({ moderation_enabled: enabled })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/sites/${id}`);
}

export async function approveComment(formData: FormData) {
  const supabase = createClient();
  const commentId = String(formData.get("comment_id") || "");
  const siteId = String(formData.get("site_id") || "");
  if (!commentId) return;
  const { error } = await supabase
    .from("comments")
    .update({ status: "approved" })
    .eq("id", commentId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/sites/${siteId}`);
}

export async function deleteComment(formData: FormData) {
  const supabase = createClient();
  const commentId = String(formData.get("comment_id") || "");
  const siteId = String(formData.get("site_id") || "");
  if (!commentId) return;
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/sites/${siteId}`);
}
