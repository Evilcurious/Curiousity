"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Alert, Button, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { CheckCircle2 } from "lucide-react";

export default function ProfileSettings() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.display_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/user/profile", {
        method: "PATCH",
        body: { display_name: name, email },
      });
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold">Profile</h2>
      <p className="mt-1 text-sm text-muted">Manage your personal information</p>

      <div className="mt-6 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-base text-lg font-bold">
          {(user?.display_name || user?.email || "U").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-medium">{user?.display_name || "User"}</p>
          <p className="text-xs text-muted">{user?.email}</p>
          {user?.google_linked && (
            <p className="mt-1 text-[11px] text-faint">Google account linked</p>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        {saved && (
          <Alert variant="success">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Profile updated
            </span>
          </Alert>
        )}
        <div>
          <Label htmlFor="name">Display name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner size={14} /> : null}
          Save changes
        </Button>
      </form>
    </div>
  );
}
