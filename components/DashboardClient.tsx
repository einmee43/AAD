'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import KageBackdrop from '@/components/KageBackdrop';
import {
  Activity,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Trophy,
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
  roblox_user_id?: number;
  status: string;
  live_status: 'farming' | 'lobby' | 'offline';
  current_mode?: string;
  current_map?: string;
  current_wave?: string;
  last_heartbeat: string;
  started_at?: string;
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

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} ชม. ${m} น.`;
  return `${m}m ${s}s`;
}

function timeAgo(iso: string) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff} วิ ที่แล้ว`;
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  return `${Math.floor(diff / 3600)} ชม. ที่แล้ว`;
}

function getItemIcon(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('dawn')) return '/icons/dawn_coin.jpg';
  if (n.includes('gem')) return '/icons/gems.png';
  if (n.includes('gold') || n.includes('coin') || n.includes('yen')) return '/icons/gold.png';
  if (n.includes('pearl')) return '/icons/pearls.png';
  if (n.includes('perfect') && n.includes('cube')) return '/icons/perfect_stat_cube.png';
  if (n.includes('cube')) return '/icons/stat_cube.png';
  if (n.includes('remnant')) return '/icons/star_remnant.png';
  if (n.includes('portal') && (n.includes('secret') || n.includes('explosion') || n.includes('demon')))
    return '/icons/portal_secret.png';
  if (n.includes('portal')) return '/icons/portal_mythic.png';
  return null;
}

