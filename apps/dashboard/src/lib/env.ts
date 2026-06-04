// Public env, validated once. All three are safe to expose to the browser.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const WIDGET_SRC =
  process.env.NEXT_PUBLIC_WIDGET_SRC ?? "https://cdn.commentbox.app/widget.js";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // Surfaces a clear message during dev/build instead of an opaque auth failure.
  console.warn(
    "[dashboard] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}
