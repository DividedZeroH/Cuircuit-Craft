/** Browser storage that never throws: private windows and blocked storage just behave as empty. */
export function readValue<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeValue(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const KEYS = { circuit: 'circuit-craft.circuit', sheet: 'circuit-craft.sheet' } as const;
