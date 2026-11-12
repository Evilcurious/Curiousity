"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { ChatView } from "@/components/ChatView";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const [, setTick] = useState(0);
  const onMessagesChanged = useCallback(() => setTick((t) => t + 1), []);
  return <ChatView conversationId={params.id} onMessagesChanged={onMessagesChanged} />;
}
