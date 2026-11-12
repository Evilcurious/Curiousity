"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, ShieldAlert } from "lucide-react";
import { api, streamSSE } from "@/lib/api";
import type { AIModel, Message as MessageType } from "@/lib/types";
import { Message } from "./Message";
import { MessageInput } from "./MessageInput";
import { Welcome } from "./Welcome";
import { Loader, EmptyState, Spinner } from "./Loader";
import { Button } from "./ui";
import { useAuth } from "@/lib/auth";

interface PendingApproval {
  execution_id: string;
  tool_call_id: string;
  name: string;
  arguments: unknown;
}

export function ChatView({
  conversationId,
  initialMessages,
  onMessagesChanged,
}: {
  conversationId?: string;
  initialMessages?: MessageType[];
  onMessagesChanged?: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageType[]>(initialMessages || []);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [loading, setLoading] = useState(!!conversationId && !initialMessages);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const currentConv = useRef<string | undefined>(conversationId);

  currentConv.current = conversationId;

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api<MessageType[]>(`/conversations/${conversationId}/messages`);
      setMessages(data);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streamContent, streaming]);

  const runGeneration = useCallback(
    async (path: string, body: unknown) => {
      setStreaming(true);
      setError(null);
      setStreamContent("");
      abortRef.current = new AbortController();

      // Optimistic user message for edit flows is handled by caller.
      let convId = conversationId;

      try {
        await streamSSE(
          path,
          body,
          (ev) => {
            const type = ev.type as string;
            if (type === "message_start") {
              /* user message persisted */
            } else if (type === "token") {
              setStreamContent((prev) => prev + (ev.text as string));
            } else if (type === "tool_call") {
              // Show a transient tool-call chip inside the streaming buffer
              setStreamContent(
                (prev) => prev + `\n\n\`⚙ tool: ${ev.name}\`\n`
              );
            } else if (type === "tool_result") {
              setStreamContent((prev) => prev + `\n\`✓ ${ev.name}: ${ev.status}\`\n\n`);
            } else if (type === "approval_required") {
              setApproval({
                execution_id: ev.execution_id as string,
                tool_call_id: ev.tool_call_id as string,
                name: ev.name as string,
                arguments: ev.arguments,
              });
            } else if (type === "message_done") {
              setStreamContent("");
            } else if (type === "error") {
              setError((ev.message as string) || "Generation failed");
            }
          },
          abortRef.current.signal
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message || "Generation failed");
        }
      } finally {
        setStreaming(false);
        setStreamContent("");
        await loadMessages();
        onMessagesChanged?.();
      }
    },
    [conversationId, loadMessages, onMessagesChanged]
  );

  const send = useCallback(
    async (content: string, attachmentIds: string[]) => {
      setError(null);
      let convId = conversationId;

      if (!convId) {
        // Create conversation on first message
        try {
          const conv = await api<{ id: string }>("/conversations", {
            method: "POST",
            body: { title: "New chat" },
          });
          convId = conv.id;
          // Navigate but keep state — replace URL without remounting much
          window.history.replaceState(null, "", `/chat/${convId}`);
          onMessagesChanged?.();
        } catch {
          setError("Could not create a conversation");
          return;
        }
      }

      // Optimistic user message
      setMessages((prev) => [
        ...prev,
        {
          id: `tmp-${Date.now()}`,
          conversation_id: convId!,
          role: "user",
          content,
          created_at: new Date().toISOString(),
          attachments: null,
        } as MessageType,
      ]);

      await runGeneration(`/conversations/${convId}/messages`, {
        content,
        attachment_ids: attachmentIds,
      });

      // If URL was /chat (no id), redirect to the conversation page after first send
      if (!conversationId && convId) {
        router.replace(`/chat/${convId}`);
      }
    },
    [conversationId, runGeneration, router, onMessagesChanged]
  );

  const regenerate = useCallback(
    async (message: MessageType) => {
      // Find the user message preceding this assistant message
      const idx = messages.findIndex((m) => m.id === message.id);
      let userMsg: MessageType | undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMsg = messages[i];
          break;
        }
      }
      if (!userMsg || !conversationId) return;
      await runGeneration(
        `/conversations/${conversationId}/messages/${userMsg.id}/regenerate`,
        {}
      );
    },
    [messages, conversationId, runGeneration]
  );

  const editMessage = useCallback(
    async (message: MessageType, content: string) => {
      if (!conversationId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, content } : m))
      );
      await runGeneration(`/conversations/${conversationId}/messages/${message.id}`, {
        content,
      });
    },
    [conversationId, runGeneration]
  );

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    if (conversationId) {
      try {
        await api(`/conversations/${conversationId}/stop`, { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    setStreaming(false);
    setStreamContent("");
    await loadMessages();
  }, [conversationId, loadMessages]);

  const decideApproval = useCallback(
    async (decision: "approve" | "deny") => {
      if (!approval) return;
      const { execution_id } = approval;
      setApproval(null);
      try {
        await api(`/tool-executions/${execution_id}/approval`, {
          method: "POST",
          body: { decision },
        });
        // Continue generation after the decision
        await runGeneration(`/tool-executions/${execution_id}/continue`, {
          decision,
          tool_call_id: approval?.tool_call_id,
        });
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [approval, runGeneration]
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader label="Loading conversation" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming ? (
          <Welcome
            userName={user?.display_name || "there"}
            onPick={(text) => send(text, [])}
          />
        ) : (
          <div className="py-4">
            {messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                onRegenerate={
                  m.role === "assistant" && !m.error ? () => regenerate(m) : undefined
                }
                onEdit={
                  m.role === "user" && !streaming ? (content) => editMessage(m, content) : undefined
                }
              />
            ))}
            {streaming && streamContent && (
              <Message
                message={{
                  id: "streaming",
                  conversation_id: conversationId || "",
                  role: "assistant",
                  content: streamContent,
                  created_at: new Date().toISOString(),
                }}
                isStreaming
              />
            )}
            {streaming && !streamContent && (
              <div className="px-4 md:px-8 lg:px-16 xl:px-24">
                <div className="mx-auto flex max-w-3xl items-center gap-3 py-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold">
                    C
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Approval banner */}
      {approval && (
        <div className="border-t bg-surface px-4 py-3 animate-slide-up">
          <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-xl border bg-raised p-4">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Approval required</p>
              <p className="mt-0.5 text-xs text-muted">
                Curiousity wants to run <strong>{approval.name}</strong> with:
              </p>
              <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-surface p-2 text-[11px] text-muted">
                {JSON.stringify(approval.arguments, null, 2)}
              </pre>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" onClick={() => decideApproval("approve")}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => decideApproval("deny")}>
                  Deny
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-4 pb-1">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 rounded-lg border bg-surface px-3.5 py-2 text-xs animate-fade-in">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-muted hover:text-ink">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t bg-base px-4 py-4 md:px-8 lg:px-16 xl:px-24">
        <div className="mx-auto max-w-3xl">
          <MessageInput
            onSend={send}
            onStop={stop}
            streaming={streaming}
            sendOnEnter
          />
        </div>
      </div>
    </div>
  );
}
