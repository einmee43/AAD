import crypto from 'crypto';
import {
  ALL_SHARE_CURRENCIES,
  ALL_SHARE_SECTIONS,
  type ShareCurrencyKey,
  type ShareSectionKey,
} from './shareConfig';

export interface SharePayload {
  v: 1;
  u: string; // owner user_id
  b?: string[]; // optional scoped bot names
  l?: string; // optional shop/order label
  h?: number; // default hours window
  s?: ShareSectionKey[]; // visible sections (omitted = all)
  c?: ShareCurrencyKey[]; // visible currency tiles (omitted = all)
  f?: string[]; // optional item/reward focus keyword filter
  iat: number;
}

function getSigningSecret(): string {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'fallback-dev-secret';
  return crypto.createHash('sha256').update(`${base}:nexty-hub-share-v1`).digest('hex');
}

export function createShareToken(payload: Omit<SharePayload, 'v' | 'iat'>): string {
  const cleanSections = Array.isArray(payload.s)
    ? payload.s.filter((k) => ALL_SHARE_SECTIONS.includes(k))
    : undefined;
  const cleanCurrencies = Array.isArray(payload.c)
    ? payload.c.filter((k) => ALL_SHARE_CURRENCIES.includes(k))
    : undefined;
  const cleanKeywords = Array.isArray(payload.f)
    ? payload.f.map((x) => String(x).trim().slice(0, 32)).filter(Boolean).slice(0, 15)
    : undefined;

  const includeSections =
    cleanSections &&
    cleanSections.length > 0 &&
    cleanSections.length < ALL_SHARE_SECTIONS.length;

  const includeCurrencies =
    cleanCurrencies &&
    cleanCurrencies.length > 0 &&
    cleanCurrencies.length < ALL_SHARE_CURRENCIES.length;

  const full: SharePayload = {
    v: 1,
    u: payload.u,
    ...(payload.b && payload.b.length > 0 ? { b: payload.b.slice(0, 20) } : {}),
    ...(payload.l ? { l: payload.l.slice(0, 60) } : {}),
    ...(payload.h ? { h: payload.h } : {}),
    ...(includeSections ? { s: cleanSections } : {}),
    ...(includeCurrencies ? { c: cleanCurrencies } : {}),
    ...(cleanKeywords && cleanKeywords.length > 0 ? { f: cleanKeywords } : {}),
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
