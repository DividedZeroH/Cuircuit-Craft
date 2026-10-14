/** Line plot of the sheet's one-parameter functions on a canvas. */
import type { Env } from '../../domain/math/expression';
import { sampleFunction } from '../../domain/math/sheet';
import { formatNumber } from '../../domain/units';
import { cssVar } from '../theme';

export const PLOT_COLORS = ['#1f6bff', '#ff8a1f', '#2f9e44', '#d93a2b'];

function niceStep(range: number): number {
  const raw = range / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

const num = (v: number): string => formatNumber(v) ?? '';

export interface PlotInfo { variable: string; from: number; to: number }

/** Draws up to four functions. Returns the axis description, or null when there is nothing to draw. */
export function drawPlot(canvas: HTMLCanvasElement, env: Env | null, names: string[], emptyText: string): PlotInfo | null {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  if (!w || !h) return null;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const ink = cssVar('--ink'), grid = cssVar('--line');
  const shown = names.slice(0, 4);
  if (!env || !shown.length) {
    c.fillStyle = ink; c.font = '500 12px "Martian Mono", Menlo, monospace'; c.textAlign = 'center';
    c.fillText(emptyText, w / 2, h / 2);
    return null;
  }
  const xmin = env.vars.xmin, xmax = env.vars.xmax;
  const x0 = isFinite(xmin) ? xmin : 0;
  let x1 = isFinite(xmax) ? xmax : 10;
  if (!(x1 > x0)) x1 = x0 + 1;
  const series = shown.map(n => sampleFunction(env, n, x0, x1));
  let y0 = 0, y1 = 0;
  series.forEach(pts => pts.forEach(([, y]) => { if (isFinite(y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  if (y1 - y0 < 1e-15) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const L = 64, R = 16, T = 16, B = 34;
  const X = (x: number): number => L + ((x - x0) / (x1 - x0)) * (w - L - R);
  const Y = (y: number): number => T + (1 - (y - y0) / (y1 - y0)) * (h - T - B);
  c.font = '300 10.5px "Martian Mono", Menlo, monospace'; c.fillStyle = ink; c.strokeStyle = grid; c.lineWidth = 1;
  const sx = niceStep(x1 - x0), sy = niceStep(y1 - y0);
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + sx * 1e-9; x += sx) {
    c.beginPath(); c.moveTo(X(x), T); c.lineTo(X(x), h - B); c.stroke();
    c.fillText(num(Math.abs(x) < sx * 1e-6 ? 0 : x), X(x), h - B + 8);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + sy * 1e-9; y += sy) {
    c.beginPath(); c.moveTo(L, Y(y)); c.lineTo(w - R, Y(y)); c.stroke();
    c.fillText(num(Math.abs(y) < sy * 1e-6 ? 0 : y), L - 8, Y(y));
  }
  c.strokeStyle = ink; c.lineWidth = 1.2;
  const zero = Y(Math.max(y0, Math.min(y1, 0)));
  c.beginPath(); c.moveTo(L, zero); c.lineTo(w - R, zero); c.stroke();
  if (x0 <= 0 && x1 >= 0) { c.beginPath(); c.moveTo(X(0), T); c.lineTo(X(0), h - B); c.stroke(); }
  series.forEach((pts, i) => {
    c.strokeStyle = PLOT_COLORS[i]; c.lineWidth = 2.5; c.lineJoin = 'round'; c.beginPath();
    let pen = false;
    pts.forEach(([x, y]) => {
      if (!isFinite(y)) { pen = false; return; }
      if (pen) c.lineTo(X(x), Y(y)); else c.moveTo(X(x), Y(y));
      pen = true;
    });
    c.stroke();
    const last = [...pts].reverse().find(([, y]) => isFinite(y));
    if (last) { c.fillStyle = PLOT_COLORS[i]; c.beginPath(); c.arc(X(last[0]), Y(last[1]), 4, 0, 7); c.fill(); }
  });
  return { variable: env.fns[shown[0]].params[0], from: x0, to: x1 };
}
