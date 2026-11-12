"use client";

import { useCallback, useState } from "react";
import { ChatView } from "@/components/ChatView";

export default function NewChatPage() {
  const [, setTick] = useState(0);
  const onMessagesChanged = useCallback(() => setTick((t) => t + 1), []);
  return <ChatView onMessagesChanged={onMessagesChanged} />;
}
