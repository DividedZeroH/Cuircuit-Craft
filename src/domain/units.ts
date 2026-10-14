/** SI formatting and parsing. Pure functions; the locale is injected by the caller. */

const PREFIXES: Record<number, string> = { [-12]: 'p', [-9]: 'n', [-6]: 'µ', [-3]: 'm', 0: '', 3: 'k', 6: 'M' };
const MULTIPLIERS: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, '': 1 };

let numberLocale = 'en-US';
export function setNumberLocale(locale: string): void { numberLocale = locale; }
export function getNumberLocale(): string { return numberLocale; }

/** 4700 → "4.7 kΩ" (with the active locale's decimal mark). */
export function formatSI(value: number, unit: string): string {
  if (!isFinite(value)) return '∞ ' + unit;
  const abs = Math.abs(value);
  if (abs < 1e-12) return '0 ' + unit;
  let exp = Math.floor(Math.log10(abs) / 3) * 3;
  exp = Math.max(-12, Math.min(6, exp));
  let mantissa = value / Math.pow(10, exp);
  if (Math.abs(mantissa) >= 999.5 && exp < 6) { exp += 3; mantissa = value / Math.pow(10, exp); }
  return mantissa.toLocaleString(numberLocale, { maximumSignificantDigits: 3, useGrouping: false }) + ' ' + PREFIXES[exp] + unit;
}

/** Plain numbers for the sheet: 0.5 → "0.5", 47000 → "47 k". */
export function formatNumber(value: number): string | null {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs === 0 || (abs >= 0.01 && abs < 10000)) return value.toLocaleString(numberLocale, { maximumSignificantDigits: 4, useGrouping: false });
  return formatSI(value, '').trim();
}

/** "4,7k", "4.7 kΩ", "100u" → number. Returns NaN when it cannot read the text. */
export function parseSI(text: string): number {
  const s = String(text).trim().replace(',', '.').replace(/ohm|Ω|Hz|F|V|H/g, '').replace(/\s+/g, '');
  const m = s.match(/^(\d*\.?\d+)([pnuµmkKM]?)$/);
  if (!m) return NaN;
  return parseFloat(m[1]) * MULTIPLIERS[m[2]];
}

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
