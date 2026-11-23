import { NextRequest, NextResponse } from 'next/server';

type WikiPage = {
  title?: string;
  thumbnail?: { source?: string };
  images?: Array<{ title?: string }>;
};

export async function GET(req: NextRequest) {
  const imgParam = req.nextUrl.searchParams.get('img');
  if (imgParam) {
    if (!imgParam.startsWith('https://static.wikia.nocookie.net/animeadventures/')) {
      return NextResponse.json({ error: 'Invalid image host' }, { status: 400 });
    }
    try {
      const upstream = await fetch(imgParam, {
        headers: { Referer: 'https://animeadventures.fandom.com/' },
        next: { revalidate: 86400 },
      });
      if (!upstream.ok) {
        return new NextResponse('Image fetch failed', { status: upstream.status });
      }
      const contentType = upstream.headers.get('content-type') || 'image/png';
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    } catch {
      return NextResponse.json({ error: 'Proxy failed' }, { status: 502 });
    }
  }

  const rawNames = req.nextUrl.searchParams.get('names') || '';
  const names = rawNames
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (names.length === 0) {
    return NextResponse.json({ icons: {} });
  }

  try {
    const queryUrl =
      'https://animeadventures.fandom.com/api.php?action=query&titles=' +
      encodeURIComponent(names.join('|')) +
      '&prop=pageimages|images&pithumbsize=200&imlimit=50&format=json&redirects=1';

    const res = await fetch(queryUrl, { next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json({ icons: {} });
    }

    const data = (await res.json()) as {
      query?: {
        redirects?: Array<{ from: string; to: string }>;
        normalized?: Array<{ from: string; to: string }>;
        pages?: Record<string, WikiPage>;
      };
    };

    const aliasToTitle = new Map<string, string>();
    for (const r of data.query?.redirects || []) aliasToTitle.set(r.from, r.to);
    for (const n of data.query?.normalized || []) aliasToTitle.set(n.from, n.to);

    const icons: Record<string, string> = {};
    const fallbackFileToTitles = new Map<string, string[]>();

    for (const page of Object.values(data.query?.pages || {})) {
      const title = page.title;
      if (!title) continue;
      if (page.thumbnail?.source) {
        icons[title] = page.thumbnail.source;
      } else {
        const candidates = (page.images || [])
          .map((im) => im.title || '')
          .filter(
            (t) =>
              t &&
              !/Damage type|Star Fruit|Sacred Treasure|Mythic|Legendary|Secret|Gem|Gold|Trait|Icon/i.test(
                t
              )
          );
        const pick =
          candidates.find((c) => !c.toLowerCase().includes('shiny')) || candidates[0];
        if (pick) {
          const list = fallbackFileToTitles.get(pick) || [];
          list.push(title);
          fallbackFileToTitles.set(pick, list);
        }
      }
    }

    if (fallbackFileToTitles.size > 0) {
      const fileQuery =
        'https://animeadventures.fandom.com/api.php?action=query&titles=' +
        encodeURIComponent(Array.from(fallbackFileToTitles.keys()).join('|')) +
        '&prop=imageinfo&iiprop=url&iiurlwidth=200&format=json';

      const fRes = await fetch(fileQuery, { next: { revalidate: 86400 } });
      if (fRes.ok) {
        const fData = (await fRes.json()) as {
          query?: {
            pages?: Record<
              string,
              { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }
            >;
          };
        };
        for (const fp of Object.values(fData.query?.pages || {})) {
          const fileTitle = fp.title;
          const imgUrl = fp.imageinfo?.[0]?.thumburl || fp.imageinfo?.[0]?.url;
          if (fileTitle && imgUrl) {
            for (const unitTitle of fallbackFileToTitles.get(fileTitle) || []) {
              icons[unitTitle] = imgUrl;
            }
          }
        }
      }
    }

    const result: Record<string, string> = {};
    for (const reqName of names) {
      let resolved = reqName;
      for (let i = 0; i < 3; i++) {
        const next = aliasToTitle.get(resolved);
        if (!next) break;
        resolved = next;
      }
      const rawUrl = icons[resolved] || icons[reqName];
      if (rawUrl) {
        result[reqName] = `/api/unit-icons?img=${encodeURIComponent(rawUrl)}`;
      }
    }

    return NextResponse.json(
      { icons: result },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      }
    );
  } catch {
    return NextResponse.json({ icons: {} });
  }
}
