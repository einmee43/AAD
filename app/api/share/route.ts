import { NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { createShareToken, verifyShareToken } from '@/lib/shareToken';

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

  const token = createShareToken({
    u: user.id,
    b: botNames && botNames.length > 0 ? botNames : undefined,
    l: label,
    h: hours,
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
    logsQuery,
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
    return {
      ...acc,
      live_status: isOffline ? 'offline' : acc.status,
    };
  });

  const allowedAccIds = new Set(accounts.map((a) => a.id));
  const snapshots = (snapshotsRes.data || []).filter((s) => allowedAccIds.has(s.account_id));

  return NextResponse.json({
    ok: true,
    share_label: payload.l || 'Nexty Shop • Live Tracker',
    hours,
    accounts,
    run_logs: logsRes.data || [],
    snapshots,
  });
}
