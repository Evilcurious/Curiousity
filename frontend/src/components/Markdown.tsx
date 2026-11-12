"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";
import { useTheme } from "@/lib/theme";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-ink transition-colors focus-ring"
      aria-label="Copy code"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Monochrome-friendly overrides for the syntax themes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function monoStyle(dark: boolean): any {
  const base: any = dark ? oneDark : oneLight;
  const codeKey = 'code[class*="language-"]';
  const preKey = 'pre[class*="language-"]';
  return {
    ...base,
    [codeKey]: {
      ...(base[codeKey] || {}),
      background: "transparent",
      fontSize: "13px",
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    },
    [preKey]: {
      ...(base[preKey] || {}),
      background: dark ? "#101012" : "#FAFAFA",
      margin: 0,
      padding: "12px 14px",
    },
  };
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeText = String(children).replace(/\n$/, "");
            if (match || codeText.includes("\n")) {
              return (
                <div className="code-block">
                  <div className="code-block-header">
                    <span className="text-muted">{match ? match[1] : "code"}</span>
                    <CopyButton text={codeText} />
                  </div>
                  <SyntaxHighlighter
                    language={match?.[1] || "text"}
                    style={monoStyle(dark)}
                    PreTag="div"
                  >
                    {codeText}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
