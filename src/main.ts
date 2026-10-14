/**
 * Composition root: builds the shared store, simulator and editor,
 * then connects the three views (board, schematic, sheet) to them.
 */
import './styles/main.css';
import { Editor } from './application/editor';
import { Probe } from './application/probe';
import { CircuitStore } from './application/store';
import { checkPart, deriveReadings, referenceVoltage } from './domain/analysis';
import type { Warning } from './domain/analysis';
import { cloneCircuit, validateCircuit } from './domain/circuit';
import type { Circuit } from './domain/circuit';
import { EXAMPLES } from './domain/examples';
import { Simulator } from './domain/simulation/simulator';
import { copyText } from './infrastructure/clipboard';
import { initLanguage, onLanguageChange, t, translateDom } from './infrastructure/i18n';
import { KEYS, readValue, writeValue } from './infrastructure/storage';
import { BoardView } from './presentation/board/BoardView';
import { SchematicView } from './presentation/schematic/SchematicView';
import { SheetView } from './presentation/sheet/SheetView';
import { onThemeChange } from './presentation/theme';
import { CalcPanel } from './presentation/ui/CalcPanel';
import { Chrome } from './presentation/ui/Chrome';
import { Scope } from './presentation/ui/Scope';
import { renderWarnings } from './presentation/ui/Warnings';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

initLanguage();

// ---- Shared state
function loadCircuit(): Circuit {
  try { const saved = readValue<Circuit>(KEYS.circuit); if (saved) return validateCircuit(saved); } catch { /* fall back to the example */ }
  return validateCircuit(cloneCircuit(EXAMPLES.rc));
}
const store = new CircuitStore(loadCircuit(), c => writeValue(KEYS.circuit, c));
const sim = new Simulator();
const probe = new Probe(sim);
const editor = new Editor(store, probe);
sim.onStep = time => probe.record(time);
sim.setCircuit(store.circuit);

// ---- Views
const board = new BoardView($('stage'), $('tags'), $('probe-tag'), store, sim, editor, probe);
const schematic = new SchematicView($('sch'), document.getElementById('sch-over') as unknown as SVGSVGElement, $('sch-stage'), store, sim, editor, probe);
const sheet = new SheetView($('eq') as HTMLTextAreaElement, $('eq-out'), $('plot') as HTMLCanvasElement, $('plot-legend'), $('plot-note'), store, sim);
const calc = new CalcPanel($('calc-panel'), $('calc-list'), $('summary'), store, sim);
const scope = new Scope($('scope'), $('scope-cv') as HTMLCanvasElement, $('scope-rd'), $('scope-note'), $('btn-window') as HTMLButtonElement, probe);

const chrome = new Chrome(store, sim, editor, {
  onView: v => {
    if (v === 'board') board.resize();
    if (v === 'schematic') { schematic.render(); renderBom(); }
    if (v === 'sheet') sheet.evaluate(false);
  },
  onHeat: on => { board.heatMap = on; schematic.heatMap = on; refreshReadings(); if (chrome.view === 'schematic') schematic.render(); },
  onLabels: on => { board.labelsVisible = on; },
  onSnapshot: () => board.snapshot(),
  onResetCamera: () => board.resetCamera(),
  onAutoRotate: on => { board.controls.autoRotate = on; },
  onExampleLoaded: () => probe.clear()
});

editor.onInspect = id => { chrome.togglePanel(calc.root, true); calc.inspect(id); };

// ---- Store → every view
store.on(event => {
  if (event === 'selection') { board.updateSelection(); calc.highlight(); schematic.drawOverlay(); return; }
  if (event === 'values') { sim.refresh(); probe.resolve(); return; }
  sim.setCircuit(store.circuit);
  probe.resolve();
  board.rebuild();
  calc.rebuild();
  chrome.updateBomLine();
  if (chrome.view === 'schematic') { schematic.render(); renderBom(); }
  if (chrome.view === 'sheet') sheet.evaluate(false);
  refreshReadings();
});

function renderBom(): void {
  const lines = schematic.bom;
  const esc = (s: string): string => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  $('bom-table').innerHTML = '<thead><tr><th>' + t('bom.qty') + '</th><th>' + t('bom.part') + '</th><th>' + t('bom.value') + '</th><th>' + t('bom.refs') + '</th></tr></thead><tbody>' +
    lines.map(r => '<tr><td>' + r.qty + '</td><td>' + esc(r.part) + '</td><td>' + esc(r.value) + '</td><td>' + esc(r.refs.join(', ')) + '</td></tr>').join('') + '</tbody>';
  $('bom-count').textContent = t('bom.count', store.circuit.components.length, lines.length);
}

