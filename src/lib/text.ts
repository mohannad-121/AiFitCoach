const MOJIBAKE_PATTERN = /(?:\u00c3.|\u00d8.|\u00d9.|\u00f0\u0178|\u00e2\u20ac|\u00e2\u20ac\u2122|\u00e2\u20ac\u0153|\u00e2\u20ac\u009d|\u00c2|[\u201a-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20AC\u2122\u0152\u0153\u0160\u0161\u0178\u017D\u017E])/;
const ARABIC_CHAR_PATTERN = /[\u0600-\u06FF]/g;
const ARABIC_CHAR_DETECTION_PATTERN = /[\u0600-\u06FF]/;
const MOJIBAKE_MARKERS = ['\u00d8', '\u00d9', '\u00c3', '\u00c2', '\u00d0', '\u00e2', '\u00ef\u00bb\u00bf'] as const;
const BIDI_LTR_RUN_PATTERN = /\d[\d.,/%:+\-]*(?:\s+(?:[A-Za-z\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF/%:+\-]*)){0,2}/g;
const LTR_ISOLATE = '\u2066';
const POP_DIRECTIONAL_ISOLATE = '\u2069';

const CP1252_REVERSE_MAP: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function decodeLatin1AsUtf8(value: string): string | null {
  const bytes: number[] = [];

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }

    const mapped = CP1252_REVERSE_MAP[code];
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }

    return null;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

function scoreText(value: string): number {
  const arabicChars = (value.match(ARABIC_CHAR_PATTERN) || []).length;
  const markerChars = MOJIBAKE_MARKERS.reduce((total, marker) => total + value.split(marker).length - 1, 0);
  const replacementChars = (value.match(/[\uFFFD?]/g) || []).length;
  return (arabicChars * 3) - (markerChars * 2) - (replacementChars * 2);
}

export function repairMojibake(value: string): string {
  if (!value) return value;
  if (!MOJIBAKE_PATTERN.test(value)) return value;

  let repaired = value;
  for (let i = 0; i < 2; i += 1) {
    if (!MOJIBAKE_PATTERN.test(repaired)) break;
    const decoded = decodeLatin1AsUtf8(repaired);
    if (!decoded || decoded === repaired) break;
    if (scoreText(decoded) <= scoreText(repaired)) break;
    repaired = decoded;
  }

  return repaired.replace(/\uFFFD/g, '');
}

export function containsArabic(value: string): boolean {
  return ARABIC_CHAR_DETECTION_PATTERN.test(value || '');
}

export function getTextDirection(value: string): 'rtl' | 'ltr' | 'auto' {
  const text = repairMojibake(value || '').trim();
  if (!text) return 'auto';

  const arabicCount = (text.match(ARABIC_CHAR_PATTERN) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;

  if (arabicCount === 0 && latinCount === 0) return 'auto';
  if (arabicCount >= Math.max(2, latinCount * 0.35)) return 'rtl';
  if (latinCount > 0) return 'ltr';
  return 'auto';
}

export function bilingualLabel(english: string, arabic: string, language: 'en' | 'ar'): string {
  const en = repairMojibake(english || '');
  const ar = repairMojibake(arabic || '');

  if (!en) return ar;
  if (!ar) return en;

  return language === 'ar' ? `${ar} / ${en}` : `${en} / ${ar}`;
}

export function localizedLabel(english: string, arabic: string, language: 'en' | 'ar'): string {
  const en = repairMojibake(english || '');
  const ar = repairMojibake(arabic || '');

  if (language === 'ar') return ar || en;
  return en || ar;
}

export function stabilizeBidiNumbers(value: string): string {
  if (!value) return value;
  if (!ARABIC_CHAR_DETECTION_PATTERN.test(value) || !BIDI_LTR_RUN_PATTERN.test(value)) {
    BIDI_LTR_RUN_PATTERN.lastIndex = 0;
    return value;
  }

  BIDI_LTR_RUN_PATTERN.lastIndex = 0;
  return value.replace(BIDI_LTR_RUN_PATTERN, (match) => `${LTR_ISOLATE}${match}${POP_DIRECTIONAL_ISOLATE}`);
}
