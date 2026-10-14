/**
 * Transient circuit simulator: modified nodal analysis with backward-Euler
 * companion models. Diodes are piecewise linear, MOSFETs are voltage-controlled
 * switches with a linear transition; both are solved by fixed-point iteration.
 */
import type { Circuit } from '../circuit';
import type { Part } from '../components';
import { MnaSystem } from './mna';
import { buildTopology } from './topology';
import type { CapacitorEl, InductorEl, NodeId, SourceEl, Topology } from './topology';

export interface PartResult {
  v: number; i: number; p: number;
  R?: number; q?: number; en?: number; tau?: number; Rth?: number;
  on?: boolean; bright?: number; k?: number; vgs?: number; short?: boolean;
  /** Derived for display: share of the largest resistive current, capacitor fill, max inductor current. */
  norm?: number; level?: number; imax?: number;
}

interface Solution { V(node: NodeId): number; j(e: SourceEl): number }

const MOS_RON = 1;
const BASE_STEP = 0.001;

export function sourceValue(c: Part, t: number): number {
  const f = c.freq ?? 1;
  if (c.wave === 'sine') return c.value * Math.sin(2 * Math.PI * f * t);
  if (c.wave === 'square') return Math.sin(2 * Math.PI * f * t) >= 0 ? c.value : 0;
  return c.value;
}

export class Simulator {
  powerOn = true;
  time = 0;
  /** Simulated seconds per real second. */
  speed = 1;
  topo!: Topology;
  results: Array<PartResult | null> = [];
  /** Conventional current along each trace, from its first point to its last. */
  traceCurrent: number[] = [];
  private nodeV: number[] = [];
  private capV = new Map<string, number>();
  private indI = new Map<string, number>();
  private diodeOn = new Map<string, boolean>();
  private mosK = new Map<string, number>();
  private circuit!: Circuit;
  private accumulator = 0;
  /** Called after every step with the simulated time. */
  onStep: ((t: number) => void) | null = null;

  setCircuit(circuit: Circuit): void {
    this.circuit = circuit;
    const ids = new Set(circuit.components.map(c => c.id));
    [this.capV, this.indI, this.diodeOn, this.mosK].forEach(m => [...m.keys()].forEach(k => { if (!ids.has(k)) m.delete(k); }));
    this.topo = buildTopology(circuit);
    this.computeTimeConstants();
    this.step(1e-4);
  }

  /** Rebuilds the netlist only (for value changes that do not need a visual rebuild). */
  refresh(): void { this.topo = buildTopology(this.circuit); this.computeTimeConstants(); }

  reset(): void { this.capV.clear(); this.indI.clear(); this.diodeOn.clear(); this.mosK.clear(); this.time = 0; }
  discharge(): void { this.capV.clear(); this.indI.clear(); this.time = 0; }
  setPower(on: boolean): void { this.powerOn = on; this.computeTimeConstants(); }

  /** Advances by a real-time delta using fixed steps. */
  advance(realDt: number): void {
    const h = BASE_STEP * this.speed;
    this.accumulator += realDt;
    let n = 0;
    while (this.accumulator >= BASE_STEP && n < 60) { this.step(h); this.time += h; this.accumulator -= BASE_STEP; n++; }
    if (n === 60) this.accumulator = 0;
  }

  voltageAt(node: NodeId | null | undefined): number | null {
    if (node === null || node === undefined || node < -1) return null;
    return node === -1 ? 0 : this.nodeV[node] ?? null;
  }

  private assemble(mode: { h?: number; t?: number; test?: { a: NodeId; b: NodeId }; skip?: InductorEl }): Solution {
    const { nodeCount: n } = this.topo;
    const srcs = this.powerOn ? this.topo.V.filter(e => !e.short && e.a > -2 && e.b > -2) : [];
    const sys = new MnaSystem(n + srcs.length);
    for (let i = 0; i < n; i++) sys.A[i][i] += 1e-9;
    this.topo.R.forEach(e => sys.conductance(e.a, e.b, e.G));
    if (mode.h) this.topo.C.forEach(e => {
      const g = e.C / mode.h!, ieq = g * (this.capV.get(e.id) || 0);
      sys.conductance(e.a, e.b, g); sys.current(e.a, ieq); sys.current(e.b, -ieq);
    });
    this.topo.L.forEach(e => {
      if (mode.h) { const g = mode.h / e.L, ip = this.indI.get(e.id) || 0; sys.conductance(e.a, e.b, g); sys.current(e.a, -ip); sys.current(e.b, ip); }
      else if (mode.skip !== e) sys.conductance(e.a, e.b, 1e3);
    });
    this.topo.D.forEach(e => {
      if (this.diodeOn.get(e.id)) {
        const g = 1 / e.Rs; sys.conductance(e.a, e.b, g);
        if (mode.h) { sys.current(e.a, e.Vf * g); sys.current(e.b, -e.Vf * g); }
      } else sys.conductance(e.a, e.b, 1e-9);
    });
    this.topo.M.forEach(e => sys.conductance(e.a, e.b, 1e-9 + (this.mosK.get(e.id) || 0) / MOS_RON));
    srcs.forEach((e, k) => sys.voltageSource(n + k, e.a, e.b, mode.test ? 0 : sourceValue(e.c, mode.t ?? 0)));
    if (mode.test) { sys.current(mode.test.a, 1); sys.current(mode.test.b, -1); }
    const x = sys.solve();
    return { V: i => (i < 0 ? 0 : x[i]), j: e => { const k = srcs.indexOf(e); return k < 0 ? 0 : x[n + k]; } };
  }

