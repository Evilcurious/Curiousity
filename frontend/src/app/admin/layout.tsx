"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Loader } from "@/components/Loader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BarChart3,
  Users,
  Cpu,
  Puzzle,
  Settings as SettingsIcon,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/models", label: "AI models", icon: Cpu },
  { href: "/admin/integrations", label: "Integrations", icon: Puzzle },
  { href: "/admin/settings", label: "System", icon: SettingsIcon },
  { href: "/admin/logs", label: "Logs", icon: ScrollText },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.role !== "admin") {
      router.replace("/chat");
    } else {
      setAuthorized(true);
    }
  }, [user, loading, router]);

  if (loading || !authorized) {
    return (
      <main className="flex h-screen items-center justify-center">
        <Loader label="Checking admin access" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b bg-base">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:text-ink focus-ring"
          >
            <ArrowLeft size={15} />
            Back to chat
          </Link>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck size={17} /> Admin panel
          </h1>
          <div className="ml-auto">
            <ThemeToggle compact />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row">
        <nav className="w-full shrink-0 md:w-48">
          <ul className="flex flex-row gap-1 overflow-x-auto md:flex-col">
            {NAV.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors focus-ring",
                    pathname === href
                      ? "bg-ink text-base font-medium"
                      : "text-muted hover:bg-raised hover:text-ink"
                  )}
                >
                  <Icon size={15} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
