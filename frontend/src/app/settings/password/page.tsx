"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { CheckCircle2 } from "lucide-react";

export default function PasswordSettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      setCurrent("");
      setNext("");
      setConfirm("");
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
      <h2 className="text-lg font-semibold">Password</h2>
      <p className="mt-1 text-sm text-muted">
        Change your password. All other sessions will be signed out.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        {saved && (
          <Alert variant="success">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Password changed
            </span>
          </Alert>
        )}
        <div>
          <Label htmlFor="current">Current password</Label>
          <Input
            id="current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="next">New password</Label>
          <Input
            id="next"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner size={14} /> : null}
          Update password
        </Button>
      </form>
    </div>
  );
}
