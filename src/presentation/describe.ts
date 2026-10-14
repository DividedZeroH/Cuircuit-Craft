/** Human-readable text for parts, readings and warnings, in the active language. */
import type { Warning } from '../domain/analysis';
import { LED_SPECS, UNIT } from '../domain/components';
import type { Part } from '../domain/components';
import { DomainError } from '../domain/errors';
import type { PartResult } from '../domain/simulation/simulator';
import { formatSI as f } from '../domain/units';
import { t } from '../infrastructure/i18n';

const b = (s: string): string => '<b>' + s + '</b>';

export const partName = (p: Pick<Part, 'type'>): string => t('n.' + p.type);
export const toolName = (tool: string): string => t('s.' + tool);
export const ledColorName = (p: Part): string => t('c.' + (p.color ?? 'red'));

export function errorText(e: unknown): string {
  return e instanceof DomainError ? t('err.' + e.code, ...e.args) : String(e);
}

export function warningText(w: Warning): string {
  const arg = w.code === 'dissip' ? f(w.args[0], 'W') : w.code === 'ledBurn' || w.code === 'bigI' ? f(w.args[0], 'A') : '';
  return t('warn.' + w.code, arg);
}

/** Short value label: "4.7 kΩ", "Red", "closed", "5 V 50 Hz". */
export function valueLabel(p: Part): string {
  switch (p.type) {
    case 'led': return ledColorName(p);
    case 'switch': return p.closed ? t('st.closed') : t('st.open');
    case 'diode': return '1N4148';
    case 'source': return p.wave !== 'dc' ? f(p.value, 'V') + ' ' + f(p.freq ?? 1, 'Hz') : f(p.value, 'V');
    default: return UNIT[p.type] ? f(p.value, UNIT[p.type]!) : '';
  }
}

/** Value as written in the bill of materials. */
export function bomValue(p: Part): string {
  switch (p.type) {
    case 'led': return ledColorName(p) + ' · Vf ' + f(LED_SPECS[p.color ?? 'red'].vf, 'V');
    case 'diode': return '1N4148';
    case 'switch': return 'SPST';
    case 'source': return t('wave.' + (p.wave ?? 'dc')) + ' ' + f(p.value, 'V') + (p.wave !== 'dc' ? ' · ' + f(p.freq ?? 1, 'Hz') : '');
    case 'nmos': case 'pmos': return 'V_th ' + f(p.value, 'V');
    case 'resistor': case 'pot': return f(p.value, 'Ω') + ' · ¼ W';
    case 'capacitor': return f(p.value, 'F') + ' · 16 V';
    default: return f(p.value, UNIT[p.type] ?? '');
  }
}

export function mosState(r: PartResult): string {
  const k = r.k ?? 0;
  return k > 0.5 ? t('st.conducts') : k > 0.01 ? t('st.partial') : t('st.cutoff');
}

