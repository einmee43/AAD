import { NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { createShareToken, verifyShareToken } from '@/lib/shareToken';
import {
  matchesFocusKeywords,
  resolveShareVisibility,
  type ShareCurrencyKey,
  type ShareSectionKey,
} from '@/lib/shareConfig';

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const botNames = Array.isArray(body.botNames)
    ? body.botNames.map((b: unknown) => String(b).trim()).filter(Boolean)
    : undefined;
  const label = body.label ? String(body.label).trim().slice(0, 60) : undefined;
  const hours = body.hours ? Math.min(720, Math.max(1, Number(body.hours) || 24)) : 24;
  const sections = Array.isArray(body.sections)
    ? (body.sections.map((x: unknown) => String(x).trim()).filter(Boolean) as ShareSectionKey[])
    : undefined;
  const currencies = Array.isArray(body.currencies)
    ? (body.currencies.map((x: unknown) => String(x).trim()).filter(Boolean) as ShareCurrencyKey[])
    : undefined;
  const focusKeywords = Array.isArray(body.focusKeywords)
    ? body.focusKeywords.map((x: unknown) => String(x).trim()).filter(Boolean)
    : undefined;

  const token = createShareToken({
    u: user.id,
    b: botNames && botNames.length > 0 ? botNames : undefined,
    l: label,
    h: hours,
    s: sections,
    c: currencies,
    f: focusKeywords,
  });

  return NextResponse.json({ token, path: `/share/${token}` });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || '';
  const payload = verifyShareToken(token);

  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired share link' }, { status: 403 });
  }

  const vis = resolveShareVisibility(payload);
  const secSet = new Set(vis.sections);
  const curSet = new Set(vis.currencies);
  const showStatus = secSet.has('status');
  const showCurrencies = secSet.has('currencies');
  const showGained = secSet.has('gained');
  const showInventory = secSet.has('inventory');
  const showUnits = secSet.has('units');
  const showBattlePass = secSet.has('battlepass');
  const showTower = secSet.has('tower');
  const showHistory = secSet.has('history');

  const hours = Math.min(
    720,
    Math.max(1, Number(searchParams.get('hours')) || payload.h || 24)
  );
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const scopedBots = payload.b && payload.b.length > 0 ? payload.b : null;

  const admin = createAdminSupabase();

  let accQuery = admin
    .from('accounts')
    .select(
      'id, bot_name, roblox_username, roblox_user_id, status, current_mode, current_map, current_wave, last_heartbeat, started_at, updated_at'
    )
    .eq('user_id', payload.u)
    .order('bot_name', { ascending: true });

  if (scopedBots) {
    accQuery = accQuery.in('bot_name', scopedBots);
  }

  let logsQuery = admin
    .from('run_logs')
    .select('id, account_id, bot_name, mode, map_name, result, duration_sec, rewards, created_at')
    .eq('user_id', payload.u)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(200);

  if (scopedBots) {
    logsQuery = logsQuery.in('bot_name', scopedBots);
  }

  const [accountsRes, logsRes, snapshotsRes] = await Promise.all([
    accQuery,
    showHistory || showGained ? logsQuery : Promise.resolve({ data: [], error: null }),
    admin
      .from('inventory_snapshots')
      .select('account_id, currencies, items, updated_at')
      .eq('user_id', payload.u),
  ]);

  if (accountsRes.error || logsRes.error || snapshotsRes.error) {
    return NextResponse.json(
      {
        error:
          accountsRes.error?.message || logsRes.error?.message || snapshotsRes.error?.message,
      },
      { status: 500 }
    );
  }

  const nowMs = Date.now();
  const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

  const accounts = (accountsRes.data || []).map((acc) => {
    const lastMs = new Date(acc.last_heartbeat).getTime();
    const isOffline = nowMs - lastMs > OFFLINE_THRESHOLD_MS;
    if (!showStatus) {
      return {
        ...acc,
        status: 'hidden',
        live_status: isOffline ? 'offline' : acc.status,
        current_mode: undefined,
        current_map: undefined,
        current_wave: undefined,
      };
    }
    return {
      ...acc,
      live_status: isOffline ? 'offline' : acc.status,
    };
  });

  const allowedAccIds = new Set(accounts.map((a) => a.id));

  // Scrub hidden snapshot sections server-side so hidden data is never leaked
  const snapshots = (snapshotsRes.data || [])
    .filter((s) => allowedAccIds.has(s.account_id))
    .map((s) => {
      const rawCur =
        s.currencies && typeof s.currencies === 'object'
          ? (s.currencies as Record<string, unknown>)
          : {};
      const filteredCur: Record<string, unknown> = {};

      if (showCurrencies) {
        if (curSet.has('level')) {
          if (rawCur['_level'] !== undefined) filteredCur['_level'] = rawCur['_level'];
          if (rawCur['_xp'] !== undefined) filteredCur['_xp'] = rawCur['_xp'];
          if (rawCur['_max_xp'] !== undefined) filteredCur['_max_xp'] = rawCur['_max_xp'];
        }
        if (curSet.has('gems') && rawCur['Gems'] !== undefined) filteredCur['Gems'] = rawCur['Gems'];
        if (curSet.has('pearls') && rawCur['Summer Pearls'] !== undefined)
          filteredCur['Summer Pearls'] = rawCur['Summer Pearls'];
        if (curSet.has('gold') && rawCur['Gold'] !== undefined) filteredCur['Gold'] = rawCur['Gold'];
        if (curSet.has('dawn') && rawCur['Dawn Coins'] !== undefined)
          filteredCur['Dawn Coins'] = rawCur['Dawn Coins'];
        if (curSet.has('reroll')) {
          if (rawCur['Trait Reroll'] !== undefined) filteredCur['Trait Reroll'] = rawCur['Trait Reroll'];
          if (rawCur['_total_trait_rerolls'] !== undefined)
            filteredCur['_total_trait_rerolls'] = rawCur['_total_trait_rerolls'];
        }
        if (curSet.has('remnant')) {
          if (rawCur['Star Remnant'] !== undefined) filteredCur['Star Remnant'] = rawCur['Star Remnant'];
          if (rawCur['_star_remnant_limited'] !== undefined)
            filteredCur['_star_remnant_limited'] = rawCur['_star_remnant_limited'];
          if (rawCur['_star_remnant_regular'] !== undefined)
            filteredCur['_star_remnant_regular'] = rawCur['_star_remnant_regular'];
        }
      }

      if (showBattlePass && rawCur['_battlepass'] !== undefined) {
        filteredCur['_battlepass'] = rawCur['_battlepass'];
      }
      if (showTower && rawCur['_tower'] !== undefined) {
        filteredCur['_tower'] = rawCur['_tower'];
      }
      if (showUnits) {
        if (rawCur['_team'] !== undefined) filteredCur['_team'] = rawCur['_team'];
        if (rawCur['_units'] !== undefined) filteredCur['_units'] = rawCur['_units'];
      }

      const rawItems = Array.isArray(s.items) ? s.items : [];
      const filteredItems =
        showInventory || showGained
          ? rawItems.filter((it: { name?: string; category?: string }) =>
              matchesFocusKeywords(it?.name || '', vis.focusKeywords, it?.category)
            )
          : [];

      return {
        ...s,
        currencies: filteredCur,
        items: filteredItems,
      };
    });

  const runLogs = (logsRes.data || []).map((log) => {
    const rawRewards = Array.isArray(log.rewards) ? log.rewards : [];
    const filteredRewards = rawRewards.filter((r: { name?: string; category?: string }) =>
      matchesFocusKeywords(r?.name || '', vis.focusKeywords, r?.category)
    );
    return {
      ...log,
      ...(showStatus || showHistory ? {} : { mode: 'Farm', map_name: '-' }),
      rewards: filteredRewards,
    };
  });

  return NextResponse.json({
    ok: true,
    share_label: payload.l || 'Nexty Shop • Live Tracker',
    share_config: vis,
    hours,
    accounts,
    run_logs: runLogs,
    snapshots,
  });
}
