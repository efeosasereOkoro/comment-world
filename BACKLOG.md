# commentbox — Backlog

Strategic gaps to address before onboarding a serious (paying / enterprise / gov)
tenant. These are trust-and-operability issues, not features. Ordered roughly by
priority. Items 1 and 6 from the original audit are already done (install-check
residue hardening; unit tests for the pure origin + verify-result logic).

---

## 2. Abuse ceiling / per-site quota

**Problem.** We have per-IP rate limiting and an origin allowlist, but nothing caps
*total* comments or storage per site. A popular page — or a spammer who is already on
the allowlist — can grow the `comments` table without bound. There is no signal to the
owner that they are approaching any limit, and no backstop for us.

**Direction.**
- Add a per-site `comment_quota` (nullable; null = unlimited) and enforce it in the
  `post-comment` Edge Function before insert (count or a maintained counter).
- Return a distinct error (e.g. `quota_exceeded`) so the widget can show a friendly
  "comments are temporarily closed" message instead of a generic failure.
- Surface usage in the dashboard ("1,240 / 5,000 comments") with a warning state as it
  approaches the cap.
- Consider a global per-site insert-rate ceiling (not just per-IP) to blunt distributed
  spam from many IPs on an allowlisted origin.

**Acceptance.** Inserts past the quota are rejected with `quota_exceeded`; owner sees
usage and a warning before the cap; the widget degrades gracefully.

---

## 3. Moderation / new-comment notifications

**Problem.** With moderation on, comments arrive as `pending` and stay hidden until an
owner *happens to visit* the dashboard. There is no email/notification, so backlogs
accumulate silently and authors believe their comment vanished. This is table stakes
for every comparable feedback tool.

**Direction.**
- Email the site owner on a new comment (or new *pending* comment when moderation is
  on). Batch/digest to avoid noise on busy sites (e.g. "5 new comments to review").
- Owner-level notification preferences (per-site, on/off, immediate vs. daily digest).
- Use Supabase Auth's email infra or a transactional provider (Resend/Postmark); verify
  deliverability (SPF/DKIM) so mail doesn't land in spam.
- Optional: a lightweight "your comment is awaiting approval" acknowledgement to the
  author in the widget so they aren't left guessing.

**Acceptance.** Owners receive timely, deliverable notifications they can configure; no
pending comment can sit unseen indefinitely.

---

## 4. Widget accessibility (a11y)

**Problem.** The dashboard got a focus-ring pass, but the **embedded widget** (Shadow
DOM) is what our customers' *visitors* actually touch — and it's the part a gov/
enterprise buyer will audit for WCAG compliance. This is literally our origin story
(extracted from a Government of Barbados site), so it's a credibility issue, not a
nice-to-have.

**Direction.**
- Full keyboard navigation: open/close the comment popover, move between comments and
  controls, submit — all without a mouse.
- Focus trapping inside the popover while open; restore focus to the trigger on close.
- Screen-reader support: proper roles/labels (`aria-label`, `aria-expanded`,
  `role="dialog"`, live region for post status), and announce pending/error states.
- Respect `prefers-reduced-motion`; ensure color contrast of the widget UI meets AA.
- Test with a screen reader (NVDA/VoiceOver) and keyboard-only; document conformance.

**Acceptance.** The widget is operable keyboard-only and announces state to assistive
tech; a documented WCAG 2.1 AA self-assessment exists.

---

## 5. Data ownership — export & deletion (PII)

**Problem.** Multi-tenant comment data is PII (names, content, hashed IPs). Today a site
delete cascades, but there is **no per-site export** and **no subject-level delete**
("delete my comment" / GDPR access & erasure). A serious customer will ask for both.

**Direction.**
- Per-site **export** (CSV/JSON) of comments for the owner, from the dashboard.
- **Author-initiated deletion / right-to-erasure** path: a way for a commenter (or the
  owner on their behalf) to delete a specific comment; define how identity is proven.
- Document data retention and what we store (esp. `ip_hash` — confirm it's a salted,
  non-reversible hash and document the salt rotation policy).
- A data-processing note / privacy summary tenants can show their own users.

**Acceptance.** Owners can export their site's data and honor a deletion request;
retention and PII handling are documented.

---

## Standing housekeeping (not backlog, do soon)

- **Rotate exposed secrets**: Supabase service-role key, Supabase personal access token,
  and the GitHub PAT(s) that were pasted into chat / hard-coded in local `.git/config`.
- **Confirm Vercel env** `NEXT_PUBLIC_WIDGET_SRC` points at
  `https://comment-world-dashboard.vercel.app/widget.js`.
