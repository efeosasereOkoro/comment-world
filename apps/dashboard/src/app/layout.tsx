import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// We dogfood commentbox on our own dashboard — if we won't run it, we can't sell it.
const COMMENTBOX_SITE_ID = "68d17a9c-3863-4346-8ed1-c8f71eb49edb";
const COMMENTBOX_SRC = "https://comment-world-dashboard.vercel.app/widget.js";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "commentbox dashboard",
  description: "Manage your commentbox sites, embed snippets, and moderation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Script id="commentbox-config" strategy="beforeInteractive">
          {`window.CommentWidget = { siteId: "${COMMENTBOX_SITE_ID}" };`}
        </Script>
        <Script src={COMMENTBOX_SRC} strategy="afterInteractive" />
      </body>
    </html>
  );
}
