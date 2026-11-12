"use client";

import { Sparkles, Wrench, Globe, Server } from "lucide-react";

const SUGGESTIONS = [
  {
    icon: Sparkles,
    title: "Explain a concept",
    text: "Explain how vector databases work, with a simple example.",
  },
  {
    icon: Wrench,
    title: "Use a tool",
    text: "What is the current date and time?",
  },
  {
    icon: Globe,
    title: "Research",
    text: "Search the web for the latest news about self-hosted AI.",
  },
  {
    icon: Server,
    title: "Write code",
    text: "Write a Python function that parses an ISO 8601 timestamp.",
  },
];

export function Welcome({
  userName,
  onPick,
}: {
  userName: string;
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 animate-fade-in">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-ink text-xl font-bold">
        C
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Welcome, {userName}</h1>
      <p className="mt-2 max-w-md text-center text-sm text-muted">
        Curiousity is your self-hosted AI agent — chat, use tools, connect integrations and
        automate work.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, title, text }) => (
          <button
            key={title}
            onClick={() => onPick(text)}
            className="group flex flex-col items-start gap-1.5 rounded-xl border bg-raised p-4 text-left transition-all hover:shadow-md focus-ring"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              <Icon size={13} />
              {title}
            </div>
            <p className="text-sm leading-5">{text}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
