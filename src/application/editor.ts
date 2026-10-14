/**
 * Editing logic shared by the 3D board and the 2D schematic.
 * Views translate pointer events into board coordinates and call these methods;
 * the editor decides what happens and talks to the store.
 */
import { createPart, manhattan, movePart, partAt, traceAt } from '../domain/circuit';
import type { Hit, TraceHit } from '../domain/circuit';
import { BOARD, LIMIT_X, LIMIT_Z, PART_TYPES, footprint } from '../domain/components';
import type { PartType, Point } from '../domain/components';
import { clamp } from '../domain/units';
import type { Probe } from './probe';
import type { CircuitStore } from './store';

export type Tool = 'view' | 'probe' | 'trace' | 'erase' | PartType;

/** A pointer position on the board: snapped grid point plus the raw position. */
export interface BoardPoint { x: number; z: number; rx: number; rz: number }
export interface Screen { x: number; y: number }
export interface DragState { index: number; ox: number; oz: number; nx: number; nz: number; moved: boolean }

export const isPlaceTool = (t: Tool): t is PartType => (PART_TYPES as string[]).includes(t);

const snap = (v: number): number => Math.round(v / BOARD.snap) * BOARD.snap;

/** Raw board coordinates → BoardPoint, or null when outside the board. */
export function toBoardPoint(rx: number, rz: number): BoardPoint | null {
  if (Math.abs(rx) > BOARD.width / 2 + 0.5 || Math.abs(rz) > BOARD.depth / 2 + 0.5) return null;
  return { x: clamp(snap(rx), -LIMIT_X, LIMIT_X), z: clamp(snap(rz), -LIMIT_Z, LIMIT_Z), rx, rz };
}

type EditorEvent = 'tool' | 'overlay';

export class Editor {
  tool: Tool = 'view';
  rot = 0;
  draft: Point[] | null = null;
  hover: BoardPoint | null = null;
  drag: DragState | null = null;
  private downAt: Screen | null = null;
  private listeners = new Set<(e: EditorEvent) => void>();
  /** Set by the UI: opens the calculations panel on a part. */
  onInspect: (id: string) => void = () => {};

  constructor(private store: CircuitStore, private probe: Probe) {}

  on(fn: (e: EditorEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: EditorEvent): void { this.listeners.forEach(fn => fn(e)); }

  setTool(t: Tool): void {
    if (this.tool === 'trace' && t !== 'trace') this.finishDraft();
    this.tool = t;
    this.emit('tool');
  }
  rotate(): void { this.rot = (this.rot + 1) % 4; this.emit('tool'); }

  partAt(p: BoardPoint): Hit | null { return partAt(this.store.circuit, p.rx, p.rz, footprint); }
  targetAt(p: BoardPoint): Hit | TraceHit | null { return this.partAt(p) ?? traceAt(this.store.circuit, p.rx, p.rz); }

  /** Draft trace including the preview segment to the pointer. */
  draftPreview(): Point[] | null {
    if (!this.draft) return null;
    return this.hover ? this.draft.concat(manhattan(this.draft[this.draft.length - 1], [this.hover.x, this.hover.z])) : this.draft;
  }

  finishDraft(): void {
    const pts = this.draft;
    this.draft = null;
    if (pts && pts.length >= 2) this.store.commit(c => { c.traces.push(pts); });
    this.emit('overlay');
  }
  cancelDraft(): void { this.draft = null; this.emit('overlay'); }

  undo(): void {
    if (this.draft) { this.draft = this.draft.length > 1 ? this.draft.slice(0, -1) : null; this.emit('overlay'); return; }
    this.store.undo();
  }

  hoverAt(p: BoardPoint | null): void {
    this.hover = p;
    this.emit('overlay');
  }

  /** Returns true when a drag starts (the view should then capture the pointer and stop orbiting). */
  pointerDown(screen: Screen, p: BoardPoint | null): boolean {
    this.downAt = screen;
    if (this.tool !== 'view' || !p) return false;
    const hit = this.partAt(p);
    if (!hit) return false;
    this.drag = { index: hit.index, ox: hit.part.x - p.rx, oz: hit.part.z - p.rz, nx: hit.part.x, nz: hit.part.z, moved: false };
    return true;
  }

  pointerMove(screen: Screen, p: BoardPoint | null): void {
    const d = this.drag;
    if (!d) { this.hoverAt(p); return; }
    if (!p || !this.downAt) return;
    if (Math.hypot(screen.x - this.downAt.x, screen.y - this.downAt.y) > 6) d.moved = true;
    if (!d.moved) return;
    d.nx = clamp(snap(p.rx + d.ox), -LIMIT_X, LIMIT_X);
    d.nz = clamp(snap(p.rz + d.oz), -LIMIT_Z, LIMIT_Z);
    this.emit('overlay');
  }

  pointerUp(screen: Screen, p: BoardPoint | null): void {
    const d = this.drag, down = this.downAt;
    this.drag = null; this.downAt = null;
    if (d) {
      const part = this.store.circuit.components[d.index];
      if (d.moved && part && (d.nx !== part.x || d.nz !== part.z)) {
        this.store.select(part.id);
        this.store.commit(c => movePart(c, d.index, d.nx, d.nz));
        return;
      }
      if (d.moved) { this.emit('overlay'); return; }
    }
    if (down && Math.hypot(screen.x - down.x, screen.y - down.y) < 6) this.click(p);
  }

  click(p: BoardPoint | null): void {
    if (!p) return;
    const store = this.store, t = this.tool;
    if (t === 'view') {
      const hit = this.partAt(p);
      if (!hit) { store.select(null); return; }
      store.select(hit.part.id);
      if (hit.part.type === 'switch') { store.commit(c => { c.components[hit.index].closed = !c.components[hit.index].closed; }); return; }
      this.onInspect(hit.part.id);
      return;
    }
    if (t === 'probe') { this.probe.place([p.x, p.z]); this.emit('overlay'); return; }
    if (isPlaceTool(t)) {
      const part = createPart(store.circuit, t, p.x, p.z, this.rot);
      store.select(part.id);
      store.commit(c => { c.components.push(part); });
      return;
    }
    if (t === 'trace') {
      const pt: Point = [p.x, p.z];
      if (!this.draft) { this.draft = [pt]; this.emit('overlay'); return; }
      const last = this.draft[this.draft.length - 1];
      if (last[0] === pt[0] && last[1] === pt[1]) { this.finishDraft(); return; }
      this.draft = this.draft.concat(manhattan(last, pt));
      this.emit('overlay');
      return;
    }
    if (t === 'erase') {
      const hit = this.targetAt(p);
      if (!hit) return;
      store.commit(c => { if (hit.kind === 'part') c.components.splice(hit.index, 1); else c.traces.splice(hit.index, 1); });
      this.hoverAt(p);
    }
  }
}
