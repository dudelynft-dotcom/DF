"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;
const ADMIN_ADDRESS = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

type User = {
  id: number;
  xHandle: string;
  xAvatar: string | null;
  wallet: string;
  tier: string;
  points: number;
  volume: { tradeUsd: number; mineUsd: number };
  createdAt: number;
  referrerId: number | null;
};
type TaskRow = {
  id: number;
  slug: string;
  kind: string;
  title: string;
  points: number;
  max_completions: number;
  active: number;
  sort_order: number;
  claim_count: number;
};

// Gatekeeping is wallet-based: only the wallet in NEXT_PUBLIC_ADMIN_ADDRESS
// sees real UI. The backend also checks Bearer ADMIN_TOKEN on each call,
// so a UI bypass still gets 401 from the API.
export default function CommunityAdmin() {
  const { address, isConnected } = useAccount();
  const isAdmin = useMemo(
    () => !!address && !!ADMIN_ADDRESS && address.toLowerCase() === ADMIN_ADDRESS,
    [address],
  );

  const [adminToken, setAdminToken] = useState("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BACKEND}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${adminToken}`,
      },
    });
  }

  async function refresh() {
    if (!adminToken) return;
    setLoading(true);
    setError(null);
    try {
      const [uRes, tRes] = await Promise.all([
        authedFetch("/community/admin/users"),
        authedFetch("/community/admin/tasks"),
      ]);
      if (uRes.status === 401 || tRes.status === 401) throw new Error("Wrong admin token.");
      if (!uRes.ok || !tRes.ok) throw new Error("Backend error.");
      const [u, t] = await Promise.all([uRes.json(), tRes.json()]);
      setUsers(u.users ?? []);
      setTasks(t.tasks ?? []);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  async function onAdjust(u: User) {
    const deltaStr = prompt(`Adjust points for @${u.xHandle}\nCurrent: ${u.points}\nEnter signed delta (e.g. 100 or -50):`);
    if (!deltaStr) return;
    const delta = parseInt(deltaStr, 10);
    if (!Number.isInteger(delta) || delta === 0) { alert("Bad delta"); return; }
    const reason = prompt("Reason (required, shown in the ledger):");
    if (!reason) return;
    try {
      const res = await authedFetch("/community/admin/adjust", {
        method: "POST",
        body: JSON.stringify({ userId: u.id, delta, reason }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "failed");
      alert(`Adjusted. New total: ${j.total}`);
      refresh();
    } catch (e: unknown) { alert(`Failed: ${(e as Error).message}`); }
  }

  async function onToggleTask(t: TaskRow) {
    try {
      const res = await authedFetch("/community/admin/task-active", {
        method: "POST",
        body: JSON.stringify({ taskId: t.id, active: !t.active }),
      });
      if (!res.ok) throw new Error("failed");
      refresh();
    } catch (e: unknown) { alert(`Failed: ${(e as Error).message}`); }
  }

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("df_admin_token") : null;
    if (saved) setAdminToken(saved);
  }, []);
  useEffect(() => {
    if (adminToken) {
      try { window.localStorage.setItem("df_admin_token", adminToken); } catch {}
      refresh();
    }
  }, [adminToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isConnected) {
    return <div className="max-w-3xl mx-auto p-8">Connect the admin wallet to continue.</div>;
  }
  if (!isAdmin) {
    return <div className="max-w-3xl mx-auto p-8 text-red-300">This wallet is not the admin.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-6 sm:p-10">
      <h1 className="font-display text-3xl tracking-tight">Community admin</h1>
      <p className="mt-2 text-ink-muted text-sm">
        Wallet gate passed. Paste the backend ADMIN_TOKEN once — cached in localStorage.
      </p>

      <div className="mt-6 flex items-center gap-2">
        <input
          type="password"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          className="flex-1 px-3 py-2 rounded-md bg-bg-base border border-line text-sm"
        />
        <button
          onClick={refresh}
          disabled={!adminToken || loading}
          className="px-4 py-2 rounded-md bg-gold-400 text-bg-base font-medium text-sm disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {error && <div className="mt-3 text-sm text-red-300">{error}</div>}

      {/* Users */}
      <h2 className="mt-10 font-display text-xl">Users {users && <span className="text-ink-faint text-sm">({users.length})</span>}</h2>
      <div className="mt-3 rounded-xl border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
            <tr className="border-b border-line">
              <th className="text-left  p-3">ID</th>
              <th className="text-left  p-3">Handle</th>
              <th className="text-left  p-3">Wallet</th>
              <th className="text-left  p-3">Tier</th>
              <th className="text-right p-3">Points</th>
              <th className="text-right p-3">Trade $</th>
              <th className="text-right p-3">Mine $</th>
              <th className="text-right p-3">Ref</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-line/40">
                <td className="p-3 text-ink-faint tabular">{u.id}</td>
                <td className="p-3">
                  <a href={`https://x.com/${u.xHandle}`} target="_blank" rel="noreferrer" className="hover:text-gold-300">@{u.xHandle}</a>
                </td>
                <td className="p-3 font-mono text-xs">{u.wallet}</td>
                <td className="p-3 text-xs">{u.tier}</td>
                <td className="p-3 text-right font-display tabular">{u.points.toLocaleString()}</td>
                <td className="p-3 text-right tabular">${u.volume.tradeUsd.toLocaleString()}</td>
                <td className="p-3 text-right tabular">${u.volume.mineUsd.toLocaleString()}</td>
                <td className="p-3 text-right text-ink-faint">{u.referrerId ?? "—"}</td>
                <td className="p-3 text-right">
                  <button onClick={() => onAdjust(u)} className="text-xs text-gold-300 hover:text-gold-200">Adjust</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tasks */}
      <h2 className="mt-10 font-display text-xl">Tasks {tasks && <span className="text-ink-faint text-sm">({tasks.length})</span>}</h2>
      <div className="mt-3 rounded-xl border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
            <tr className="border-b border-line">
              <th className="text-left  p-3">Slug</th>
              <th className="text-left  p-3">Kind</th>
              <th className="text-left  p-3">Title</th>
              <th className="text-right p-3">Pts</th>
              <th className="text-right p-3">Max</th>
              <th className="text-right p-3">Claims</th>
              <th className="text-right p-3">Active</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {tasks?.map((t) => (
              <tr key={t.id} className="border-b border-line/40">
                <td className="p-3 font-mono text-xs">{t.slug}</td>
                <td className="p-3 text-xs">{t.kind}</td>
                <td className="p-3">{t.title}</td>
                <td className="p-3 text-right tabular">{t.points}</td>
                <td className="p-3 text-right tabular">{t.max_completions === -1 ? "∞" : t.max_completions}</td>
                <td className="p-3 text-right tabular">{t.claim_count}</td>
                <td className="p-3 text-right">
                  <span className={t.active ? "text-emerald-300" : "text-ink-faint"}>
                    {t.active ? "on" : "off"}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <button onClick={() => onToggleTask(t)} className="text-xs text-gold-300 hover:text-gold-200">
                    {t.active ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
