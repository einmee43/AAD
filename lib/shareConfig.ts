export type ShareSectionKey =
  | 'status'
  | 'currencies'
  | 'gained'
  | 'inventory'
  | 'units'
  | 'battlepass'
  | 'tower'
  | 'history'
  | 'overview';

export type ShareCurrencyKey =
  | 'level'
  | 'gems'
  | 'pearls'
  | 'gold'
  | 'dawn'
  | 'reroll'
  | 'remnant';

export const ALL_SHARE_SECTIONS: ShareSectionKey[] = [
  'status',
  'currencies',
  'gained',
  'inventory',
  'units',
  'battlepass',
  'tower',
  'history',
  'overview',
];

export const ALL_SHARE_CURRENCIES: ShareCurrencyKey[] = [
  'level',
  'gems',
  'pearls',
  'gold',
  'dawn',
  'reroll',
  'remnant',
];

export interface ShareVisibilityConfig {
  sections: ShareSectionKey[];
  currencies: ShareCurrencyKey[];
  focusKeywords: string[];
}

export const SHARE_SECTION_META: Array<{
  key: ShareSectionKey;
  label: string;
  desc: string;
}> = [
  { key: 'status', label: 'สถานะ & ด่านที่ฟาร์ม', desc: 'ออนไลน์ / ด่าน / เวฟปัจจุบัน' },
  { key: 'currencies', label: 'เงิน & ทรัพยากรหลัก', desc: 'Gems / Gold / Reroll / Remnant' },
  { key: 'gained', label: 'ของที่ได้จากการฟาร์ม', desc: 'สรุปยอดของดรอประหว่างฟาร์ม' },
  { key: 'inventory', label: 'คลังไอเทมในกระเป๋า', desc: 'Portals / วัตถุดิบ / ดาว / คีย์ / สกิน' },
  { key: 'units', label: 'ทีม & คลังยูนิต', desc: 'ยูนิต 6 ช่องที่ใส่ & ยูนิตทั้งหมด' },
  { key: 'battlepass', label: 'Battle Pass', desc: 'เลเวลและขั้นที่ปลดล็อกแล้ว' },
  { key: 'tower', label: 'หอคอย (Misty / Infinity)', desc: 'ชั้น Infinity Mansion & Event Tower' },
  { key: 'history', label: 'ประวัติดรอป & Winrate', desc: 'ประวัติรอบที่ลงและเวลาเฉลี่ย' },
  { key: 'overview', label: 'หน้าภาพรวมหลายบอท', desc: 'ตารางเปรียบเทียบบอททั้งหมด' },
];

export const SHARE_CURRENCY_META: Array<{
  key: ShareCurrencyKey;
  label: string;
}> = [
  { key: 'level', label: 'Level / XP' },
  { key: 'gems', label: 'Gems' },
  { key: 'pearls', label: 'Summer Pearls' },
  { key: 'gold', label: 'Gold' },
  { key: 'dawn', label: 'Dawn Coins' },
  { key: 'reroll', label: 'Trait Reroll' },
  { key: 'remnant', label: 'Star Remnant' },
];

export const SHARE_PRESETS: Array<{
  id: string;
  label: string;
  sections: ShareSectionKey[];
  currencies: ShareCurrencyKey[];
  focusKeywords?: string[];
}> = [
  {
    id: 'all',
    label: 'ทั้งหมด (ค่าเริ่มต้น)',
    sections: ALL_SHARE_SECTIONS,
    currencies: ALL_SHARE_CURRENCIES,
    focusKeywords: [],
  },
  {
    id: 'gems_loot',
    label: 'ฟาร์มเพชร / รีโรล / เศษดาว',
    sections: ['status', 'currencies', 'gained', 'history'],
    currencies: ['gems', 'reroll', 'remnant', 'dawn'],
    focusKeywords: [],
  },
  {
    id: 'tower',
    label: 'ลงหอคอย (Misty / Infinity)',
    sections: ['status', 'tower', 'currencies', 'history'],
    currencies: ['dawn', 'remnant', 'gems'],
    focusKeywords: [],
  },
  {
    id: 'battlepass',
    label: 'ปั้น Battle Pass',
    sections: ['status', 'battlepass', 'history'],
    currencies: [],
    focusKeywords: [],
  },
  {
    id: 'portal_bag',
    label: 'หา Portal / ของในคลัง',
    sections: ['status', 'gained', 'inventory', 'history'],
    currencies: [],
    focusKeywords: [],
  },
];

export function resolveShareVisibility(raw?: {
  s?: ShareSectionKey[];
  c?: ShareCurrencyKey[];
  f?: string[];
} | null): ShareVisibilityConfig {
  const validSecSet = new Set<ShareSectionKey>(ALL_SHARE_SECTIONS);
  const validCurSet = new Set<ShareCurrencyKey>(ALL_SHARE_CURRENCIES);

  const sections =
    Array.isArray(raw?.s) && raw.s.length > 0
      ? raw.s.filter((k): k is ShareSectionKey => validSecSet.has(k))
      : ALL_SHARE_SECTIONS;

  const currencies =
    Array.isArray(raw?.c) && raw.c.length > 0
      ? raw.c.filter((k): k is ShareCurrencyKey => validCurSet.has(k))
      : ALL_SHARE_CURRENCIES;

  const focusKeywords = Array.isArray(raw?.f)
    ? raw.f.map((x) => String(x).trim()).filter(Boolean).slice(0, 15)
    : [];

  return {
    sections: sections.length > 0 ? sections : ALL_SHARE_SECTIONS,
    currencies,
    focusKeywords,
  };
}

export function matchesFocusKeywords(
  itemName: string,
  keywords: string[],
  category?: string
): boolean {
  if (!keywords || keywords.length === 0) return true;
  const n = (itemName || '').toLowerCase();
  const c = (category || '').toLowerCase();
  return keywords.some((kw) => {
    const k = kw.trim().toLowerCase();
    return k.length > 0 && (n.includes(k) || c.includes(k));
  });
}
