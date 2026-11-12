"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Alert, Button, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { ThemeToggle } from "@/components/ThemeToggle";

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 3.9-5.35 3.9a5.9 5.9 0 1 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.15-2.15A8.9 8.9 0 1 0 12 21c4.6 0 8.5-3.4 8.5-9 0-.3-.05-.6-.15-.9z"
      />
    </svg>
  );
}

function LoginInner() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);

  useEffect(() => {
    if (!loading && user) router.replace("/chat");
  }, [user, loading, router]);

  useEffect(() => {
    const err = params.get("error");
    if (err === "google") setError("Google sign-in failed — please try again.");
    api<{ url: string }>("/auth/google/url")
      .then(() => setGoogleConfigured(true))
      .catch(() => setGoogleConfigured(false));
  }, [params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/chat");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/auth/google/url");
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setGoogleBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-ink text-lg font-bold">
            C
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in to continue to Curiousity</p>
        </div>

        <div className="rounded-2xl border bg-raised p-6 shadow-sm">
          {googleConfigured && (
            <>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={google}
                disabled={googleBusy}
              >
                {googleBusy ? <Spinner size={14} /> : <GoogleIcon />}
                Continue with Google
              </Button>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-edge" />
                <span className="text-[11px] uppercase tracking-wider text-faint">or</span>
                <div className="h-px flex-1 bg-edge" />
              </div>
            </>
          )}

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
                autoComplete="email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="mb-1.5 text-xs text-muted hover:text-ink"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-ink hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