function getRarityStyle(rarity?: string, name?: string) {
  const r = (rarity || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (r === 'secret' || n.includes('secret') || n.includes('explosion') || n.includes('demon')) {
    return {
      label: 'Secret',
      card: 'border-rose-500/60 bg-gradient-to-b from-rose-950/50 to-[#140d1d] shadow-[0_0_20px_rgba(244,63,94,0.18)]',
      text: 'text-rose-400',
      badge: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    };
  }
  if (r === 'legendary' || n.includes('reroll') || n.includes('star')) {
    return {
      label: 'Legendary',
      card: 'border-amber-500/50 bg-gradient-to-b from-amber-950/35 to-[#140d1d] shadow-[0_0_16px_rgba(245,158,11,0.12)]',
      text: 'text-amber-400',
      badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    };
  }
  return {
    label: 'Mythic',
    card: 'border-purple-500/50 bg-gradient-to-b from-purple-950/45 to-[#130e24] shadow-[0_0_18px_rgba(168,85,247,0.16)]',
    text: 'text-purple-400',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
  };
}

export default function DashboardClient({ user }: { user: UserInfo }) {
  const [tab, setTab] = useState<'profile' | 'history' | 'keys'>('profile');
  const [hours, setHours] = useState(24);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [avatarCache, setAvatarCache] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [rarityFilter, setRarityFilter] = useState<'ALL' | 'Secret' | 'Mythic' | 'Legendary'>('ALL');
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

  // Keep selectedIdx valid
  const activeAccount = accounts[selectedIdx] || accounts[0] || null;

  // Fetch Roblox Avatar PNG for active account
  useEffect(() => {
    const uid = activeAccount?.roblox_user_id;
    if (!uid || avatarCache[uid]) return;
    fetch(`/api/avatar?userId=${uid}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.imageUrl) {
          setAvatarCache((prev) => ({ ...prev, [uid]: d.imageUrl }));
        }
      })
      .catch(() => {});
  }, [activeAccount?.roblox_user_id, avatarCache]);

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

  const handleClearLogs = async () => {
    if (!confirm('ลบประวัติ Run Logs ทั้งหมดใช่ไหมครับ?')) return;
    const res = await fetch('/api/dashboard?action=clear_logs', { method: 'DELETE' });
    if (res.ok) fetchDashboard();
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const snapshotMap = useMemo(() => {
    const map = new Map<string, Snapshot>();
    snapshots.forEach((s) => map.set(s.account_id, s));
    return map;
  }, [snapshots]);

  const activeSnap = activeAccount ? snapshotMap.get(activeAccount.id) : undefined;
  const activeCurrencies = activeSnap?.currencies || {};
  const rawLevel = activeCurrencies['_level'] || 0;
  const rawXp = activeCurrencies['_xp'] || 0;
  const rawMaxXp = activeCurrencies['_max_xp'] || 0;
  const isPlaceholderLvl = rawLevel >= 999 || rawMaxXp === 999999;
  const level = isPlaceholderLvl ? 0 : rawLevel;
  const xp = isPlaceholderLvl ? 0 : rawXp;
  const maxXp = isPlaceholderLvl ? 0 : rawMaxXp;
  const xpPct =
    level > 0 && maxXp > 0
      ? Math.min(100, Math.round((xp / maxXp) * 1000) / 10)
      : level > 0
      ? 100
      : 0;

  // Filtered inventory items for active bot
  const activeItems = useMemo(() => {
    const list = activeSnap?.items || [];
    return list.filter((it) => {
      const style = getRarityStyle(it.rarity, it.name);
      if (rarityFilter !== 'ALL' && style.label !== rarityFilter) return false;
      if (search.trim() && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [activeSnap?.items, rarityFilter, search]);

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

  // Analytics
  const analytics = useMemo(() => {
    const totalRuns = logs.length;
    const wins = logs.filter((l) => l.result === 'Win').length;
    const winrate = totalRuns > 0 ? Math.round((wins / totalRuns) * 100) : 0;
    const totalSec = logs.reduce((acc, l) => acc + (l.duration_sec || 0), 0);
    const avgSec = totalRuns > 0 ? Math.round(totalSec / totalRuns) : 0;

    const lootTotals: Record<string, number> = {};
    for (const log of logs) {
      for (const r of log.rewards || []) {
        lootTotals[r.name] = (lootTotals[r.name] || 0) + (Number(r.amount) || 0);
      }
    }

    const totalHours = Math.max(1 / 60, hours);
    const gemsPerHr = Math.round((lootTotals['Gems'] || 0) / totalHours);
    const pearlsPerHr = Math.round((lootTotals['Summer Pearls'] || 0) / totalHours);
    const onlineCount = accounts.filter((a) => a.live_status !== 'offline').length;

    return { totalRuns, winrate, totalSec, avgSec, lootTotals, gemsPerHr, pearlsPerHr, onlineCount };
  }, [logs, accounts, hours]);

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://aad-hazel.vercel.app';

  const isKage = true;

  return (
    <div className="min-h-screen bg-[#070506] text-zinc-100 relative overflow-x-hidden">
      {/* Kage Three.js + Blurred Artwork Backdrop */}
      <KageBackdrop />

      {/* Top Navbar */}
      <header className="sticky top-0 z-20 border-b border-red-500/25 bg-[#0c0709]/85 backdrop-blur-xl">
        <div className="max-w-[1520px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl border bg-red-600/20 border-red-500/45 text-red-400 shadow-[0_0_15px_rgba(220,38,38,0.35)] flex items-center justify-center">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm sm:text-base tracking-wide bg-gradient-to-r from-white to-red-400 bg-clip-text text-transparent">
                AA DROP TRACKER
              </h1>
              <p className="text-[11px] hidden sm:block text-red-300/60">
                Anime Adventures Command Center
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <nav className="aa-seg" aria-label="เมนูหลัก">
              <button
                onClick={() => setTab('profile')}
                aria-current={tab === 'profile' ? 'page' : undefined}
              >
                โปรไฟล์ &amp; คลัง
              </button>
              <button
                onClick={() => setTab('history')}
                aria-current={tab === 'history' ? 'page' : undefined}
              >
                ประวัติดรอป
              </button>
              <button
                onClick={() => setTab('keys')}
                aria-current={tab === 'keys' ? 'page' : undefined}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">API Keys</span>
              </button>
            </nav>

            <button
              onClick={fetchDashboard}
              title="Refresh"
              className="aa-btn aa-btn--icon"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <div className="flex items-center gap-2 pl-2 border-l border-red-500/20">
              {user.avatar && (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-7 h-7 rounded-full border border-red-400/50"
                />
              )}
              <span className="text-xs font-medium hidden md:inline text-purple-100">
                {user.name}
              </span>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-purple-500/20 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-[1520px] mx-auto px-4 sm:px-8 py-6 space-y-6">
        {tab === 'profile' && (
          <>
            {accounts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-purple-500/30 bg-[#120e24]/60 p-10 text-center space-y-3">
                <Bot className="w-10 h-10 text-purple-400 mx-auto" />
                <h2 className="text-base font-semibold">ยังไม่มีบอทเชื่อมต่อเข้ามา</h2>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  ไปที่แท็บ <strong>API Keys</strong> เพื่อคัดลอกโค้ด 6 บรรทัดไปรันใน MuMu แล้วการ์ดโปรไฟล์ตัวละครจะเด้งขึ้นมาอัตโนมัติครับ
                </p>
              </div>
            ) : (
              <div key={activeAccount.id} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-slide">
                {/* LEFT COLUMN: Profile Card */}
                <section
                  className={`lg:col-span-4 rounded-2xl border p-5 relative overflow-hidden transition-all duration-300 ${
                    isKage
                      ? 'border-red-500/35 bg-gradient-to-b from-[#1a0b0f]/92 via-[#11080a]/92 to-[#0b0607]/95 shadow-[0_0_40px_rgba(220,38,38,0.16)]'
                      : 'border-purple-500/35 bg-gradient-to-b from-[#171130]/95 via-[#110c24]/95 to-[#0d091c]/95 shadow-[0_0_40px_rgba(139,92,246,0.15)]'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-sm font-bold tracking-wider uppercase text-white flex items-center gap-2">
                        {isKage ? (
                          <Flame className="w-4 h-4 text-red-400" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-purple-400" />
                        )}
                        {activeAccount.bot_name}
                      </div>
                      <div
                        className={`text-[11px] ${
                          isKage ? 'text-red-300/60' : 'text-purple-300/60'
                        }`}
                      >
                        {activeAccount.roblox_username || 'Roblox Player'}
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                        activeAccount.live_status === 'farming'
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : activeAccount.live_status === 'lobby'
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          activeAccount.live_status === 'farming'
                            ? 'bg-emerald-400 animate-pulse'
                            : activeAccount.live_status === 'lobby'
                            ? 'bg-amber-400'
                            : 'bg-rose-500'
                        }`}
                      />
                      {activeAccount.live_status === 'farming'
                        ? 'ออนไลน์'
                        : activeAccount.live_status === 'lobby'
                        ? 'Lobby'
                        : 'ไม่เชื่อมต่อ'}
                    </span>
                  </div>

                  {/* Avatar on Glowing Pedestal */}
                  <div className="relative flex flex-col items-center justify-center py-4 my-1">
                    {/* Starburst Aura */}
                    <div
                      className={`absolute w-48 h-48 rounded-full blur-2xl pointer-events-none ${
                        isKage ? 'bg-red-600/20' : 'bg-purple-600/20'
                      }`}
                    />
                    <div className="relative z-10 h-48 flex items-center justify-center animate-float-slow">
                      {activeAccount.roblox_user_id && avatarCache[activeAccount.roblox_user_id] ? (
                        <img
                          src={avatarCache[activeAccount.roblox_user_id]}
                          alt={activeAccount.roblox_username || activeAccount.bot_name}
                          className="h-48 w-48 object-contain drop-shadow-[0_0_24px_rgba(220,38,38,0.55)]"
                        />
                      ) : (
                        <div className="w-28 h-28 rounded-full border border-red-500/40 bg-red-950/50 flex items-center justify-center text-red-300">
                          <Bot className="w-12 h-12" />
                        </div>
                      )}
                    </div>
                    {/* Glowing Pedestal Ring */}
                    <div className="w-44 h-5 -mt-3 rounded-[100%] border-2 border-red-500/70 bg-red-500/20 animate-pedestal" />
                  </div>

                  {/* Bot Switcher + Level Badge */}
                  <div className="flex items-center justify-center gap-3 my-3">
                    <button
                      onClick={() =>
                        setSelectedIdx((i) => (i - 1 + accounts.length) % accounts.length)
                      }
                      disabled={accounts.length <= 1}
                      className="aa-btn aa-btn--icon"
                      aria-label="บอทก่อนหน้า"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <div className="aa-btn aa-btn--level">
                      {level > 0 ? `LV. ${level}` : activeAccount.bot_name}
                    </div>

                    <button
                      onClick={() => setSelectedIdx((i) => (i + 1) % accounts.length)}
                      disabled={accounts.length <= 1}
                      className="aa-btn aa-btn--icon"
                      aria-label="บอทถัดไป"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* XP Progress Bar */}
                  <div className="space-y-1.5 mb-5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-400">XP Progress</span>
                      <span
                        className={`font-semibold ${isKage ? 'text-red-300' : 'text-purple-300'}`}
                      >
                        {level > 0 ? `${xpPct}%` : activeAccount.current_wave || 'Ready'}
                      </span>
                    </div>
                    <div
                      className={`h-2 rounded-full border overflow-hidden ${
                        isKage
                          ? 'bg-[#0c0608] border-red-500/25'
                          : 'bg-[#090714] border-purple-500/25'
                      }`}
                    >
                      <div
                        className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${
                          isKage
                            ? 'from-red-600 via-rose-500 to-amber-400'
                            : 'from-purple-500 via-fuchsia-500 to-indigo-400'
                        }`}
                        style={{ width: `${level > 0 ? xpPct : 100}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-zinc-400 flex justify-between">
                      <span>
                        {activeAccount.current_mode || 'Lobby'}{' '}
                        {activeAccount.current_map ? `• ${activeAccount.current_map}` : ''}
                      </span>
                      {maxXp > 0 && (
                        <span>
                          {xp.toLocaleString()} / {maxXp.toLocaleString()} XP
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Currency & Stats Grid */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl border border-red-500/25 bg-[#12070a]/90 p-3.5 flex items-center gap-3">
                      <img src="/icons/gems.png" alt="Gems" className="w-9 h-9 object-contain shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] text-zinc-400">เพชร (Gems)</div>
                        <div className="text-base font-bold text-white truncate">
                          {formatCompact(Number(activeCurrencies['Gems'] || 0))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-red-500/25 bg-[#12070a]/90 p-3.5 flex items-center gap-3">
                      <img
                        src="/icons/pearls.png"
                        alt="Summer Pearls"
                        className="w-9 h-9 object-contain shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-[11px] text-zinc-400">SummerPearls</div>
                        <div className="text-base font-bold text-pink-200 truncate">
                          {formatCompact(Number(activeCurrencies['Summer Pearls'] || 0))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-red-500/25 bg-[#12070a]/90 p-3.5 flex items-center gap-3">
                      <img src="/icons/gold.png" alt="Gold" className="w-9 h-9 object-contain shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] text-zinc-400">ทอง (Gold)</div>
                        <div className="text-base font-bold text-amber-200 truncate">
                          {Number(activeCurrencies['Gold'] || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-amber-500/35 bg-[#160a0d]/90 p-3.5 flex items-center gap-3">
                      <img
                        src="/icons/dawn_coin.jpg"
                        alt="Dawn Coins"
                        className="w-9 h-9 rounded-full object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-[11px] text-amber-300/80">Dawn Coins</div>
                        <div className="text-base font-bold text-amber-300 truncate">
                          {Number(activeCurrencies['Dawn Coins'] || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="col-span-2 rounded-xl border border-red-500/25 bg-[#12070a]/90 p-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-300 shrink-0">
                          <Clock className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] text-zinc-400">เวลาแมตช์ที่บันทึก</div>
                          <div className="text-base font-bold text-white">
                            {formatDuration(analytics.totalSec)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-zinc-400">Winrate</div>
                        <div className="text-sm font-bold text-emerald-400">
                          {analytics.winrate}% ({analytics.totalRuns} รอบ)
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="pt-3 border-t border-red-500/20 flex items-center justify-between text-xs text-zinc-400">
                    <span>อัปเดต: {timeAgo(activeAccount.last_heartbeat)}</span>
                    <span className="text-red-300 font-medium">
                      บอท {selectedIdx + 1} / {accounts.length}
                    </span>
                  </div>
                </section>

                {/* RIGHT COLUMN: Live KPIs + Inventory Grid + Recent Runs */}
                <section className="lg:col-span-8 space-y-5">
                  {/* Live KPI Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                        <span>บอทออนไลน์</span>
                        <Bot className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="text-xl font-bold text-white">
                        {analytics.onlineCount}{' '}
                        <span className="text-xs font-normal text-zinc-500">/ {accounts.length}</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                        <span>Gems / ชม.</span>
                        <img src="/icons/gems.png" alt="Gems" className="w-4 h-4 object-contain" />
                      </div>
                      <div className="text-xl font-bold text-white">
                        {analytics.gemsPerHr.toLocaleString()}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                        <span>Pearls / ชม.</span>
                        <img src="/icons/pearls.png" alt="Pearls" className="w-4 h-4 object-contain" />
                      </div>
                      <div className="text-xl font-bold text-pink-200">
                        {analytics.pearlsPerHr.toLocaleString()}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                        <span>เฉลี่ยต่อรอบ</span>
                        <Clock className="w-4 h-4 text-red-400" />
                      </div>
                      <div className="text-xl font-bold text-white">
                        {formatDuration(analytics.avgSec)}
                      </div>
                    </div>
                  </div>

                  {/* Top Rarity Tabs & Filter */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-3">
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="กรองตามความหายาก">
                      {(['ALL', 'Secret', 'Mythic', 'Legendary'] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRarityFilter(r)}
                          data-rarity={r === 'ALL' ? undefined : r.toLowerCase()}
                          aria-pressed={rarityFilter === r}
                          className="aa-chip"
                        >
                          {r === 'ALL' ? 'ทั้งหมด' : r}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-red-300/60 absolute left-3 top-2.5" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="ค้นหาพอร์ทัล / ไอเทม..."
                        className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#090506] border border-red-500/25 focus:outline-none focus:border-red-400 text-zinc-100"
                      />
                    </div>
                  </div>

                  {/* Inventory Grid */}
                  {activeItems.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                      {activeItems.map((item, idx) => {
                        const style = getRarityStyle(item.rarity, item.name);
                        const icon = getItemIcon(item.name);
                        return (
                          <div
                            key={`${item.name}-${idx}`}
                            className={`rounded-2xl border p-4 flex flex-col justify-between min-h-[156px] transition hover:scale-[1.01] ${style.card}`}
                          >
                            <div className="flex justify-end">
                              <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-black/40 border border-white/10 text-zinc-100">
                                x{item.amount}
                              </span>
                            </div>

                            <div className="flex items-center justify-center py-2">
                              {icon ? (
                                <img
                                  src={icon}
                                  alt={item.name}
                                  className="w-16 h-16 object-contain drop-shadow-[0_0_12px_rgba(220,38,38,0.4)]"
                                />
                              ) : (
                                <Sparkles className={`w-10 h-10 ${style.text}`} />
                              )}
                            </div>

                            <div>
                              <div className="text-xs font-bold text-white truncate">
                                {item.name}
                              </div>
                              <div className={`text-[11px] font-medium ${style.text}`}>
                                {style.label}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/70 p-5 text-center space-y-1">
                      <p className="text-xs text-zinc-300">
                        ยังไม่มีรายการ Portal / Stat Cube จากบอทนี้ (ระบบจะซิงค์เมื่อเปิดกระเป๋า Items หรือจบ Dungeon Room)
                      </p>
                    </div>
                  )}

                  {/* Quick Recent Runs Preview */}
                  <div className="rounded-2xl border border-purple-500/25 bg-[#120e24]/80 overflow-hidden">
                    <div className="px-4 py-3 border-b border-purple-500/20 flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-purple-200 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-purple-400" />
                        รอบล่าสุด ({logs.slice(0, 5).length})
                      </h2>
                      <button
                        onClick={() => setTab('history')}
                        className="text-xs text-purple-300 hover:text-white cursor-pointer"
                      >
                        ดูทั้งหมด →
                      </button>
                    </div>
                    <div className="divide-y divide-purple-500/10">
                      {logs.slice(0, 5).map((log) => (
                        <div
                          key={log.id}
                          className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                log.result === 'Win'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {log.result}
                            </span>
                            <span className="font-medium text-white">{log.bot_name}</span>
                            <span className="text-zinc-400">
                              {log.mode} • {log.map_name}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(log.rewards || []).map((r, i) => {
                              const icon = getItemIcon(r.name);
                              const st = getRarityStyle(r.rarity, r.name);
                              return (
                                <span
                                  key={i}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${st.badge}`}
                                >
                                  {icon && <img src={icon} alt={r.name} className="w-3.5 h-3.5" />}
                                  +{r.amount.toLocaleString()}
                                </span>
                              );
                            })}
                            <span className="text-zinc-500 ml-1">{timeAgo(log.created_at)}</span>
                          </div>
                        </div>
                      ))}
                      {logs.length === 0 && (
                        <div className="p-6 text-center text-xs text-zinc-500">
                          ยังไม่มีประวัติการจบรอบ
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <div className="space-y-5 animate-fade-slide">
            {/* Timeframe + Clear */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {[1, 24, 168].map((h) => (
                  <button
                    key={h}
                    onClick={() => setHours(h)}
                    aria-pressed={hours === h}
                    className="aa-chip"
                  >
                    {h === 1 ? '1 ชม. ล่าสุด' : h === 24 ? '24 ชม. ล่าสุด' : '7 วันล่าสุด'}
                  </button>
                ))}
              </div>
              <button
                onClick={handleClearLogs}
                className="aa-btn aa-btn--danger"
              >
                <Trash2 className="w-3.5 h-3.5" />
                ล้างประวัติ
              </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>บอทออนไลน์</span>
                  <Bot className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold">
                  {analytics.onlineCount}{' '}
                  <span className="text-sm font-normal text-zinc-500">/ {accounts.length}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>จำนวนรอบ &amp; Winrate</span>
                  <Trophy className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold">
                  {analytics.totalRuns}{' '}
                  <span className="text-sm font-normal text-emerald-400">
                    ({analytics.winrate}%)
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>เวลาเฉลี่ยต่อรอบ</span>
                  <Clock className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold">{formatDuration(analytics.avgSec)}</div>
              </div>

              <div className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Gems / ชั่วโมง</span>
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold">{analytics.gemsPerHr.toLocaleString()}</div>
              </div>
            </div>

            {/* Total Loot Summary */}
            {Object.keys(analytics.lootTotals).length > 0 && (
              <section className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-300 mb-3">
                  ยอดรวมที่ได้ในช่วงเวลานี้
                </h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(analytics.lootTotals)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, amount]) => {
                      const icon = getItemIcon(name);
                      const st = getRarityStyle(undefined, name);
                      return (
                        <span
                          key={name}
                          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border font-medium ${st.badge}`}
                        >
                          {icon && (
                            <img src={icon} alt={name} className="w-4 h-4 object-contain shrink-0" />
                          )}
                          <span>
                            {name}: <strong className="ml-1">+{amount.toLocaleString()}</strong>
                          </span>
                        </span>
                      );
                    })}
                </div>
              </section>
            )}

            {/* Run History Table */}
            <section className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 overflow-hidden">
              <div className="p-4 border-b border-purple-500/20 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">ตารางประวัติดรอปทุกรอบ</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="ค้นหาด่าน / ไอเทม..."
                      className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#090714] border border-purple-500/25 focus:outline-none focus:border-purple-400"
                    />
                  </div>
                  <select
                    value={botFilter}
                    onChange={(e) => setBotFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-[#090714] border border-purple-500/25"
                  >
                    <option value="ALL">ทุกบอท</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.bot_name}>
                        {a.bot_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={resultFilter}
                    onChange={(e) => setResultFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-[#090714] border border-purple-500/25"
                  >
                    <option value="ALL">Win &amp; Lose</option>
                    <option value="Win">Win</option>
                    <option value="Lose">Lose</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0b0818] text-purple-300/70 border-b border-purple-500/20">
                    <tr>
                      <th className="px-4 py-3 font-medium">เวลา</th>
                      <th className="px-4 py-3 font-medium">บอท</th>
                      <th className="px-4 py-3 font-medium">โหมด / ด่าน</th>
                      <th className="px-4 py-3 font-medium">ผลลัพธ์</th>
                      <th className="px-4 py-3 font-medium">เวลาที่ใช้</th>
                      <th className="px-4 py-3 font-medium">ของที่ได้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-500/10">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                          ไม่พบประวัติการฟาร์ม
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-purple-500/5">
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
                              {(log.rewards || []).map((r, idx) => {
                                const icon = getItemIcon(r.name);
                                const st = getRarityStyle(r.rarity, r.name);
                                return (
                                  <span
                                    key={idx}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${st.badge}`}
                                  >
                                    {icon && (
                                      <img
                                        src={icon}
                                        alt={r.name}
                                        className="w-3.5 h-3.5 object-contain shrink-0"
                                      />
                                    )}
                                    <span>
                                      {r.name} x{r.amount.toLocaleString()}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {tab === 'keys' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-5 space-y-5">
              <div>
                <h2 className="text-base font-semibold">Generate New API Key</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  นำ Key ไปใส่ในโค้ด Lua เพื่อส่งข้อมูลเข้าหน้าโปรไฟล์ของพี่โดยตรง
                </p>
              </div>

              <form onSubmit={handleCreateKey} className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">ชื่อ Key</label>
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. MuMu Farm"
                    className="w-full px-3 py-2 text-sm rounded-xl bg-[#090714] border border-purple-500/25 focus:outline-none focus:border-purple-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Discord Webhook URL (ไม่ใส่ก็ได้ — เอาไว้แจ้งเตือน Rare Drop)
                  </label>
                  <input
                    value={newWebhook}
                    onChange={(e) => setNewWebhook(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full px-3 py-2 text-sm rounded-xl bg-[#090714] border border-purple-500/25 focus:outline-none focus:border-purple-400"
                  />
                </div>
                <button
                  type="submit"
                  className="aa-btn aa-btn--primary"
                >
                  <Plus className="w-4 h-4" />
                  Create API Key
                </button>
                {keyError && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {keyError}
                  </div>
                )}
              </form>

              <div className="space-y-2.5 pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-purple-300/70">
                  Keys ของคุณ ({keys.length})
                </h3>
                {keys.map((k) => (
                  <div
                    key={k.id}
                    className="rounded-xl border border-purple-500/20 bg-[#090714]/80 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{k.label}</div>
                      <div className="text-xs font-mono text-purple-300 truncate">{k.api_key}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        ใช้งานล่าสุด: {k.last_used_at ? timeAgo(k.last_used_at) : 'ยังไม่เคยใช้'}
                        {k.discord_webhook_url ? ' • Discord Alert ON' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => copyText(k.id, k.api_key)}
                        className="p-2 rounded-lg bg-[#15102b] hover:bg-purple-500/20 text-zinc-300 cursor-pointer"
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
                        className="p-2 rounded-lg bg-[#15102b] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                        title="Delete Key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-purple-500/25 bg-[#120e24]/85 p-5 space-y-4">
              <h2 className="text-base font-semibold">โค้ดสำหรับรันใน MuMu (6 บรรทัด)</h2>
              <p className="text-xs text-zinc-400">
                ก๊อปโค้ดนี้ไปรันใน Executor หรือวางในโฟลเดอร์ <code>autoexec</code> ได้เลย:
              </p>
              <pre className="rounded-xl bg-[#090714] border border-purple-500/25 p-4 text-xs font-mono text-emerald-300 overflow-x-auto">
{`getgenv().AA_TRACKER_CONFIG = {
    API_URL  = "${originUrl}/api/ingest",
    API_KEY  = "${keys[0]?.api_key || 'PASTE_YOUR_API_KEY_HERE'}",
    BOT_NAME = "Bot 1" -- จอ 2 เปลี่ยนเป็น "Bot 2"
}
loadstring(game:HttpGet("https://raw.githubusercontent.com/einmee43/AAD/main/aa_tracker.lua"))()`}
              </pre>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
