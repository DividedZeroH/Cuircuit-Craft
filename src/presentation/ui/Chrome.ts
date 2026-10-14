/**
 * Everything around the views: tabs, tool rail, top-right controls, menu,
 * panels and keyboard shortcuts. Holds no circuit logic of its own.
 */
import type { Editor, Tool } from '../../application/editor';
import { isPlaceTool } from '../../application/editor';
import type { CircuitStore } from '../../application/store';
import { validateCircuit } from '../../domain/circuit';
import type { ExampleId } from '../../domain/examples';
import { EXAMPLES } from '../../domain/examples';
import type { Simulator } from '../../domain/simulation/simulator';
import { formatSI } from '../../domain/units';
import { copyText } from '../../infrastructure/clipboard';
import { LANGUAGE_NAMES, getLanguage, setLanguage, t } from '../../infrastructure/i18n';
import type { Language } from '../../infrastructure/i18n';
import { errorText, toolName } from '../describe';
import { isDark, toggleTheme } from '../theme';

export type View = 'board' | 'schematic' | 'sheet';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const SPEEDS = [1, 0.1, 0.01, 0.001];
const KEYMAP: Record<string, Tool> = {
  v: 'view', m: 'probe', '1': 'source', '2': 'resistor', '3': 'capacitor', '4': 'cpu', '5': 'led', '6': 'diode',
  '7': 'switch', '8': 'inductor', '9': 'pot', n: 'nmos', p: 'pmos', t: 'trace', x: 'erase'
};

export interface ChromeHooks {
  onView(v: View): void;
  onHeat(on: boolean): void;
  onLabels(on: boolean): void;
  onSnapshot(): string;
  onResetCamera(): void;
  onAutoRotate(on: boolean): void;
  onExampleLoaded(): void;
}

export class Chrome {
  view: View = 'board';
  paused: boolean;
  heat = false;
  private clearArmed = 0;
  private idleTimer = 0;
  readonly calcPanel = $('calc-panel');
  private jsonPanel = $('json-panel');
  private shotPanel = $('shot-panel');
  private menu = $('menu');

  constructor(private store: CircuitStore, private sim: Simulator, private editor: Editor, private hooks: ChromeHooks) {
    this.paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bindTabs();
    this.bindRail();
    this.bindCorner();
    this.bindMenu();
    this.bindPanels();
    this.bindKeyboard();
    this.bindIdle();
    editor.on(e => { if (e === 'tool') this.syncTool(); });
    this.renderLanguages();
  }

  /** Re-applies every label that depends on state (after a language or theme change). */
  refreshLabels(): void {
    const dark = isDark(), theme = $('btn-theme');
    theme.querySelector('.i-moon')!.toggleAttribute('hidden', dark);
    theme.querySelector('.i-sun')!.toggleAttribute('hidden', !dark);
    theme.dataset.tip = dark ? t('tip.themeLight') : t('tip.themeDark');
    theme.setAttribute('aria-label', dark ? t('aria.toLight') : t('aria.toDark'));
    const power = $('btn-power');
    power.setAttribute('aria-pressed', String(this.sim.powerOn));
    power.dataset.tip = this.sim.powerOn ? t('tip.powerOn') : t('tip.powerOff');
    power.setAttribute('aria-label', this.sim.powerOn ? t('aria.powerOff') : t('aria.powerOn'));
    const pause = $('btn-pause');
    pause.setAttribute('aria-pressed', String(this.paused));
    pause.querySelector('.i-pause')!.toggleAttribute('hidden', this.paused);
    pause.querySelector('.i-play')!.toggleAttribute('hidden', !this.paused);
    pause.dataset.tip = this.paused ? t('tip.resume') : t('tip.pause');
    pause.setAttribute('aria-label', pause.dataset.tip);
    $('speed-lbl').textContent = '× ' + this.sim.speed.toLocaleString();
    this.syncTool();
    this.updateBomLine();
    this.renderLanguages();
  }

  updateBomLine(): void {
    $('bom-line').textContent = t('bomLine', this.store.circuit.components.length, this.store.circuit.traces.length);
  }

