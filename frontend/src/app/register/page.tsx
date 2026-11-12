"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Alert, Button, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/chat");
  }, [user, loading, router]);

  useEffect(() => {
    api<{ url: string }>("/auth/google/url")
      .then(() => setGoogleConfigured(true))
      .catch(() => setGoogleConfigured(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, name);
      router.replace("/chat");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setGoogleBusy(true);
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
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1.5 text-sm text-muted">Start using Curiousity — no email verification needed</p>
        </div>

        <div className="rounded-2xl border bg-raised p-6 shadow-sm">
          {googleConfigured && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={google}
              disabled={googleBusy}
            >
              {googleBusy ? <Spinner size={14} /> : null}
              Continue with Google
            </Button>
          )}
          {googleConfigured && (
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-edge" />
              <span className="text-[11px] uppercase tracking-wider text-faint">or</span>
              <div className="h-px flex-1 bg-edge" />
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <div>
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              Create account
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
