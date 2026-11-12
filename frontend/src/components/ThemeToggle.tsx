"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light" as const, icon: Sun, label: "Light" },
    { value: "dark" as const, icon: Moon, label: "Dark" },
    { value: "system" as const, icon: Monitor, label: "System" },
  ];
  return (
    <div className={`flex items-center gap-1 rounded-lg border bg-surface p-1 ${compact ? "" : "w-fit"}`}>
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-label={`${label} theme`}
          title={`${label} theme`}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-ring ${
            theme === value ? "bg-ink text-base" : "text-muted hover:text-ink"
          }`}
        >
          <Icon size={13} />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
