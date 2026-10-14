/** The circuit aggregate: validation and structural edits. */
import { DEFAULTS, ID_PREFIX, LED_SPECS, PART_TYPES, UNIT, WAVES, clampPos, terminalPositions } from './components';
import type { Part, PartType, Point, Trace } from './components';
import { DomainError } from './errors';

export interface Circuit {
  components: Part[];
  traces: Trace[];
}

export const cloneCircuit = (c: Circuit): Circuit => JSON.parse(JSON.stringify(c)) as Circuit;

/** Fills defaults, fixes ids and drops malformed traces. Throws DomainError on unusable input. */
export function validateCircuit(input: unknown): Circuit {
  const c = input as Circuit;
  if (!c || !Array.isArray(c.components) || !Array.isArray(c.traces)) throw new DomainError('json.missing');
  const used = new Set<string>();
  c.components.forEach((k, i) => {
    if (!PART_TYPES.includes(k.type)) throw new DomainError('json.type', [i + 1, String(k.type)]);
    if (typeof k.x !== 'number' || typeof k.z !== 'number') throw new DomainError('json.coords', [i + 1]);
    k.rot = (((k.rot | 0) % 4) + 4) % 4;
    const def = DEFAULTS[k.type] as Record<string, unknown>;
    Object.keys(def).forEach(key => { if ((k as unknown as Record<string, unknown>)[key] === undefined) (k as unknown as Record<string, unknown>)[key] = def[key]; });
    if (UNIT[k.type] && !(k.value > 0)) k.value = DEFAULTS[k.type].value;
    if (k.type === 'led' && !(k.color && LED_SPECS[k.color])) k.color = 'red';
    if (k.type === 'source' && !(k.wave && WAVES.includes(k.wave))) k.wave = 'dc';
    if (k.type === 'pot') k.pos = clampPos(k.pos);
    if (!k.id || used.has(k.id)) k.id = nextIdFrom(used, k.type);
    used.add(k.id);
  });
  c.traces = c.traces.filter(t => Array.isArray(t) && t.length >= 2 && t.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number')));
  return c;
}

function nextIdFrom(used: Set<string>, type: PartType): string {
  const pre = ID_PREFIX[type];
  let n = 1;
  while (used.has(pre + n)) n++;
  return pre + n;
}

export function nextId(c: Circuit, type: PartType): string {
  return nextIdFrom(new Set(c.components.map(k => k.id)), type);
}

export function createPart(c: Circuit, type: PartType, x: number, z: number, rot: number): Part {
  return { type, id: nextId(c, type), x, z, rot, ...JSON.parse(JSON.stringify(DEFAULTS[type])) };
}

/** Manhattan path from a to b: either a straight segment or one corner. */
export function manhattan(from: Point, to: Point): Point[] {
  return from[0] === to[0] || from[1] === to[1] ? [to] : [[to[0], from[1]], to];
}

/** Moves a part and drags the trace ends that were attached to its terminals, keeping traces orthogonal. */
export function movePart(c: Circuit, index: number, nx: number, nz: number): void {
  const part = c.components[index];
  const before = terminalPositions(part);
  const after = terminalPositions({ ...part, x: nx, z: nz });
  c.traces = c.traces.map(pts => {
    const out = pts.map(p => [p[0], p[1]] as Point);
    [0, out.length - 1].forEach(end => {
      const p = out[end];
      const k = before.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.06);
      if (k >= 0) out[end] = [after[k][0], after[k][1]];
    });
    const fixed: Point[] = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const a = fixed[fixed.length - 1], q = out[i];
      if (a[0] !== q[0] && a[1] !== q[1]) fixed.push(i === out.length - 1 ? [a[0], q[1]] : [q[0], a[1]]);
      fixed.push(q);
    }
    return fixed;
  });
  part.x = nx;
  part.z = nz;
}

export interface Hit { kind: 'part'; index: number; part: Part; hx: number; hz: number }
export interface TraceHit { kind: 'trace'; index: number; distance: number }

export function partAt(c: Circuit, x: number, z: number, footprintOf: (p: Part) => [number, number]): Hit | null {
  for (let i = c.components.length - 1; i >= 0; i--) {
    const p = c.components[i], [hx, hz] = footprintOf(p);
    if (Math.abs(x - p.x) <= hx && Math.abs(z - p.z) <= hz) return { kind: 'part', index: i, part: p, hx, hz };
  }
  return null;
}

export function traceAt(c: Circuit, x: number, z: number, tolerance = 0.2): TraceHit | null {
  let best: TraceHit | null = null;
  c.traces.forEach((pts, i) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const d = distanceToSegment(x, z, pts[k], pts[k + 1]);
      if (d < tolerance && (!best || d < best.distance)) best = { kind: 'trace', index: i, distance: d };
    }
  });
  return best;
}

export function distanceToSegment(x: number, z: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}
