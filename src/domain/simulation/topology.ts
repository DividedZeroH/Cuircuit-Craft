/**
 * Turns the board geometry (part terminals + traces) into an electrical netlist.
 * Two points are on the same net when a trace joins them, when a trace vertex
 * lies on another trace, or when two terminals sit on the same spot.
 */
import type { Circuit } from '../circuit';
import { distanceToSegment } from '../circuit';
import { LED_SPECS, potResistance, terminals, toBoard } from '../components';
import type { Part, Point } from '../components';

/** Node index: −1 is ground, −2 is "not connected to anything". */
export type NodeId = number;

export interface Terminal { part: number; k: number; x: number; z: number; key: string }

export interface ResistiveEl { part: number; a: NodeId; b: NodeId; G: number; cpu?: boolean }
export interface CapacitorEl { part: number; id: string; a: NodeId; b: NodeId; C: number; Rth: number }
export interface InductorEl { part: number; id: string; a: NodeId; b: NodeId; L: number; Rth: number }
export interface DiodeEl { part: number; id: string; a: NodeId; b: NodeId; Vf: number; Rs: number; led: boolean }
export interface SourceEl { part: number; c: Part; a: NodeId; b: NodeId; short: boolean }
export interface MosEl { part: number; id: string; g: NodeId; a: NodeId; b: NodeId; Vth: number; p: boolean }