  private solveNonlinear(h: number, t: number): Solution {
    let s = this.assemble({ h, t });
    for (let it = 0; it < 14; it++) {
      let changed = false;
      this.topo.D.forEach(e => {
        const v = s.V(e.a) - s.V(e.b), on = this.diodeOn.get(e.id);
        if (on && (v - e.Vf) / e.Rs < -1e-9) { this.diodeOn.set(e.id, false); changed = true; }
        else if (!on && v > e.Vf + 1e-9) { this.diodeOn.set(e.id, true); changed = true; }
      });
      this.topo.M.forEach(e => {
        const vgs = e.p ? s.V(e.b) - s.V(e.g) : s.V(e.g) - s.V(e.b);
        const target = Math.max(0, Math.min(1, (vgs - e.Vth) / 1.5)), current = this.mosK.get(e.id) || 0;
        if (Math.abs(target - current) > 1e-6) {
          let next = current + (target - current) * 0.8;
          if (Math.abs(target - next) < 2e-3) next = target;
          this.mosK.set(e.id, next); changed = true;
        }
      });
      if (!changed) break;
      s = this.assemble({ h, t });
    }
    return s;
  }

  /** Thevenin resistance seen by each capacitor and inductor, for τ. */
  private computeTimeConstants(): void {
    this.topo.C.forEach((e: CapacitorEl) => { const s = this.assemble({ test: e }); e.Rth = s.V(e.a) - s.V(e.b); });
    this.topo.L.forEach((e: InductorEl) => { const s = this.assemble({ test: e, skip: e }); e.Rth = s.V(e.a) - s.V(e.b); });
  }

  step(h: number): void {
    const topo = this.topo, t = this.time + h;
    const s = this.solveNonlinear(h, t);
    const res: Array<PartResult | null> = this.circuit.components.map(() => null);
    const tc = new Array<number>(topo.terminals.length).fill(0);
    const twoTerminal = (part: number, i: number): void => { tc[topo.terminalIndex(part, 0)] = i; tc[topo.terminalIndex(part, 1)] = -i; };

    topo.R.forEach(e => {
      const v = s.V(e.a) - s.V(e.b), i = v * e.G;
      res[e.part] = { v, i, p: v * i, R: 1 / e.G };
      if (!e.cpu) { twoTerminal(e.part, i); return; }
      const left: number[] = [], right: number[] = [];
      for (let k = 0; k < 7; k++) {
        const a = topo.terminalIndex(e.part, k), b = topo.terminalIndex(e.part, 7 + k);
        if (topo.cpuConnected.has(a)) left.push(a);
        if (topo.cpuConnected.has(b)) right.push(b);
      }
      left.forEach(x => (tc[x] = i / left.length));
      right.forEach(x => (tc[x] = -i / right.length));
    });
    topo.C.forEach(e => {
      const v = s.V(e.a) - s.V(e.b), prev = this.capV.get(e.id) || 0, i = e.C * (v - prev) / h;
      this.capV.set(e.id, v);
      res[e.part] = { v, i, p: v * i, q: e.C * v, en: 0.5 * e.C * v * v, tau: e.Rth * e.C, Rth: e.Rth };
      twoTerminal(e.part, i);
    });
    topo.L.forEach(e => {
      const v = s.V(e.a) - s.V(e.b), i = (this.indI.get(e.id) || 0) + (h / e.L) * v;
      this.indI.set(e.id, i);
      res[e.part] = { v, i, p: v * i, en: 0.5 * e.L * i * i, tau: e.Rth > 1e-6 ? e.L / e.Rth : Infinity, Rth: e.Rth };
      twoTerminal(e.part, i);
    });
    topo.D.forEach(e => {
      const v = s.V(e.a) - s.V(e.b), on = !!this.diodeOn.get(e.id), i = on ? (v - e.Vf) / e.Rs : v * 1e-9;
      res[e.part] = { v, i, p: v * i, on, bright: e.led ? Math.max(0, Math.min(1, Math.sqrt(Math.max(0, i) / 0.02))) : 0 };
      twoTerminal(e.part, i);
    });
    topo.M.forEach(e => {
      const k = this.mosK.get(e.id) || 0, G = 1e-9 + k / MOS_RON, vd = s.V(e.a), vs = s.V(e.b), i = G * (vd - vs);
      res[e.part] = { v: vd - vs, i, p: (vd - vs) * i, k, vgs: s.V(e.g) - vs };
      tc[topo.terminalIndex(e.part, 1)] = i; tc[topo.terminalIndex(e.part, 2)] = -i;
    });
    topo.V.forEach(e => {
      const on = this.powerOn && !e.short;
      const j = on ? s.j(e) : 0, v = on ? sourceValue(e.c, t) : s.V(e.a) - s.V(e.b);
      res[e.part] = { v, i: -j, p: -j * v, on, short: e.short && this.powerOn };
      tc[topo.terminalIndex(e.part, 0)] = j; tc[topo.terminalIndex(e.part, 1)] = -j;
    });
    this.traceCurrent = topo.traceEnds.map(([a, b]) => (a !== null ? -tc[a] : b !== null ? tc[b] : 0));
    this.nodeV = [];
    for (let i = 0; i < topo.nodeCount; i++) this.nodeV.push(s.V(i));
    this.results = res;
    this.onStep?.(t);
  }
}
