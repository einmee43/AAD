'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import KageBackdrop from '@/components/KageBackdrop';
import NextyLogo from '@/components/NextyLogo';
import AvatarStage3D from '@/components/AvatarStage3D';
import unitRarities from '@/lib/unitRarities.json';

const unitRarityMap = unitRarities as Record<string, string>;
import {
  Activity,
  Bell,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  Heart,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  Trophy,
  Waves,
  X,
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
  tier?: string;
  hearts?: number;
  multiplier?: string;
  mods?: string;
}

interface TeamUnit {
  slot: number;
  name: string;
  level?: number | null;
  cost?: number | null;
  trait?: string | null;
}

const TRAIT_ALIAS: Record<string, string> = {
  vigorous: 'vigorous',
  superior: 'vigorous',
  range: 'range',
  marksman: 'range',
  swift: 'swift',
  nimble: 'swift',
  adept: 'adept',
  culling: 'culling',
  sniper: 'sniper',
  godspeed: 'godspeed',
  reaper: 'reaper',
  celestial: 'celestial',
  ethereal: 'celestial',
  divine: 'divine',
  golden: 'golden',
  unique: 'unique',
};

function getTraitIcon(trait?: string | null): string | null {
  const t = (trait || '').trim().toLowerCase();
  const mapped = TRAIT_ALIAS[t];
  if (mapped) return `/traits/${mapped}.png`;
  return null;
}

