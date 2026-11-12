"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { Alert, Badge, Button, Input } from "@/components/ui";
import { Spinner, EmptyState } from "@/components/Loader";
import { Modal } from "@/components/Modal";
import { Search, UserCog, Trash2, KeyRound, Users } from "lucide-react";
import { relativeTime } from "@/lib/utils";

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("user");
  const [editStatus, setEditStatus] = useState("active");
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ total: number; items: User[] }>(
        `/admin/users?search=${encodeURIComponent(search)}`
      );
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${editing.id}`, {
        method: "PATCH",
        body: {
          display_name: editName,
          email: editEmail,
          role: editRole,
          status: editStatus,
        },
      });
      setMessage("User updated");
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api(`/admin/users/${confirmDelete.id}`, { method: "DELETE" });
      setMessage("User deleted");
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: User) => {
    try {
      const res = await api<{ temporary_password: string }>(
        `/admin/users/${u.id}/reset-password`,
        { method: "POST" }
      );
      setMessage(`Temporary password for ${u.email}: ${res.temporary_password}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted">{total} registered account(s)</p>
        </div>
        <div className="relative w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="py-1.5 pl-8 text-xs"
          />
        </div>
      </div>

      {message && (
        <div className="mt-4">
          <Alert variant="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-xl border bg-raised">
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={20} />
          </div>
        ) : users.length === 0 ? (
          <EmptyState icon={<Users size={28} />} title="No users found" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-surface text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.display_name || "—"}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={u.role === "admin" ? "border-ink text-ink" : ""}>
                      {u.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={u.status === "suspended" ? "border-ink text-ink" : ""}>
                      {u.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{relativeTime(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => {
                          setEditing(u);
                          setEditName(u.display_name);
                          setEditEmail(u.email);
                          setEditRole(u.role);
                          setEditStatus(u.status);
                        }}
                        className="rounded p-1.5 text-muted hover:text-ink hover:bg-surface focus-ring"
                        title="Edit user"
                      >
                        <UserCog size={14} />
                      </button>
                      <button
                        onClick={() => resetPassword(u)}
                        className="rounded p-1.5 text-muted hover:text-ink hover:bg-surface focus-ring"
                        title="Reset password"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(u)}
                        className="rounded p-1.5 text-muted hover:text-ink hover:bg-surface focus-ring"
                        title="Delete user"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit user">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Display name</p>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Email</p>
            <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Role</p>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Status</p>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="w-full rounded-lg border bg-base px-3 py-2 text-sm focus-ring"
              >
                <option value="active">active</option>
                <option value="suspended">suspended</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete user"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Delete <strong>{confirmDelete?.email}</strong> and all their data? This cannot be
            undone.
          </p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? <Spinner size={14} /> : null}
              Delete permanently
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
