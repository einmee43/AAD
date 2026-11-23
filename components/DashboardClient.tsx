'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Activity,
  Bot,
  Clock,
  Copy,
  Check,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Trophy,
  TrendingUp,
} from 'lucide-react';

interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
}

interface Account {
  id: string;
  bot_name: string;
  roblox_username?: string;
  status: string;
  live_status: 'farming' | 'lobby' | 'offline';
  current_mode?: string;
  current_map?: string;
  current_wave?: string;
  last_heartbeat: string;
}

interface RewardItem {
  name: string;
  amount: number;
  category?: string;
  rarity?: string;
}

interface RunLog {
  id: string;
  bot_name: string;
  mode: string;
  map_name: string;
  result: 'Win' | 'Lose';
  duration_sec: number;
  rewards: RewardItem[];
  created_at: string;
}

interface Snapshot {
  account_id: string;
  currencies: Record<string, number>;
  items: RewardItem[];
  updated_at: string;
}

interface ApiKeyRow {
  id: string;
  label: string;
  api_key: string;
  discord_webhook_url: string | null;
  alert_on_rare: boolean;
  last_used_at: string | null;
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function timeAgo(iso: string) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function rarityBadgeClass(rarity?: string, name?: string) {
  const r = (rarity || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (r === 'secret' || n.includes('secret'))
    return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  if (r === 'mythic' || n.includes('mythic') || n.includes('portal') || n.includes('gold chest'))
    return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (r === 'legendary' || n.includes('reroll') || n.includes('star'))
    return 'bg-purple-500/15 text-purple-300 border-purple-500/40';
  return 'bg-zinc-800 text-zinc-200 border-zinc-700';
}

export default function DashboardClient({ user }: { user: UserInfo }) {
  const [tab, setTab] = useState<'overview' | 'keys'>('overview');
  const [hours, setHours] = useState(24);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [botFilter, setBotFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');

  // Key form state
  const [newLabel, setNewLabel] = useState('MuMu Farm');
  const [newWebhook, setNewWebhook] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?hours=${hours}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        setLogs(data.run_logs || []);
        setSnapshots(data.snapshots || []);
      }
    } finally {
      setLoading(false);
    }
  }, [hours]);

  const fetchKeys = useCallback(async () => {
    const res = await fetch('/api/keys');
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys || []);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchKeys();
    const timer = setInterval(fetchDashboard, 15000);
    return () => clearInterval(timer);
  }, [fetchDashboard, fetchKeys]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError(null);
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel, discord_webhook_url: newWebhook || null }),
    });
    if (res.ok) {
      setNewWebhook('');
      fetchKeys();
    } else {
      const data = await res.json().catch(() => ({}));
      setKeyError(data.error || `Failed (${res.status})`);
    }
  };

  const handleDeleteKey = async (id: string) => {
    await fetch(`/api/keys?id=${id}`, { method: 'DELETE' });
    fetchKeys();
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (botFilter !== 'ALL' && log.bot_name !== botFilter) return false;
      if (resultFilter !== 'ALL' && log.result !== resultFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const inMap = log.map_name.toLowerCase().includes(q) || log.mode.toLowerCase().includes(q);
        const inRewards = (log.rewards || []).some((r) => r.name.toLowerCase().includes(q));
        return inMap || inRewards;
      }
      return true;
    });
  }, [logs, botFilter, resultFilter, search]);

  // Aggregated analytics
  const analytics = useMemo(() => {
    const totalRuns = logs.length;
    const wins = logs.filter((l) => l.result === 'Win').length;
    const winrate = totalRuns > 0 ? Math.round((wins / totalRuns) * 100) : 0;
    const avgSec =
      totalRuns > 0
        ? Math.round(logs.reduce((acc, l) => acc + (l.duration_sec || 0), 0) / totalRuns)
        : 0;

    const lootTotals: Record<string, number> = {};
    for (const log of logs) {
      for (const r of log.rewards || []) {
        lootTotals[r.name] = (lootTotals[r.name] || 0) + (Number(r.amount) || 0);
      }
    }

    const totalHours = Math.max(1 / 60, hours);
    const gemsTotal = lootTotals['Gems'] || 0;
    const gemsPerHr = Math.round(gemsTotal / totalHours);

    const onlineCount = accounts.filter((a) => a.live_status !== 'offline').length;

    return { totalRuns, winrate, avgSec, lootTotals, gemsPerHr, onlineCount };
  }, [logs, accounts, hours]);

  const snapshotMap = useMemo(() => {
    const map = new Map<string, Snapshot>();
    snapshots.forEach((s) => map.set(s.account_id, s));
    return map;
  }, [snapshots]);

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm sm:text-base leading-tight">AA Drop Tracker</h1>
              <p className="text-[11px] text-zinc-400 hidden sm:block">
                Supabase + Discord Real-time Monitor
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 text-xs">
              <button
                onClick={() => setTab('overview')}
                className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                  tab === 'overview' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setTab('keys')}
                className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  tab === 'keys' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                API Keys
              </button>
            </div>

            <div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
              {user.avatar && (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-7 h-7 rounded-full border border-zinc-700"
                />
              )}
              <span className="text-xs font-medium hidden md:inline">{user.name}</span>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {tab === 'overview' ? (
          <>
            {/* Controls & Timeframe */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {[1, 24, 168].map((h) => (
                  <button
                    key={h}
                    onClick={() => setHours(h)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                      hours === h
                        ? 'bg-zinc-800 border-zinc-600 text-white'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {h === 1 ? 'Last 1h' : h === 24 ? 'Last 24h' : 'Last 7d'}
                  </button>
                ))}
              </div>
              <button
                onClick={fetchDashboard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Active Bots</span>
                  <Bot className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold">
                  {analytics.onlineCount}{' '}
                  <span className="text-sm font-normal text-zinc-500">/ {accounts.length}</span>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Runs &amp; Winrate</span>
                  <Trophy className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold">
                  {analytics.totalRuns}{' '}
                  <span className="text-sm font-normal text-emerald-400">
                    ({analytics.winrate}%)
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Avg Clear Time</span>
                  <Clock className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold">{formatDuration(analytics.avgSec)}</div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Gems / Hour</span>
                  <TrendingUp className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl font-bold">{analytics.gemsPerHr.toLocaleString()}</div>
              </div>
            </div>

            {/* Bot Monitor Grid */}
            <section>
              <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                Bot Status &amp; Inventory
              </h2>
              {accounts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400">
                  No bots connected yet. Go to <strong>API Keys</strong> tab to generate a key and
                  run the Lua tracker in MuMu.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {accounts.map((acc) => {
                    const snap = snapshotMap.get(acc.id);
                    const dotColor =
                      acc.live_status === 'farming'
                        ? 'bg-emerald-400'
                        : acc.live_status === 'lobby'
                        ? 'bg-amber-400'
                        : 'bg-rose-500';
                    return (
                      <div
                        key={acc.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                              <h3 className="font-semibold text-sm">{acc.bot_name}</h3>
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5">
                              {acc.roblox_username || 'Roblox Account'}
                            </p>
                          </div>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 capitalize">
                            {acc.live_status}
                          </span>
                        </div>

                        <div className="text-xs text-zinc-300 bg-zinc-950/60 rounded-lg p-2.5 border border-zinc-800/80 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Mode / Map:</span>
                            <span className="font-medium">
                              {acc.current_mode || '-'} {acc.current_map ? `• ${acc.current_map}` : ''}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Wave / Floor:</span>
                            <span>{acc.current_wave || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Heartbeat:</span>
                            <span>{timeAgo(acc.last_heartbeat)}</span>
                          </div>
                        </div>

                        {snap && Object.keys(snap.currencies || {}).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {Object.entries(snap.currencies).map(([k, v]) => (
                              <span
                                key={k}
                                className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300"
                              >
                                {k}: {Number(v).toLocaleString()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Total Loot Summary */}
            {Object.keys(analytics.lootTotals).length > 0 && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                  Total Loot ({hours === 1 ? '1h' : hours === 24 ? '24h' : '7d'})
                </h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(analytics.lootTotals)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, amount]) => (
                      <span
                        key={name}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${rarityBadgeClass(
                          undefined,
                          name
                        )}`}
                      >
                        {name}: <strong className="ml-1">+{amount.toLocaleString()}</strong>
                      </span>
                    ))}
                </div>
              </section>
            )}

            {/* Run History Table */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Run &amp; Drop History</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filter map or item..."
                      className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-zinc-950 border border-zinc-800 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <select
                    value={botFilter}
                    onChange={(e) => setBotFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-950 border border-zinc-800"
                  >
                    <option value="ALL">All Bots</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.bot_name}>
                        {a.bot_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={resultFilter}
                    onChange={(e) => setResultFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-950 border border-zinc-800"
                  >
                    <option value="ALL">All Results</option>
                    <option value="Win">Win</option>
                    <option value="Lose">Lose</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Bot</th>
                      <th className="px-4 py-3 font-medium">Mode / Map</th>
                      <th className="px-4 py-3 font-medium">Result</th>
                      <th className="px-4 py-3 font-medium">Duration</th>
                      <th className="px-4 py-3 font-medium">Rewards</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                          No runs recorded for this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-800/30">
                          <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                            {timeAgo(log.created_at)}
                          </td>
                          <td className="px-4 py-3 font-medium whitespace-nowrap">{log.bot_name}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-zinc-400">{log.mode}</span> • {log.map_name}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                log.result === 'Win'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-rose-500/15 text-rose-400'
                              }`}
                            >
                              {log.result}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                            {formatDuration(log.duration_sec)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {(log.rewards || []).map((r, idx) => (
                                <span
                                  key={idx}
                                  className={`px-2 py-0.5 rounded border text-[11px] ${rarityBadgeClass(
                                    r.rarity,
                                    r.name
                                  )}`}
                                >
                                  {r.name} x{r.amount}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          /* API Keys & Setup Tab */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-5">
              <div>
                <h2 className="text-base font-semibold">Generate New API Key</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Paste your key into <code>aa_tracker.lua</code> to stream runs directly to your
                  Discord account dashboard.
                </p>
              </div>

              <form onSubmit={handleCreateKey} className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Key Label</label>
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. MuMu Instance 1"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Discord Webhook URL (Optional — for Rare Drop Alerts)
                  </label>
                  <input
                    value={newWebhook}
                    onChange={(e) => setNewWebhook(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Create API Key
                </button>
                {keyError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {keyError}
                  </div>
                )}
              </form>

              <div className="space-y-2.5 pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Your Keys ({keys.length})
                </h3>
                {keys.map((k) => (
                  <div
                    key={k.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{k.label}</div>
                      <div className="text-xs font-mono text-indigo-300 truncate">{k.api_key}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Last used: {k.last_used_at ? timeAgo(k.last_used_at) : 'Never'}
                        {k.discord_webhook_url ? ' • Discord Alert ON' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => copyText(k.id, k.api_key)}
                        className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 cursor-pointer"
                        title="Copy API Key"
                      >
                        {copiedId === k.id ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteKey(k.id)}
                        className="p-2 rounded-lg bg-zinc-900 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                        title="Delete Key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <h2 className="text-base font-semibold">Lua Client Configuration</h2>
              <p className="text-xs text-zinc-400">
                Put these settings at the top of <code>aa_tracker.lua</code> in your executor:
              </p>
              <pre className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 text-xs font-mono text-emerald-300 overflow-x-auto">
{`getgenv().AA_TRACKER_CONFIG = {
    API_URL  = "${originUrl}/api/ingest",
    API_KEY  = "${keys[0]?.api_key || 'PASTE_YOUR_API_KEY_HERE'}",
    BOT_NAME = "Bot 1" -- เปลี่ยนเป็น Bot 2 สำหรับจอที่ 2
}`}
              </pre>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
