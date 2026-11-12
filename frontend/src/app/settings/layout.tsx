"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Loader } from "@/components/Loader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import {
  User as UserIcon,
  KeyRound,
  Palette,
  Cpu,
  UserX,
  ArrowLeft,
} from "lucide-react";

const NAV = [
  { href: "/settings", label: "Profile", icon: UserIcon },
  { href: "/settings/password", label: "Password", icon: KeyRound },
  { href: "/settings/appearance", label: "Appearance", icon: Palette },
  { href: "/settings/models", label: "AI model", icon: Cpu },
  { href: "/settings/account", label: "Account", icon: UserX },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <main className="flex h-screen items-center justify-center">
        <Loader label="Loading settings" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b bg-base">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-ink focus-ring rounded-md px-2 py-1"
          >
            <ArrowLeft size={15} />
            Back to chat
          </Link>
          <h1 className="text-base font-semibold">Settings</h1>
          <div className="ml-auto">
            <ThemeToggle compact />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row">
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
        <div className="min-w-0 flex-1">
          <div className="rounded-2xl border bg-raised p-6 shadow-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