$('btn-svg').addEventListener('click', async e => {
  const btn = e.currentTarget as HTMLElement;
  btn.textContent = (await copyText(schematic.exportSvg())) ? t('sch.copied') : t('copyFail');
  setTimeout(() => (btn.textContent = t('sch.copy')), 1500);
});
$('btn-bom').addEventListener('click', async e => {
  const btn = e.currentTarget as HTMLElement;
  const tsv = [t('bom.qty'), t('bom.part'), t('bom.value'), t('bom.refs')].join('\t') + '\n' + schematic.bom.map(r => [r.qty, r.part, r.value, r.refs.join(', ')].join('\t')).join('\n');
  btn.textContent = (await copyText(tsv)) ? t('bom.copied') : t('copyFail');
  setTimeout(() => (btn.textContent = t('bom.copy')), 1500);
});
$('btn-eq-apply').addEventListener('click', () => sheet.applyNow());
$('btn-vars').addEventListener('click', () => sheet.appendVariableList());
$('btn-eq-sample').addEventListener('click', () => sheet.loadSample());
$('btn-scope-x').addEventListener('click', () => probe.clear());

// ---- Readings: a few times per second, shared by every view
let warnings: Array<Warning | null> = [];
function refreshReadings(): void {
  const c = store.circuit;
  deriveReadings(c, sim.results);
  warnings = c.components.map((_, i) => checkPart(c, i, sim.results[i] ?? null));
  board.updateReadings(warnings);
  calc.update(warnings);
  renderWarnings($('warns'), warnings);
  chrome.updateHeatLegend(referenceVoltage(c));
}

// ---- Language and theme
function sheetHelp(): string {
  const code = (s: string): string => '<code>' + s + '</code>';
  const dec = t('p.hint').includes('4,7') ? '4,7' : '4.7';
  return [
    code('x = ' + dec + 'k') + ' ' + t('f.assign'), code('f(t) = …') + ' ' + t('f.defplot'), code('g(a; b) = …') + ' ' + t('f.two'),
    code('deriv(f; x)'), code('integ(f; a; b)'), code('solve x: f(x) = 2'),
    code('R1 = ' + dec + 'k') + ' ' + t('f.board'), code('S1 = 0') + ' ' + t('f.switch'), code('pos_RV1 = 0' + dec[1] + '3'), code('freq_V1 = 50'),
    code('xmin') + ' / ' + code('xmax') + ' ' + t('f.range'), code('#') + ' ' + t('f.comment'), t('f.prefix') + ' ' + code('p n u m k M'),
    'sqrt exp ln log sin cos tan abs min max round pi e'
  ].join(' · ') + '<br>' + t('eq.writeHint');
}

function applyLanguage(): void {
  translateDom();
  $('eq-help').innerHTML = sheetHelp();
  chrome.refreshLabels();
  calc.rebuild();
  sheet.onLanguageChange();
  board.redrawSilk();
  refreshReadings();
  if (chrome.view === 'schematic') { schematic.render(); renderBom(); }
  if (chrome.view === 'sheet') sheet.evaluate(false);
}
onLanguageChange(applyLanguage);
onThemeChange(() => {
  board.applyTheme();
  chrome.refreshLabels();
  refreshReadings();
  if (chrome.view === 'schematic') schematic.render();
  if (chrome.view === 'sheet') sheet.plot();
});
window.addEventListener('resize', () => { board.resize(); if (chrome.view === 'sheet') sheet.plot(); });

// ---- Start
board.rebuild();
calc.rebuild();
applyLanguage();
const hash = location.hash.slice(1);
chrome.setView(hash === 'schematic' || hash === 'sheet' ? hash : 'board');
document.fonts?.ready.then(() => { board.redrawSilk(); if (chrome.view === 'sheet') sheet.plot(); });

let last = performance.now(), readingsTimer = 0, slowTimer = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const running = !chrome.paused;
  if (running) {
    sim.advance(dt);
    readingsTimer += dt; slowTimer += dt;
    if (readingsTimer > 0.2) {
      readingsTimer = 0;
      refreshReadings();
      if (chrome.view === 'schematic' && probe.active) schematic.drawOverlay();
    }
    if (slowTimer > 0.6) {
      slowTimer = 0;
      if (chrome.view === 'sheet') sheet.evaluate(false);
      else if (chrome.view === 'schematic') { schematic.render(); renderBom(); }
    }
  }
  if (chrome.view !== 'sheet') scope.draw();
  if (chrome.view === 'board') board.frame(dt, running);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
