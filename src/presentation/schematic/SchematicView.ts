/**
 * The 2D schematic: same circuit as the board, drawn with symbols, and fully editable.
 * A base SVG shows the circuit; an overlay SVG shows hover, drafts, drags, selection and probes.
 */
import type { Editor } from '../../application/editor';
import { isPlaceTool, toBoardPoint } from '../../application/editor';
import type { Probe } from '../../application/probe';
import type { CircuitStore } from '../../application/store';
import { referenceVoltage } from '../../domain/analysis';
import { BOARD, DEFAULTS, footprint } from '../../domain/components';
import type { Part, Point } from '../../domain/components';
import type { Simulator } from '../../domain/simulation/simulator';
import { formatSI } from '../../domain/units';
import { t } from '../../infrastructure/i18n';
import { bomValue, partName, valueLabel } from '../describe';
import { heatHex } from '../heat';
import { cssVar, scenePalette } from '../theme';
import { symbol } from './symbols';

const U = 60;
const OX = (BOARD.width / 2) * U + 30, OY = (BOARD.depth / 2) * U + 30;
const W = BOARD.width * U + 60, H = BOARD.depth * U + 60;
const X = (x: number): number => OX + x * U;
const Y = (z: number): number => OY + z * U;
const esc = (s: string): string => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export interface BomLine { qty: number; part: string; value: string; refs: string[] }

export class SchematicView {
  heatMap = false;
  bom: BomLine[] = [];

  constructor(private base: HTMLElement, private overlay: SVGSVGElement, private stage: HTMLElement,
    private store: CircuitStore, private sim: Simulator, private editor: Editor, private probe: Probe) {
    overlay.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    this.bindPointer();
    editor.on(() => this.drawOverlay());
    probe.on(() => this.drawOverlay());
  }

  private visible(): boolean { return document.body.dataset.view === 'schematic'; }

  private bindPointer(): void {
    const point = (e: PointerEvent): ReturnType<typeof toBoardPoint> => {
      const r = this.stage.getBoundingClientRect();
      if (!r.width) return null;
      const sx = ((e.clientX - r.left) / r.width) * W, sy = ((e.clientY - r.top) / r.height) * H;
      return toBoardPoint((sx - OX) / U, (sy - OY) / U);
    };
    this.stage.addEventListener('pointerdown', e => { if (this.editor.pointerDown({ x: e.clientX, y: e.clientY }, point(e))) this.stage.setPointerCapture(e.pointerId); });
    this.stage.addEventListener('pointermove', e => {
      const p = point(e);
      this.editor.pointerMove({ x: e.clientX, y: e.clientY }, p);
      document.body.classList.toggle('over-part', !!(p && this.editor.tool === 'view' && this.editor.partAt(p)));
    });
    this.stage.addEventListener('pointerup', e => this.editor.pointerUp({ x: e.clientX, y: e.clientY }, point(e)));
    this.stage.addEventListener('pointerleave', () => { if (!this.editor.drag) this.editor.hoverAt(null); });
    this.stage.addEventListener('dblclick', () => { if (this.editor.tool === 'trace') this.editor.finishDraft(); });
  }

