import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Server-side Supabase client bound to the request's cookies. Use in Server
 *  Components, Route Handlers, and Server Actions. */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll called from a Server Component (read-only cookies). Safe to
          // ignore — middleware refreshes the session on every request.
        }
      },
    },
  });
}
