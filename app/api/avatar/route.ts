import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId || !/^\d+$/.test(userId) || Number(userId) <= 0) {
    return NextResponse.json({ imageUrl: null }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) {
      return NextResponse.json({ imageUrl: null }, { status: 502 });
    }
    const json = await res.json();
    const imageUrl = json?.data?.[0]?.imageUrl || null;
    return NextResponse.json({ imageUrl });
  } catch {
    return NextResponse.json({ imageUrl: null }, { status: 500 });
  }
}