export interface Topology {
  nodeCount: number;
  R: ResistiveEl[]; C: CapacitorEl[]; L: InductorEl[]; D: DiodeEl[]; V: SourceEl[]; M: MosEl[];
  terminals: Terminal[];
  /** For each trace, the terminal index at its first and last point (or null). */
  traceEnds: Array<[number | null, number | null]>;
  /** For each trace, the node it belongs to. */
  traceNode: Array<NodeId | null>;
  cpuConnected: Set<number>;
  terminalIndex(part: number, k: number): number;
  netAt(x: number, z: number): NodeId | null;
  hasSource: boolean;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    this.parent.set(k, r);
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const pointKey = (x: number, z: number): string => 'P' + x.toFixed(3) + ',' + z.toFixed(3);

export function buildTopology(circuit: Circuit): Topology {
  const uf = new UnionFind();
  const terms: Terminal[] = [];
  circuit.components.forEach((c, ci) => terminals(c).forEach(([lx, lz], k) => {
    const [x, z] = toBoard(c, lx, lz);
    const key = 'T' + ci + '_' + k;
    uf.find(key);
    terms.push({ part: ci, k, x, z, key });
  }));
  // The processor's left pins are VCC, the right pins are GND.
  circuit.components.forEach((c, ci) => {
    if (c.type !== 'cpu') return;
    for (let k = 1; k < 7; k++) { uf.union('T' + ci + '_0', 'T' + ci + '_' + k); uf.union('T' + ci + '_7', 'T' + ci + '_' + (7 + k)); }
  });
  for (let i = 0; i < terms.length; i++) for (let j = i + 1; j < terms.length; j++)
    if (terms[i].part !== terms[j].part && Math.hypot(terms[i].x - terms[j].x, terms[i].z - terms[j].z) < 0.06) uf.union(terms[i].key, terms[j].key);

  interface Seg { ti: number; a: Point; b: Point }
  const segs: Seg[] = [];
  circuit.traces.forEach((pts, ti) => {
    pts.forEach(p => uf.find(pointKey(p[0], p[1])));
    for (let i = 0; i < pts.length - 1; i++) {
      uf.union(pointKey(pts[i][0], pts[i][1]), pointKey(pts[i + 1][0], pts[i + 1][1]));
      segs.push({ ti, a: pts[i], b: pts[i + 1] });
    }
  });
  circuit.traces.forEach((pts, ti) => pts.forEach(p => segs.forEach(s => {
    if (s.ti !== ti && distanceToSegment(p[0], p[1], s.a, s.b) < 0.03) uf.union(pointKey(p[0], p[1]), pointKey(s.a[0], s.a[1]));
  })));
  terms.forEach(t => segs.forEach(s => { if (distanceToSegment(t.x, t.z, s.a, s.b) < 0.06) uf.union(t.key, pointKey(s.a[0], s.a[1])); }));

  const traceEnds = circuit.traces.map(pts => [pts[0], pts[pts.length - 1]].map(p => {
    const t = terms.findIndex(q => Math.hypot(q.x - p[0], q.z - p[1]) < 0.06);
    return t < 0 ? null : t;
  }) as [number | null, number | null]);
  const termIdx = new Map<string, number>();
  terms.forEach((t, i) => termIdx.set(t.part + '_' + t.k, i));
  const terminalIndex = (part: number, k: number): number => termIdx.get(part + '_' + k)!;
  const cpuConnected = new Set<number>();
  traceEnds.flat().forEach(ti => { if (ti !== null && circuit.components[terms[ti].part].type === 'cpu') cpuConnected.add(ti); });

  // Nets that touch at least one terminal become nodes.
  const roots = new Map<string, number>();
  terms.forEach(t => { const r = uf.find(t.key); if (!roots.has(r)) roots.set(r, roots.size); });
  const netOfTerm = (ti: number): number | undefined => roots.get(uf.find(terms[ti].key));
  let gnd = 0;
  const firstSource = circuit.components.findIndex(c => c.type === 'source');
  if (firstSource >= 0) gnd = netOfTerm(terminalIndex(firstSource, 1))!;
  const node = (net: number | undefined): NodeId => net === undefined ? -2 : net === gnd ? -1 : net < gnd ? net : net - 1;
  const nd = (ci: number, k: number): NodeId => node(netOfTerm(terminalIndex(ci, k)));

  const topo: Topology = {
    nodeCount: Math.max(0, roots.size - 1), R: [], C: [], L: [], D: [], V: [], M: [],
    terminals: terms, traceEnds, traceNode: [], cpuConnected, terminalIndex,
    netAt: () => null, hasSource: firstSource >= 0
  };
  circuit.components.forEach((c, ci) => {
    switch (c.type) {
      case 'resistor': topo.R.push({ part: ci, a: nd(ci, 0), b: nd(ci, 1), G: 1 / c.value }); break;
      case 'pot': topo.R.push({ part: ci, a: nd(ci, 0), b: nd(ci, 1), G: 1 / potResistance(c) }); break;
      case 'switch': topo.R.push({ part: ci, a: nd(ci, 0), b: nd(ci, 1), G: c.closed ? 100 : 1e-10 }); break;
      case 'cpu': topo.R.push({ part: ci, a: nd(ci, 0), b: nd(ci, 7), G: 1 / c.value, cpu: true }); break;
      case 'capacitor': topo.C.push({ part: ci, id: c.id, a: nd(ci, 0), b: nd(ci, 1), C: c.value, Rth: Infinity }); break;
      case 'inductor': topo.L.push({ part: ci, id: c.id, a: nd(ci, 0), b: nd(ci, 1), L: c.value, Rth: 0 }); break;
      case 'diode': topo.D.push({ part: ci, id: c.id, a: nd(ci, 0), b: nd(ci, 1), Vf: 0.7, Rs: 0.5, led: false }); break;
      case 'led': topo.D.push({ part: ci, id: c.id, a: nd(ci, 0), b: nd(ci, 1), Vf: LED_SPECS[c.color ?? 'red'].vf, Rs: 15, led: true }); break;
      case 'source': { const a = nd(ci, 0), b = nd(ci, 1); topo.V.push({ part: ci, c, a, b, short: a === b }); break; }
      case 'nmos': case 'pmos': topo.M.push({ part: ci, id: c.id, g: nd(ci, 0), a: nd(ci, 1), b: nd(ci, 2), Vth: c.value, p: c.type === 'pmos' }); break;
    }
  });

  const rootAt = (x: number, z: number): string | null => {
    for (const t of terms) if (Math.hypot(t.x - x, t.z - z) < 0.16) return uf.find(t.key);
    for (const pts of circuit.traces) for (const p of pts) if (Math.hypot(p[0] - x, p[1] - z) < 0.16) return uf.find(pointKey(p[0], p[1]));
    for (const s of segs) if (distanceToSegment(x, z, s.a, s.b) < 0.12) return uf.find(pointKey(s.a[0], s.a[1]));
    return null;
  };
  topo.netAt = (x, z) => { const r = rootAt(x, z); return r === null || !roots.has(r) ? null : node(roots.get(r)); };
  topo.traceNode = circuit.traces.map(pts => { const r = uf.find(pointKey(pts[0][0], pts[0][1])); return roots.has(r) ? node(roots.get(r)) : null; });
  return topo;
}
