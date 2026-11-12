"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AIModel, Provider } from "@/lib/types";
import { Alert, Badge, Button, Input, Label, Toggle } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { Modal } from "@/components/Modal";
import { Cpu, Plus, Trash2, Zap, Pencil } from "lucide-react";

export default function AdminModels() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // provider modal
  const [provModal, setProvModal] = useState(false);
  const [editProv, setEditProv] = useState<Provider | null>(null);
  const [provName, setProvName] = useState("");
  const [provType, setProvType] = useState("openai_compat");
  const [provUrl, setProvUrl] = useState("");
  const [provKey, setProvKey] = useState("");
  const [provHeaders, setProvHeaders] = useState("{}");

  // model modal
  const [modelModal, setModelModal] = useState(false);
  const [editModel, setEditModel] = useState<AIModel | null>(null);
  const [mProvider, setMProvider] = useState("");
  const [mModelId, setMModelId] = useState("");
  const [mDisplay, setMDisplay] = useState("");
  const [mCtx, setMCtx] = useState(32768);
  const [mMaxOut, setMMaxOut] = useState(4096);
  const [mTemp, setMTemp] = useState(0.7);
  const [mTopP, setMTopP] = useState(0.95);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([
        api<Provider[]>("/admin/providers"),
        api<AIModel[]>("/admin/models"),
      ]);
      setProviders(p);
      setModels(m);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveProvider = async () => {
    setBusy(true);
    setError(null);
    try {
      let headers: Record<string, string> = {};
      if (provHeaders.trim() && provHeaders.trim() !== "{}") {
        headers = JSON.parse(provHeaders);
      }
      const body = {
        name: provName,
        provider_type: provType,
        base_url: provUrl,
        api_key: provKey || undefined,
        custom_headers: headers,
        enabled: true,
      };
      if (editProv) {
        await api(`/admin/providers/${editProv.id}`, { method: "PATCH", body });
        setMessage("Provider updated");
      } else {
        await api("/admin/providers", { method: "POST", body });
        setMessage("Provider created");
      }
      setProvModal(false);
      resetProvForm();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetProvForm = () => {
    setEditProv(null);
    setProvName("");
    setProvType("openai_compat");
    setProvUrl("");
    setProvKey("");
    setProvHeaders("{}");
  };

  const saveModel = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        provider_id: mProvider,
        model_id: mModelId,
        display_name: mDisplay || mModelId,
        context_length: mCtx,
        max_output_tokens: mMaxOut,
        temperature: mTemp,
        top_p: mTopP,
      };
      if (editModel) {
        await api(`/admin/models/${editModel.id}`, {
          method: "PATCH",
          body: {
            display_name: body.display_name,
            context_length: body.context_length,
            max_output_tokens: body.max_output_tokens,
            temperature: body.temperature,
            top_p: body.top_p,
          },
        });
        setMessage("Model updated");
      } else {
        await api("/admin/models", { method: "POST", body });
        setMessage("Model created");
      }
      setModelModal(false);
      resetModelForm();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetModelForm = () => {
    setEditModel(null);
    setMProvider(providers[0]?.id || "");
    setMModelId("");
    setMDisplay("");
    setMCtx(32768);
    setMMaxOut(4096);
    setMTemp(0.7);
    setMTopP(0.95);
  };

  const testProvider = async (p: Provider) => {
    setTesting(p.id);
    try {
      const res = await api<{ ok: boolean; message: string; models: string[] }>(
        "/models/test",
        { method: "POST", body: { provider_id: p.id } }
      );
      setMessage(`${p.name}: ${res.message}${res.models.length ? ` — ${res.models.slice(0, 5).join(", ")}` : ""}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const setDefault = async (m: AIModel) => {
    await api(`/admin/models/${m.id}`, { method: "PATCH", body: { is_default: true } });
    setMessage(`${m.display_name} is now the default model`);
    await load();
  };

  const toggleModel = async (m: AIModel) => {
    await api(`/admin/models/${m.id}`, { method: "PATCH", body: { enabled: !m.enabled } });
    await load();
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI models</h2>
          <p className="text-sm text-muted">Providers, models and generation settings</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              resetProvForm();
              setProvModal(true);
            }}
          >
            <Plus size={13} /> Provider
          </Button>
          <Button
            size="sm"
            onClick={() => {
              resetModelForm();
              setModelModal(true);
            }}
          >
            <Plus size={13} /> Model
          </Button>
        </div>
      </div>

      {message && (
        <div className="mt-4">
          <Alert variant="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={20} />
        </div>
      ) : (
        <>
          {/* Providers */}
          <h3 className="mt-6 text-sm font-medium">Providers</h3>
          <div className="mt-3 space-y-2">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-raised px-4 py-3">
                <Cpu size={15} className="text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.name} {p.is_system && <Badge className="ml-1 border-ink">system</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {p.provider_type} · {p.base_url}
                    {p.has_api_key ? " · key set" : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => testProvider(p)}
                  disabled={testing === p.id}
                >
                  {testing === p.id ? <Spinner size={12} /> : <Zap size={12} />}
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditProv(p);
                    setProvName(p.name);
                    setProvType(p.provider_type);
                    setProvUrl(p.base_url);
                    setProvKey("");
                    setProvHeaders(JSON.stringify(p.custom_headers || {}));
                    setProvModal(true);
                  }}
                >
                  <Pencil size={12} />
                </Button>
                {!p.is_system && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api(`/admin/providers/${p.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Models */}
          <h3 className="mt-8 text-sm font-medium">Models</h3>
          <div className="mt-3 overflow-hidden rounded-xl border bg-raised">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-surface text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">Context</th>
                  <th className="px-4 py-2.5 font-medium">Temp</th>
                  <th className="px-4 py-2.5 font-medium">Enabled</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {models.map((m) => (
                  <tr key={m.id} className="hover:bg-surface/60">
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {m.display_name}
                        {m.is_default && <Badge className="ml-1.5 border-ink">default</Badge>}
                      </p>
                      <p className="text-xs text-muted">{m.model_id}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{m.provider_name}</td>
                    <td className="px-4 py-3 text-xs text-muted">{m.context_length}</td>
                    <td className="px-4 py-3 text-xs text-muted">{m.temperature}</td>
                    <td className="px-4 py-3">
                      <Toggle checked={m.enabled} onChange={() => toggleModel(m)} label="Toggle model" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {!m.is_default && (
                          <Button size="sm" variant="ghost" onClick={() => setDefault(m)}>
                            Set default
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditModel(m);
                            setMProvider(m.provider_id);
                            setMModelId(m.model_id);
                            setMDisplay(m.display_name);
                            setMCtx(m.context_length);
                            setMMaxOut(m.max_output_tokens);
                            setMTemp(m.temperature);
                            setMTopP(m.top_p);
                            setModelModal(true);
                          }}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await api(`/admin/models/${m.id}`, { method: "DELETE" });
                            await load();
                          }}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Provider modal */}
      <Modal
        open={provModal}
        onClose={() => setProvModal(false)}
        title={editProv ? "Edit provider" : "Add provider"}
      >
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div>
            <Label>Name</Label>
            <Input value={provName} onChange={(e) => setProvName(e.target.value)} placeholder="e.g. OpenRouter" />
          </div>
          <div>
            <Label>Provider type</Label>
            <select
              value={provType}
              onChange={(e) => setProvType(e.target.value)}
              className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
            >
              <option value="ollama">Ollama</option>
              <option value="openai_compat">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>
          <div>
            <Label>Base URL</Label>
            <Input value={provUrl} onChange={(e) => setProvUrl(e.target.value)} placeholder="https://api.example.com/v1" />
          </div>
          <div>
            <Label>API key {editProv && "(leave blank to keep current)"}</Label>
            <Input type="password" value={provKey} onChange={(e) => setProvKey(e.target.value)} />
          </div>
          <div>
            <Label>Custom headers (JSON)</Label>
            <textarea
              value={provHeaders}
              onChange={(e) => setProvHeaders(e.target.value)}
              rows={3}
              className="w-full rounded-lg border bg-base px-3 py-2 font-mono text-xs focus-ring"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveProvider} disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              {editProv ? "Save" : "Create"}
            </Button>
            <Button variant="ghost" onClick={() => setProvModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model modal */}
      <Modal
        open={modelModal}
        onClose={() => setModelModal(false)}
        title={editModel ? "Edit model" : "Add model"}
      >
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {!editModel && (
            <div>
              <Label>Provider</Label>
              <select
                value={mProvider}
                onChange={(e) => setMProvider(e.target.value)}
                className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label>Model ID</Label>
            <Input value={mModelId} onChange={(e) => setMModelId(e.target.value)} placeholder="e.g. llama3.1:8b" />
          </div>
          <div>
            <Label>Display name</Label>
            <Input value={mDisplay} onChange={(e) => setMDisplay(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Context length</Label>
              <Input type="number" value={mCtx} onChange={(e) => setMCtx(+e.target.value)} />
            </div>
            <div>
              <Label>Max output tokens</Label>
              <Input type="number" value={mMaxOut} onChange={(e) => setMMaxOut(+e.target.value)} />
            </div>
            <div>
              <Label>Temperature</Label>
              <Input type="number" step="0.1" value={mTemp} onChange={(e) => setMTemp(+e.target.value)} />
            </div>
            <div>
              <Label>Top P</Label>
              <Input type="number" step="0.05" value={mTopP} onChange={(e) => setMTopP(+e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveModel} disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              {editModel ? "Save" : "Create"}
            </Button>
            <Button variant="ghost" onClick={() => setModelModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
