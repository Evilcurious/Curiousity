"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SystemSettings } from "@/lib/types";
import { Alert, Button, Input, Label, Toggle } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { CheckCircle2 } from "lucide-react";

export default function AdminSettings() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SystemSettings>("/admin/settings")
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  const save = async (patch: Partial<SystemSettings>) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<SystemSettings>("/admin/settings", {
        method: "PATCH",
        body: patch,
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settings)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={20} />
      </div>
    );

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-semibold">System settings</h2>
      <p className="text-sm text-muted">Application configuration and controls</p>

      {saved && (
        <div className="mt-4">
          <Alert variant="success">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Settings saved
            </span>
          </Alert>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mt-6 space-y-6">
        <div className="rounded-xl border bg-raised p-4">
          <h3 className="text-sm font-medium">General</h3>
          <div className="mt-3 space-y-4">
            <div>
              <Label>Application name</Label>
              <Input
                defaultValue={settings.app_name}
                onBlur={(e) => save({ app_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Default theme</Label>
              <select
                value={settings.default_theme}
                onChange={(e) => save({ default_theme: e.target.value })}
                className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-raised p-4">
          <h3 className="text-sm font-medium">Registration & access</h3>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Allow new registrations</p>
                <p className="text-xs text-muted">When disabled, only admins can create accounts</p>
              </div>
              <Toggle
                checked={settings.registration_enabled}
                onChange={(v) => save({ registration_enabled: v })}
                label="Registration"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Maintenance mode</p>
                <p className="text-xs text-muted">
                  Blocks all non-admin API access (admin panel keeps working)
                </p>
              </div>
              <Toggle
                checked={settings.maintenance_mode}
                onChange={(v) => save({ maintenance_mode: v })}
                label="Maintenance"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-raised p-4">
          <h3 className="text-sm font-medium">Integrations status</h3>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Google OAuth</span>
              <span className="text-xs text-muted">
                {settings.google_oauth_configured ? "Configured" : "Not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>SMTP email</span>
              <span className="text-xs text-muted">
                {settings.smtp_configured ? "Configured" : "Not configured (reset tokens shown in UI)"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>AI backend</span>
              <span className="text-xs text-muted">
                {settings.ai_model} @ {settings.ai_base_url}
              </span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Google OAuth, SMTP and the default AI backend are configured through environment
            variables — see docs/ENVIRONMENT.md.
          </p>
        </div>
      </div>
    </div>
  );
}
