/** Light / dark theme: follows the system until the user picks one with the toggle. */
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

export function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : media.matches;
}

export function toggleTheme(): void {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
}

export function onThemeChange(fn: () => void): void { listeners.add(fn); }

new MutationObserver(() => listeners.forEach(fn => fn())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
media.addEventListener('change', () => listeners.forEach(fn => fn()));

/** Reads a CSS custom property (colors follow the active theme). */
export const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export interface ScenePalette {
  board: number; trace: number; pad: number; hole: number; edge: number;
  hemiSky: number; hemiGround: number; hemi: number; sun: number; shadow: number;
  silkBg: string; silkDot: string; silkLine: string; silkText: string; silkFrame: string;
}

export const SCENE_PALETTES: Record<'light' | 'dark', ScenePalette> = {
  light: {
    board: 0xf7f7f5, trace: 0xd9dbdd, pad: 0xe9eaeb, hole: 0xc9ccce, edge: 0xc4c7ca, hemiSky: 0xffffff, hemiGround: 0xe6e6e4, hemi: 0.75, sun: 0.8, shadow: 0.08,
    silkBg: '#f7f7f5', silkDot: '#e2e3e2', silkLine: '#9da1a5', silkText: '#141414', silkFrame: '#cfd1d2'
  },
  dark: {
    board: 0x1d1f23, trace: 0x464b53, pad: 0x9aa0a8, hole: 0x0c0d0f, edge: 0x30343a, hemiSky: 0xc8d0dc, hemiGround: 0x15161a, hemi: 0.6, sun: 0.85, shadow: 0.4,
    silkBg: '#1d1f23', silkDot: '#2a2d33', silkLine: '#646a73', silkText: '#eef0f2', silkFrame: '#383c43'
  }
};

export const scenePalette = (): ScenePalette => SCENE_PALETTES[isDark() ? 'dark' : 'light'];
