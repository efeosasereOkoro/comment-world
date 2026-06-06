"use client";

import { useState } from "react";
import { deleteSite } from "@/app/dashboard/actions";

/**
 * Guarded delete for a site. Deleting a site cascades to all its comments, so a
 * single click is too dangerous. This opens a confirmation dialog that requires the
 * owner to type the site's exact name before the delete button enables. The same
 * typed value is sent as `confirm_name` and re-checked server-side in {@link deleteSite},
 * so the guard can't be bypassed by scripting the form.
 */
export default function DeleteSiteButton({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const matches = value.trim() === siteName;

  function close() {
    setOpen(false);
    setValue("");
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--danger btn--sm"
        onClick={() => setOpen(true)}
      >
        Delete site
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm site deletion"
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "26rem", width: "100%", margin: 0 }}
          >
            <h2 style={{ marginTop: 0 }}>Delete this site?</h2>
            <p className="muted small">
              This permanently deletes <strong>{siteName}</strong> and{" "}
              <strong>all of its comments</strong>. This cannot be undone.
            </p>
            <form action={deleteSite} className="stack">
              <input type="hidden" name="site_id" value={siteId} />
              <div className="field">
                <label htmlFor="confirm_name">
                  Type the site name <code>{siteName}</code> to confirm
                </label>
                <input
                  id="confirm_name"
                  name="confirm_name"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={siteName}
                />
              </div>
              <div className="row-between">
                <button type="button" className="btn btn--secondary btn--sm" onClick={close}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--danger btn--sm" disabled={!matches}>
                  Delete site
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
