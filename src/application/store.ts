/**
 * Single source of truth shared by the three views (board, schematic, sheet).
 * Every edit goes through commit() so all views and the simulator see the same circuit.
 */
import { cloneCircuit } from '../domain/circuit';
import type { Circuit } from '../domain/circuit';
import type { Part } from '../domain/components';

/** structure: parts or traces changed · values: a value changed without moving anything · selection */
export type StoreEvent = 'structure' | 'values' | 'selection';

export class CircuitStore {
  private history: string[] = [];
  private listeners = new Set<(e: StoreEvent) => void>();
  selectedId: string | null = null;

  constructor(public circuit: Circuit, private persist: (c: Circuit) => void) {}

  on(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: StoreEvent): void { this.listeners.forEach(fn => fn(e)); }

  /** Undoable edit. The mutator may change the circuit in place or return a new one. */
  commit(mutate: (c: Circuit) => Circuit | void): void {
    this.history.push(JSON.stringify(this.circuit));
    if (this.history.length > 100) this.history.shift();
    const next = mutate(this.circuit);
    if (next) this.circuit = next;
    if (this.selectedId && !this.find(this.selectedId)) this.selectedId = null;
    this.persist(this.circuit);
    this.emit('structure');
  }

  /** Continuous adjustment (a slider) that should not flood the undo history or rebuild meshes. */
  tweak(mutate: (c: Circuit) => void): void {
    mutate(this.circuit);
    this.persist(this.circuit);
    this.emit('values');
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.circuit = JSON.parse(prev) as Circuit;
    this.persist(this.circuit);
    this.emit('structure');
    return true;
  }

  replace(c: Circuit): void { this.commit(() => cloneCircuit(c)); }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('selection');
  }

  find(id: string): Part | undefined { return this.circuit.components.find(p => p.id === id); }
  indexOf(id: string): number { return this.circuit.components.findIndex(p => p.id === id); }
}
