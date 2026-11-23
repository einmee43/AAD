import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const hours = Math.min(720, Math.max(1, Number(searchParams.get('hours')) || 24));
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const [accountsRes, logsRes, snapshotsRes] = await Promise.all([
    supabase.from('accounts').select('*').order('bot_name', { ascending: true }),
    supabase
      .from('run_logs')
      .select('*')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('inventory_snapshots').select('*'),
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

  return NextResponse.json({
    accounts,
    run_logs: logsRes.data || [],
    snapshots: snapshotsRes.data || [],
    hours,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get('action') === 'clear_logs') {
    const { error } = await supabase.from('run_logs').delete().eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
