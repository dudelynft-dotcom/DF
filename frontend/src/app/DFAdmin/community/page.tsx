"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;
const ADMIN_ADDRESS = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

type User = {
  id: number; xId: string; xHandle: string; xAvatar: string | null;
  wallet: string; tier: string; points: number;
  volume: { tradeUsd: number; mineUsd: number };
  createdAt: number; referrerId: number | null;
};
type TaskRow = {
  id: number; slug: string; kind: string; title: string;
  points: number; max_completions: number; active: number;
  sort_order: number; claim_count: number;
};
type Tweet = {
  id: number; user_id: number; tweet_id: string; url: string;
  day: string; status: string; reason: string | null; checked_at: number;
  x_handle: string; wallet: string; banned: number;
};
type Ref = {
  referrer_id: number; referrer_handle: string;
  referee_count: number; referee_total_points: number;
};
type LedgerResp = {
  user: { id: number; x_handle: string; wallet: string; banned: number; banned_at: number | null; banned_reason: string | null };
  total: number;
  entries: Array<{ id: number; delta: number; reason: string; ref_id: number | null; created_at: number; task_slug: string | null; task_title: string | null }>;
};

type Tab = "users" | "tasks" | "tweets" | "referrals";

/// Community moderation dashboard. Wallet-gated (admin EOA) + backend
/// bearer-token gated. All mutations append to the ledger; point
/// totals are recomputed on read. Ban is soft — zero'd + flagged.
export default function CommunityAdmin() {
  const { address, isConnected } = useAccount();
  const isAdmin = useMemo(
    () => !!address && !!ADMIN_ADDRESS && address.toLowerCase() === ADMIN_ADDRESS,
    [address],
  );

  const [adminToken, setAdminToken] = useState("");
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [tweets, setTweets] = useState<Tweet[] | null>(null);
  const [refs, setRefs] = useState<Ref[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const authed = async (path: string, init?: RequestInit) =>
    fetch(`${BACKEND}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
    });

  async function refresh() {
    if (!adminToken) return;
    setError(null);
    try {
      const [u, t, tw, r] = await Promise.all([
        authed("/community/admin/users"),
        authed("/community/admin/tasks"),
        authed("/community/admin/tweets?status=all&limit=300"),
        authed("/community/admin/referrals"),
      ]);
      if ([u, t, tw, r].some((x) => x.status === 401)) throw new Error("Wrong admin token.");
      const [uj, tj, twj, rj] = await Promise.all([u.json(), t.json(), tw.json(), r.json()]);
      setUsers(uj.users ?? []);
      setTasks(tj.tasks ?? []);
      setTweets(twj.tweets ?? []);
      setRefs(rj.referrers ?? []);
    } catch (e) { setError((e as Error).message); }
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

  if (!isConnected) return <div className="max-w-3xl mx-auto p-8">Connect the admin wallet to continue.</div>;
  if (!isAdmin)     return <div className="max-w-3xl mx-auto p-8 text-red-300">This wallet is not the admin.</div>;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Community admin</h1>
          <p className="mt-1 text-ink-muted text-sm">Season 1 moderation · ban, refund, audit.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="w-48 sm:w-64 px-3 py-2 rounded-md bg-bg-base border border-line text-sm"
          />
          <button onClick={refresh} disabled={!adminToken} className="px-3 py-2 rounded-md border border-line text-sm hover:border-gold-400/60">
            Refresh
          </button>
          <a
            href={`${BACKEND}/community/admin/export.csv`}
            onClick={(e) => {
              // Server requires Authorization header → can't do via <a>.
              // Fetch as blob and trigger download.
              e.preventDefault();
              authed("/community/admin/export.csv").then(async (r) => {
                if (!r.ok) { alert(`Export failed: ${r.status}`); return; }
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `community-snapshot-${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              });
            }}
            className="px-3 py-2 rounded-md bg-gold-400 text-bg-base text-sm font-medium hover:bg-gold-300"
          >
            Export CSV
          </a>
        </div>
      </div>
      {error && <div className="mt-4 text-sm text-red-300">{error}</div>}

      {/* Tabs */}
      <nav className="mt-6 flex gap-1 border-b border-line -mb-px overflow-x-auto">
        {(["users","tasks","tweets","referrals"] as Tab[]).map((t) => {
          const count = t === "users" ? users?.length : t === "tasks" ? tasks?.length : t === "tweets" ? tweets?.length : refs?.length;
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`
                px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap
                ${active ? "border-gold-400 text-ink" : "border-transparent text-ink-muted hover:text-ink"}
              `}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)} {count != null && <span className="text-ink-faint tabular">({count})</span>}
            </button>
          );
        })}
        {tab === "users" && (
          <button
            onClick={() => setBulkOpen(true)}
            className="ml-auto px-3 py-1.5 my-1 rounded-md border border-line text-xs hover:border-gold-400/60"
          >
            Bulk award…
          </button>
        )}
      </nav>

      {/* Tab content */}
      <div className="mt-6">
        {tab === "users"     && <UsersTab users={users} search={userSearch} setSearch={setUserSearch} onOpen={setDrawerUserId} />}
        {tab === "tasks"     && <TasksTab tasks={tasks} authed={authed} refresh={refresh} />}
        {tab === "tweets"    && <TweetsTab tweets={tweets} authed={authed} refresh={refresh} />}
        {tab === "referrals" && <ReferralsTab rows={refs} onOpenUser={setDrawerUserId} />}
      </div>

      {/* User drawer */}
      {drawerUserId != null && (
        <UserDrawer userId={drawerUserId} authed={authed} refresh={refresh} onClose={() => setDrawerUserId(null)} />
      )}

      {/* Bulk award modal */}
      {bulkOpen && (
        <BulkAward authed={authed} onClose={() => setBulkOpen(false)} onDone={refresh} />
      )}
    </div>
  );
}

