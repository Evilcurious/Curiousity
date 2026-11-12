"use client";

import { useTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function AppearanceSettings() {
  const { theme, resolved } = useTheme();

  return (
    <div>
      <h2 className="text-lg font-semibold">Appearance</h2>
      <p className="mt-1 text-sm text-muted">Customize how Curiousity looks on this device</p>

      <div className="mt-6 space-y-6">
        <div>
          <h3 className="text-sm font-medium">Theme</h3>
          <p className="mt-1 text-xs text-muted">
            Currently using the <strong>{theme}</strong> setting ({resolved} mode active).
          </p>
          <div className="mt-3">
            <ThemeToggle />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium">Preview</h3>
          <div className="mt-3 rounded-xl border bg-base p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold">
                C
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium">Curiousity</p>
                <p className="mt-1 text-sm leading-6">
                  This is how messages will appear in your chats — clean, monochrome and easy to
                  read.
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-surface p-3">
              <pre className="text-xs text-muted">
{`function greet(name) {
  return \`Hello, \${name}!\`;
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
