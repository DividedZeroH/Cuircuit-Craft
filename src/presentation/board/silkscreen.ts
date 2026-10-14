/** Board printing: grid dots, outlines and reference designators, drawn to a canvas texture. */
import * as THREE from 'three';
import type { Circuit } from '../../domain/circuit';
import { BOARD, toBoard } from '../../domain/components';
import type { Part } from '../../domain/components';
import type { ScenePalette } from '../theme';

const TW = 2400, TH = 1600, S = TW / BOARD.width;
const px = (x: number): number => ((x + BOARD.width / 2) / BOARD.width) * TW;
const pz = (z: number): number => ((z + BOARD.depth / 2) / BOARD.depth) * TH;

export class Silkscreen {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;

  constructor(renderer: THREE.WebGLRenderer) {
    this.canvas.width = TW; this.canvas.height = TH;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  private text(s: string, p: Part, lx: number, lz: number, size = 40, weight = 500): void {
    const [x, z] = toBoard(p, lx, lz);
    this.g.font = weight + ' ' + size + 'px "Martian Mono", Menlo, monospace';
    this.g.fillText(s, px(x), pz(z));
  }
  private outline(p: Part, hx: number, hz: number): void {
    const [a, b] = p.rot % 2 ? [hz, hx] : [hx, hz];
    this.g.strokeRect(px(p.x - a), pz(p.z - b), 2 * a * S, 2 * b * S);
  }

  draw(c: Circuit, pal: ScenePalette): void {
    const g = this.g;
    g.fillStyle = pal.silkBg; g.fillRect(0, 0, TW, TH);
    g.fillStyle = pal.silkDot;
    for (let x = -5.75; x <= 5.75; x += 0.5) for (let z = -3.75; z <= 3.75; z += 0.5) { g.beginPath(); g.arc(px(x), pz(z), 2.2, 0, 7); g.fill(); }
    g.strokeStyle = pal.silkFrame; g.lineWidth = 3; g.strokeRect(px(-5.8), pz(-3.8), 11.6 * S, 7.6 * S);
    g.fillStyle = pal.silkText; g.strokeStyle = pal.silkLine; g.lineWidth = 4; g.textAlign = 'center'; g.textBaseline = 'middle';
    c.components.forEach(p => {
      switch (p.type) {
        case 'resistor': case 'diode': case 'inductor': case 'switch': this.outline(p, 0.62, 0.28); this.text(p.id, p, 0, -0.58, 40, 700); break;
        case 'pot': this.outline(p, 0.62, 0.38); this.text(p.id, p, 0, -0.68, 40, 700); break;
        case 'led': {
          const [x, z] = toBoard(p, 0, 0);
          g.beginPath(); g.arc(px(x), pz(z), 0.3 * S, 0, 7); g.stroke();
          this.text(p.id, p, 0, -0.55, 36, 700); this.text('A', p, -0.5, 0.32, 28); this.text('K', p, 0.5, 0.32, 28);
          break;
        }
        case 'capacitor': g.beginPath(); g.arc(px(p.x), pz(p.z), 0.46 * S, 0, 7); g.stroke(); this.text(p.id, p, 0.85, 0, 40, 700); this.text('+', p, 0.32, -0.6, 44, 700); break;
        case 'source': this.outline(p, 0.48, 0.66); this.text(p.id, p, -0.8, 0, 40, 700); this.text('+', p, 0.33, -0.8, 48, 700); this.text('−', p, 0.33, 0.8, 48, 700); break;
        case 'nmos': case 'pmos': {
          const n = p.type === 'nmos';
          this.text(p.id, p, -0.25, -0.75, 38, 700); this.text('G', p, -0.75, 0.32, 28);
          this.text('D', p, 0.82, n ? -0.75 : 0.75, 28); this.text('S', p, 0.82, n ? 0.75 : -0.75, 28); this.text(n ? 'N' : 'P', p, -0.25, 0.75, 32);
          break;
        }
        case 'cpu': this.outline(p, 1.45, 1.45); this.text(p.id, p, -1.25, -1.72, 40, 700); this.text('VCC', p, -1.8, 1.05, 30); this.text('GND', p, 1.8, 1.05, 30); break;
      }
    });
    g.textAlign = 'right'; g.font = '300 36px "Martian Mono", Menlo, monospace';
    g.fillText('CIRCUIT CRAFT  rev.C', px(5.55), pz(3.6));
    this.texture.needsUpdate = true;
  }
}