/** Long form with the formulas (calculations panel) and short form (floating label). */
export function describe(p: Part, r: PartResult | null): { html: string; tag: string } {
  if (!r) return { html: t('noConn'), tag: t('noConn') };
  switch (p.type) {
    case 'resistor': case 'pot': {
      const R = r.R ?? p.value;
      return {
        html: (p.type === 'pot' ? 'R = ' + Math.round((p.pos ?? 0.5) * 100) + ' % · ' + f(p.value, 'Ω') + ' = ' + b(f(R, 'Ω')) + '<br>' : '') +
          'V = ' + b(f(r.v, 'V')) + '<br>I = V / R = ' + f(r.v, 'V') + ' / ' + f(R, 'Ω') + ' = ' + b(f(r.i, 'A')) + '<br>P = V · I = ' + b(f(r.p, 'W')),
        tag: f(r.v, 'V') + ' · ' + f(r.i, 'A')
      };
    }
    case 'capacitor':
      return {
        html: 'V = ' + b(f(r.v, 'V')) + ' · I = ' + f(r.i, 'A') + '<br>Q = C · V = ' + f(p.value, 'F') + ' · ' + f(r.v, 'V') + ' = ' + b(f(r.q ?? 0, 'C')) +
          '<br>E = ½ · C · V² = ' + b(f(r.en ?? 0, 'J')) +
          ((r.Rth ?? Infinity) > 1e8 ? '<br>' + t('st.noCharge') : '<br>τ = R · C = ' + f(r.Rth!, 'Ω') + ' · ' + f(p.value, 'F') + ' = ' + b(f(r.tau ?? 0, 's'))),
        tag: f(r.v, 'V') + ' · ' + Math.round((r.level ?? 0) * 100) + ' %'
      };
    case 'inductor':
      return {
        html: 'V = ' + b(f(r.v, 'V')) + ' · I = ' + b(f(r.i, 'A')) + '<br>E = ½ · L · I² = ' + b(f(r.en ?? 0, 'J')) +
          (isFinite(r.tau ?? Infinity) && (r.Rth ?? 0) < 1e8 ? '<br>τ = L / R = ' + f(p.value, 'H') + ' / ' + f(r.Rth!, 'Ω') + ' = ' + b(f(r.tau!, 's')) : '<br>' + t('st.noSeriesR')),
        tag: f(r.i, 'A') + ' · ' + f(r.v, 'V')
      };
    case 'diode':
      return { html: 'V = ' + b(f(r.v, 'V')) + ' · I = ' + b(f(r.i, 'A')) + '<br>' + (r.on ? t('st.dOn') : t('st.dOff')), tag: r.on ? t('st.conducts') + ' · ' + f(r.i, 'A') : t('st.block') };
    case 'led':
      return {
        html: 'V = ' + b(f(r.v, 'V')) + ' · I = ' + b(f(r.i, 'A')) + '<br>P = ' + f(r.p, 'W') + ' · ' + t('st.bright') + ' ' + b(Math.round((r.bright ?? 0) * 100) + ' %') +
          '<br>' + t('st.vf', ledColorName(p).toLowerCase(), f(LED_SPECS[p.color ?? 'red'].vf, 'V')) + ' · ' + t('st.ideal'),
        tag: r.on ? f(r.i, 'A') + ' · ' + Math.round((r.bright ?? 0) * 100) + ' %' : t('st.ledOff')
      };
    case 'switch':
      return { html: (p.closed ? t('st.Closed') : t('st.Open')) + ' · I = ' + b(f(r.i, 'A')) + '<br>' + t('st.tap'), tag: (p.closed ? t('st.closed') : t('st.open')) + ' · ' + f(r.i, 'A') };
    case 'nmos': case 'pmos': {
      const vg = p.type === 'pmos' ? -(r.vgs ?? 0) : r.vgs ?? 0, label = p.type === 'pmos' ? 'V_SG' : 'V_GS', st = mosState(r);
      return {
        html: label + ' = ' + b(f(vg, 'V')) + (vg > p.value ? ' > ' : ' ≤ ') + 'V_th ' + f(p.value, 'V') + ' → ' + b(st) +
          '<br>V_DS = ' + f(r.v, 'V') + ' · I_D = ' + b(f(r.i, 'A')) + '<br>P = ' + f(r.p, 'W'),
        tag: st + ' · ' + f(r.i, 'A')
      };
    }
    case 'source': {
      if (!r.on) return { html: r.short ? '<span class="bad">' + t('st.short') + '</span>' : t('st.srcOff'), tag: t('st.off') };
      const form = p.wave === 'dc' ? 'V = ' + b(f(p.value, 'V'))
        : p.wave === 'sine' ? 'v(t) = ' + f(p.value, 'V') + ' · sin(2π · ' + f(p.freq ?? 1, 'Hz') + ' · t) = ' + b(f(r.v, 'V'))
          : 'v(t) = ' + t('st.square', f(p.value, 'V'), f(p.freq ?? 1, 'Hz')) + ' = ' + b(f(r.v, 'V'));
      return { html: form + '<br>I = ' + b(f(r.i, 'A')) + ' · P = V · I = ' + b(f(r.p, 'W')), tag: f(r.i, 'A') + ' · ' + f(r.p, 'W') };
    }
    case 'cpu':
      return {
        html: 'V(VCC − GND) = ' + b(f(r.v, 'V')) + '<br>I = V / R = ' + f(r.v, 'V') + ' / ' + f(p.value, 'Ω') + ' = ' + b(f(r.i, 'A')) + '<br>P = ' + b(f(r.p, 'W')) + ' · ' + (r.v > 1 ? t('st.cpuOn') : t('st.cpuOff')),
        tag: f(r.v, 'V') + ' · ' + f(r.i, 'A')
      };
  }
}
