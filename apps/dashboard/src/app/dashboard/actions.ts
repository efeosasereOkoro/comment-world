"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseOrigins } from "@/lib/origins";

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
  const confirmName = String(formData.get("confirm_name") || "").trim();
  if (!id) return;

  // Defense in depth: the client requires typing the site name, but re-verify it
  // server-side so the cascading delete can't be triggered by a scripted form post
  // that skips the confirmation UI.
  const { data: site, error: lookupError } = await supabase
    .from("sites")
    .select("name")
    .eq("id", id)
    .single();
  if (lookupError) throw new Error(lookupError.message);
  if (!site || confirmName !== site.name) {
    throw new Error("Confirmation text did not match the site name; site not deleted.");
  }

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
