"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Integration, MCPServer, Tool, ToolExecution } from "@/lib/types";
import { Alert, Badge, Button, Input, Label, Toggle } from "@/components/ui";
import { Spinner, EmptyState } from "@/components/Loader";
import { Modal } from "@/components/Modal";
import { Plus, RefreshCw, Server, Trash2, Zap, Wrench, Pencil } from "lucide-react";
import { relativeTime } from "@/lib/utils";

export default function AdminIntegrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [executions, setExecutions] = useState<ToolExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [mcpModal, setMcpModal] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState("stdio");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("{}");

  const [intModal, setIntModal] = useState(false);
  const [intKey, setIntKey] = useState("composio");
  const [intName, setIntName] = useState("");
  const [intConfig, setIntConfig] = useState("{}");
  const [intCredKey, setIntCredKey] = useState("api_key");
  const [intCredVal, setIntCredVal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, m, t, e] = await Promise.all([
        api<Integration[]>("/integrations"),
        api<MCPServer[]>("/integrations/mcp"),
        api<Tool[]>("/tools"),
        api<ToolExecution[]>("/tool-executions?limit=30"),
      ]);
      setIntegrations(i);
      setMcpServers(m);
      setTools(t);
      setExecutions(e);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveMcp = async () => {
    setBusy("mcp");
    setError(null);
    try {
      let headers = {};
      if (mcpHeaders.trim() && mcpHeaders.trim() !== "{}") headers = JSON.parse(mcpHeaders);
      await api("/integrations/mcp", {
        method: "POST",
        body: {
          name: mcpName,
          transport: mcpTransport,
          command: mcpTransport === "stdio" ? mcpCommand : undefined,
          args: mcpTransport === "stdio" && mcpArgs ? mcpArgs.split(" ").filter(Boolean) : undefined,
          url: mcpTransport === "http" ? mcpUrl : undefined,
          headers: Object.keys(headers).length ? headers : undefined,
        },
      });
      setMessage("MCP server registered");
      setMcpModal(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveIntegration = async () => {
    setBusy("int");
    setError(null);
    try {
      let config = {};
      try {
        config = JSON.parse(intConfig || "{}");
      } catch {
        setError("Config must be valid JSON");
        setBusy(null);
        return;
      }
      await api("/integrations", {
        method: "POST",
        body: {
          key: intKey,
          name: intName,
          config,
          credentials: intCredVal ? { [intCredKey]: intCredVal } : {},
        },
      });
      setMessage("Integration created");
      setIntModal(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, path: string, label: string) => {
    setBusy(id + path);
    setError(null);
    try {
      const res = await api<{ message?: string }>(path, { method: "POST" });
      setMessage(res.message || `${label} OK`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="text-sm text-muted">
            Composio, MCP servers, webhooks and custom tools
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setIntModal(true)}>
            <Plus size={13} /> Integration
          </Button>
          <Button size="sm" onClick={() => setMcpModal(true)}>
            <Plus size={13} /> MCP server
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
          {/* MCP servers */}
          <h3 className="mt-6 text-sm font-medium">MCP servers</h3>
          <div className="mt-3 space-y-2">
            {mcpServers.length === 0 && (
              <p className="rounded-xl border bg-raised px-4 py-6 text-center text-xs text-muted">
                No MCP servers registered — add a local (stdio) or remote (HTTP) server.
              </p>
            )}
            {mcpServers.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border bg-raised px-4 py-3">
                <Server size={15} className="text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted">
                    {s.transport} · {s.transport === "stdio" ? s.command : s.url} ·{" "}
                    {s.tool_count} tool(s)
                    {s.status !== "connected" && s.last_error ? ` · ${s.last_error.slice(0, 60)}` : ""}
                  </p>
                </div>
                <Badge className={s.status === "connected" ? "border-ink" : ""}>{s.status}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === s.id + "test"}
                  onClick={() => act(s.id, `/integrations/mcp/${s.id}/test`, "MCP test")}
                >
                  <Zap size={12} /> Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === s.id + "discover"}
                  onClick={() => act(s.id, `/integrations/mcp/${s.id}/discover`, "Discovery")}
                >
                  <RefreshCw size={12} /> Discover
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/integrations/mcp/${s.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>

          {/* Integrations */}
          <h3 className="mt-8 text-sm font-medium">Integration instances</h3>
          <div className="mt-3 space-y-2">
            {integrations.length === 0 && (
              <p className="rounded-xl border bg-raised px-4 py-6 text-center text-xs text-muted">
                No integrations configured — connect Composio, n8n, Activepieces or a custom API.
              </p>
            )}
            {integrations.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-xl border bg-raised px-4 py-3">
                <Wrench size={15} className="text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{i.name}</p>
                  <p className="truncate text-xs text-muted">
                    {i.key} · {i.tool_count} tool(s) · {i.status}
                    {i.has_credentials ? " · credentials stored" : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === i.id + "test"}
                  onClick={() => act(i.id, `/integrations/${i.id}/test`, "Test")}
                >
                  <Zap size={12} /> Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === i.id + "discover"}
                  onClick={() => act(i.id, `/integrations/${i.id}/discover`, "Discovery")}
                >
                  <RefreshCw size={12} /> Discover
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/integrations/${i.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>

          {/* Tools */}
          <h3 className="mt-8 text-sm font-medium">Tools</h3>
          <div className="mt-3 divide-y overflow-hidden rounded-xl border bg-raised">
            {tools.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted">No tools discovered yet</p>}
            {tools.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.display_name || t.name}</p>
                  <p className="truncate text-[11px] text-muted">{t.description || t.name}</p>
                </div>
                <Badge>{t.source}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/tools/${t.id}`, {
                      method: "PATCH",
                      body: { requires_approval: !t.requires_approval },
                    });
                    await load();
                  }}
                >
                  {t.requires_approval ? "approval: on" : "approval: off"}
                </Button>
                <Toggle
                  checked={t.enabled}
                  onChange={async () => {
                    await api(`/tools/${t.id}`, { method: "PATCH", body: { enabled: !t.enabled } });
                    await load();
                  }}
                  label={`Toggle ${t.name}`}
                />
              </div>
            ))}
          </div>

          {/* Execution history */}
          <h3 className="mt-8 text-sm font-medium">Tool execution history</h3>
          <div className="mt-3 overflow-hidden rounded-xl border bg-raised">
            {executions.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">No tool executions yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface text-left text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">Tool</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                    <th className="px-4 py-2.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {executions.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2.5 text-xs">{e.tool_name}</td>
                      <td className="px-4 py-2.5">
                        <Badge className={e.status === "error" ? "border-ink" : ""}>{e.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">{e.duration_ms}ms</td>
                      <td className="px-4 py-2.5 text-xs text-muted">{relativeTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* MCP modal */}
      <Modal open={mcpModal} onClose={() => setMcpModal(false)} title="Add MCP server">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div>
            <Label>Name</Label>
            <Input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="e.g. filesystem" />
          </div>
          <div>
            <Label>Transport</Label>
            <select
              value={mcpTransport}
              onChange={(e) => setMcpTransport(e.target.value)}
              className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
            >
              <option value="stdio">stdio (local process)</option>
              <option value="http">HTTP (remote server)</option>
            </select>
          </div>
          {mcpTransport === "stdio" ? (
            <>
              <div>
                <Label>Command</Label>
                <Input value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} placeholder="npx" />
              </div>
              <div>
                <Label>Arguments (space-separated)</Label>
                <Input value={mcpArgs} onChange={(e) => setMcpArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /data" />
              </div>
            </>
          ) : (
            <div>
              <Label>Server URL</Label>
              <Input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
            </div>
          )}
          <div>
            <Label>Headers (JSON, e.g. auth tokens — stored encrypted)</Label>
            <textarea
              value={mcpHeaders}
              onChange={(e) => setMcpHeaders(e.target.value)}
              rows={3}
              className="w-full rounded-lg border bg-base px-3 py-2 font-mono text-xs focus-ring"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveMcp} disabled={busy === "mcp"}>
              {busy === "mcp" ? <Spinner size={14} /> : null}
              Register
            </Button>
            <Button variant="ghost" onClick={() => setMcpModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Integration modal */}
      <Modal open={intModal} onClose={() => setIntModal(false)} title="Add integration">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div>
            <Label>Type</Label>
            <select
              value={intKey}
              onChange={(e) => setIntKey(e.target.value)}
              className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
            >
              <option value="composio">Composio</option>
              <option value="n8n">n8n webhook</option>
              <option value="activepieces">Activepieces webhook</option>
              <option value="custom_http">Custom REST API</option>
              <option value="webhook">Generic webhook</option>
            </select>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={intName} onChange={(e) => setIntName(e.target.value)} placeholder="e.g. Composio prod" />
          </div>
          <div>
            <Label>Configuration (JSON)</Label>
            <textarea
              value={intConfig}
              onChange={(e) => setIntConfig(e.target.value)}
              rows={5}
              className="w-full rounded-lg border bg-base px-3 py-2 font-mono text-xs focus-ring"
              placeholder='{"app_names": ["github"], "webhook_url": "https://..."}'
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Credential key</Label>
              <Input value={intCredKey} onChange={(e) => setIntCredKey(e.target.value)} />
            </div>
            <div>
              <Label>Credential value (encrypted at rest)</Label>
              <Input type="password" value={intCredVal} onChange={(e) => setIntCredVal(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveIntegration} disabled={busy === "int"}>
              {busy === "int" ? <Spinner size={14} /> : null}
              Create
            </Button>
            <Button variant="ghost" onClick={() => setIntModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
