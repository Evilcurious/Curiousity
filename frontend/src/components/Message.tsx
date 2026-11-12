"use client";

import { memo, useState } from "react";
import {
  Check,
  Copy,
  Pencil,
  RefreshCw,
  Wrench,
  AlertCircle,
  Paperclip,
} from "lucide-react";
import { Markdown } from "./Markdown";
import { Button, Textarea } from "./ui";
import { formatTime, cn } from "@/lib/utils";
import type { Message as MessageType } from "@/lib/types";

export const Message = memo(function Message({
  message,
  isStreaming,
  onRegenerate,
  onEdit,
}: {
  message: MessageType;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onEdit?: (content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  const copy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (isTool) {
    return (
      <div className="animate-fade-in px-4 md:px-8 lg:px-16 xl:px-24">
        <div className="mx-auto max-w-3xl">
          <details className="rounded-lg border bg-surface text-xs">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-muted select-none">
              <Wrench size={12} />
              <span className="font-medium">{message.tool_name || "Tool"}</span>
              <span className="ml-auto">tool result</span>
            </summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t px-3 py-2 font-mono text-[11px] text-muted">
              {message.content}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group animate-fade-in px-4 md:px-8 lg:px-16 xl:px-24",
        isUser && "bg-surface/50"
      )}
    >
      <div className="mx-auto flex max-w-3xl gap-3 py-4">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold",
            isUser ? "bg-ink text-base border-ink" : "bg-base text-ink"
          )}
          aria-hidden="true"
        >
          {isUser ? "You" : "C"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium">{isUser ? "You" : "Curiousity"}</span>
            <span className="text-[10px] text-faint opacity-0 group-hover:opacity-100 transition-opacity">
              {formatTime(message.created_at)}
            </span>
          </div>

          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(12, draft.split("\n").length + 1)}
                autoFocus
                className="text-[15px]"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    onEdit?.(draft);
                  }}
                  disabled={!draft.trim()}
                >
                  Send
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : isUser ? (
            <p className="text-[15px] leading-7 whitespace-pre-wrap">{message.content}</p>
          ) : message.error ? (
            <div className="flex items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-sm">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Something went wrong</p>
                <p className="mt-0.5 text-xs text-muted">{message.error}</p>
              </div>
            </div>
          ) : (
            <div className={cn(isStreaming && "stream-cursor")}>
              <Markdown content={message.content} />
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-1 text-[11px] text-muted"
                >
                  <Paperclip size={10} />
                  {a.filename}
                </span>
              ))}
            </div>
          )}

          {message.tool_calls && message.tool_calls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.tool_calls.map((tc) => (
                <span
                  key={tc.id}
                  className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-1 text-[11px] text-muted"
                >
                  <Wrench size={10} />
                  {tc.name}
                </span>
              ))}
            </div>
          )}

          {!isStreaming && (message.content || message.error) && (
            <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:text-ink hover:bg-surface transition-colors focus-ring"
                aria-label="Copy message"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
              {!isUser && (message.content || message.error) && onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:text-ink hover:bg-surface transition-colors focus-ring"
                  aria-label="Regenerate response"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              )}
              {isUser && onEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:text-ink hover:bg-surface transition-colors focus-ring"
                  aria-label="Edit message"
                >
                  <Pencil size={12} />
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
