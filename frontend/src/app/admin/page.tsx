"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OverviewStats } from "@/lib/types";
import { Card } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { relativeTime } from "@/lib/utils";

const STAT_LABELS: [keyof OverviewStats, string][] = [
  ["total_users", "Total users"],
  ["active_users", "Active users"],
  ["total_conversations", "Conversations"],
  ["ai_requests", "AI requests"],
  ["tool_executions", "Tool executions"],
  ["total_messages", "Messages"],
];

export default function AdminOverview() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OverviewStats>("/admin/overview")
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-muted">Failed to load stats: {error}</p>;
  if (!stats)
    return (
      <div className="flex justify-center py-20">
        <Spinner size={22} />
      </div>
    );

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-semibold">Overview</h2>
      <p className="text-sm text-muted">Platform activity at a glance</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {STAT_LABELS.map(([key, label]) => (
          <Card key={key} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {(stats[key] as number).toLocaleString()}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-medium">Model usage</h3>
          <div className="mt-3 space-y-2">
            {stats.model_usage.length === 0 && (
              <p className="text-xs text-muted">No AI requests yet</p>
            )}
            {stats.model_usage.map((m) => (
              <div key={m.model_id} className="flex items-center gap-2">
                <span className="w-40 truncate text-xs">{m.model_name || m.model_id}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-ink"
                    style={{
                      width: `${Math.min(
                        100,
                        (m.count / Math.max(...stats.model_usage.map((x) => x.count), 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-muted">{m.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-medium">System status</h3>
          <div className="mt-3 space-y-1.5">
            {Object.entries(stats.system_status).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted">{k}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-4">
        <h3 className="text-sm font-medium">Recent activity</h3>
        <div className="mt-3 divide-y">
          {stats.recent_activity.length === 0 && (
            <p className="py-2 text-xs text-muted">No activity recorded yet</p>
          )}
          {stats.recent_activity.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px]">
                  {a.action}
                </span>
                <span className="text-muted">{a.ip || "—"}</span>
              </div>
              <span className="text-faint">{relativeTime(a.created_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
