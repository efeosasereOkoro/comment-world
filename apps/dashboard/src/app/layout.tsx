import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "commentbox dashboard",
  description: "Manage your commentbox sites, embed snippets, and moderation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
