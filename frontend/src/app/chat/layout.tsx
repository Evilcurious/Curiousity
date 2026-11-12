"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Loader } from "@/components/Loader";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarKey, setSidebarKey] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <main className="flex h-screen items-center justify-center">
        <Loader label="Loading Curiousity" />
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar onCollapsedChange={() => setSidebarKey((k) => k + 1)} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
