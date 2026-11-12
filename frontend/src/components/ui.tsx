"use client";

import { cn } from "@/lib/utils";

/** Monochrome button variants. */
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus-ring disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-[15px]",
        variant === "primary" && "bg-ink text-base hover:opacity-90",
        variant === "secondary" && "bg-surface text-ink border hover:bg-raised",
        variant === "ghost" && "text-muted hover:text-ink hover:bg-surface",
        variant === "danger" && "bg-ink text-base hover:opacity-90",
        variant === "outline" && "border text-ink hover:bg-surface",
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border bg-base px-3.5 py-2.5 text-sm placeholder:text-faint focus-ring",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border bg-base px-3.5 py-2.5 text-sm placeholder:text-faint focus-ring",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1.5 block text-xs font-medium text-muted", className)} {...props} />
  );
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full transition-colors focus-ring",
        checked ? "bg-ink" : "bg-edge"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-base transition-transform shadow",
          checked ? "translate-x-4.5 left-0.5" : "left-0.5"
        )}
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-raised", className)} {...props} />;
}

export function Alert({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "error" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-2.5 text-sm animate-fade-in",
        variant === "error" && "border-ink bg-surface text-ink",
        variant === "success" && "border-edge bg-surface text-ink",
        variant === "default" && "bg-surface text-muted"
      )}
    >
      {children}
    </div>
  );
}
