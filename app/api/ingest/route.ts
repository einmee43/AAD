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
  allRewards: RewardItem[],
  rareItems: RewardItem[]
) {
  try {
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const isPortal =
      mode.toLowerCase().includes('portal') || mapName.toLowerCase().includes('portal');

    const title =
      rareItems.length > 0
        ? `✨ Rare Drop! (${botName})`
        : isPortal
        ? `${result === 'Win' ? '🌌' : '💀'} Portal ${result === 'Win' ? 'Cleared' : 'Failed'}! (${botName})`
        : `🎮 Run ${result} (${botName})`;

    const rareNames = new Set(rareItems.map((i) => i.name.toLowerCase()));
    const rewardLines =
      allRewards.length > 0
        ? allRewards
            .map((i) => {
              const tag = rareNames.has(i.name.toLowerCase()) ? '🔥 **[RARE]** ' : '• ';
              return `${tag}**${i.name}** x${Number(i.amount || 0).toLocaleString()}`;
            })
            .join('\n')
        : 'ไม่มีข้อมูลของดรอป (หรือไม่ได้รับเพิ่ม)';

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Nexty Hub Tracker',
        embeds: [
          {
            title,
            color:
              rareItems.length > 0 ? 0xf59e0b : result === 'Win' ? 0x22c55e : 0xef4444,
            fields: [
              { name: 'โหมด / ด่าน', value: `${mode} — ${mapName}`, inline: true },
              { name: 'ผลลัพธ์ / เวลา', value: `${result} (${mins}m ${secs}s)`, inline: true },
              { name: 'ของรางวัลที่ได้', value: rewardLines.slice(0, 1000), inline: false },
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

    // Update inventory snapshot if provided (preserve existing currencies like Dawn Coins, _team & _units)
    if (
      body.currencies ||
      body.items ||
      Array.isArray(body.team) ||
      Array.isArray(body.units)
    ) {
      const { data: existingSnap } = await admin
        .from('inventory_snapshots')
        .select('currencies, items')
        .eq('account_id', accountRow.id)
        .maybeSingle();

      const mergedCurrencies: Record<string, unknown> = {
        ...(existingSnap?.currencies && typeof existingSnap.currencies === 'object'
          ? existingSnap.currencies
          : {}),
        ...(body.currencies && typeof body.currencies === 'object' ? body.currencies : {}),
      };

      if (Array.isArray(body.team) && body.team.length > 0) {
        mergedCurrencies._team = body.team;
      }

      if (Array.isArray(body.units) && body.units.length > 0) {
        mergedCurrencies._units = body.units;
      }

      const incomingItems: RewardItem[] = Array.isArray(body.items) ? body.items : [];
      const existingItems: RewardItem[] = Array.isArray(existingSnap?.items)
        ? (existingSnap.items as RewardItem[])
        : [];

      const isPortalItem = (it: RewardItem) =>
        it.category === 'portal' || (it.name || '').toLowerCase().includes('portal');

      for (const it of incomingItems) {
        if ((it.name || '').toLowerCase().includes('dawn coin') && typeof it.amount === 'number') {
          mergedCurrencies['Dawn Coins'] = it.amount;
        }
      }

      const incomingPortals = incomingItems.filter(isPortalItem);
      const incomingRegular = incomingItems.filter((it) => !isPortalItem(it));
      const existingPortals = existingItems.filter(
        (it) => isPortalItem(it) && (it.name || '').toLowerCase() !== 'portals'
      );
      const existingRegular = existingItems.filter((it) => !isPortalItem(it));

      const mergedItems =
        body.items_complete === true && incomingItems.length > 0
          ? incomingItems.filter((it) => (it.name || '').toLowerCase() !== 'portals')
          : [
              ...(incomingPortals.length > 0 ? incomingPortals : existingPortals),
              ...(incomingRegular.length > 0 ? incomingRegular : existingRegular),
            ];

      await admin.from('inventory_snapshots').upsert(
        {
          user_id: userId,
          account_id: accountRow.id,
          currencies: mergedCurrencies,
          items: mergedItems,
          updated_at: nowIso,
        },
        { onConflict: 'account_id' }
      );
    }

    // Insert run_log on run_complete
    if (eventType === 'run_complete') {
      const rawRewards: RewardItem[] = Array.isArray(body.rewards) ? body.rewards : [];
      const rewards = rawRewards.filter((r) => {
        const n = String(r?.name || '').trim().toLowerCase();
        if (!n) return false;
        if (
          /\b(xp|exp)\b/i.test(n) ||
          n.includes('xp progress') ||
          n.includes('unit exp') ||
          n.includes('unit xp') ||
          n.includes('player xp') ||
          n.includes('player exp')
        ) {
          return false;
        }
        return true;
      });
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

      if (keyRow.discord_webhook_url) {
        const rareItems = rewards.filter(isRareReward);
        const isPortalRun =
          mode.toLowerCase().includes('portal') || mapName.toLowerCase().includes('portal');
        if ((keyRow.alert_on_rare && rareItems.length > 0) || isPortalRun) {
          await sendDiscordAlert(
            keyRow.discord_webhook_url,
            botName,
            mode,
            mapName,
            result,
            durationSec,
            rewards,
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
