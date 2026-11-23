import { NextRequest, NextResponse } from 'next/server';

function getCdnUrl(hash: string): string {
  if (hash.startsWith('http://') || hash.startsWith('https://')) return hash;
  let i = 31;
  for (let t = 0; t < 38 && t < hash.length; t++) {
    i ^= hash.charCodeAt(t);
  }
  return `https://t${i % 8}.rbxcdn.com/${hash}`;
}

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get('hash');
  if (hash) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(hash)) {
      return NextResponse.json({ error: 'Invalid hash' }, { status: 400 });
    }
    try {
      const targetUrl = getCdnUrl(hash);
      const upstream = await fetch(targetUrl, {
        next: { revalidate: 86400 },
      });
      if (!upstream.ok) {
        return new NextResponse('Upstream error', { status: upstream.status });
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    } catch {
      return NextResponse.json({ error: 'CDN fetch failed' }, { status: 502 });
    }
  }

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId || !/^\d+$/.test(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  }

  const apiKey = process.env.ROBLOX_OPEN_CLOUD_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ available: false, reason: 'NO_API_KEY' });
  }

  try {
    let imageUrl: string | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const thumbRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`,
        {
          headers: { 'x-api-key': apiKey },
          cache: 'no-store',
        }
      );
      if (!thumbRes.ok) {
        return NextResponse.json({
          available: false,
          reason: `UPSTREAM_${thumbRes.status}`,
        });
      }
      const thumbJson = (await thumbRes.json()) as {
        state?: string;
        imageUrl?: string;
      };
      if (thumbJson.state === 'Completed' && thumbJson.imageUrl) {
        imageUrl = thumbJson.imageUrl;
        break;
      }
      await new Promise((r) => setTimeout(r, 450));
    }

    if (!imageUrl) {
      return NextResponse.json({ available: false, reason: 'PENDING_TIMEOUT' });
    }

    const manifestRes = await fetch(imageUrl, { cache: 'no-store' });
    if (!manifestRes.ok) {
      return NextResponse.json({ available: false, reason: 'MANIFEST_FAILED' });
    }
    const manifest = (await manifestRes.json()) as {
      obj?: string;
      mtl?: string;
      aabb?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    };

    if (!manifest.obj || !manifest.mtl) {
      return NextResponse.json({ available: false, reason: 'INCOMPLETE_MANIFEST' });
    }

    const [objRes, mtlRes] = await Promise.all([
      fetch(getCdnUrl(manifest.obj), { next: { revalidate: 86400 } }),
      fetch(getCdnUrl(manifest.mtl), { next: { revalidate: 86400 } }),
    ]);

    if (!objRes.ok || !mtlRes.ok) {
      return NextResponse.json({ available: false, reason: 'MESH_FAILED' });
    }

    const objText = await objRes.text();
    const rawMtl = await mtlRes.text();

    // Rewrite texture hashes to same-origin cached proxy & strip map_d/map_Ka (Roblox puts RGBA in map_d which breaks Three.js opacity)
    const mtlLines = rawMtl.split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('map_d ') || trimmed.startsWith('map_Ka ')) {
        return [];
      }
      if (trimmed.startsWith('map_Kd ')) {
        const ref = trimmed.slice(7).trim();
        const cleanHash = ref.replace(/^https?:\/\/[^/]+\//, '');
        return [`map_Kd /api/avatar-3d?hash=${encodeURIComponent(cleanHash)}`];
      }
      return [line];
    });

    return NextResponse.json(
      {
        available: true,
        objText,
        mtlText: mtlLines.join('\n'),
        aabb: manifest.aabb || null,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch {
    return NextResponse.json({ available: false, reason: 'FETCH_ERROR' });
  }
}
