"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Parse a textarea of origins (comma- or newline-separated) into a clean array. */
function parseOrigins(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim().replace(/\/+$/, ""))
        .filter(Boolean)
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

export async function deleteComment(formData: FormData) {
  const supabase = createClient();
  const commentId = String(formData.get("comment_id") || "");
  const siteId = String(formData.get("site_id") || "");
  if (!commentId) return;
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/sites/${siteId}`);
}
