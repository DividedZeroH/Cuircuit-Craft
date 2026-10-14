/**
 * Equation sheet. Reads the circuit (values and live readings) and writes back:
 * assigning to a part name changes that part on the board and schematic.
 */
import { applyWrites, boardVariables, writableValues } from '../../application/sheetSync';
import type { CircuitStore } from '../../application/store';
import type { SheetResult } from '../../domain/math/sheet';
import { evaluateSheet } from '../../domain/math/sheet';
import type { Simulator } from '../../domain/simulation/simulator';
import { formatNumber } from '../../domain/units';
import { KEYS, readValue, writeValue } from '../../infrastructure/storage';
import { isSheetSample, sheetSample, t } from '../../infrastructure/i18n';
import { errorText } from '../describe';
import { PLOT_COLORS, drawPlot } from './plot';

const WRITE_DELAY = 700;
const esc = (s: string): string => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class SheetView {
  private result: SheetResult | null = null;
  private writeTimer = 0;

  constructor(private input: HTMLTextAreaElement, private output: HTMLElement, private canvas: HTMLCanvasElement,
    private legend: HTMLElement, private note: HTMLElement, private store: CircuitStore, private sim: Simulator) {
    input.value = readValue<string>(KEYS.sheet) ?? sheetSample();
    input.addEventListener('input', () => {
      writeValue(KEYS.sheet, input.value);
      this.evaluate(false);
      clearTimeout(this.writeTimer);
      this.writeTimer = window.setTimeout(() => this.evaluate(true), WRITE_DELAY);
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input'));
    });
  }

  private visible(): boolean { return document.body.dataset.view === 'sheet'; }

  /** Recomputes every line. With apply = true, assignments to parts are written to the circuit. */
  evaluate(apply: boolean): void {
    const c = this.store.circuit;
    this.result = evaluateSheet(this.input.value, boardVariables(c, this.sim), writableValues(c));
    const errors = apply && this.result.writes.length ? applyWrites(this.store, this.result.writes) : new Map();
    const writable = writableValues(this.store.circuit);
    this.output.innerHTML = this.result.lines.map(line => {
      switch (line.kind) {
        case 'empty': return '<div></div>';
        case 'error': return '<div class="err">' + esc(errorText(line.error)) + '</div>';
        case 'function': return '<div class="fn">' + esc(line.params.length === 1 ? t('eq.fn1') : t('eq.fnN', line.params.length)) + '</div>';
        case 'solve': return '<div>' + esc(line.name + ' = ' + (formatNumber(line.value) ?? t('eq.undef'))) + '</div>';
        case 'value': return '<div>= ' + esc(formatNumber(line.value) ?? t('eq.undef')) + '</div>';
        case 'assign': {
          const text = '= ' + (formatNumber(line.value) ?? t('eq.undef'));
          if (!line.write) return '<div>' + esc(text) + '</div>';
          const err = errors.get(line.name);
          if (err) return '<div class="err">' + esc(errorText(err)) + '</div>';
          const now = writable[line.name];
          const synced = Math.abs(now - line.value) <= 1e-12 * Math.max(1, Math.abs(line.value));
          return '<div>' + esc(text) + ' <span class="sync">' + esc(synced ? t('eq.synced') : t('eq.onBoard', formatNumber(now) ?? '')) + '</span></div>';
        }
      }
    }).join('');
    this.input.style.height = this.result.lines.length * 30 + 24 + 'px';
    this.plot();
  }

  /** Writes the sheet's assignments now (the "Apply to board" button). */
  applyNow(): void { clearTimeout(this.writeTimer); this.evaluate(true); }

  plot(): void {
    if (!this.visible()) return;
    const info = drawPlot(this.canvas, this.result?.env ?? null, this.result?.plottable ?? [], t('plot.empty'));
    if (!info || !this.result) { this.legend.textContent = t('plot.none'); this.note.textContent = '—'; return; }
    this.legend.innerHTML = this.result.plottable.slice(0, 4).map((n, i) =>
      '<span class="key"><i style="background:' + PLOT_COLORS[i] + '"></i><b>' + esc(n) + '(' + esc(this.result!.env.fns[n].params[0]) + ')</b></span>').join('');
    this.note.textContent = t('plot.range', info.variable, formatNumber(info.from) ?? '', formatNumber(info.to) ?? '');
  }

  loadSample(): void { this.input.value = sheetSample(); this.input.dispatchEvent(new Event('input')); }

  /** Swap in the new language's sample when the sheet still holds an untouched sample. */
  onLanguageChange(): void { if (isSheetSample(this.input.value)) { this.input.value = sheetSample(); writeValue(KEYS.sheet, this.input.value); } }

  appendVariableList(): void {
    const names = Object.keys(boardVariables(this.store.circuit, this.sim)).filter(k => k !== 't_sim');
    const lines = ['', t('eq.varsHead')];
    this.store.circuit.components.forEach(p => {
      const own = names.filter(k => k === p.id || k.endsWith('_' + p.id));
      if (own.length) lines.push('# ' + own.join('  '));
    });
    lines.push(t('eq.varsTime'), t('eq.varsWrite'));
    this.input.value = this.input.value.replace(/\s*$/, '') + '\n' + lines.join('\n');
    this.input.dispatchEvent(new Event('input'));
  }
}