function getUnitCardTheme(name: string, trait?: string | null) {
  const n = name.toLowerCase();
  const r = (unitRarityMap[n] || '').toLowerCase();
  const t = (trait || '').toLowerCase();
  const isRainbow =
    r === 'secret' ||
    r === 'exclusive' ||
    t === 'unique' ||
    n.includes('elyssia') ||
    n.includes('alucard') ||
    n.includes('ainz') ||
    n.includes('dazai') ||
    n.includes('roger') ||
    n.includes('homura');

  if (isRainbow) {
    return {
      frame:
        'p-[2.5px] bg-[linear-gradient(135deg,#22d3ee,#3b82f6,#22c55e,#eab308,#ef4444,#a855f7)] shadow-[0_0_16px_rgba(34,211,238,0.32)]',
      innerBg: 'linear-gradient(180deg, #1d4332 0%, #0f241b 100%)',
    };
  }
  if (r === 'legendary' || n.includes('windsong') || n.includes('bulby')) {
    return {
      frame:
        'p-[2.5px] bg-gradient-to-b from-amber-300 via-amber-500 to-yellow-700 shadow-[0_0_14px_rgba(245,158,11,0.28)]',
      innerBg: 'linear-gradient(180deg, #3c2a12 0%, #1c1207 100%)',
    };
  }
  return {
    frame:
      'p-[2.5px] bg-gradient-to-b from-fuchsia-400 via-purple-600 to-indigo-800 shadow-[0_0_14px_rgba(168,85,247,0.28)]',
    innerBg: 'linear-gradient(180deg, #2d1849 0%, #140b24 100%)',
  };
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
  currencies: Record<string, unknown>;
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

function isJunkReward(name: string): boolean {
  const n = (name || '').toLowerCase();
  return (
    n.includes('victory') ||
    n.includes('defeat') ||
    n.includes('first completion') ||
    n === 'score:' ||
    n === 'high score:' ||
    n.includes('xp progress')
  );
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
  if (n.includes('dawn coin')) {
    return {
      label: 'Mythic',
      card: 'border-purple-500/50 bg-gradient-to-b from-purple-950/45 to-[#130e24] shadow-[0_0_18px_rgba(168,85,247,0.16)]',
      text: 'text-purple-400',
      badge: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
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
  const [unitIconCache, setUnitIconCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Filters
  const [inventoryTab, setInventoryTab] = useState<'all' | 'items' | 'portals' | 'team'>('all');
  const [rarityFilter, setRarityFilter] = useState<'ALL' | 'Secret' | 'Mythic' | 'Legendary'>('ALL');
  const [portalKind, setPortalKind] = useState<string>('ALL');
  const [portalTier, setPortalTier] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [botFilter, setBotFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');

  // Key form state
  const [newLabel, setNewLabel] = useState('MuMu Farm');
  const [newWebhook, setNewWebhook] = useState('');
  const [webhookDrafts, setWebhookDrafts] = useState<Record<string, string>>({});
  const [savingWebhookId, setSavingWebhookId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // In-web notifications
  type WebAlert = {
    id: string;
    title: string;
    subtitle: string;
    rewards: string;
    isRare: boolean;
    result: 'Win' | 'Lose';
    createdAt: string;
  };
  const [alerts, setAlerts] = useState<WebAlert[]>([]);
  const [toasts, setToasts] = useState<WebAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const seenLogIdsRef = useRef<Set<string>>(new Set());
  const logsInitializedRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    const res = await fetch(`/api/dashboard?hours=${hours}`);
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts || []);
      setLogs(data.run_logs || []);
      setSnapshots(data.snapshots || []);
    }
  }, [hours]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      await loadDashboard();
    } finally {
      setLoading(false);
    }
  }, [loadDashboard]);

  const fetchKeys = useCallback(async () => {
    const res = await fetch('/api/keys');
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys || []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runFetch = async () => {
      const [dashRes, keysRes] = await Promise.all([
        fetch(`/api/dashboard?hours=${hours}`),
        fetch('/api/keys'),
      ]);
      if (cancelled) return;
      if (dashRes.ok) {
        const data = await dashRes.json();
        setAccounts(data.accounts || []);
        setLogs(data.run_logs || []);
        setSnapshots(data.snapshots || []);
      }
      if (keysRes.ok) {
        const kData = await keysRes.json();
        setKeys(kData.keys || []);
      }
    };
    void runFetch();
    const timer = setInterval(() => {
      void loadDashboard();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hours, loadDashboard]);

  // Detect new run_logs on auto-refresh and fire in-web alerts + toasts
  useEffect(() => {
    if (!logsInitializedRef.current) {
      if (logs.length > 0) {
        logs.forEach((l) => seenLogIdsRef.current.add(l.id));
        logsInitializedRef.current = true;
      }
      return;
    }

    const freshLogs = logs.filter((l) => !seenLogIdsRef.current.has(l.id));
    if (freshLogs.length === 0) return;

    freshLogs.forEach((l) => seenLogIdsRef.current.add(l.id));
    const newAlerts: WebAlert[] = freshLogs.map((l) => {
      const cleanRewards = (l.rewards || []).filter((r) => !isJunkReward(r.name));
      const isRare = cleanRewards.some((r) => {
        const rr = (r.rarity || '').toLowerCase();
        const rn = r.name.toLowerCase();
        return (
          ['secret', 'mythic', 'legendary'].includes(rr) ||
          rn.includes('portal') ||
          rn.includes('remnant') ||
          rn.includes('cube') ||
          rn.includes('dawn')
        );
      });
      const rewardSummary =
        cleanRewards.length > 0
          ? cleanRewards
              .slice(0, 3)
              .map((r) => `${r.name} x${r.amount.toLocaleString()}`)
              .join(' • ')
          : 'ไม่มีของดรอปเพิ่ม';
      return {
        id: l.id,
        title: `${l.bot_name} • ${l.mode} (${l.result})`,
        subtitle: `${l.map_name} • ${formatDuration(l.duration_sec)}`,
        rewards: rewardSummary,
        isRare,
        result: l.result,
        createdAt: l.created_at,
      };
    });

    setAlerts((prev) => [...newAlerts, ...prev].slice(0, 15));
    setUnreadCount((c) => c + newAlerts.length);
    setToasts((prev) => [...newAlerts, ...prev].slice(0, 3));

    const timer = setTimeout(() => {
      const ids = new Set(newAlerts.map((a) => a.id));
      setToasts((prev) => prev.filter((t) => !ids.has(t.id)));
    }, 7000);
    return () => clearTimeout(timer);
  }, [logs]);

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

  const handleSaveWebhook = async (id: string, currentVal: string) => {
    setSavingWebhookId(id);
    setKeyError(null);
    const res = await fetch('/api/keys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, discord_webhook_url: currentVal.trim() || null }),
    });
    setSavingWebhookId(null);
    if (res.ok) {
      fetchKeys();
    } else {
      const data = await res.json().catch(() => ({}));
      setKeyError(data.error || `Failed (${res.status})`);
    }
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
  const rawLevel = Number(activeCurrencies['_level']) || 0;
  const rawXp = Number(activeCurrencies['_xp']) || 0;
  const rawMaxXp = Number(activeCurrencies['_max_xp']) || 0;
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

  const activeTeam: TeamUnit[] = Array.isArray(activeCurrencies['_team'])
    ? (activeCurrencies['_team'] as TeamUnit[])
    : [];

  // Fetch unit portraits dynamically for equipped team
  useEffect(() => {
    const missing = activeTeam
      .map((u) => u.name)
      .filter((n) => n && unitIconCache[n] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    fetch(`/api/unit-icons?names=${encodeURIComponent(missing.join('|'))}`)
      .then((r) => r.json())
      .then((d: { icons?: Record<string, string> }) => {
        if (cancelled) return;
        const fetched = d?.icons || {};
        setUnitIconCache((prev) => {
          const next = { ...prev };
          for (const m of missing) {
            next[m] = fetched[m] || '';
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTeam, unitIconCache]);

  const allBotItems = activeSnap?.items || [];
  const portalItems = allBotItems.filter(
    (it) => it.category === 'portal' || it.name.toLowerCase().includes('portal')
  );
  const regularItems = allBotItems.filter(
    (it) => it.category !== 'portal' && !it.name.toLowerCase().includes('portal')
  );

  // Filtered inventory items for active bot
  const activeItems = (
    inventoryTab === 'portals'
      ? portalItems
      : inventoryTab === 'items'
      ? regularItems
      : allBotItems
  ).filter((it) => {
    const style = getRarityStyle(it.rarity, it.name);
    if (rarityFilter !== 'ALL' && style.label !== rarityFilter) return false;
    if (inventoryTab === 'portals') {
      if (portalKind !== 'ALL' && !it.name.toLowerCase().includes(portalKind.toLowerCase())) {
        return false;
      }
      if (portalTier !== 'ALL') {
        const t = it.tier || (it.name.match(/T(\d+)/i)?.[0]?.toUpperCase() ?? '');
        if (t !== portalTier) return false;
      }
    }
    if (search.trim() && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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
        if (isJunkReward(r.name)) continue;
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
          <NextyLogo size="sm" />

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

            <div className="relative">
              <button
                onClick={() => {
                  setShowAlerts((v) => !v);
                  setUnreadCount(0);
                }}
                title="แจ้งเตือนในเว็บ"
                className="aa-btn aa-btn--icon relative"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.8)]">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showAlerts && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-red-500/30 bg-[#12070a]/95 backdrop-blur-xl shadow-2xl p-3 z-50 space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-xs font-bold text-red-200">แจ้งเตือนในเว็บล่าสุด</span>
                    {alerts.length > 0 && (
                      <button
                        onClick={() => setAlerts([])}
                        className="text-[11px] text-zinc-400 hover:text-red-300 cursor-pointer"
                      >
                        ล้างทั้งหมด
                      </button>
                    )}
                  </div>
                  {alerts.length === 0 ? (
                    <div className="py-5 text-center text-xs text-zinc-400">
                      ยังไม่มีแจ้งเตือนใหม่ (ระบบเช็กอัตโนมัติทุก 15 วิ)
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                      {alerts.map((a) => (
                        <div
                          key={a.id}
                          className={`rounded-xl border p-2.5 text-xs ${
                            a.isRare
                              ? 'border-amber-500/45 bg-amber-950/25'
                              : 'border-red-500/20 bg-black/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-white truncate">{a.title}</span>
                            <span className="text-[10px] text-zinc-400 shrink-0">
                              {timeAgo(a.createdAt)}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate mt-0.5">{a.subtitle}</div>
                          <div className="text-[11px] text-emerald-300 truncate mt-1">{a.rewards}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

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
              <span className="text-xs font-medium hidden md:inline text-red-100">
                {user.name}
              </span>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-red-500/20 transition cursor-pointer"
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
              <div className="rounded-2xl border border-dashed border-red-500/30 bg-[#13080b]/60 p-10 text-center space-y-3">
                <Bot className="w-10 h-10 text-red-400 mx-auto" />
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
                          <Sparkles className="w-4 h-4 text-red-400" />
                        )}
                        {activeAccount.bot_name}
                      </div>
                      <div
                        className={`text-[11px] ${
                          isKage ? 'text-red-300/60' : 'text-red-300/60'
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

                  {/* Real Three.js 3D Avatar Stage & Layered Podium */}
                  <AvatarStage3D
                    robloxUserId={activeAccount.roblox_user_id}
                    fallbackAvatarUrl={
                      activeAccount.roblox_user_id
                        ? avatarCache[activeAccount.roblox_user_id]
                        : null
                    }
                    alt={activeAccount.roblox_username || activeAccount.bot_name}
                  />

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
                        className={`font-semibold ${isKage ? 'text-red-300' : 'text-red-300'}`}
                      >
                        {level > 0 ? `${xpPct}%` : activeAccount.current_wave || 'Ready'}
                      </span>
                    </div>
                    <div
                      className={`h-2 rounded-full border overflow-hidden ${
                        isKage
                          ? 'bg-[#0c0608] border-red-500/25'
                          : 'bg-[#090506] border-red-500/25'
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
                  {/* Live Match & 6-Unit Team Banner */}
                  <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            activeAccount.live_status === 'farming'
                              ? 'bg-emerald-400 animate-pulse'
                              : activeAccount.live_status === 'lobby'
                              ? 'bg-sky-400'
                              : 'bg-zinc-500'
                          }`}
                        />
                        <span className="font-semibold text-zinc-200">
                          {activeAccount.live_status === 'farming'
                            ? 'อยู่ในแมตช์'
                            : activeAccount.live_status === 'lobby'
                            ? 'อยู่ใน Lobby'
                            : 'ออฟไลน์'}
                        </span>
                      </div>
                      <div className="text-base font-bold text-white truncate">
                        {activeAccount.current_mode || 'Lobby'}
                      </div>
                      <div className="text-xs text-zinc-400 truncate">
                        {activeAccount.current_map || 'Main Lobby'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* 6 Equipped Unit Slots (aavalues.trade halftone + rarity frame style) */}
                      {[1, 2, 3, 4, 5, 6].map((slotNum) => {
                        const unit = activeTeam.find((u) => u.slot === slotNum);
                        const unitImg = unit ? unitIconCache[unit.name] : '';
                        const traitImg = unit ? getTraitIcon(unit.trait) : null;
                        const theme = unit ? getUnitCardTheme(unit.name, unit.trait) : null;
                        return (
                          <div
                            key={slotNum}
                            title={
                              unit
                                ? `${unit.name}${unit.level ? ` (Lv.${unit.level})` : ''}${
                                    unit.trait ? ` • ${unit.trait}` : ''
                                  }`
                                : `ช่องที่ ${slotNum} ว่าง`
                            }
                            className={`w-[74px] h-[74px] sm:w-20 sm:h-20 rounded-xl shrink-0 transition-transform hover:-translate-y-0.5 ${
                              theme ? theme.frame : 'border border-white/10 bg-black/30 opacity-45'
                            }`}
                          >
                            <div
                              className="relative w-full h-full rounded-[9.5px] overflow-hidden flex items-center justify-center"
                              style={theme ? { background: theme.innerBg } : undefined}
                            >
                              {unit ? (
                                <>
                                  {/* Halftone polka-dot texture */}
                                  <div
                                    className="absolute inset-0 pointer-events-none opacity-65"
                                    style={{
                                      backgroundImage:
                                        'radial-gradient(rgba(0,0,0,0.42) 1.5px, transparent 1.5px)',
                                      backgroundSize: '8px 8px',
                                    }}
                                  />
                                  {unitImg ? (
                                    <img
                                      src={unitImg}
                                      alt={unit.name}
                                      className="relative z-10 w-full h-full object-contain object-bottom pt-1"
                                    />
                                  ) : (
                                    <Shield className="relative z-10 w-6 h-6 text-purple-300/80" />
                                  )}
                                  <div className="absolute inset-x-0 bottom-0 h-8 z-20 bg-gradient-to-t from-black/90 via-black/45 to-transparent pointer-events-none" />
                                  {unit.level ? (
                                    <span className="absolute top-1 left-1.5 z-30 text-[10px] font-extrabold text-white leading-none [text-shadow:0_1px_3px_#000,0_0_4px_#000]">
                                      Lv. {unit.level}
                                    </span>
                                  ) : null}
                                  {traitImg && (
                                    <img
                                      src={traitImg}
                                      alt={unit.trait || 'trait'}
                                      className="absolute top-1 right-1 z-30 w-4 h-4 object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,1)]"
                                    />
                                  )}
                                  {unit.cost ? (
                                    <span className="absolute bottom-3.5 right-1.5 z-30 text-[9.5px] font-extrabold text-amber-300 leading-none [text-shadow:0_1px_2px_#000]">
                                      {unit.cost} ¥
                                    </span>
                                  ) : null}
                                  <span className="absolute bottom-0.5 inset-x-1 z-30 text-center text-[9px] font-bold text-white truncate leading-tight [text-shadow:0_1px_3px_#000,0_0_4px_#000]">
                                    {unit.name}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[10px] text-zinc-500">ว่าง</span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Live Wave Badge (exact same 80x80 size as unit slots) */}
                      <div className="w-[74px] h-[74px] sm:w-20 sm:h-20 rounded-xl border border-red-500/35 bg-[#0b0406] flex flex-col items-center justify-center shrink-0 text-center">
                        <div className="flex items-center justify-center gap-0.5 text-[10px] text-red-300/80 leading-none">
                          <Waves className="w-3 h-3" />
                          <span>เวฟ</span>
                        </div>
                        <div className="text-xl font-bold text-white leading-tight mt-0.5">
                          {activeAccount.current_wave && activeAccount.current_wave !== '-'
                            ? activeAccount.current_wave.replace(/Wave\s*/i, '')
                            : '-'}
                        </div>
                      </div>
                    </div>
                  </div>

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

                  {/* Inventory Category Tabs, Rarity & Portal Tier Filters */}
                  <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="หมวดคลัง">
                        {(
                          [
                            { id: 'all', label: `ทั้งหมด (${allBotItems.length})` },
                            { id: 'items', label: `ไอเทม (${regularItems.length})` },
                            { id: 'portals', label: `ประตู (${portalItems.length})` },
                            { id: 'team', label: `ทีมยูนิต (${activeTeam.length})` },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            role="tab"
                            onClick={() => setInventoryTab(t.id)}
                            aria-selected={inventoryTab === t.id}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                              inventoryTab === t.id
                                ? 'bg-red-600/25 border-red-500/60 text-white shadow-[0_0_12px_rgba(239,68,68,0.25)]'
                                : 'bg-[#090506]/70 border-white/10 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {t.label}
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

                    {inventoryTab !== 'team' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5" role="group" aria-label="กรองตามความหายาก">
                        {(['ALL', 'Secret', 'Mythic', 'Legendary'] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setRarityFilter(r)}
                            data-rarity={r === 'ALL' ? undefined : r.toLowerCase()}
                            aria-pressed={rarityFilter === r}
                            className="aa-chip"
                          >
                            {r === 'ALL' ? 'ทุกระดับ' : r}
                          </button>
                        ))}
                      </div>
                    )}

                    {inventoryTab === 'portals' && (
                      <div className="space-y-2 pt-2 border-t border-white/5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {['ALL', 'Eclipse', 'Explosion', 'Alien', 'Puppet', 'Shibuya', 'Sky', 'Demon'].map((kind) => (
                            <button
                              key={kind}
                              onClick={() => setPortalKind(kind)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                                portalKind === kind
                                  ? 'bg-red-500/25 border-red-400/60 text-red-100'
                                  : 'bg-black/35 border-white/10 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {kind === 'ALL' ? 'ทุกชนิด' : kind}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {['ALL', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T0'].map((tier) => (
                            <button
                              key={tier}
                              onClick={() => setPortalTier(tier)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                                portalTier === tier
                                  ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                                  : 'bg-black/35 border-white/10 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {tier === 'ALL' ? 'ทุก Tier' : tier}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Inventory / Team Grid */}
                  {inventoryTab === 'team' ? (
                    activeTeam.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
                        {activeTeam.map((unit) => {
                          const theme = getUnitCardTheme(unit.name, unit.trait);
                          const traitImg = getTraitIcon(unit.trait);
                          return (
                            <div
                              key={unit.slot}
                              className={`aspect-square rounded-2xl transition-transform hover:-translate-y-1 animate-fade-slide ${theme.frame}`}
                            >
                              <div
                                className="relative w-full h-full rounded-[13px] overflow-hidden flex items-end justify-center"
                                style={{ background: theme.innerBg }}
                              >
                                <div
                                  className="absolute inset-0 pointer-events-none opacity-65"
                                  style={{
                                    backgroundImage:
                                      'radial-gradient(rgba(0,0,0,0.42) 1.8px, transparent 1.8px)',
                                    backgroundSize: '10px 10px',
                                  }}
                                />
                                {unitIconCache[unit.name] ? (
                                  <img
                                    src={unitIconCache[unit.name]}
                                    alt={unit.name}
                                    className="relative z-10 w-full h-full object-contain object-bottom pt-2"
                                  />
                                ) : (
                                  <Shield className="relative z-10 w-10 h-10 mb-8 text-purple-300/80" />
                                )}
                                <div className="absolute inset-x-0 bottom-0 h-12 z-20 bg-gradient-to-t from-black/90 via-black/45 to-transparent pointer-events-none" />
                                {unit.level ? (
                                  <span className="absolute top-2 left-2 z-30 text-[11px] font-extrabold text-white [text-shadow:0_1px_3px_#000]">
                                    Lv. {unit.level}
                                  </span>
                                ) : null}
                                {traitImg && (
                                  <img
                                    src={traitImg}
                                    alt={unit.trait || 'trait'}
                                    className="absolute top-2 right-2 z-30 w-5 h-5 object-contain drop-shadow-[0_1px_4px_rgba(0,0,0,1)]"
                                  />
                                )}
                                {unit.cost ? (
                                  <span className="absolute bottom-6 right-2 z-30 text-[11px] font-extrabold text-amber-300 [text-shadow:0_1px_3px_#000]">
                                    {unit.cost} ¥
                                  </span>
                                ) : null}
                                <div className="absolute bottom-1.5 inset-x-1.5 z-30 text-center text-xs font-extrabold text-white leading-tight truncate [text-shadow:0_1.5px_3px_#000,0_0_6px_#000]">
                                  {unit.name}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/70 p-5 text-center space-y-1">
                        <p className="text-xs text-zinc-300">
                          ยังไม่มีข้อมูลทีมยูนิตจากบอทนี้ (รันสคริปต์เวอร์ชันล่าสุดเพื่อซิงค์ทีม 6 ตัว)
                        </p>
                      </div>
                    )
                  ) : activeItems.length > 0 ? (
                    <div
                      key={`${inventoryTab}-${rarityFilter}-${portalKind}-${portalTier}-${activeAccount.id}`}
                      className="grid grid-cols-2 sm:grid-cols-3 gap-3.5"
                    >
                      {activeItems.map((item, idx) => {
                        const style = getRarityStyle(item.rarity, item.name);
                        const icon = getItemIcon(item.name);
                        const tierTag =
                          item.tier || (item.name.match(/T(\d+)/i)?.[0]?.toUpperCase() ?? null);
                        return (
                          <div
                            key={`${item.name}-${idx}`}
                            style={{ animationDelay: `${Math.min(idx * 40, 280)}ms` }}
                            className={`rounded-2xl border p-4 flex flex-col justify-between min-h-[156px] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.01] animate-fade-slide ${style.card}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              {tierTag ? (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-200">
                                  {tierTag}
                                </span>
                              ) : (
                                <span />
                              )}
                              <div className="flex items-center gap-1.5">
                                {item.hearts ? (
                                  <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-lg bg-rose-500/20 border border-rose-400/35 text-rose-200">
                                    <Heart className="w-3 h-3 fill-rose-400 text-rose-400" />
                                    {item.hearts}
                                  </span>
                                ) : null}
                                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-black/40 border border-white/10 text-zinc-100">
                                  x{item.amount}
                                </span>
                              </div>
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
                              <div className="flex items-center justify-between gap-2 mt-0.5">
                                <span className={`text-[11px] font-medium ${style.text}`}>
                                  {style.label}
                                </span>
                                {item.multiplier ? (
                                  <span className="text-[10px] font-semibold text-emerald-300 truncate">
                                    {item.multiplier}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      key={`empty-${inventoryTab}-${rarityFilter}-${activeAccount.id}`}
                      className="rounded-2xl border border-red-500/25 bg-[#13080b]/70 p-5 text-center space-y-1 animate-fade-slide"
                    >
                      <p className="text-xs text-zinc-300">
                        {inventoryTab === 'portals'
                          ? 'ยังไม่มี Portal ที่ตรงกับเงื่อนไข (เปิดหน้า Items ใน Lobby เพื่อให้บอทซิงค์รายการพอร์ทัล)'
                          : 'ยังไม่มีรายการไอเทมจากบอทนี้ (ระบบจะซิงค์เมื่อเปิดกระเป๋า Items หรือจบ Dungeon Room)'}
                      </p>
                    </div>
                  )}

                  {/* Quick Recent Runs Preview */}
                  <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/80 overflow-hidden">
                    <div className="px-4 py-3 border-b border-red-500/20 flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-red-200 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-red-400" />
                        รอบล่าสุด ({logs.slice(0, 5).length})
                      </h2>
                      <button
                        onClick={() => setTab('history')}
                        className="text-xs text-red-300 hover:text-white cursor-pointer"
                      >
                        ดูทั้งหมด →
                      </button>
                    </div>
                    <div className="divide-y divide-red-500/10">
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
                            {(log.rewards || []).filter((r) => !isJunkReward(r.name)).map((r, i) => {
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
              <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>บอทออนไลน์</span>
                  <Bot className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold">
                  {analytics.onlineCount}{' '}
                  <span className="text-sm font-normal text-zinc-500">/ {accounts.length}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
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

              <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>เวลาเฉลี่ยต่อรอบ</span>
                  <Clock className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold">{formatDuration(analytics.avgSec)}</div>
              </div>

              <div className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Gems / ชั่วโมง</span>
                  <TrendingUp className="w-4 h-4 text-red-400" />
                </div>
                <div className="text-2xl font-bold">{analytics.gemsPerHr.toLocaleString()}</div>
              </div>
            </div>

            {/* Total Loot Summary */}
            {Object.keys(analytics.lootTotals).length > 0 && (
              <section className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-red-300 mb-3">
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
            <section className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 overflow-hidden">
              <div className="p-4 border-b border-red-500/20 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">ตารางประวัติดรอปทุกรอบ</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="ค้นหาด่าน / ไอเทม..."
                      className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#090506] border border-red-500/25 focus:outline-none focus:border-red-400"
                    />
                  </div>
                  <select
                    value={botFilter}
                    onChange={(e) => setBotFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-[#090506] border border-red-500/25"
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
                    className="px-2.5 py-1.5 text-xs rounded-xl bg-[#090506] border border-red-500/25"
                  >
                    <option value="ALL">Win &amp; Lose</option>
                    <option value="Win">Win</option>
                    <option value="Lose">Lose</option>
                  </select>
                </div>
              </div>

              <div className="divide-y divide-red-500/10">
                {filteredLogs.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-zinc-500">
                    ไม่พบประวัติการฟาร์ม
                  </div>
                ) : (
                  filteredLogs.map((log) => {
                    const lowMap = (log.map_name || '').toLowerCase();
                    const lowMode = (log.mode || '').toLowerCase();
                    const isPortal = lowMode.includes('portal') || lowMap.includes('portal');
                    const isSky = lowMap.includes('sky');
                    const isDungeon = lowMode.includes('dungeon') || lowMap.includes('dungeon');
                    const isChallenge = lowMap.includes('challenge');

                    const thumbGradient = isSky
                      ? 'from-sky-500/70 via-indigo-700/75 to-[#0b1024]'
                      : isPortal
                      ? 'from-fuchsia-600/70 via-purple-800/75 to-[#12071d]'
                      : isDungeon
                      ? 'from-red-600/70 via-rose-900/75 to-[#160508]'
                      : isChallenge
                      ? 'from-amber-500/70 via-orange-800/75 to-[#190d05]'
                      : 'from-rose-600/60 via-red-900/75 to-[#120609]';

                    const modeLabel = isPortal
                      ? 'Portal'
                      : isDungeon
                      ? 'Dungeon'
                      : isChallenge
                      ? 'Challenge'
                      : log.mode || 'Match';

                    const d = new Date(log.created_at);
                    const hhmm = d.toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                    const ddmm = `${String(d.getDate()).padStart(2, '0')}/${String(
                      d.getMonth() + 1
                    ).padStart(2, '0')}`;

                    const cleanRewards = (log.rewards || []).filter((r) => !isJunkReward(r.name));

                    return (
                      <div
                        key={log.id}
                        className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-red-500/5 transition-colors"
                      >
                        <div className="flex items-start gap-3.5 min-w-0">
                          {/* Real Map Thumbnail */}
                          <div className="relative w-28 sm:w-32 h-[68px] rounded-xl overflow-hidden shrink-0 border border-white/15 bg-[#090506]">
                            <img
                              src="/maps/default.png"
                              alt={log.map_name}
                              className="w-full h-full object-cover"
                            />
                            <div
                              className={`absolute inset-0 bg-gradient-to-br ${thumbGradient} opacity-40 mix-blend-color`}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                            <span className="absolute bottom-1.5 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white/95 backdrop-blur-sm">
                              {modeLabel}
                            </span>
                          </div>

                          {/* Center Info & Reward Chips */}
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-sm font-bold ${
                                  log.result === 'Win' ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {log.result === 'Win' ? 'ชนะ' : 'แพ้'}
                              </span>
                              <span className="text-sm font-bold text-white truncate">
                                {log.map_name}
                              </span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-200">
                                {log.bot_name}
                              </span>
                            </div>

                            <div className="text-xs text-zinc-400">
                              {log.mode} • {formatDuration(log.duration_sec)}
                            </div>

                            {cleanRewards.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {cleanRewards.map((r, idx) => {
                                  const icon = getItemIcon(r.name);
                                  return (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#090506] border border-white/10 text-xs font-semibold text-zinc-100"
                                    >
                                      {icon ? (
                                        <img
                                          src={icon}
                                          alt={r.name}
                                          className="w-4 h-4 object-contain shrink-0"
                                        />
                                      ) : (
                                        <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                                      )}
                                      <span>{r.name}</span>
                                      <span className="text-zinc-300 font-bold">
                                        ×{r.amount.toLocaleString()}
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right Timestamp */}
                        <div className="text-right shrink-0 sm:pl-4">
                          <div className="text-xs font-medium text-zinc-400 tabular-nums">
                            {hhmm} • {ddmm}
                          </div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {timeAgo(log.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'keys' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-5 space-y-5">
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
                    className="w-full px-3 py-2 text-sm rounded-xl bg-[#090506] border border-red-500/25 focus:outline-none focus:border-red-400"
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
                    className="w-full px-3 py-2 text-sm rounded-xl bg-[#090506] border border-red-500/25 focus:outline-none focus:border-red-400"
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
                <h3 className="text-xs font-semibold uppercase tracking-wider text-red-300/70">
                  Keys ของคุณ ({keys.length})
                </h3>
                {keys.map((k) => {
                  const draft = webhookDrafts[k.id] ?? (k.discord_webhook_url || '');
                  return (
                    <div
                      key={k.id}
                      className="rounded-xl border border-red-500/20 bg-[#090506]/80 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold">{k.label}</div>
                          <div className="text-xs font-mono text-red-300 truncate">{k.api_key}</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            ใช้งานล่าสุด: {k.last_used_at ? timeAgo(k.last_used_at) : 'ยังไม่เคยใช้'}
                            {k.discord_webhook_url ? ' • Discord Alert ON' : ' • ยังไม่ใส่ Webhook'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => copyText(k.id, k.api_key)}
                            className="p-2 rounded-lg bg-[#1a0b0f] hover:bg-red-500/20 text-zinc-300 cursor-pointer"
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
                            className="p-2 rounded-lg bg-[#1a0b0f] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                            title="Delete Key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                        <input
                          value={draft}
                          onChange={(e) =>
                            setWebhookDrafts((prev) => ({ ...prev, [k.id]: e.target.value }))
                          }
                          placeholder="วาง Discord Webhook URL เพื่อแจ้งเตือน Portal / Rare Drop..."
                          className="flex-1 px-2.5 py-1.5 text-[11px] rounded-lg bg-[#12070a] border border-red-500/20 focus:outline-none focus:border-red-400 text-zinc-200"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveWebhook(k.id, draft)}
                          disabled={savingWebhookId === k.id}
                          className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-red-600/25 hover:bg-red-600/40 border border-red-500/40 text-red-100 cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {savingWebhookId === k.id ? 'กำลังบันทึก...' : 'บันทึก Webhook'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-red-500/25 bg-[#13080b]/85 p-5 space-y-4">
              <h2 className="text-base font-semibold">โค้ดสำหรับรันใน MuMu (6 บรรทัด)</h2>
              <p className="text-xs text-zinc-400">
                ก๊อปโค้ดนี้ไปรันใน Executor หรือวางในโฟลเดอร์ <code>autoexec</code> ได้เลย:
              </p>
              <pre className="rounded-xl bg-[#090506] border border-red-500/25 p-4 text-xs font-mono text-emerald-300 overflow-x-auto">
{`getgenv().AA_TRACKER_CONFIG = {
    API_URL  = "${originUrl}/api/ingest",
    API_KEY  = "${keys[0]?.api_key || 'PASTE_YOUR_API_KEY_HERE'}",
    BOT_NAME = "Bot 1" -- จอ 2 เปลี่ยนเป็น "Bot 2"
}
loadstring(game:HttpGet("https://raw.githubusercontent.com/einmee43/AAD/main/aa_tracker.lua?v=" .. tostring(os.time())))()`}
              </pre>
            </section>
          </div>
        )}
      </main>

      {/* Live In-Web Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-2xl border p-3.5 shadow-2xl backdrop-blur-xl animate-fade-slide ${
                t.isRare
                  ? 'border-amber-400/60 bg-[#1a0d08]/95'
                  : 'border-red-500/40 bg-[#14080b]/95'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{t.title}</div>
                  <div className="text-[11px] text-zinc-400 truncate">{t.subtitle}</div>
                  <div className="text-[11px] font-medium text-emerald-300 mt-1 truncate">
                    {t.rewards}
                  </div>
                </div>
                <button
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  className="text-zinc-400 hover:text-white cursor-pointer shrink-0"
                  aria-label="ปิดแจ้งเตือน"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
