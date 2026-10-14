/** Schematic symbols in local part units (1 = one board unit), drawn as SVG strings. */
import { CPU_PINS, LED_SPECS } from '../../domain/components';
import type { Part } from '../../domain/components';

const INK = 'var(--ink)';
const path = (d: string): string => '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="0.045" stroke-linecap="round" stroke-linejoin="round"/>';
const ZIGZAG = 'M-0.75 0H-0.4L-0.33 -0.12L-0.2 0.12L-0.07 -0.12L0.07 0.12L0.2 -0.12L0.33 0.12L0.4 0H0.75';
const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

export function symbol(p: Part): string {
  switch (p.type) {
    case 'resistor': return path(ZIGZAG);
    case 'pot': return path(ZIGZAG) + path('M-0.3 0.3L0.3 -0.3M0.3 -0.3H0.14M0.3 -0.3V-0.14');
    case 'capacitor': return path('M0 -0.5V-0.08M-0.26 -0.08H0.26M-0.26 0.08H0.26M0 0.08V0.5') + '<text x="0.2" y="-0.22" font-size="0.22" fill="' + INK + '">+</text>';
    case 'inductor': return path('M-0.75 0H-0.45' + 'a0.1125 0.1125 0 0 1 0.225 0'.repeat(4) + 'H0.75');
    case 'diode': return path('M-0.75 0H-0.2M0.15 0H0.75M0.15 -0.18V0.18') + '<path d="M-0.2 -0.18L-0.2 0.18L0.15 0Z" fill="' + INK + '"/>';
    case 'led':
      return path('M-0.5 0H-0.18M0.12 0H0.5M0.12 -0.17V0.17') +
        '<path d="M-0.18 -0.17L-0.18 0.17L0.12 0Z" fill="' + hex(LED_SPECS[p.color ?? 'red'].hex) + '" stroke="' + INK + '" stroke-width="0.03"/>' +
        path('M0 -0.25L0.14 -0.4M0.14 -0.4H0.06M0.14 -0.4V-0.32M0.12 -0.2L0.26 -0.35M0.26 -0.35H0.18M0.26 -0.35V-0.27');
    case 'switch':
      return path('M-0.75 0H-0.32M0.32 0H0.75' + (p.closed ? 'M-0.3 0L0.3 0' : 'M-0.3 0L0.27 -0.28')) +
        '<circle cx="-0.3" cy="0" r="0.045" fill="' + INK + '"/><circle cx="0.3" cy="0" r="0.045" fill="' + INK + '"/>';
    case 'nmos': case 'pmos': {
      const n = p.type === 'nmos', dz = n ? -0.75 : 0.75, sz = -dz, dy = dz < 0 ? -0.3 : 0.3, sy = -dy;
      return path('M-0.75 0H' + (n ? '-0.22' : '-0.32') + 'M-0.2 -0.32V0.32M-0.08 -0.4V-0.18M-0.08 -0.1V0.1M-0.08 0.18V0.4' +
        'M-0.08 ' + dy + 'H0.5V' + dz + 'M-0.08 ' + sy + 'H0.5V' + sz + 'M-0.08 0H0.5V' + sy) +
        (n ? path('M0.12 -0.08L0 0L0.12 0.08') : '<circle cx="-0.27" cy="0" r="0.05" fill="none" stroke="' + INK + '" stroke-width="0.04"/>' + path('M0.1 -0.08L0.22 0L0.1 0.08'));
    }
    case 'source': {
      const inner = p.wave === 'sine' ? path('M-0.2 0q0.1 -0.22 0.2 0t0.2 0')
        : p.wave === 'square' ? path('M-0.2 0.1V-0.1H0V0.1H0.2V-0.1')
          : '<text x="-0.08" y="-0.1" font-size="0.22" fill="' + INK + '">+</text><text x="-0.07" y="0.24" font-size="0.22" fill="' + INK + '">−</text>';
      return path('M0 -0.75V-0.32M0 0.32V0.75') + '<circle cx="0" cy="0" r="0.32" fill="none" stroke="' + INK + '" stroke-width="0.045"/>' + inner;
    }
    case 'cpu':
      return '<rect x="-1.1" y="-1.1" width="2.2" height="2.2" fill="none" stroke="' + INK + '" stroke-width="0.045"/>' +
        path(CPU_PINS.map(o => 'M-1.25 ' + o + 'H-1.1M1.1 ' + o + 'H1.25M' + o + ' -1.25V-1.1M' + o + ' 1.1V1.25').join('')) +
        '<text x="-0.95" y="0.07" font-size="0.18" fill="' + INK + '">VCC</text><text x="0.55" y="0.07" font-size="0.18" fill="' + INK + '">GND</text>';
  }
}
