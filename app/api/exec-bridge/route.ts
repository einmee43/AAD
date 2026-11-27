import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/server';

const BRIDGE_TOKEN = process.env.EXECUTOR_BRIDGE_TOKEN || 'nexty-exec-bridge-v1';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-bridge-token') || req.nextUrl.searchParams.get('token');
  if (token !== BRIDGE_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.storage.from('exec-bridge').download('tunnel.json');
    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: 'Tunnel URL not registered yet' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const parsed = JSON.parse(await data.text());
    return NextResponse.json(
      { ok: true, tunnel_url: parsed.tunnel_url || null, updated_at: parsed.updated_at || null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to read tunnel' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
