import Link from "next/link";
import { getUser } from "@/lib/auth";
import { WIDGET_SRC } from "@/lib/env";
import CopyBlock from "@/components/CopyBlock";

export const dynamic = "force-dynamic";

const SNIPPET =
  `<script>window.CommentWidget = { siteId: "your-site-id" };</script>\n` +
  `<script async src="${WIDGET_SRC}"></script>`;

const BENEFITS = [
  {
    title: "Install in two lines",
    body: "Two script tags on any page — static HTML, WordPress, React, anything. No backend changes, no rebuild.",
    icon: (
      <path d="M8 6 4 12l4 6M16 6l4 6-4 6M13 4l-2 16" strokeWidth="1.8" fill="none" />
    ),
  },
  {
    title: "Pinned to the page",
    body: "Feedback attaches to the exact element or highlighted text — and re-anchors itself when the page is redesigned.",
    icon: (
      <path
        d="M12 21s-7-5.2-7-10a7 7 0 0 1 14 0c0 4.8-7 10-7 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        strokeWidth="1.6"
        fill="none"
      />
    ),
  },
  {
    title: "Style-isolated",
    body: "The widget lives in Shadow DOM, so it never clashes with your CSS and your styles never leak into it.",
    icon: (
      <path
        d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z"
        strokeWidth="1.6"
        fill="none"
      />
    ),
  },
  {
    title: "You stay in control",
    body: "A per-site origin allowlist, optional moderation, rate limiting and spam protection are built in from day one.",
    icon: (
      <path
        d="M12 3a4 4 0 0 1 4 4v3h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1V7a4 4 0 0 1 4-4Zm-2 7h4V7a2 2 0 1 0-4 0v3Z"
        strokeWidth="1.4"
        fill="none"
      />
    ),
  },
];

export default async function Home() {
  const user = await getUser();
  const ctaHref = user ? "/dashboard" : "/login";
  const ctaLabel = user ? "Go to dashboard" : "Get started free";

  return (
    <div className="lp">
      <header className="lp-nav">
        <span className="lp-nav__brand">commentbox</span>
        <span className="lp-nav__spacer" />
        <a href="#how">How it works</a>
        <Link className="btn btn--secondary btn--sm" href={ctaHref}>
          {user ? "Dashboard" : "Sign in"}
        </Link>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero__inner">
          <div>
            <span className="lp-eyebrow">Website feedback widget</span>
            <h1 className="lp-h1">Collect feedback on your live site — in two lines of code.</h1>
            <p className="lp-sub">
              commentbox lets visitors pin comments to the exact spot on the page,
              without leaving it. Installed like a chat widget, scoped to your domain.
            </p>
            <div className="lp-cta-row">
              <Link className="btn btn--lg" href={ctaHref}>
                {ctaLabel}
              </Link>
              <a className="btn btn--secondary btn--lg" href="#how">
                See how it works
              </a>
            </div>
            <p className="lp-note">No iframe. No rebuild. Live in about 2 minutes.</p>
            <p className="lp-trust">Works on any stack · Free to start · No credit card</p>
          </div>

          <div className="lp-hero__code">
            <div className="lp-hero__code-bar">
              <span className="lp-dot" />
              <span className="lp-dot" />
              <span className="lp-dot" />
            </div>
            <code className="code">{SNIPPET}</code>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="lp-section">
        <div className="lp-section-head">
          <h2>Everything you need to collect feedback in context</h2>
          <p>Drop in-line comments onto a site you already have — without getting in the way.</p>
        </div>
        <div className="lp-benefits">
          {BENEFITS.map((b) => (
            <div className="lp-benefit" key={b.title}>
              <span className="lp-benefit__icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor">
                  {b.icon}
                </svg>
              </span>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="lp-section lp-section--tint" id="how">
        <div className="lp-section-head">
          <h2>Install in three steps</h2>
          <p>From sign-up to your first live comment — in order, no surprises.</p>
        </div>
        <div className="lp-steps">
          <div className="lp-step">
            <span className="lp-step__num">1</span>
            <div className="lp-step__body">
              <h3>Create a site</h3>
              <p>
                Sign up, add your site, and allow its origin (the scheme + host, e.g.{" "}
                <code>https://example.com</code>). This is what authorizes comments from
                your domain — and gives you a unique <code>siteId</code>.
              </p>
            </div>
          </div>

          <div className="lp-step">
            <span className="lp-step__num">2</span>
            <div className="lp-step__body">
              <h3>Paste the snippet</h3>
              <p>
                Drop these two tags into your page, just before{" "}
                <code>&lt;/body&gt;</code>. Swap <code>your-site-id</code> for the id from
                step 1 — the dashboard gives you the snippet pre-filled.
              </p>
              <CopyBlock text={SNIPPET} />
            </div>
          </div>

          <div className="lp-step">
            <span className="lp-step__num">3</span>
            <div className="lp-step__body">
              <h3>Verify and go live</h3>
              <p>
                Run the one-click install check, post a test comment, and you&apos;re
                live. Moderate, rate-limit, or restrict origins anytime from the
                dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <div className="lp-final__inner">
          <h2>Ready to add comments to your site?</h2>
          <p>Create your first site and paste the snippet — it takes about two minutes.</p>
          <Link className="btn btn--lg btn--invert" href={ctaHref}>
            {ctaLabel}
          </Link>
        </div>
      </section>

      <footer className="lp-footer">
        <span>commentbox</span>
        <span className="lp-footer__spacer" />
        <Link href={ctaHref}>{user ? "Dashboard" : "Sign in"}</Link>
        <a href="#how">How it works</a>
      </footer>
    </div>
  );
}
