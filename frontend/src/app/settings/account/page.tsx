"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Alert, Button, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Loader";
import { Modal } from "@/components/Modal";

export default function AccountSettings() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/user/account", {
        method: "DELETE",
        body: { password: password || undefined, confirm: true },
      });
      await logout();
      router.push("/login");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold">Account</h2>
      <p className="mt-1 text-sm text-muted">Manage your account and connected sign-in methods</p>

      <div className="mt-6 space-y-6">
        <div className="rounded-xl border p-4">
          <h3 className="text-sm font-medium">Sign-in methods</h3>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-lg border bg-surface px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium">Email & password</p>
                <p className="text-xs text-muted">{user?.email}</p>
              </div>
              <span className="text-[11px] text-muted">Active</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-surface px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium">Google</p>
                <p className="text-xs text-muted">
                  {user?.google_linked ? "Linked" : "Not connected"}
                </p>
              </div>
              <span className="text-[11px] text-muted">
                {user?.google_linked ? "Active" : "Sign in with Google to link"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <h3 className="text-sm font-medium">Delete account</h3>
          <p className="mt-1 text-xs text-muted">
            Permanently delete your account, conversations, messages and connected data. This
            cannot be undone.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => setConfirmOpen(true)}>
            Delete my account
          </Button>
        </div>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete account">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This will permanently delete <strong>{user?.email}</strong> and all associated data.
            Type your password to confirm.
          </p>
          {error && <Alert variant="error">{error}</Alert>}
          {!user?.google_linked || user?.email ? (
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="danger" onClick={deleteAccount} disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              Permanently delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
