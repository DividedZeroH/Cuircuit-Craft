/** Derived readings and safety checks over simulation results. */
import type { Circuit } from './circuit';
import { RATED_POWER } from './components';
import type { PartResult } from './simulation/simulator';

export interface Warning { partId: string; code: string; args: number[] }

/** Highest source voltage, used as the reference for capacitor fill and the voltage map. */
export function referenceVoltage(c: Circuit): number {
  return Math.max(1, ...c.components.filter(k => k.type === 'source').map(k => k.value));
}

/** Adds norm / level / imax to each result, in place. */
export function deriveReadings(c: Circuit, results: Array<PartResult | null>): void {
  const vref = referenceVoltage(c);
  const flows = results.map((r, i) => (r && ['resistor', 'pot', 'cpu'].includes(c.components[i].type) ? Math.abs(r.i) : 0));
  const maxI = Math.max(1e-12, ...flows);
  const maxL = Math.max(1e-12, ...results.map((r, i) => (r && c.components[i].type === 'inductor' ? Math.abs(r.i) : 0)));
  results.forEach((r, i) => {
    if (!r) return;
    r.norm = flows[i] / maxI;
    r.level = Math.min(1, Math.abs(r.v) / vref);
    r.imax = maxL;
  });
}

/** Returns at most one warning per part. Codes are translated by the presentation layer. */
export function checkPart(c: Circuit, index: number, r: PartResult | null): Warning | null {
  if (!r) return null;
  const part = c.components[index];
  const w = (code: string, ...args: number[]): Warning => ({ partId: part.id, code, args });
  switch (part.type) {
    case 'resistor': case 'pot': return Math.abs(r.p) > (RATED_POWER[part.type] ?? Infinity) ? w('dissip', Math.abs(r.p)) : null;
    case 'capacitor': return r.v < -0.5 ? w('reverse') : Math.abs(r.v) > 16 ? w('over16') : null;
    case 'led': return r.i > 0.03 ? w('ledBurn', r.i) : null;
    case 'diode': return r.i > 1 ? w('over1A') : null;
    case 'nmos': case 'pmos': return Math.abs(r.i) > 0.5 ? w('over05') : null;
    case 'source': return r.short ? w('short') : Math.abs(r.i) > 3 ? w('bigI', r.i) : null;
    case 'cpu': return r.v > 6 ? w('overV') : null;
    default: return null;
  }
}

export interface Totals { current: number; power: number; energy: number }
export function totals(c: Circuit, results: Array<PartResult | null>): Totals {
  const sum = (types: string[], key: keyof PartResult): number =>
    results.reduce((s, r, i) => s + (r && types.includes(c.components[i].type) ? Number(r[key] ?? 0) : 0), 0);
  return { current: sum(['source'], 'i'), power: sum(['source'], 'p'), energy: sum(['capacitor', 'inductor'], 'en') };
}
