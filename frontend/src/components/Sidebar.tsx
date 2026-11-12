"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Check,
  ChevronDown,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
  Puzzle,
  LogOut,
  User as UserIcon,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, groupByDate } from "@/lib/utils";
import type { AIModel, Conversation } from "@/lib/types";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar({
  onCollapsedChange,
}: {
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadConversations = useCallback(async () => {
    try {
      const data = await api<Conversation[]>(`/conversations?search=${encodeURIComponent(debouncedSearch)}`);
      setConversations(data);
    } catch {
      /* ignore */
    }
  }, [debouncedSearch]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations, pathname]);

  useEffect(() => {
    api<AIModel[]>("/models")
      .then((data) => {
        setModels(data);
        const saved = localStorage.getItem("curiousity_model");
        const preferred = data.find((m) => m.id === saved) || data.find((m) => m.is_default) || data[0];
        if (preferred) setSelectedModel(preferred.id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Close menus on outside click
  useEffect(() => {
    const close = () => {
      setMenuFor(null);
      setModelOpen(false);
      setProfileOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const newChat = async () => {
    try {
      const conv = await api<Conversation>("/conversations", {
        method: "POST",
        body: { title: "New chat", model_id: selectedModel || undefined },
      });
      await loadConversations();
      router.push(`/chat/${conv.id}`);
    } catch {
      router.push("/chat");
    }
  };

  const selectModel = (id: string) => {
    setSelectedModel(id);
    localStorage.setItem("curiousity_model", id);
    setModelOpen(false);
  };

  const rename = async (id: string) => {
    if (renameDraft.trim()) {
      await api(`/conversations/${id}`, { method: "PATCH", body: { title: renameDraft.trim() } });
      await loadConversations();
    }
    setRenaming(null);
  };

  const togglePin = async (c: Conversation) => {
    await api(`/conversations/${c.id}`, { method: "PATCH", body: { pinned: !c.pinned } });
    await loadConversations();
    setMenuFor(null);
  };

  const remove = async (id: string) => {
    await api(`/conversations/${id}`, { method: "DELETE" });
    await loadConversations();
    if (pathname === `/chat/${id}`) router.push("/chat");
    setMenuFor(null);
  };

  const currentModel = models.find((m) => m.id === selectedModel);
  const groups = groupByDate(conversations);

  if (collapsed) {
    return (
      <div className="flex h-full w-[52px] flex-col items-center gap-2 border-r bg-surface py-3">
        <button
          onClick={() => {
            setCollapsed(false);
            onCollapsedChange?.(false);
          }}
          className="rounded-lg p-2 text-muted hover:text-ink hover:bg-raised focus-ring"
          aria-label="Expand sidebar"
        >
          <PanelLeft size={17} />
        </button>
        <button
          onClick={newChat}
          className="rounded-lg p-2 text-muted hover:text-ink hover:bg-raised focus-ring"
          aria-label="New chat"
        >
          <MessageSquarePlus size={17} />
        </button>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r bg-surface animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          onClick={() => {
            setCollapsed(true);
            onCollapsedChange?.(true);
          }}
          className="rounded-lg p-1.5 text-muted hover:text-ink hover:bg-raised focus-ring"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-base text-xs font-bold">
            C
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Curiousity</span>
        </div>
      </div>

      {/* New chat */}
      <div className="px-3 pt-3">
        <button
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-lg border bg-raised px-3 py-2.5 text-sm font-medium transition-colors hover:bg-base focus-ring"
        >
          <MessageSquarePlus size={15} />
          New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg border bg-base py-1.5 pl-8 pr-7 text-xs placeholder:text-faint focus-ring"
            aria-label="Search conversations"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* History */}
      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-faint">
            {search ? "No chats match your search" : "No conversations yet"}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-1.5">
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-faint">
              {group.label}
            </p>
            {group.items.map((c) => {
              const active = pathname === `/chat/${c.id}`;
              return (
                <div key={c.id} className="group relative">
                  {renaming === c.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => rename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(c.id);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-full rounded-lg border bg-base px-2.5 py-2 text-xs focus-ring"
                    />
                  ) : (
                    <button
                      onClick={() => router.push(`/chat/${c.id}`)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-ring",
                        active ? "bg-raised text-ink font-medium border" : "text-muted hover:bg-raised hover:text-ink"
                      )}
                    >
                      {c.pinned && <Pin size={10} className="shrink-0" />}
                      <span className="truncate flex-1">{c.title || "New chat"}</span>
                    </button>
                  )}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(menuFor === c.id ? null : c.id);
                      }}
                      className="rounded p-1 text-muted hover:text-ink focus-ring"
                      aria-label="Conversation menu"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {menuFor === c.id && (
                      <div
                        className="absolute right-0 z-30 mt-1 w-36 rounded-lg border bg-raised py-1 shadow-lg animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => togglePin(c)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface"
                        >
                          <Pin size={11} />
                          {c.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          onClick={() => {
                            setRenaming(c.id);
                            setRenameDraft(c.title);
                            setMenuFor(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface"
                        >
                          <SquarePen size={11} />
                          Rename
                        </button>
                        <button
                          onClick={() => remove(c.id)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface"
                        >
                          <Trash2 size={11} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Model selector */}
      <div className="relative border-t px-3 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setModelOpen(!modelOpen);
            setProfileOpen(false);
          }}
          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-xs hover:bg-raised focus-ring"
        >
          <span className="flex items-center gap-2 truncate">
            <span className="h-2 w-2 rounded-full bg-ink" aria-hidden="true" />
            <span className="truncate font-medium">{currentModel?.display_name || "Select model"}</span>
          </span>
          <ChevronDown size={13} className="text-muted" />
        </button>
        {modelOpen && (
          <div
            className="absolute bottom-full left-3 right-3 z-30 mb-1 max-h-64 overflow-y-auto rounded-lg border bg-raised py-1 shadow-lg animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => selectModel(m.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-surface"
              >
                <span className="truncate">
                  <span className="font-medium">{m.display_name}</span>
                  <span className="ml-1.5 text-faint">{m.provider_name}</span>
                </span>
                {m.id === selectedModel && <Check size={12} />}
              </button>
            ))}
            {models.length === 0 && <p className="px-3 py-2 text-xs text-faint">No models available</p>}
          </div>
        )}
      </div>

      {/* Theme + profile */}
      <div className="border-t px-3 py-2.5">
        <div className="mb-2 flex justify-center">
          <ThemeToggle compact />
        </div>
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setProfileOpen(!profileOpen);
              setModelOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-raised focus-ring"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-base text-[10px] font-bold">
              {(user?.display_name || user?.email || "U").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-xs font-medium">{user?.display_name || "User"}</p>
              <p className="truncate text-[10px] text-faint">{user?.email}</p>
            </div>
            <ChevronDown size={12} className="text-muted" />
          </button>
          {profileOpen && (
            <div
              className="absolute bottom-full left-0 right-0 z-30 mb-1 rounded-lg border bg-raised py-1 shadow-lg animate-fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => router.push("/settings")}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface"
              >
                <UserIcon size={12} />
                Settings
              </button>
              <button
                onClick={() => router.push("/integrations")}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface"
              >
                <Puzzle size={12} />
                Integrations
              </button>
              {user?.role === "admin" && (
                <button
                  onClick={() => router.push("/admin")}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface"
                >
                  <Settings size={12} />
                  Admin panel
                </button>
              )}
              <button
                onClick={() => logout()}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface"
              >
                <LogOut size={12} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
