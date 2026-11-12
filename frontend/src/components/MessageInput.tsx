"use client";

import { useRef, useState } from "react";
import { ArrowUp, Paperclip, Square, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Loader";

export function MessageInput({
  onSend,
  onStop,
  streaming,
  disabled,
  sendOnEnter = true,
  initialValue = "",
}: {
  onSend: (content: string, attachmentIds: string[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  sendOnEnter?: boolean;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<{ id: string; filename: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !streaming && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim(), attachments.map((a) => a.id));
    setValue("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && sendOnEnter) {
      e.preventDefault();
      submit();
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { api } = await import("@/lib/api");
      const att = await api<{ id: string; filename: string; size: number }>("/attachments", {
        method: "POST",
        body: form,
      });
      setAttachments((prev) => [...prev, att]);
    } catch {
      /* upload failed — silently ignore, user can retry */
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Attachment chips */}
      {(attachments.length > 0 || uploading) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1.5 text-xs"
            >
              <FileText size={12} className="text-muted" />
              {a.filename}
              <button
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="text-muted hover:text-ink focus-ring rounded"
                aria-label={`Remove ${a.filename}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {uploading && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1.5 text-xs text-muted">
              <Spinner size={12} /> Uploading…
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border bg-raised p-2.5 shadow-sm transition-shadow",
          "focus-within:shadow-md"
        )}
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
          aria-label="Attach file"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={streaming || uploading}
          className="rounded-lg p-2 text-muted hover:text-ink hover:bg-surface transition-colors focus-ring disabled:opacity-40"
          aria-label="Attach file"
          title="Attach file"
        >
          <Paperclip size={17} />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message Curiousity…"
          rows={1}
          disabled={disabled}
          className="max-h-[220px] flex-1 bg-transparent py-2 text-[15px] placeholder:text-faint outline-none"
          aria-label="Message input"
        />

        {streaming ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-ink p-2 text-base transition-opacity hover:opacity-90 focus-ring"
            aria-label="Stop generating"
            title="Stop generating"
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!canSend}
            className="rounded-lg bg-ink p-2 text-base transition-all hover:opacity-90 focus-ring disabled:opacity-30"
            aria-label="Send message"
            title="Send message"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-faint">
        {sendOnEnter ? "Enter to send · Shift+Enter for a new line" : "Click the arrow to send"} ·
        Curiousity can make mistakes — verify important information.
      </p>
    </div>
  );
}
