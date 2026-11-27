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

interface TowerInfo {
  infinite_room?: number;
  active_room?: number;
  active_event_floor?: number;
  season?: string;
  rank_title?: string;
  rank_pct?: string;
  event_floors?: Record<string, number>;
  dungeon_depth?: number;
}

function formatEventTowerKey(key: string): string {
  return key
    .replace(/^event_tower_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function sendDiscordTowerAlert(
  webhookUrl: string,
  botName: string,
  headline: string,
  tower: TowerInfo,
  extraFields: Array<{ name: string; value: string; inline?: boolean }> = []
) {
  try {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    if (typeof tower.infinite_room === 'number' && tower.infinite_room > 0) {
      fields.push({
        name: '🏰 Infinity Mansion (สูงสุด)',
        value: `**Room ${tower.infinite_room}**`,
        inline: true,
      });
    }

    if (typeof tower.active_room === 'number' && tower.active_room > 0) {
      fields.push({
        name: '⚔️ กำลังไต่ชั้น',
        value: `**Room ${tower.active_room}**`,
        inline: true,
      });
    }

    if (tower.season || tower.rank_title || tower.rank_pct) {
      const rankParts = [tower.season, tower.rank_title, tower.rank_pct].filter(Boolean);
      fields.push({
        name: '🏆 ซีซั่น / แรงก์',
        value: rankParts.join(' • '),
        inline: true,
      });
    }

    if (tower.event_floors && Object.keys(tower.event_floors).length > 0) {
      const evLines = Object.entries(tower.event_floors)
        .filter(([, fl]) => typeof fl === 'number' && fl > 0)
        .map(([k, fl]) => `${formatEventTowerKey(k)}: **Floor ${fl}**`);
      if (evLines.length > 0) {
        fields.push({
          name: '🗼 Event Tower',
          value: evLines.join('\n'),
          inline: true,
        });
      }
    }

    if (typeof tower.active_event_floor === 'number' && tower.active_event_floor > 0) {
      fields.push({
        name: '⚔️ กำลังลง Event Tower',
        value: `**Floor ${tower.active_event_floor}**`,
        inline: true,
      });
    }

    for (const f of extraFields) {
      fields.push(f);
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Nexty Hub Tracker',
        embeds: [
          {
            title: `🏰 Tower Alert • ${botName}`,
            description: headline,
            color: 0xa855f7,
            fields,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch {
    // Non-blocking alert
  }
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
    let mergedTowerForAlert: TowerInfo | null = null;
    let towerAlertSent = false;

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

      const prevCurrencies =
        existingSnap?.currencies && typeof existingSnap.currencies === 'object'
          ? (existingSnap.currencies as Record<string, unknown>)
          : {};
      const incomingCurrencies =
        body.currencies && typeof body.currencies === 'object'
          ? (body.currencies as Record<string, unknown>)
          : {};

      const mergedCurrencies: Record<string, unknown> = {
        ...prevCurrencies,
        ...incomingCurrencies,
      };

      const prevTower =
        prevCurrencies._tower && typeof prevCurrencies._tower === 'object'
          ? (prevCurrencies._tower as TowerInfo)
          : null;
      const incomingTower =
        incomingCurrencies._tower && typeof incomingCurrencies._tower === 'object'
          ? (incomingCurrencies._tower as TowerInfo)
          : null;

      if (prevTower || incomingTower) {
        const mergedEventFloors: Record<string, number> = {
          ...(prevTower?.event_floors || {}),
          ...(incomingTower?.event_floors || {}),
        };
        const isLobbyNow = body.status === 'lobby';
        const resolvedTower: TowerInfo = {
          ...(prevTower || {}),
          ...(incomingTower || {}),
          event_floors: Object.keys(mergedEventFloors).length > 0 ? mergedEventFloors : undefined,
        };
        if (isLobbyNow) {
          delete resolvedTower.active_room;
          delete resolvedTower.active_event_floor;
        } else if (incomingTower) {
          resolvedTower.active_room = incomingTower.active_room;
          resolvedTower.active_event_floor = incomingTower.active_event_floor;
        }
        mergedCurrencies._tower = resolvedTower;
        mergedTowerForAlert = resolvedTower;

        if (keyRow.discord_webhook_url && incomingTower) {
          const changeLines: string[] = [];
          const prevInf = Number(prevTower?.infinite_room || 0);
          const nextInf = Number(resolvedTower.infinite_room || 0);
          if (prevInf > 0 && nextInf > prevInf) {
            changeLines.push(`🎉 ปลดล็อกชั้นใหม่ Infinity Mansion: **Room ${prevInf} ➔ Room ${nextInf}**`);
          }

          const prevActRoom = Number(prevTower?.active_room || 0);
          const nextActRoom = Number(resolvedTower.active_room || 0);
          if (nextActRoom > 0 && nextActRoom !== prevActRoom) {
            changeLines.push(`⚔️ บอทกำลังเข้าสู้ Infinity Mansion: **Room ${nextActRoom}**`);
          }

          const prevEvMap = prevTower?.event_floors || {};
          const nextEvMap = resolvedTower.event_floors || {};
          for (const [k, fl] of Object.entries(nextEvMap)) {
            const pFl = Number(prevEvMap[k] || 0);
            if (pFl > 0 && fl > pFl) {
              changeLines.push(
                `🗼 ปลดล็อกชั้นใหม่ ${formatEventTowerKey(k)}: **Floor ${pFl} ➔ Floor ${fl}**`
              );
            }
          }

          const prevActEv = Number(prevTower?.active_event_floor || 0);
          const nextActEv = Number(resolvedTower.active_event_floor || 0);
          if (nextActEv > 0 && nextActEv !== prevActEv) {
            changeLines.push(`⚔️ บอทกำลังเข้าสู้ Event Tower: **Floor ${nextActEv}**`);
          }

          if (changeLines.length > 0) {
            towerAlertSent = true;
            await sendDiscordTowerAlert(
              keyRow.discord_webhook_url,
              botName,
              changeLines.join('\n'),
              resolvedTower
            );
          }
        }
      }

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
        const isTowerRun =
          mode.toLowerCase().includes('tower') ||
          mapName.toLowerCase().includes('infinity mansion') ||
          mapName.toLowerCase().includes('infinite tower') ||
          /\broom\s*\d+/i.test(mapName);
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
        } else if (isTowerRun && !towerAlertSent) {
          const mins = Math.floor(durationSec / 60);
          const secs = durationSec % 60;
          await sendDiscordTowerAlert(
            keyRow.discord_webhook_url,
            botName,
            `${result === 'Win' ? '✅ จบด่านหอคอย' : '💀 แพ้ด่านหอคอย'}: **${mapName}**`,
            mergedTowerForAlert || {},
            [
              {
                name: 'ผลลัพธ์ / เวลา',
                value: `${result} (${mins}m ${secs}s)`,
                inline: true,
              },
            ]
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
