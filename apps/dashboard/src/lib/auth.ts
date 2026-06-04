import { createClient } from "@/lib/supabase/server";

/** The authenticated user, or null. */
export async function getUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Is the given user id on the platform_admins allowlist?
 *  RLS only returns rows to admins, so a non-admin simply gets an empty result. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