  updateHeatLegend(vref: number): void {
    $('hl-min').textContent = '−' + formatSI(vref, 'V');
    $('hl-max').textContent = '+' + formatSI(vref, 'V');
    $('heat-legend').hidden = !this.heat || !this.calcPanel.hidden || !this.jsonPanel.hidden || !this.shotPanel.hidden;
  }

  setView(v: View): void {
    this.view = v;
    document.body.dataset.view = v;
    document.querySelectorAll<HTMLElement>('[data-view-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.viewTab === v)));
    if (v === 'sheet') this.togglePanel(this.calcPanel, false);
    this.editor.hoverAt(null);
    this.hooks.onView(v);
  }

  togglePanel(panel: HTMLElement, show?: boolean): void {
    const on = show === undefined ? panel.hidden : show;
    [this.calcPanel, this.jsonPanel, this.shotPanel].forEach(p => { p.hidden = p === panel ? !on : on ? true : p.hidden; });
    $('btn-calc').setAttribute('aria-pressed', String(!this.calcPanel.hidden));
  }

  private syncTool(): void {
    document.body.dataset.tool = this.editor.tool;
    document.querySelectorAll<HTMLElement>('button[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === this.editor.tool)));
    const tool = this.editor.tool;
    const tips: Partial<Record<Tool, string>> = { view: 'tip.view', probe: 'tip.probe', trace: 'tip.trace', erase: 'tip.erase', nmos: 'tip.nmos', pmos: 'tip.pmos', cpu: 'tip.cpu' };
    $('tip').textContent = tips[tool] ? t(tips[tool]!) : isPlaceTool(tool) ? t('tip.place', toolName(tool).toLowerCase()) : '';
  }

  private bindTabs(): void {
    document.querySelectorAll<HTMLElement>('[data-view-tab]').forEach(b => b.addEventListener('click', () => this.setView(b.dataset.viewTab as View)));
  }

  private bindRail(): void {
    document.querySelectorAll<HTMLElement>('button[data-tool]').forEach(b => b.addEventListener('click', () => this.editor.setTool(b.dataset.tool as Tool)));
  }

  private bindCorner(): void {
    $('btn-theme').addEventListener('click', toggleTheme);
    $('btn-power').addEventListener('click', () => { this.sim.setPower(!this.sim.powerOn); this.refreshLabels(); });
    $('btn-pause').addEventListener('click', () => { this.paused = !this.paused; this.refreshLabels(); });
    $('btn-heat').addEventListener('click', e => {
      this.heat = !this.heat;
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.heat));
      this.hooks.onHeat(this.heat);
    });
    $('btn-tags').addEventListener('click', e => {
      const btn = e.currentTarget as HTMLElement, on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      $('tags').hidden = !on;
      this.hooks.onLabels(on);
    });
    $('btn-calc').addEventListener('click', () => this.togglePanel(this.calcPanel));
  }

  private setMenu(open: boolean): void {
    this.menu.hidden = !open;
    $('btn-menu').setAttribute('aria-expanded', String(open));
  }

  private renderLanguages(): void {
    const box = $('langs'), current = getLanguage();
    box.innerHTML = '';
    (Object.keys(LANGUAGE_NAMES) as Language[]).forEach(l => {
      const b = document.createElement('button');
      b.type = 'button'; b.lang = l; b.textContent = LANGUAGE_NAMES[l];
      b.setAttribute('aria-pressed', String(l === current));
      b.addEventListener('click', e => { e.stopPropagation(); setLanguage(l); });
      box.appendChild(b);
    });
  }

  private bindMenu(): void {
    $('btn-menu').addEventListener('click', e => { e.stopPropagation(); this.setMenu(this.menu.hidden); });
    this.menu.addEventListener('click', e => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button');
      if (b && !['btn-clear', 'btn-spin', 'btn-speed'].includes(b.id) && !b.closest('#langs')) this.setMenu(false);
    });
    document.addEventListener('click', () => this.setMenu(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.setMenu(false); });

