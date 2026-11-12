"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Plug,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Integration, Tool } from "@/lib/types";
import { Alert, Badge, Button, Input, Label, Toggle } from "@/components/ui";
import { Spinner, EmptyState } from "@/components/Loader";
import { Modal } from "@/components/Modal";
import { ThemeToggle } from "@/components/ThemeToggle";

interface CatalogItem {
  key: string;
  name: string;
  description: string;
  credentials: string[];
}

export default function IntegrationsPage() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [connectFor, setConnectFor] = useState<CatalogItem | null>(null);
  const [configName, setConfigName] = useState("");
  const [configJson, setConfigJson] = useState("{}");
  const [credKey, setCredKey] = useState("api_key");
  const [credValue, setCredValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cat = await api<{ items: CatalogItem[] }>("/integrations/catalog");
      setCatalog(cat.items);
      if (isAdmin) {
        setIntegrations(await api<Integration[]>("/integrations"));
        setTools(await api<Tool[]>("/tools"));
      } else {
        setIntegrations(await api<Integration[]>("/integrations/enabled"));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    if (!connectFor) return;
    setBusy(true);
    setError(null);
    try {
      let config: unknown = {};
      try {
        config = JSON.parse(configJson || "{}");
      } catch {
        setError("Config must be valid JSON");
        setBusy(false);
        return;
      }
      await api("/integrations", {
        method: "POST",
        body: {
          key: connectFor.key === "mcp" ? "custom_http" : connectFor.key,
          name: configName || connectFor.name,
          config,
          credentials: credValue ? { [credKey]: credValue } : {},
        },
      });
      setMessage(`${connectFor.name} connected`);
      setConnectFor(null);
      setConfigName("");
      setConfigJson("{}");
      setCredValue("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/integrations/${id}/test`, {
        method: "POST",
      });
      setMessage(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const discover = async (id: string) => {
    setTesting(id);
    try {
      const res = await api<{ message: string }>(`/integrations/${id}/discover`, { method: "POST" });
      setMessage(res.message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const toggleTool = async (tool: Tool) => {
    await api(`/tools/${tool.id}`, { method: "PATCH", body: { enabled: !tool.enabled } });
    await load();
  };

  const filtered = catalog.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b bg-base">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:text-ink focus-ring"
          >
            <ArrowLeft size={15} />
            Back to chat
          </Link>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Puzzle size={17} /> Integrations
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/admin/integrations" className="text-xs text-muted hover:text-ink">
              {isAdmin ? "Manage in Admin →" : ""}
            </Link>
            <ThemeToggle compact />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {message && (
          <div className="mb-4">
            <Alert variant="success">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={13} /> {message}
              </span>
            </Alert>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {/* Catalog */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Marketplace</h2>
            <p className="text-sm text-muted">
              Connect tools and services the agent can use — Composio, MCP, n8n, Activepieces,
              custom APIs and webhooks.
            </p>
          </div>
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations…"
              className="py-1.5 pl-8 text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={22} />
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const existing = integrations.find((i) => i.key === item.key);
              return (
                <div key={item.key} className="flex flex-col rounded-xl border bg-raised p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border">
                      {item.key === "mcp" ? (
                        <Server size={16} />
                      ) : item.key === "composio" ? (
                        <Plug size={16} />
                      ) : (
                        <Wrench size={16} />
                      )}
                    </div>
                    {existing && <Badge className="border-ink">Connected</Badge>}
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{item.name}</h3>
                  <p className="mt-1 flex-1 text-xs leading-5 text-muted">{item.description}</p>
                  <div className="mt-3">
                    {item.key === "mcp" ? (
                      <Link href="/admin/integrations">
                        <Button variant="secondary" size="sm" className="w-full">
                          {isAdmin ? "Manage MCP servers" : "View"}
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant={existing ? "ghost" : "secondary"}
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setConnectFor(item);
                          setConfigName(item.name);
                        }}
                      >
                        {existing ? "Configure" : "Connect"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active integrations (admin sees management; users see availability) */}
        {isAdmin && integrations.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold">Connected integrations</h2>
            <div className="mt-4 space-y-2">
              {integrations.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-3 rounded-xl border bg-raised px-4 py-3"
                >
                  <Plug size={15} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted">
                      {i.key} · {i.tool_count} tool(s) · {i.status}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => test(i.id)}
                    disabled={testing === i.id}
                  >
                    {testing === i.id ? <Spinner size={12} /> : null}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => discover(i.id)}
                    disabled={testing === i.id}
                  >
                    Discover tools
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tools (admin) */}
        {isAdmin && tools.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold">Agent tools</h2>
            <p className="text-sm text-muted">
              Enable or disable individual tools available to the agent.
            </p>
            <div className="mt-4 divide-y rounded-xl border bg-raised">
              {tools.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <Wrench size={13} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.display_name || t.name}</p>
                    <p className="truncate text-xs text-muted">{t.description || t.name}</p>
                  </div>
                  <Badge>{t.source}</Badge>
                  {t.requires_approval && <Badge className="border-ink">approval</Badge>}
                  <Toggle checked={t.enabled} onChange={() => toggleTool(t)} label={`Toggle ${t.name}`} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Connect modal */}
      <Modal
        open={!!connectFor}
        onClose={() => setConnectFor(null)}
        title={`Connect ${connectFor?.name || ""}`}
      >
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div>
            <Label>Name</Label>
            <Input value={configName} onChange={(e) => setConfigName(e.target.value)} />
          </div>
          <div>
            <Label>Configuration (JSON)</Label>
            <textarea
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              rows={6}
              className="w-full rounded-lg border bg-base px-3 py-2 font-mono text-xs focus-ring"
              placeholder='{"webhook_url": "https://...", "tools": [...]}'
            />
            <p className="mt-1 text-[11px] text-faint">
              See docs/ENVIRONMENT.md for the configuration schema of each integration type.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Credential key</Label>
              <Input value={credKey} onChange={(e) => setCredKey(e.target.value)} />
            </div>
            <div>
              <Label>Credential value</Label>
              <Input
                type="password"
                value={credValue}
                onChange={(e) => setCredValue(e.target.value)}
                placeholder="Stored encrypted"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={connect} disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              Connect
            </Button>
            <Button variant="ghost" onClick={() => setConnectFor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
