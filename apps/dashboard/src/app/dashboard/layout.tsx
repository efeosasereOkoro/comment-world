import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, isPlatformAdmin } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  const admin = await isPlatformAdmin(user.id);

  return (
    <>
      <header className="topbar">
        <Link href="/dashboard" className="topbar__brand">
          commentbox
        </Link>
        <div className="topbar__spacer" />
        <nav>
          <Link href="/dashboard">My sites</Link>
          {admin && <Link href="/admin">Admin</Link>}
          <span className="muted small topbar__email">{user.email}</span>
          <LogoutButton />
        </nav>
      </header>
      {children}
    </>
  );
}
