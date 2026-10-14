/** Multimeter with two probes and a rolling buffer for the oscilloscope. */
import type { Point } from '../domain/components';
import type { NodeId } from '../domain/simulation/topology';
import type { Simulator } from '../domain/simulation/simulator';

export const SCOPE_WINDOWS = [0.05, 0.2, 1, 5, 20];

export class Probe {
  red: Point | null = null;
  black: Point | null = null;
  private redNode: NodeId | null = null;
  private blackNode: NodeId | null = null;
  buffer: Array<[number, number]> = [];
  window = 1;
  private lastSample = -1;
  private listeners = new Set<() => void>();

  constructor(private sim: Simulator) {}

  on(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { this.listeners.forEach(fn => fn()); }

  get active(): boolean { return this.red !== null; }

  /** First tap places the red probe, the second the black one, the third starts over. */
  place(pt: Point): void {
    if (!this.red || this.black) { this.red = pt; this.black = null; } else this.black = pt;
    this.buffer = []; this.lastSample = -1;
    this.resolve();
    this.emit();
  }

  clear(): void { this.red = this.black = null; this.buffer = []; this.resolve(); this.emit(); }

  cycleWindow(): void {
    this.window = SCOPE_WINDOWS[(SCOPE_WINDOWS.indexOf(this.window) + 1) % SCOPE_WINDOWS.length];
    this.buffer = [];
    this.emit();
  }

  /** Re-attaches the probes to nets after the circuit changes. */
  resolve(): void {
    const topo = this.sim.topo;
    this.redNode = this.red && topo ? topo.netAt(this.red[0], this.red[1]) : null;
    this.blackNode = this.black && topo ? topo.netAt(this.black[0], this.black[1]) : null;
  }

  /** Red minus black, or red against the supply negative when only one probe is placed. */
  reading(): number | null {
    if (!this.red) return null;
    const va = this.sim.voltageAt(this.redNode);
    if (va === null) return null;
    if (!this.black) return va;
    const vb = this.sim.voltageAt(this.blackNode);
    return vb === null ? null : va - vb;
  }

  record(t: number): void {
    if (!this.red || t - this.lastSample < this.window / 500) return;
    const v = this.reading();
    if (v === null) return;
    this.lastSample = t;
    this.buffer.push([t, v]);
    while (this.buffer.length && this.buffer[0][0] < t - this.window) this.buffer.shift();
  }
}
