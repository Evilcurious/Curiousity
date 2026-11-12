"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AIModel, UserSettings } from "@/lib/types";
import { Alert, Button, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { CheckCircle2, Cpu } from "lucide-react";

export default function ModelSettings() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api<AIModel[]>("/models"), api<UserSettings>("/user/settings")])
      .then(([m, s]) => {
        setModels(m);
        setSettings(s);
        setSelected(s.default_model_id || m.find((x) => x.is_default)?.id || "");
        setSystemPrompt(s.system_prompt || "");
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api("/user/settings", {
        method: "PATCH",
        body: { default_model_id: selected || null, system_prompt: systemPrompt || null },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">AI model</h2>
      <p className="mt-1 text-sm text-muted">
        Choose your default model and personalize how Curiousity responds
      </p>

      <div className="mt-6 space-y-5">
        {saved && (
          <Alert variant="success">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Preferences saved
            </span>
          </Alert>
        )}

        <div>
          <Label>Default model</Label>
          <div className="grid gap-2">
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-ring ${
                  selected === m.id ? "border-ink bg-surface" : "hover:bg-surface"
                }`}
              >
                <Cpu size={16} className="text-muted" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{m.display_name}</p>
                  <p className="text-xs text-muted">
                    {m.provider_name} · ctx {(m.context_length / 1000).toFixed(0)}k · temp{" "}
                    {m.temperature}
                  </p>
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 ${
                    selected === m.id ? "border-ink bg-ink" : "border-edge"
                  }`}
                />
              </button>
            ))}
            {models.length === 0 && (
              <p className="text-sm text-muted">No models are available — contact your administrator.</p>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="system-prompt">Personal instructions (optional)</Label>
          <textarea
            id="system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Always answer in a formal tone. Prefer Python examples."
            className="w-full rounded-lg border bg-base px-3.5 py-2.5 text-sm placeholder:text-faint focus-ring"
          />
          <p className="mt-1 text-[11px] text-faint">
            These instructions are added to every conversation you start.
          </p>
        </div>

        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner size={14} /> : null}
          Save preferences
        </Button>
      </div>
    </div>
  );
}
