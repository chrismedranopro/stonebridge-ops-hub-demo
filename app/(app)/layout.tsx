"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

// Session resolution is async (Supabase Auth + a staff-table lookup), so this
// guard can't be a Next.js proxy/middleware check — it has to run client-side
// here, and must wait for `loading` before deciding there's no session (else
// every refresh would flash a redirect to /login before the real session loads).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) return null;

  return (
    <div id="shell">
      <Sidebar />
      <div id="main">
        <Topbar />
        <div id="content">{children}</div>
      </div>
    </div>
  );
}
