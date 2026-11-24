import crypto from 'crypto';

export interface SharePayload {
  v: 1;
  u: string; // owner user_id
  b?: string[]; // optional scoped bot names
  l?: string; // optional shop/order label
  h?: number; // default hours window
  iat: number;
}

function getSigningSecret(): string {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'fallback-dev-secret';
  return crypto.createHash('sha256').update(`${base}:nexty-hub-share-v1`).digest('hex');
}

export function createShareToken(payload: Omit<SharePayload, 'v' | 'iat'>): string {
  const full: SharePayload = {
    v: 1,
    u: payload.u,
    ...(payload.b && payload.b.length > 0 ? { b: payload.b.slice(0, 20) } : {}),
    ...(payload.l ? { l: payload.l.slice(0, 60) } : {}),
    ...(payload.h ? { h: payload.h } : {}),
    iat: Math.floor(Date.now() / 1000),
  };
  const data = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyShareToken(token: string): SharePayload | null {
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    if (!data || !sig) return null;

    const expectedSig = crypto
      .createHmac('sha256', getSigningSecret())
      .update(data)
      .digest('base64url');

    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SharePayload;
    if (!parsed || parsed.v !== 1 || typeof parsed.u !== 'string' || !parsed.u) return null;
    return parsed;
  } catch {
    return null;
  }
}
