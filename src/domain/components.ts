/** Part catalog: types, defaults, terminals and footprints. Independent of rendering. */

export type PartType = 'source' | 'resistor' | 'pot' | 'capacitor' | 'inductor' | 'diode' | 'led' | 'switch' | 'nmos' | 'pmos' | 'cpu';
export type Wave = 'dc' | 'sine' | 'square';
export type LedColor = 'red' | 'green' | 'yellow' | 'blue' | 'white';
export type Point = [number, number];
export type Trace = Point[];

export interface Part {
  type: PartType;
  id: string;
  x: number;
  z: number;
  /** Quarter turns, 0–3. */
  rot: number;
  /** Main value: V (source), Ω (resistor, pot, cpu), F, H, V_th (MOSFET). */
  value: number;
  wave?: Wave;
  freq?: number;
  /** Potentiometer wiper position, 0–1. */
  pos?: number;
  color?: LedColor;
  closed?: boolean;
}

export const PART_TYPES: PartType[] = ['source', 'resistor', 'pot', 'capacitor', 'inductor', 'diode', 'led', 'switch', 'nmos', 'pmos', 'cpu'];
export const WAVES: Wave[] = ['dc', 'sine', 'square'];

export const DEFAULTS: Record<PartType, Omit<Part, 'type' | 'id' | 'x' | 'z' | 'rot'>> = {
  source: { value: 5, wave: 'dc', freq: 1 },
  resistor: { value: 1000 },
  pot: { value: 10000, pos: 0.5 },
  capacitor: { value: 100e-6 },
  inductor: { value: 0.1 },
  diode: { value: 0.7 },
  led: { value: 0.02, color: 'red' },
  switch: { value: 0, closed: true },
  nmos: { value: 2 },
  pmos: { value: 2 },
  cpu: { value: 1000 }
};

/** Unit of the editable main value; parts without one have no numeric value to edit. */
export const UNIT: Partial<Record<PartType, string>> = { source: 'V', resistor: 'Ω', pot: 'Ω', capacitor: 'F', inductor: 'H', cpu: 'Ω', nmos: 'V', pmos: 'V' };

export const ID_PREFIX: Record<PartType, string> = { source: 'V', resistor: 'R', pot: 'RV', capacitor: 'C', inductor: 'L', diode: 'D', led: 'LED', switch: 'S', nmos: 'Q', pmos: 'Q', cpu: 'U' };

export const LED_SPECS: Record<LedColor, { hex: number; vf: number }> = {
  red: { hex: 0xff2d20, vf: 1.9 }, green: { hex: 0x22e05a, vf: 2.1 }, yellow: { hex: 0xffd21f, vf: 2.0 },
  blue: { hex: 0x2f7bff, vf: 3.0 }, white: { hex: 0xf4f6ff, vf: 3.1 }
};

/** Power rating in watts for the parts that have one. */
export const RATED_POWER: Partial<Record<PartType, number>> = { resistor: 0.25, pot: 0.25 };

export const BOARD = { width: 12, depth: 8, thickness: 0.22, snap: 0.25 } as const;
export const LIMIT_X = BOARD.width / 2 - 0.2;
export const LIMIT_Z = BOARD.depth / 2 - 0.2;

export const CPU_PINS = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];

/** Terminal positions in the part's local frame. Order matters: it is how the simulator names them. */
export function terminals(p: Pick<Part, 'type'>): Point[] {
  switch (p.type) {
    case 'capacitor': return [[0, -0.5], [0, 0.5]];                 // +, −
    case 'source': return [[0, -0.75], [0, 0.75]];                  // +, −
    case 'led': return [[-0.5, 0], [0.5, 0]];                       // anode, cathode
    case 'nmos': return [[-0.75, 0], [0.5, -0.75], [0.5, 0.75]];    // G, D, S
    case 'pmos': return [[-0.75, 0], [0.5, 0.75], [0.5, -0.75]];    // G, D, S (source on top)
    case 'cpu': return ([] as Point[]).concat(
      CPU_PINS.map(o => [-1.25, o] as Point), CPU_PINS.map(o => [1.25, o] as Point),
      CPU_PINS.map(o => [o, -1.25] as Point), CPU_PINS.map(o => [o, 1.25] as Point));
    default: return [[-0.75, 0], [0.75, 0]];
  }
}

/** Half-extents [x, z] of the part on the board, already rotated. */
export function footprint(p: Pick<Part, 'type' | 'rot'>): [number, number] {
  const swap = (a: number, b: number): [number, number] => (p.rot % 2 ? [b, a] : [a, b]);
  switch (p.type) {
    case 'resistor': case 'diode': return swap(0.9, 0.3);
    case 'pot': return swap(0.9, 0.4);
    case 'inductor': case 'switch': return swap(0.9, 0.35);
    case 'led': return swap(0.65, 0.35);
    case 'capacitor': return swap(0.45, 0.6);
    case 'source': return swap(0.5, 0.85);
    case 'nmos': case 'pmos': return [0.85, 0.9];
    case 'cpu': return [1.35, 1.35];
  }
}

/** Local → board coordinates. Matches a Y rotation of −rot·90°. */
export function toBoard(p: Pick<Part, 'x' | 'z' | 'rot'>, lx: number, lz: number): Point {
  const th = -p.rot * Math.PI / 2;
  const co = Math.round(Math.cos(th)), si = Math.round(Math.sin(th));
  return [p.x + co * lx + si * lz, p.z - si * lx + co * lz];
}

export function terminalPositions(p: Part): Point[] {
  return terminals(p).map(([lx, lz]) => toBoard(p, lx, lz));
}

/** Effective resistance of a potentiometer. */
export const potResistance = (p: Part): number => Math.max(1, (p.pos ?? 0.5) * p.value);

export const clampPos = (v: unknown): number => Math.max(0, Math.min(1, Number(v) || 0));
