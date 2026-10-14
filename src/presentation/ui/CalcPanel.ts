/** Live calculations: one editable row per part, with the formulas filled in. */
import type { CircuitStore } from '../../application/store';
import { totals } from '../../domain/analysis';
import type { Warning } from '../../domain/analysis';
import { LED_SPECS, PART_TYPES, UNIT, WAVES } from '../../domain/components';
import type { LedColor, Part } from '../../domain/components';
import type { Simulator } from '../../domain/simulation/simulator';
import { formatSI, parseSI } from '../../domain/units';
import { t } from '../../infrastructure/i18n';
import { describe, partName, warningText } from '../describe';

interface Row { id: string; box: HTMLElement; code: HTMLElement }

const esc = (s: string): string => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class CalcPanel {
  private rows: Row[] = [];

  constructor(readonly root: HTMLElement, private list: HTMLElement, private summary: HTMLElement,
    private store: CircuitStore, private sim: Simulator) {}

  get open(): boolean { return !this.root.hidden; }

  rebuild(): void {
    this.list.textContent = '';
    this.rows = [];
    const c = this.store.circuit;
    if (!c.components.length) { this.list.innerHTML = '<p>' + esc(t('calc.empty')) + '</p>'; return; }
    c.components
      .slice()
      .sort((a, b) => PART_TYPES.indexOf(a.type) - PART_TYPES.indexOf(b.type) || a.id.localeCompare(b.id, undefined, { numeric: true }))
      .forEach(p => this.rows.push(this.row(p)));
    this.highlight();
  }

  private edit(id: string, mutate: (p: Part) => void): void {
    this.store.commit(c => { const p = c.components.find(k => k.id === id); if (p) mutate(p); });
  }

  private row(p: Part): Row {
    const box = document.createElement('div'); box.className = 'calc';
    const head = document.createElement('header');
    head.innerHTML = '<b>' + esc(p.id) + '</b><small>' + esc(partName(p)) + '</small>';
    const controls = document.createElement('div'); controls.className = 'ctl';
    const unit = UNIT[p.type];
    if (unit) {
      const input = document.createElement('input');
      input.type = 'text'; input.id = 'val-' + p.id; input.value = formatSI(p.value, unit);
      input.setAttribute('aria-label', t(p.type === 'nmos' || p.type === 'pmos' ? 'aria.vth' : 'aria.value', p.id));
      input.addEventListener('change', () => {
        const v = parseSI(input.value);
        if (!(v > 0)) { input.value = formatSI(p.value, unit); return; }
        this.edit(p.id, k => { k.value = v; });
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
      head.appendChild(input);
      if (p.type === 'nmos' || p.type === 'pmos') controls.insertAdjacentHTML('beforeend', '<span>' + esc(t('calc.vth')) + '</span>');
    }
    if (p.type === 'source') {
      const sel = document.createElement('select'); sel.id = 'wave-' + p.id; sel.setAttribute('aria-label', t('aria.wave', p.id));
      WAVES.forEach(w => sel.add(new Option(t('wave.' + w), w, false, w === p.wave)));
      sel.addEventListener('change', () => this.edit(p.id, k => { k.wave = sel.value as Part['wave']; }));
      controls.appendChild(sel);
      if (p.wave !== 'dc') {
        const f = document.createElement('input'); f.type = 'text'; f.id = 'freq-' + p.id; f.value = formatSI(p.freq ?? 1, 'Hz');
        f.setAttribute('aria-label', t('aria.freq', p.id));
        f.addEventListener('change', () => { const v = parseSI(f.value); if (!(v > 0)) { f.value = formatSI(p.freq ?? 1, 'Hz'); return; } this.edit(p.id, k => { k.freq = v; }); });
        controls.appendChild(f);
        controls.insertAdjacentHTML('beforeend', '<span>' + esc(t('calc.slow')) + '</span>');
      }
    }
    if (p.type === 'led') {
      const sel = document.createElement('select'); sel.id = 'color-' + p.id; sel.setAttribute('aria-label', t('aria.color', p.id));
      (Object.keys(LED_SPECS) as LedColor[]).forEach(k => sel.add(new Option(t('c.' + k), k, false, k === p.color)));
      sel.addEventListener('change', () => this.edit(p.id, k => { k.color = sel.value as LedColor; }));
      head.appendChild(sel);
    }
    if (p.type === 'switch') {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = p.closed ? t('b.open') : t('b.shut');
      btn.addEventListener('click', () => this.edit(p.id, k => { k.closed = !k.closed; }));
      head.appendChild(btn);
    }
    if (p.type === 'pot') {
      const range = document.createElement('input');
      range.type = 'range'; range.min = '0'; range.max = '100'; range.value = String(Math.round((p.pos ?? 0.5) * 100));
      range.id = 'pos-' + p.id; range.setAttribute('aria-label', t('aria.pos', p.id));
      range.addEventListener('input', () => this.store.tweak(c => { const k = c.components.find(x => x.id === p.id); if (k) k.pos = Number(range.value) / 100; }));
      controls.appendChild(range);
    }
    const code = document.createElement('code');
    box.append(head);
    if (controls.childNodes.length) box.append(controls);
    box.append(code);
    this.list.appendChild(box);
    return { id: p.id, box, code };
  }

  highlight(): void {
    this.rows.forEach(r => r.box.classList.toggle('focus', r.id === this.store.selectedId));
  }

  /** Opens the panel on a part and puts the cursor in its first field. */
  inspect(id: string): void {
    this.root.hidden = false;
    this.highlight();
    const row = this.rows.find(r => r.id === id);
    if (!row) return;
    row.box.scrollIntoView({ block: 'nearest' });
    const field = row.box.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    if (field) { field.focus(); if (field instanceof HTMLInputElement && field.type === 'text') field.select(); }
  }

  update(warnings: Array<Warning | null>): void {
    const c = this.store.circuit;
    this.rows.forEach(row => {
      const i = c.components.findIndex(p => p.id === row.id);
      if (i < 0) return;
      const w = warnings[i];
      row.code.innerHTML = describe(c.components[i], this.sim.results[i] ?? null).html + (w ? '<br><span class="bad">⚠ ' + esc(warningText(w)) + '</span>' : '');
    });
    if (!this.sim.topo?.hasSource) {
      this.summary.innerHTML = '<dt>' + esc(t('sum.noSrc')) + '</dt><dd>' + esc(t('sum.addSrc')) + '</dd>';
      return;
    }
    const tot = totals(c, this.sim.results);
    const item = (k: string, v: string): string => '<dt>' + esc(t(k)) + '</dt><dd>' + esc(v) + '</dd>';
    this.summary.innerHTML = item('sum.time', formatSI(this.sim.time, 's')) + item('m.speed', '× ' + this.sim.speed.toLocaleString()) +
      item('sum.cur', formatSI(tot.current, 'A')) + item('sum.pow', formatSI(tot.power, 'W')) + item('sum.energy', formatSI(tot.energy, 'J'));
  }
}
