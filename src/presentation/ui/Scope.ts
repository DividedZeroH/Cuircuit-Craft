/** Multimeter reading and oscilloscope trace for the probes. */
import type { Probe } from '../../application/probe';
import { formatSI } from '../../domain/units';
import { t } from '../../infrastructure/i18n';
import { cssVar } from '../theme';

export class Scope {
  constructor(private root: HTMLElement, private canvas: HTMLCanvasElement, private reading: HTMLElement,
    private note: HTMLElement, private windowButton: HTMLButtonElement, private probe: Probe) {
    windowButton.addEventListener('click', () => probe.cycleWindow());
    probe.on(() => this.sync());
    this.sync();
  }

  private sync(): void {
    this.root.hidden = !this.probe.active;
    this.windowButton.textContent = formatSI(this.probe.window, 's');
  }

  draw(): void {
    if (this.root.hidden) return;
    const v = this.probe.reading();
    this.reading.textContent = v === null ? t('s.noconnLong') : (this.probe.black ? 'ΔV = ' : 'V = ') + formatSI(v, 'V');
    this.note.textContent = this.probe.black ? t('s.note2') : t('s.note1');
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (!w) return;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const buf = this.probe.buffer;
    if (buf.length < 2) return;
    let y0 = Math.min(0, ...buf.map(p => p[1])), y1 = Math.max(0, ...buf.map(p => p[1]));
    if (y1 - y0 < 1e-6) { y1 += 1; y0 -= 1; }
    const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
    const win = this.probe.window, tEnd = buf[buf.length - 1][0], tStart = tEnd - win, L = 44;
    const X = (x: number): number => L + ((x - tStart) / win) * (w - L - 4), Y = (y: number): number => 4 + (1 - (y - y0) / (y1 - y0)) * (h - 22);
    g.strokeStyle = cssVar('--line'); g.lineWidth = 1; g.font = '300 9.5px "Martian Mono", monospace'; g.fillStyle = cssVar('--ink-soft');
    for (let k = 0; k <= 4; k++) {
      const yy = y0 + ((y1 - y0) * k) / 4;
      g.beginPath(); g.moveTo(L, Y(yy)); g.lineTo(w - 4, Y(yy)); g.stroke();
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(formatSI(yy, 'V'), L - 4, Y(yy));
    }
    g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(t('s.perScreen', formatSI(win, 's')), w - 4, h - 14);
    g.strokeStyle = cssVar('--ink'); g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(w - 4, Y(0)); g.stroke();
    g.strokeStyle = cssVar('--electron'); g.lineWidth = 2; g.beginPath();
    buf.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
  }
}
