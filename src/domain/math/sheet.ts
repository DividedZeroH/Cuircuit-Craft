/**
 * Evaluates a sheet line by line. Each line is one of:
 *   comment / blank, `name = expr`, `f(x; y) = expr`, `solve x: lhs = rhs`, or a bare expression.
 * Assignments to names in `writable` are reported back so the caller can update the circuit.
 */
import { DomainError } from '../errors';
import { compile } from './expression';
import type { Env, UserFn, Vars } from './expression';

export type LineResult =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'assign'; name: string; value: number; write?: { current: number } }
  | { kind: 'solve'; name: string; value: number }
  | { kind: 'function'; name: string; params: string[] }
  | { kind: 'error'; error: DomainError };

export interface SheetResult {
  lines: LineResult[];
  env: Env;
  /** One-parameter functions, in definition order: these get plotted. */
  plottable: string[];
  writes: Array<{ name: string; value: number }>;
}

const SOLVE = /^(?:solve|resolver|resolva|resolve|loese|löse)\s+([A-Za-z_]\w*)\s*:\s*(.+?)=(.+)$/;
const FUNCTION = /^([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*(?:\s*;\s*[A-Za-z_]\w*)*)\s*\)\s*=(.*)$/;
const ASSIGN = /^([A-Za-z_]\w*)\s*=(.*)$/;

export function evaluateSheet(text: string, initial: Vars, writable: Record<string, number>): SheetResult {
  const vars = Object.assign(Object.create(null) as Vars, initial);
  const fns = Object.create(null) as Record<string, UserFn>;
  const env: Env = { vars, fns, depth: 0 };
  const plottable: string[] = [];
  const writes: SheetResult['writes'] = [];

  const lines = text.split('\n').map((raw): LineResult => {
    const s = raw.replace(/#.*/, '').trim();
    if (!s) return { kind: 'empty' };
    try {
      const sv = SOLVE.exec(s);
      if (sv) return solveLine(env, sv[1], sv[2], sv[3]);
      const fm = FUNCTION.exec(s);
      if (fm) {
        const params = fm[2].split(';').map(x => x.trim());
        fns[fm[1]] = { params, body: compile(fm[3]) };
        if (params.length === 1 && !plottable.includes(fm[1])) plottable.push(fm[1]);
        return { kind: 'function', name: fm[1], params };
      }
      const am = ASSIGN.exec(s);
      if (am) {
        const name = am[1], value = compile(am[2])(env);
        vars[name] = value;
        if (name in writable) {
          writes.push({ name, value });
          return { kind: 'assign', name, value, write: { current: writable[name] } };
        }
        return { kind: 'assign', name, value };
      }
      return { kind: 'value', value: compile(s)(env) };
    } catch (err) {
      return { kind: 'error', error: err instanceof DomainError ? err : new DomainError('expr.unknown', [String(err)]) };
    }
  });
  return { lines, env, plottable, writes };
}

/** Secant method on lhs − rhs, starting from the variable's current value (or 1). */
function solveLine(env: Env, name: string, lhs: string, rhs: string): LineResult {
  const L = compile(lhs), R = compile(rhs);
  const F = (x: number): number => { env.vars[name] = x; return L(env) - R(env); };
  let x0 = typeof env.vars[name] === 'number' && isFinite(env.vars[name]) ? env.vars[name] : 1;
  let x1 = x0 * 1.1 + 0.1, f0 = F(x0), f1 = F(x1), ok = false;
  for (let k = 0; k < 80; k++) {
    if (!isFinite(f1) || f1 === f0) break;
    const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
    x0 = x1; f0 = f1; x1 = x2; f1 = F(x1);
    if (Math.abs(f1) < 1e-10 * (1 + Math.abs(x1))) { ok = true; break; }
  }
  if (!ok || !isFinite(x1)) { delete env.vars[name]; throw new DomainError('expr.nosol', [name]); }
  env.vars[name] = x1;
  return { kind: 'solve', name, value: x1 };
}

/** Samples a one-parameter function over [x0, x1]. */
export function sampleFunction(env: Env, name: string, x0: number, x1: number, n = 300): Array<[number, number]> {
  const f = env.fns[name];
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    let y: number;
    try { const vars = Object.create(env.vars) as Vars; vars[f.params[0]] = x; y = f.body({ vars, fns: env.fns, depth: 1 }); }
    catch { y = NaN; }
    pts.push([x, y]);
  }
  return pts;
}