// ==========================================================
//                         TABS
// ==========================================================

function UsersTab({ users, search, setSearch, onOpen }: {
  users: User[] | null;
  search: string; setSearch: (s: string) => void;
  onOpen: (id: number) => void;
}) {
  if (!users) return <Skeleton />;
  const q = search.toLowerCase().trim();
  const filtered = q
    ? users.filter((u) => u.xHandle.toLowerCase().includes(q) || u.wallet.toLowerCase().includes(q))
    : users;
  return (
    <>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search handle or wallet…"
        className="w-full mb-3 px-3 py-2 rounded-md bg-bg-base border border-line text-sm"
      />
      <div className="rounded-xl border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
            <tr className="border-b border-line">
              <Th>ID</Th><Th>Handle</Th><Th>Wallet</Th><Th>Tier</Th>
              <Th className="text-right">Points</Th>
              <Th className="text-right">Trade $</Th>
              <Th className="text-right">Mine $</Th>
              <Th className="text-right">Ref</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={`border-b border-line/40 hover:bg-white/[0.02] cursor-pointer`} onClick={() => onOpen(u.id)}>
                <Td className="text-ink-faint tabular">{u.id}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {u.xAvatar && (<img src={u.xAvatar} alt="" className="h-5 w-5 rounded-full" /> /* eslint-disable-line @next/next/no-img-element */)}
                    <span>@{u.xHandle}</span>
                  </div>
                </Td>
                <Td className="font-mono text-xs">{u.wallet}</Td>
                <Td className="text-xs">{u.tier}</Td>
                <Td className="text-right font-display tabular">{u.points.toLocaleString()}</Td>
                <Td className="text-right tabular">${u.volume.tradeUsd.toLocaleString()}</Td>
                <Td className="text-right tabular">${u.volume.mineUsd.toLocaleString()}</Td>
                <Td className="text-right text-ink-faint">{u.referrerId ?? "—"}</Td>
                <Td className="text-right text-gold-300 text-xs">Open →</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TasksTab({ tasks, authed, refresh }: {
  tasks: TaskRow[] | null;
  authed: (p: string, i?: RequestInit) => Promise<Response>;
  refresh: () => void;
}) {
  if (!tasks) return <Skeleton />;
  const onToggle = async (t: TaskRow) => {
    const r = await authed("/community/admin/task-active", {
      method: "POST", body: JSON.stringify({ taskId: t.id, active: !t.active }),
    });
    if (!r.ok) alert("Failed"); else refresh();
  };
  return (
    <div className="rounded-xl border border-line overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          <tr className="border-b border-line">
            <Th>Slug</Th><Th>Kind</Th><Th>Title</Th>
            <Th className="text-right">Pts</Th>
            <Th className="text-right">Max</Th>
            <Th className="text-right">Claims</Th>
            <Th className="text-right">Active</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-line/40">
              <Td className="font-mono text-xs">{t.slug}</Td>
              <Td className="text-xs">{t.kind}</Td>
              <Td>{t.title}</Td>
              <Td className="text-right tabular">{t.points}</Td>
              <Td className="text-right tabular">{t.max_completions === -1 ? "∞" : t.max_completions}</Td>
              <Td className="text-right tabular">{t.claim_count}</Td>
              <Td className="text-right"><span className={t.active ? "text-emerald-300" : "text-ink-faint"}>{t.active ? "on" : "off"}</span></Td>
              <Td className="text-right"><button onClick={() => onToggle(t)} className="text-xs text-gold-300 hover:text-gold-200">{t.active ? "Disable" : "Enable"}</button></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TweetsTab({ tweets, authed, refresh }: {
  tweets: Tweet[] | null;
  authed: (p: string, i?: RequestInit) => Promise<Response>;
  refresh: () => void;
}) {
  if (!tweets) return <Skeleton />;
  const onReject = async (t: Tweet) => {
    const reason = prompt(`Reject tweet ${t.tweet_id} by @${t.x_handle}? Reason:`);
    if (!reason) return;
    const r = await authed("/community/admin/tweet-reject", {
      method: "POST", body: JSON.stringify({ tweetId: t.id, reason }),
    });
    const j = await r.json();
    if (!r.ok) { alert(`Failed: ${j?.error}`); return; }
    alert(`Reversed ${j.reversed} points.`);
    refresh();
  };
  return (
    <div className="rounded-xl border border-line overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          <tr className="border-b border-line">
            <Th>Day</Th><Th>User</Th><Th>Tweet</Th><Th>Status</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {tweets.map((t) => (
            <tr key={t.id} className="border-b border-line/40">
              <Td className="text-xs font-mono">{t.day}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span>@{t.x_handle}</span>
                  {t.banned ? <span className="text-[10px] text-red-300">BANNED</span> : null}
                </div>
              </Td>
              <Td><a href={t.url} target="_blank" rel="noreferrer" className="text-gold-300 hover:text-gold-200 text-xs">Open ↗</a></Td>
              <Td>
                <span className={
                  t.status === "verified" ? "text-emerald-300 text-xs" :
                  t.status === "rejected" ? "text-red-300 text-xs" :
                  "text-ink-muted text-xs"
                }>{t.status}</span>
                {t.reason && <div className="text-[10px] text-ink-faint">{t.reason}</div>}
              </Td>
              <Td className="text-right">
                {t.status !== "rejected" && (
                  <button onClick={() => onReject(t)} className="text-xs text-red-300 hover:text-red-200">Reject + reverse</button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReferralsTab({ rows, onOpenUser }: { rows: Ref[] | null; onOpenUser: (id: number) => void }) {
  if (!rows) return <Skeleton />;
  return (
    <div className="rounded-xl border border-line overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          <tr className="border-b border-line">
            <Th>Referrer</Th>
            <Th className="text-right">Invitees</Th>
            <Th className="text-right">Invitee total points</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.referrer_id} className="border-b border-line/40">
              <Td>@{r.referrer_handle}</Td>
              <Td className="text-right tabular">{r.referee_count}</Td>
              <Td className="text-right tabular">{r.referee_total_points.toLocaleString()}</Td>
              <Td className="text-right"><button onClick={() => onOpenUser(r.referrer_id)} className="text-xs text-gold-300 hover:text-gold-200">Open →</button></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================================
//                      DRAWER + MODALS
// ==========================================================

function UserDrawer({ userId, authed, refresh, onClose }: {
  userId: number;
  authed: (p: string, i?: RequestInit) => Promise<Response>;
  refresh: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<LedgerResp | null>(null);

  async function load() {
    const r = await authed(`/community/admin/user/${userId}/ledger`);
    if (!r.ok) { alert("Load failed"); return; }
    setData(await r.json());
  }
  useEffect(() => { load(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function adjust() {
    const delta = parseInt(prompt("Signed delta (e.g. 100 or -50):") ?? "", 10);
    if (!Number.isInteger(delta) || delta === 0) return;
    const reason = prompt("Reason (shown in ledger):");
    if (!reason) return;
    const r = await authed("/community/admin/adjust", {
      method: "POST", body: JSON.stringify({ userId, delta, reason }),
    });
    const j = await r.json();
    if (!r.ok) { alert(`Failed: ${j?.error}`); return; }
    load(); refresh();
  }
  async function ban() {
    const reason = prompt("Ban reason (required):");
    if (!reason) return;
    const r = await authed("/community/admin/ban", {
      method: "POST", body: JSON.stringify({ userId, reason }),
    });
    const j = await r.json();
    if (!r.ok) { alert(`Failed: ${j?.error}`); return; }
    alert(`Banned. Removed ${j.pointsRemoved} points.`);
    load(); refresh();
  }
  async function unban() {
    if (!confirm("Un-ban this user? Their point total stays zero until you adjust.")) return;
    const r = await authed("/community/admin/unban", {
      method: "POST", body: JSON.stringify({ userId }),
    });
    if (!r.ok) { alert("Failed"); return; }
    load(); refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[520px] bg-bg-surface border-l border-line overflow-y-auto">
        <div className="sticky top-0 bg-bg-surface border-b border-line px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-faint">User {userId}</div>
            <div className="mt-1 font-display text-lg">
              {data ? <>@{data.user.x_handle}{data.user.banned ? <span className="ml-2 text-red-300 text-xs">BANNED</span> : null}</> : "…"}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">×</button>
        </div>

        {!data ? <div className="p-6"><Skeleton /></div> : (
          <div className="p-5 space-y-5">
            <div className="rounded-md border border-line p-4 bg-bg-base">
              <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint">Total points</div>
              <div className="font-display text-4xl tabular text-ink mt-1">{data.total.toLocaleString()}</div>
              <div className="mt-1 text-xs font-mono text-ink-faint break-all">{data.user.wallet}</div>
              {data.user.banned && data.user.banned_reason && (
                <div className="mt-3 text-xs text-red-300">
                  Banned at {new Date((data.user.banned_at ?? 0) * 1000).toLocaleString()}: {data.user.banned_reason}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={adjust} className="px-3 py-2 rounded-md border border-line text-sm hover:border-gold-400/60">Adjust points</button>
              {data.user.banned
                ? <button onClick={unban} className="px-3 py-2 rounded-md border border-emerald-500/40 text-emerald-300 text-sm hover:bg-emerald-500/10">Un-ban</button>
                : <button onClick={ban} className="px-3 py-2 rounded-md border border-red-500/40 text-red-300 text-sm hover:bg-red-500/10">Ban + zero</button>}
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-ink-faint mb-2">Ledger ({data.entries.length})</div>
              <ul className="divide-y divide-line border border-line rounded-md overflow-hidden">
                {data.entries.length === 0 ? (
                  <li className="p-4 text-sm text-ink-faint text-center">Empty.</li>
                ) : data.entries.map((e) => (
                  <li key={e.id} className="p-3 flex items-start gap-3">
                    <div className={`font-display tabular text-sm w-16 shrink-0 text-right ${e.delta > 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {e.delta > 0 ? "+" : ""}{e.delta}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">{e.task_title ?? e.reason}</div>
                      <div className="text-[11px] text-ink-faint">
                        {new Date(e.created_at * 1000).toLocaleString()} · {e.reason}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BulkAward({ authed, onClose, onDone }: {
  authed: (p: string, i?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [walletsText, setWalletsText] = useState("");
  const [delta, setDelta] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const wallets = walletsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const d = parseInt(delta, 10);
    if (wallets.length === 0) { alert("Paste at least one wallet."); return; }
    if (!Number.isInteger(d) || d === 0) { alert("Bad delta."); return; }
    if (!reason.trim()) { alert("Reason required."); return; }
    if (!confirm(`Award ${d} points to ${wallets.length} wallets?\nReason: ${reason}`)) return;

    setBusy(true);
    try {
      const r = await authed("/community/admin/bulk-award", {
        method: "POST", body: JSON.stringify({ wallets, delta: d, reason }),
      });
      const j = await r.json();
      if (!r.ok) { alert(`Failed: ${j?.error}`); return; }
      alert(`Matched ${j.matched}, skipped ${j.skipped}.`);
      onDone(); onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-xl rounded-xl border border-line bg-bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">Bulk award</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-ink-muted">Paste wallets separated by comma, space, or newline. Missing wallets are silently skipped.</p>
        <textarea
          value={walletsText}
          onChange={(e) => setWalletsText(e.target.value)}
          placeholder="0xabc...&#10;0xdef..."
          rows={6}
          className="w-full px-3 py-2 rounded-md bg-bg-base border border-line text-xs font-mono"
        />
        <div className="flex gap-3">
          <label className="flex-1">
            <div className="text-[10px] uppercase tracking-[0.2em] text-ink-faint mb-1">Delta</div>
            <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} className="w-full px-3 py-2 rounded-md bg-bg-base border border-line text-sm" />
          </label>
          <label className="flex-[2]">
            <div className="text-[10px] uppercase tracking-[0.2em] text-ink-faint mb-1">Reason</div>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. giveaway-2026-04-20" className="w-full px-3 py-2 rounded-md bg-bg-base border border-line text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-md bg-gold-400 text-bg-base text-sm font-medium disabled:opacity-60">
            {busy ? "…" : "Award"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================================
//                       small helpers
// ==========================================================

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left p-3 ${className ?? ""}`}>{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`p-3 ${className ?? ""}`}>{children}</td>;
}
function Skeleton() {
  return <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}</div>;
}
