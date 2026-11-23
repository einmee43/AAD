import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/server';

interface RewardItem {
  name: string;
  amount: number;
  category?: string;
  rarity?: string;
}

const RARE_KEYWORDS = ['secret', 'mythic', 'portal', 'gold chest', 'relic', 'star remnant', 'divine'];

function isRareReward(item: RewardItem): boolean {
  const r = (item.rarity || '').toLowerCase();
  if (['secret', 'mythic', 'legendary', 'exotic'].includes(r)) return true;
  const n = (item.name || '').toLowerCase();
  return RARE_KEYWORDS.some((kw) => n.includes(kw));
}

async function sendDiscordAlert(
  webhookUrl: string,
  botName: string,
  mode: string,
  mapName: string,
  result: string,
  durationSec: number,
  rareItems: RewardItem[]
) {
  try {
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const itemLines = rareItems.map((i) => `• **${i.name}** x${i.amount}`).join('\n');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'AA Drop Tracker',
        embeds: [
          {
            title: `✨ Rare Drop Detected! (${botName})`,
            color: result === 'Win' ? 0x22c55e : 0xef4444,
            fields: [
              { name: 'Mode / Map', value: `${mode} — ${mapName}`, inline: true },
              { name: 'Result / Time', value: `${result} (${mins}m ${secs}s)`, inline: true },
              { name: 'Rare Rewards', value: itemLines || 'None', inline: false },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch {
    // Non-blocking alert
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const headerKey =
      request.headers.get('x-api-key') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const apiKey = headerKey || body.api_key;

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
    }

    const admin = createAdminSupabase();

    const { data: keyRow, error: keyErr } = await admin
      .from('api_keys')
      .select('id, user_id, discord_webhook_url, alert_on_rare')
      .eq('api_key', apiKey.trim())
      .single();

    if (keyErr || !keyRow) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const userId = keyRow.user_id;
    const eventType = body.event_type || 'heartbeat';
    const botName = String(body.bot_name || 'Bot 1').slice(0, 64);
    const nowIso = new Date().toISOString();

    // Update API key last_used_at
    await admin.from('api_keys').update({ last_used_at: nowIso }).eq('id', keyRow.id);

    // Upsert account status
    const accountPayload: Record<string, unknown> = {
      user_id: userId,
      bot_name: botName,
      roblox_username: body.roblox_username ? String(body.roblox_username).slice(0, 64) : undefined,
      roblox_user_id: typeof body.roblox_user_id === 'number' ? body.roblox_user_id : undefined,
      status: body.status || (eventType === 'run_complete' ? 'farming' : 'lobby'),
      current_mode: body.current_mode || body.mode || null,
      current_map: body.current_map || body.map_name || null,
      current_wave: body.current_wave ? String(body.current_wave) : null,
      last_heartbeat: nowIso,
      updated_at: nowIso,
    };

    // Clean undefined keys
    Object.keys(accountPayload).forEach(
      (k) => accountPayload[k] === undefined && delete accountPayload[k]
    );

    const { data: accountRow, error: accErr } = await admin
      .from('accounts')
      .upsert(accountPayload, { onConflict: 'user_id,bot_name' })
      .select('id')
      .single();

    if (accErr || !accountRow) {
      return NextResponse.json({ error: accErr?.message || 'Account upsert failed' }, { status: 500 });
    }

    // Update inventory snapshot if provided
    if (body.currencies || body.items) {
      await admin.from('inventory_snapshots').upsert(
        {
          user_id: userId,
          account_id: accountRow.id,
          currencies: body.currencies || {},
          items: Array.isArray(body.items) ? body.items : [],
          updated_at: nowIso,
        },
        { onConflict: 'account_id' }
      );
    }

    // Insert run_log on run_complete
    if (eventType === 'run_complete') {
      const rewards: RewardItem[] = Array.isArray(body.rewards) ? body.rewards : [];
      const mode = String(body.mode || 'Dungeon').slice(0, 64);
      const mapName = String(body.map_name || 'Unknown').slice(0, 128);
      const result = body.result === 'Lose' ? 'Lose' : 'Win';
      const durationSec = Math.max(0, Math.floor(Number(body.duration_sec) || 0));

      const { error: logErr } = await admin.from('run_logs').insert({
        user_id: userId,
        account_id: accountRow.id,
        bot_name: botName,
        mode,
        map_name: mapName,
        result,
        duration_sec: durationSec,
        rewards,
      });

      if (logErr) {
        return NextResponse.json({ error: logErr.message }, { status: 500 });
      }

      if (keyRow.discord_webhook_url && keyRow.alert_on_rare) {
        const rareItems = rewards.filter(isRareReward);
        if (rareItems.length > 0) {
          await sendDiscordAlert(
            keyRow.discord_webhook_url,
            botName,
            mode,
            mapName,
            result,
            durationSec,
            rareItems
          );
        }
      }
    }

    return NextResponse.json({ ok: true, event_type: eventType, account_id: accountRow.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid payload' },
      { status: 400 }
    );
  }
}