  /** Full redraw of the circuit layer (with live node voltages) and the bill of materials. */
  render(): void {
    const c = this.store.circuit, vref = referenceVoltage(c), neutral = scenePalette().trace;
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" font-family="Martian Mono, Menlo, monospace" role="img" aria-label="' + esc(t('sch.aria')) + '">';
    s += '<rect x="30" y="30" width="' + BOARD.width * U + '" height="' + BOARD.depth * U + '" rx="6" fill="none" stroke="var(--line)" stroke-width="1.5"/>';
    const labeled = new Set<number | null>();
    c.traces.forEach((pts, i) => {
      const node = this.sim.topo?.traceNode[i] ?? null, v = this.sim.voltageAt(node);
      const color = this.heatMap && v !== null ? heatHex(v, vref, neutral) : 'var(--ink)';
      s += '<polyline points="' + pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round"/>';
      if (v !== null && !labeled.has(node)) {
        labeled.add(node);
        const [x1, z1] = pts[0], [x2, z2] = pts[1];
        s += '<text x="' + (X((x1 + x2) / 2) + 4) + '" y="' + (Y((z1 + z2) / 2) - 5) + '" font-size="10" fill="var(--ink-soft)">' + esc(formatSI(v, 'V')) + '</text>';
      }
    });
    const ends = new Map<string, number>();
    c.traces.forEach(pts => [pts[0], pts[pts.length - 1]].forEach(p => { const k = p.join(','); ends.set(k, (ends.get(k) ?? 0) + 1); }));
    c.traces.forEach(pts => pts.forEach(p => { if ((ends.get(p.join(',')) ?? 0) > 1) s += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="3.5" fill="var(--ink)"/>'; }));
    c.components.forEach(p => {
      s += this.symbolAt(p, p.x, p.z, 1);
      const [hx, hz] = footprint(p), lx = X(p.x + hx + 0.08), ly = Y(p.z - hz + 0.15);
      s += '<text x="' + lx + '" y="' + ly + '" font-size="12" font-weight="700" fill="var(--ink)">' + esc(p.id) + '</text>' +
        '<text x="' + lx + '" y="' + (ly + 14) + '" font-size="10.5" fill="var(--ink)">' + esc(valueLabel(p)) + '</text>';
    });
    this.base.innerHTML = s + '</svg>';
    this.bom = this.buildBom();
    this.drawOverlay();
  }

  private symbolAt(p: Part, x: number, z: number, opacity: number): string {
    return '<g opacity="' + opacity + '" transform="translate(' + X(x) + ' ' + Y(z) + ') rotate(' + p.rot * 90 + ') scale(' + U + ')">' + symbol(p) + '</g>';
  }

  drawOverlay(): void {
    if (!this.visible()) return;
    const ed = this.editor, c = this.store.circuit, blue = cssVar('--electron'), red = cssVar('--danger'), paper = cssVar('--paper-2');
    let s = '';
    const box = (p: Part, x: number, z: number, color: string, dashed: boolean): void => {
      const [hx, hz] = footprint(p);
      s += '<rect x="' + X(x - hx - 0.08) + '" y="' + Y(z - hz - 0.08) + '" width="' + (2 * hx + 0.16) * U + '" height="' + (2 * hz + 0.16) * U +
        '" rx="6" fill="' + color + '" fill-opacity="0.08" stroke="' + color + '" stroke-width="2"' + (dashed ? ' stroke-dasharray="6 4"' : '') + '/>';
    };
    const polyline = (pts: Point[], color: string, width: number, extra = ''): void => {
      s += '<polyline points="' + pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linejoin="round" ' + extra + '/>';
    };
    const selected = this.store.selectedId ? this.store.find(this.store.selectedId) : undefined;
    if (selected) box(selected, selected.x, selected.z, blue, true);
    const d = ed.drag;
    if (d?.moved) { const p = c.components[d.index]; if (p) { const moved = { ...p, x: d.nx, z: d.nz }; box(moved, d.nx, d.nz, blue, false); s += this.symbolAt(moved, d.nx, d.nz, 0.7); } }
    const hover = ed.hover;
    if (hover && isPlaceTool(ed.tool)) {
      const fake: Part = { type: ed.tool, id: '', x: hover.x, z: hover.z, rot: ed.rot, ...JSON.parse(JSON.stringify(DEFAULTS[ed.tool])) };
      s += this.symbolAt(fake, hover.x, hover.z, 0.45);
    }
    const draft = ed.draftPreview();
    if (draft) {
      polyline(draft, blue, 3, 'stroke-dasharray="7 5"');
      s += '<circle cx="' + X(draft[0][0]) + '" cy="' + Y(draft[0][1]) + '" r="4" fill="' + blue + '"/>';
    } else if (hover && ed.tool === 'trace') s += '<circle cx="' + X(hover.x) + '" cy="' + Y(hover.z) + '" r="4" fill="' + blue + '" fill-opacity="0.6"/>';
    if (hover && ed.tool === 'erase') {
      const hit = ed.targetAt(hover);
      if (hit?.kind === 'part') box(hit.part, hit.part.x, hit.part.z, red, false);
      else if (hit) polyline(c.traces[hit.index], red, 5, 'stroke-opacity="0.6"');
    }
    if (hover && ed.tool === 'probe') s += '<circle cx="' + X(hover.x) + '" cy="' + Y(hover.z) + '" r="5" fill="none" stroke="' + red + '" stroke-width="2"/>';
    const pr = this.probe;
    if (pr.red) {
      const v = pr.reading();
      s += '<circle cx="' + X(pr.red[0]) + '" cy="' + Y(pr.red[1]) + '" r="6" fill="#d92d20" stroke="' + paper + '" stroke-width="2"/>';
      s += '<text x="' + (X(pr.red[0]) + 10) + '" y="' + (Y(pr.red[1]) - 10) + '" font-size="13" font-weight="700" fill="#d92d20">' + esc(v === null ? t('noConn') : (pr.black ? 'ΔV ' : 'V ') + formatSI(v, 'V')) + '</text>';
    }
    if (pr.black) s += '<circle cx="' + X(pr.black[0]) + '" cy="' + Y(pr.black[1]) + '" r="6" fill="#1d1e21" stroke="' + paper + '" stroke-width="2"/>';
    this.overlay.innerHTML = s;
  }

  private buildBom(): BomLine[] {
    const groups = new Map<string, BomLine & { order: number }>();
    const order = ['source', 'resistor', 'pot', 'capacitor', 'inductor', 'diode', 'led', 'switch', 'nmos', 'pmos', 'cpu'];
    this.store.circuit.components.forEach(p => {
      const value = bomValue(p), key = p.type + '|' + value;
      if (!groups.has(key)) groups.set(key, { qty: 0, part: partName(p), value, refs: [], order: order.indexOf(p.type) });
      const g = groups.get(key)!;
      g.qty++; g.refs.push(p.id);
    });
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }

  /** The schematic as a standalone SVG with theme colors resolved. */
  exportSvg(): string {
    return this.base.innerHTML.replace(/var\(--ink-soft\)/g, cssVar('--ink-soft')).replace(/var\(--ink\)/g, cssVar('--ink')).replace(/var\(--line\)/g, cssVar('--line'));
  }
}