    $('btn-speed').addEventListener('click', () => {
      this.sim.speed = SPEEDS[(SPEEDS.indexOf(this.sim.speed) + 1) % SPEEDS.length];
      $('speed-lbl').textContent = '× ' + this.sim.speed.toLocaleString();
    });
    $('btn-discharge').addEventListener('click', () => this.sim.discharge());
    $('btn-rot').addEventListener('click', () => this.editor.rotate());
    $('btn-undo').addEventListener('click', () => this.editor.undo());
    $('btn-spin').addEventListener('click', e => {
      const b = e.currentTarget as HTMLElement, on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      this.hooks.onAutoRotate(on);
    });
    $('btn-home').addEventListener('click', () => this.hooks.onResetCamera());
    document.querySelectorAll<HTMLElement>('[data-example]').forEach(b => b.addEventListener('click', () => {
      this.sim.reset();
      this.store.select(null);
      this.store.replace(validateCircuit(JSON.parse(JSON.stringify(EXAMPLES[b.dataset.example as ExampleId]))));
      this.hooks.onExampleLoaded();
    }));
    $('btn-shot').addEventListener('click', () => {
      const url = this.hooks.onSnapshot();
      ($('shot-img') as HTMLImageElement).src = url;
      ($('shot-download') as HTMLAnchorElement).href = url;
      this.togglePanel(this.shotPanel, true);
    });
    $('btn-json').addEventListener('click', () => {
      ($('json') as HTMLTextAreaElement).value = JSON.stringify(this.store.circuit, null, 1).replace(/\[\n\s+(-?[\d.e-]+),\n\s+(-?[\d.e-]+)\n\s+\]/g, '[$1, $2]');
      $('json-msg').textContent = '';
      this.togglePanel(this.jsonPanel, true);
    });
    const clear = $('btn-clear');
    clear.addEventListener('click', () => {
      const label = clear.querySelector('span')!;
      if (!this.clearArmed) {
        label.textContent = t('m.clearSure'); clear.classList.add('warn');
        this.clearArmed = window.setTimeout(() => { this.clearArmed = 0; label.textContent = t('m.clear'); clear.classList.remove('warn'); }, 2500);
        return;
      }
      clearTimeout(this.clearArmed); this.clearArmed = 0;
      label.textContent = t('m.clear'); clear.classList.remove('warn'); this.setMenu(false);
      this.store.commit(c => { c.components = []; c.traces = []; });
    });
  }

  private bindPanels(): void {
    document.querySelectorAll<HTMLElement>('[data-close]').forEach(x => x.addEventListener('click', () => this.togglePanel($(x.dataset.close!), false)));
    const area = $('json') as HTMLTextAreaElement, msg = $('json-msg');
    $('btn-copy').addEventListener('click', async () => {
      if (await copyText(area.value)) msg.textContent = t('msg.copied');
      else { area.select(); msg.textContent = t('msg.selected'); }
    });
    $('btn-apply').addEventListener('click', () => {
      try {
        const next = validateCircuit(JSON.parse(area.value));
        this.sim.reset();
        this.store.replace(next);
        msg.textContent = t('msg.applied');
      } catch (err) {
        msg.textContent = t('msg.applyFail', errorText(err));
      }
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', e => {
      const target = e.target as HTMLElement;
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(target.tagName) || this.view === 'sheet') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.editor.undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) this.editor.setTool(KEYMAP[k]);
      else if (k === 'r') this.editor.rotate();
      else if (e.key === 'Enter') this.editor.finishDraft();
      else if (e.key === 'Escape') this.editor.cancelDraft();
      else if (e.key === 'Delete' || e.key === 'Backspace') this.editor.setTool('erase');
    });
  }

  private bindIdle(): void {
    const wake = (): void => {
      document.body.classList.remove('idle');
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => { if (this.menu.hidden) document.body.classList.add('idle'); }, 2500);
    };
    ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(ev => window.addEventListener(ev, wake, { passive: true }));
    wake();
  }
}
