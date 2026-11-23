import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data || [] });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const label = String(body.label || 'MuMu Farm').slice(0, 50);
  const webhook = body.discord_webhook_url ? String(body.discord_webhook_url).trim() : null;
  const apiKey = `aa_live_${crypto.randomBytes(18).toString('hex')}`;

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      user_id: user.id,
      label,
      api_key: apiKey,
      discord_webhook_url: webhook,
      alert_on_rare: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data });
}

export async function PATCH(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = String(body.label).slice(0, 50);
  if (body.discord_webhook_url !== undefined)
    updates.discord_webhook_url = body.discord_webhook_url
      ? String(body.discord_webhook_url).trim()
      : null;
  if (body.alert_on_rare !== undefined) updates.alert_on_rare = Boolean(body.alert_on_rare);

  const { data, error } = await supabase
    .from('api_keys')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data });
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
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase.from('api_keys').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
