// Public backend config, baked into the widget build at compile time.
// The publishable (anon) key is safe to expose in the browser — access is governed
// by Row Level Security and the origin-checked write path, not by hiding the key.
// These resolve to empty strings until the fresh Supabase project is created (Phase 3),
// in which case the widget still renders its UI but cannot persist comments.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY ?? "";

/** Base URL for Supabase Edge Functions, derived from the project URL.
 *  The widget's write path posts to `${FUNCTIONS_URL}/post-comment`. */
export const FUNCTIONS_URL: string = SUPABASE_URL
  ? SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1"
  : "";

/** localStorage key for remembering the commenter's name across sessions. */
export const NAME_KEY = "commentbox::name";

/** localStorage key recording that the first-run coachmark has been dismissed,
 *  so the onboarding hint shows only once per visitor. */
export const COACHMARK_KEY = "commentbox::coachmark-seen";

/** Public landing page for the product. Surfaced in the widget's "Powered by"
 *  footer so a visitor who likes the tool can add it to their own site or share
 *  it — a built-in growth loop. UTM params attribute installs/shares back to the
 *  widget so the loop is measurable in analytics. */
export const MARKETING_URL =
  "https://comment-world-dashboard.vercel.app/?utm_source=widget&utm_medium=referral&utm_campaign=powered_by";

/** Short pitch used as the share-sheet text and clipboard message. */
export const SHARE_TEXT =
  "Add commentbox to your site — collect feedback on any page in minutes.";
