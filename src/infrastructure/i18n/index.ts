/** Translation service. English is the default and the fallback for missing keys. */
import { setNumberLocale } from '../../domain/units';
import { readValue, writeValue } from '../storage';
import * as de from './locales/de';
import * as en from './locales/en';
import * as es from './locales/es';
import * as ja from './locales/ja';
import * as pt from './locales/pt';
import type { Dictionary, Language } from './types';

export type { Language } from './types';

const BUNDLES: Record<Language, { strings: Dictionary; sheetSample: string[] }> = { en, es, pt, de, ja };

/** Names are written in their own language so anyone can find theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español', pt: 'Português', de: 'Deutsch', ja: '日本語' };
const NUMBER_LOCALE: Record<Language, string> = { en: 'en-US', es: 'es-AR', pt: 'pt-BR', de: 'de-DE', ja: 'ja-JP' };
const STORAGE_KEY = 'circuit-craft.lang';

let current: Language = 'en';
const listeners = new Set<(lang: Language) => void>();

export function t(key: string, ...args: Array<string | number>): string {
  let s = BUNDLES[current].strings[key] ?? BUNDLES.en.strings[key] ?? key;
  args.forEach((a, i) => { s = s.split('{' + i + '}').join(String(a)); });
  return s;
}

export const getLanguage = (): Language => current;

export function setLanguage(lang: Language): void {
  current = lang;
  setNumberLocale(NUMBER_LOCALE[lang]);
  document.documentElement.lang = lang;
  writeValue(STORAGE_KEY, lang);
  listeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn: (lang: Language) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const sheetSample = (lang: Language = current): string => BUNDLES[lang].sheetSample.join('\n');
export const isSheetSample = (text: string): boolean => (Object.keys(BUNDLES) as Language[]).some(l => sheetSample(l) === text);

/** Saved choice, otherwise English. */
export function initLanguage(): void {
  const saved = readValue<string>(STORAGE_KEY);
  const lang = saved && saved in BUNDLES ? (saved as Language) : 'en';
  current = lang;
  setNumberLocale(NUMBER_LOCALE[lang]);
  document.documentElement.lang = lang;
}

/** Fills every element marked with data-i18n* attributes. */
export function translateDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-tip]').forEach(el => {
    const [key, shortcut] = el.dataset.i18nTip!.split('|');
    const label = t(key);
    el.dataset.tip = shortcut ? label + ' · ' + shortcut : label;
    el.setAttribute('aria-label', label);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria!)));
  root.querySelectorAll<HTMLImageElement>('[data-i18n-alt]').forEach(el => { el.alt = t(el.dataset.i18nAlt!); });
}
