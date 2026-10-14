/**
 * Small expression language for the sheet:
 *   numbers with SI prefixes (4.7k, 100u), + − * / ^, parentheses,
 *   calls with ";" separated arguments, deriv(f; x) and integ(f; a; b).
 * Compiles to closures; errors are DomainError codes.
 */
import { DomainError } from '../errors';

export type Vars = Record<string, number>;
export interface UserFn { params: string[]; body: Compiled }
export interface Env { vars: Vars; fns: Record<string, UserFn>; depth: number }
export type Compiled = (env: Env) => number;

interface Token { t: 'n' | 'id' | 'op'; v: string; n?: number }

const MULT: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6 };

const BUILTIN: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, raiz: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, round: Math.round,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a)
};

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    const num = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?([pnuµmkM](?![A-Za-z0-9_]))?/.exec(rest);
    if (num) {
      let core = num[0];
      if (num[1]) core = core.slice(0, -1);
      toks.push({ t: 'n', v: num[0], n: parseFloat(core.replace(',', '.')) * (num[1] ? MULT[num[1]] : 1) });
      i += num[0].length; continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^();·×'.includes(ch)) { toks.push({ t: 'op', v: ch === '·' || ch === '×' ? '*' : ch }); i++; continue; }
    throw new DomainError('expr.char', [ch]);
  }
  return toks;
}

export function lookup(env: Env, name: string): number {
  if (name in env.vars) return env.vars[name];
  if (name === 'pi') return Math.PI;
  if (name === 'e') return Math.E;
  throw new DomainError('expr.unknown', [name]);
}

export function callFn(env: Env, name: string, args: number[]): number {
  const f = env.fns[name];
  if (f) {
    if (env.depth > 40) throw new DomainError('expr.recursive', [name]);
    if (args.length !== f.params.length) throw new DomainError('expr.arity', [name, f.params.length]);
    const vars = Object.create(env.vars) as Vars;
    f.params.forEach((p, i) => { vars[p] = args[i]; });
    return f.body({ vars, fns: env.fns, depth: env.depth + 1 });
  }
  if (BUILTIN[name]) return BUILTIN[name](...args);
  throw new DomainError('expr.unknownFn', [name]);
}

export function compile(src: string): Compiled {
  const toks = tokenize(src);
  let p = 0;
  const isOp = (v: string): boolean => !!toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const need = (v: string): void => { if (!isOp(v)) throw new DomainError('expr.missing', [v]); p++; };

  function expr(): Compiled {
    let l = term();
    while (isOp('+') || isOp('-')) {
      const o = toks[p++].v, r = term(), a = l;
      l = o === '+' ? en => a(en) + r(en) : en => a(en) - r(en);
    }
    return l;
  }
  function term(): Compiled {
    let l = unary();
    while (isOp('*') || isOp('/')) {
      const o = toks[p++].v, r = unary(), a = l;
      l = o === '*' ? en => a(en) * r(en) : en => a(en) / r(en);
    }
    return l;
  }
  function unary(): Compiled {
    if (isOp('-')) { p++; const u = unary(); return en => -u(en); }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power(): Compiled {
    const base = primary();
    if (isOp('^')) { p++; const ex = unary(); return en => Math.pow(base(en), ex(en)); }
    return base;
  }
  function primary(): Compiled {
    const tk = toks[p++];
    if (!tk) throw new DomainError('expr.end');
    if (tk.t === 'n') { const v = tk.n!; return () => v; }
    if (tk.t === 'id') {
      const name = tk.v;
      if ((name === 'deriv' || name === 'integ') && isOp('(')) return calculus(name);
      if (isOp('(')) {
        p++;
        const args: Compiled[] = [];
        if (!isOp(')')) { args.push(expr()); while (isOp(';')) { p++; args.push(expr()); } }
        need(')');
        return en => callFn(en, name, args.map(a => a(en)));
      }
      return en => lookup(en, name);
    }
    if (tk.v === '(') { const e = expr(); need(')'); return e; }
    throw new DomainError('expr.misplaced', [tk.v]);
  }
  function calculus(name: string): Compiled {
    p++;
    const fn = toks[p++];
    if (!fn || fn.t !== 'id') throw new DomainError('expr.needFn', [name]);
    const args: Compiled[] = [];
    while (isOp(';')) { p++; args.push(expr()); }
    need(')');
    if (name === 'deriv') {
      if (args.length !== 1) throw new DomainError('expr.use', ['deriv(f; x)']);
      return en => {
        const x = args[0](en), h = Math.max(1e-6, Math.abs(x) * 1e-5);
        return (callFn(en, fn.v, [x + h]) - callFn(en, fn.v, [x - h])) / (2 * h);
      };
    }
    if (args.length !== 2) throw new DomainError('expr.use', ['integ(f; a; b)']);
    return en => {  // Simpson's rule
      const a = args[0](en), b = args[1](en), N = 400, h = (b - a) / N;
      let s = callFn(en, fn.v, [a]) + callFn(en, fn.v, [b]);
      for (let k = 1; k < N; k++) s += (k % 2 ? 4 : 2) * callFn(en, fn.v, [a + k * h]);
      return (s * h) / 3;
    };
  }

  const e = expr();
  if (p < toks.length) throw new DomainError('expr.extra', [toks[p].v]);
  return e;
}
