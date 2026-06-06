/**
 * Pure interpretation of the live write-path test result, kept free of node:https /
 * Next imports so it can be unit-tested in isolation. The /api/verify route does the
 * actual HTTP POST to the post-comment Edge Function and feeds the outcome here.
 */

export type WriteStatus =
  | "ok"
  | "pending"
  | "origin_not_allowed"
  | "rate_limited"
  | "captcha_required"
  | "unknown_site"
  | "error";

export type PostResult = {
  status: number;
  body: { error?: string; status?: string } | null;
};

/**
 * Map the Edge Function's HTTP response to {writeOk, writeStatus}:
 *  - 200            → write succeeded (ok, or pending when moderation is on)
 *  - 429            → throttled, but the request got *past* the origin check, so
 *                     writes work — treat as success (rate_limited)
 *  - origin_not_allowed / captcha_failed / unknown_site → specific failure reasons
 *  - anything else  → generic error
 */
export function interpretWriteResult(res: PostResult): {
  writeOk: boolean;
  writeStatus: WriteStatus;
} {
  if (res.status === 200) {
    return { writeOk: true, writeStatus: res.body?.status === "pending" ? "pending" : "ok" };
  }
  if (res.status === 429) {
    return { writeOk: true, writeStatus: "rate_limited" };
  }
  switch (res.body?.error) {
    case "origin_not_allowed":
      return { writeOk: false, writeStatus: "origin_not_allowed" };
    case "captcha_failed":
      return { writeOk: false, writeStatus: "captcha_required" };
    case "unknown_site":
      return { writeOk: false, writeStatus: "unknown_site" };
    default:
      return { writeOk: false, writeStatus: "error" };
  }
}
