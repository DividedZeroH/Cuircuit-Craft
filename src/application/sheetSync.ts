/**
 * Connects the equation sheet with the circuit:
 * board values and live readings become sheet variables, and assignments to
 * part names in the sheet are written back to the circuit.
 */
import type { Circuit } from '../domain/circuit';
import { UNIT, potResistance } from '../domain/components';
import type { Part } from '../domain/components';
import { DomainError } from '../domain/errors';
import type { Vars } from '../domain/math/expression';
import type { Simulator } from '../domain/simulation/simulator';
import type { CircuitStore } from './store';

interface Binding { get(p: Part): number; set(p: Part, v: number): void }

const MAIN_VALUE: Binding = {
  get: p => (p.type === 'pot' ? potResistance(p) : p.type === 'switch' ? (p.closed ? 1 : 0) : p.value),
  set: (p, v) => {
    if (p.type === 'pot') p.pos = Math.max(0, Math.min(1, v / p.value));
    else if (p.type === 'switch') p.closed = v >= 0.5;
    else p.value = v;
  }
};
const POSITION: Binding = { get: p => p.pos ?? 0.5, set: (p, v) => { p.pos = Math.max(0, Math.min(1, v)); } };
const FREQUENCY: Binding = { get: p => p.freq ?? 1, set: (p, v) => { p.freq = v; } };

/** Sheet names that write into the circuit: R1, S1, pos_RV1, freq_V1… */
function bindings(c: Circuit): Map<string, { part: Part; binding: Binding; positive: boolean }> {
  const map = new Map<string, { part: Part; binding: Binding; positive: boolean }>();
  c.components.forEach(p => {
    if (UNIT[p.type] || p.type === 'switch') map.set(p.id, { part: p, binding: MAIN_VALUE, positive: p.type !== 'switch' && p.type !== 'pot' });
    if (p.type === 'pot') map.set('pos_' + p.id, { part: p, binding: POSITION, positive: false });
    if (p.type === 'source') map.set('freq_' + p.id, { part: p, binding: FREQUENCY, positive: true });
  });
  return map;
}

export function writableValues(c: Circuit): Record<string, number> {
  const out: Record<string, number> = {};
  bindings(c).forEach((b, name) => { out[name] = b.binding.get(b.part); });
  return out;
}

/** Everything the sheet can read: writable values plus live readings (V_R1, I_R1, P_R1, Q_C1, E_C1, tau_C1, t_sim). */
export function boardVariables(c: Circuit, sim: Simulator): Vars {
  const v: Vars = { ...writableValues(c) };
  c.components.forEach((p, i) => {
    const r = sim.results[i];
    if (!r) return;
    v['V_' + p.id] = r.v; v['I_' + p.id] = r.i; v['P_' + p.id] = r.p;
    if (p.type === 'capacitor') { v['Q_' + p.id] = r.q ?? 0; v['E_' + p.id] = r.en ?? 0; if ((r.Rth ?? Infinity) < 1e8) v['tau_' + p.id] = r.tau ?? 0; }
    if (p.type === 'inductor') { v['E_' + p.id] = r.en ?? 0; if (isFinite(r.tau ?? Infinity)) v['tau_' + p.id] = r.tau!; }
  });
  v.t_sim = sim.time;
  return v;
}

/**
 * Applies sheet assignments to the circuit in one undoable commit.
 * Returns the names that were rejected, with the reason.
 */
export function applyWrites(store: CircuitStore, writes: Array<{ name: string; value: number }>): Map<string, DomainError> {
  const errors = new Map<string, DomainError>();
  const valid: typeof writes = [];
  const map = bindings(store.circuit);
  writes.forEach(w => {
    const b = map.get(w.name);
    if (!b) return;
    if (!isFinite(w.value) || (b.positive && !(w.value > 0))) { errors.set(w.name, new DomainError('write.positive', [w.name])); return; }
    if (Math.abs(b.binding.get(b.part) - w.value) <= 1e-12 * Math.max(1, Math.abs(w.value))) return;
    valid.push(w);
  });
  if (valid.length) {
    store.commit(c => {
      const live = bindings(c);
      valid.forEach(w => { const b = live.get(w.name); if (b) b.binding.set(b.part, w.value); });
    });
  }
  return errors;
}
