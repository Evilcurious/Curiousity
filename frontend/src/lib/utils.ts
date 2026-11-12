import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function groupByDate<T extends { id: string; updated_at: string; pinned: boolean }>(
  items: T[]
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 3600 * 1000;

  const pinned = items.filter((i) => i.pinned);
  if (pinned.length) groups.push({ label: "Pinned", items: pinned });

  const rest = items.filter((i) => !i.pinned);
  const buckets: Record<string, T[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    "Previous 30 days": [],
    Older: [],
  };
  for (const item of rest) {
    const t = new Date(item.updated_at).getTime();
    if (t >= startOfToday) buckets.Today.push(item);
    else if (t >= startOfToday - dayMs) buckets.Yesterday.push(item);
    else if (t >= startOfToday - 7 * dayMs) buckets["Previous 7 days"].push(item);
    else if (t >= startOfToday - 30 * dayMs) buckets["Previous 30 days"].push(item);
    else buckets.Older.push(item);
  }
  for (const [label, list] of Object.entries(buckets)) {
    if (list.length) groups.push({ label, items: list });
  }
  return groups;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
