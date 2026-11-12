"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert, Button, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ ok: boolean; reset_token?: string }>("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setDone(true);
      if (data.reset_token) setResetToken(data.reset_token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-ink text-lg font-bold">
            C
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1.5 text-sm text-muted">
            Enter your email and we&apos;ll send you a reset link
          </p>
        </div>

        <div className="rounded-2xl border bg-raised p-6 shadow-sm">
          {done ? (
            <div className="space-y-4 text-center animate-fade-in">
              <CheckCircle2 size={36} className="mx-auto" />
              <p className="text-sm text-muted">
                If that account exists, a reset link has been sent.
              </p>
              {resetToken && (
                <div className="rounded-lg border bg-surface p-3 text-left">
                  <p className="text-xs font-medium">SMTP is not configured on this server.</p>
                  <p className="mt-1 text-xs text-muted">Use this reset token:</p>
                  <code className="mt-1.5 block break-all rounded bg-base p-2 text-[11px]">
                    {resetToken}
                  </code>
                  <Link
                    href={`/reset-password?token=${resetToken}`}
                    className="mt-2 inline-block text-xs font-medium text-ink hover:underline"
                  >
                    Continue to reset →
                  </Link>
                </div>
              )}
              <Link href="/login" className="inline-block text-sm text-muted hover:text-ink">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <Alert variant="error">{error}</Alert>}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Spinner size={14} /> : null}
                Send reset link
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-ink hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
