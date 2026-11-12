"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditLog } from "@/lib/types";
import { Badge, Button, Input } from "@/components/ui";
import { Spinner, EmptyState } from "@/components/Loader";
import { ScrollText } from "lucide-react";
import { relativeTime } from "@/lib/utils";

const FILTERS = [
  { value: "", label: "All events" },
  { value: "auth", label: "Authentication" },
  { value: "admin", label: "Admin actions" },
  { value: "chat", label: "Chat activity" },
  { value: "tool", label: "Tool executions" },
  { value: "user", label: "User changes" },
];

export default function AdminLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ total: number; items: AuditLog[] }>(
        `/admin/logs?action=${filter}&limit=200`
      );
      setLogs(data.items);
      setTotal(data.total);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Logs & monitoring</h2>
          <p className="text-sm text-muted">
            Login history, security events, admin actions and tool executions
          </p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-ring ${
                filter === f.value ? "bg-ink text-base" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border bg-raised">
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={20} />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={<ScrollText size={28} />} title="No log entries" description="Actions will appear here as they happen." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-surface text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Resource</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-surface/60">
                  <td className="px-4 py-2.5">
                    <Badge>{l.action}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{l.user_id?.slice(0, 8) || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {l.resource_type ? `${l.resource_type}${l.resource_id ? `:${l.resource_id.slice(0, 8)}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{l.ip || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{relativeTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Showing {logs.length} of {total} entries · login history is available under the
        Authentication filter.
      </p>
    </div>
  );
}
