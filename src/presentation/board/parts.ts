/** 3D models for each part type. Each returns a group and an animate() fed with live readings. */
import * as THREE from 'three';
import { CPU_PINS, LED_SPECS, terminals } from '../../domain/components';
import type { Part, PartType } from '../../domain/components';
import type { PartResult } from '../../domain/simulation/simulator';
import { MAT, padMesh, shadowed } from './materials';

export interface PartModel {
  group: THREE.Group;
  /** Height for the floating label. */
  height: number;
  animate(dt: number, r: PartResult | null): void;
}

const BAND_COLORS = [0x1d1b1a, 0x7b4a26, 0xd93a2b, 0xff7a1a, 0xf2c521, 0x2f9e44, 0x1f6bff, 0x7b3fbf, 0x8a8d91, 0xf4f4f4];

/** Four-band color code (±5 %). */
function bandsFor(ohms: number): number[] {
  let e = Math.floor(Math.log10(Math.max(ohms, 1))) - 1, d = Math.round(ohms / Math.pow(10, e));
  if (d >= 100) { d = Math.round(d / 10); e++; }
  return [BAND_COLORS[Math.floor(d / 10) % 10], BAND_COLORS[d % 10], BAND_COLORS[Math.max(0, Math.min(9, e))], 0xc9a23a];
}

function axialLeads(g: THREE.Group, H: number, from = 0.45): void {
  [-1, 1].forEach(sx => {
    const lh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.75 - from, 10), MAT.lead));
    lh.rotation.z = Math.PI / 2; lh.position.set((sx * (from + 0.75)) / 2, H, 0); g.add(lh);
    const lv = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, H, 10), MAT.lead));
    lv.position.set(sx * 0.75, H / 2, 0); g.add(lv);
    padMesh(g, sx * 0.75, 0, 0.13);
  });
}

let glow: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

function resistor(p: Part): PartModel {
  const g = new THREE.Group(), H = 0.3, R = 0.14;
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.7, 40), MAT.resBody));
  body.rotation.z = Math.PI / 2; body.position.y = H; g.add(body);
  [-1, 1].forEach(sx => {
    const cap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 32, 16), MAT.resBody));
    cap.scale.set(0.8, 1, 1); cap.position.set(sx * 0.35, H, 0); g.add(cap);
  });
  axialLeads(g, H);
  const cols = bandsFor(p.value);
  const bands = [-0.24, -0.11, 0.02, 0.24].map((bx, i) => {
    const base = new THREE.Color(cols[i]);
    const mat = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: i === 3 ? 0.3 : 0.5, metalness: i === 3 ? 0.6 : 0 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.04, R * 1.04, 0.05, 40), mat);
    band.rotation.z = Math.PI / 2; band.position.set(bx, H, 0); g.add(band);
    return { mat, base, phase: i * 0.9 };
  });
  let ph = 0;
  return {
    group: g, height: 0.55,
    animate(dt, r) {
      const n = r?.norm ?? 0; ph += dt * (2 + 6 * n);
      bands.forEach(bd => {
        const v = 0.5 + 0.5 * Math.sin(ph - bd.phase);
        bd.mat.color.copy(bd.base).multiplyScalar(0.8 + 0.2 * v * n);
        bd.mat.emissive.copy(bd.base).multiplyScalar(v * 0.4 * n);
      });
    }
  };
}

function pot(p: Part): PartModel {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.3, 0.7), MAT.potBody)); body.position.y = 0.17; g.add(body);
  const knob = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.16, 32), MAT.knob)); knob.position.y = 0.4; g.add(knob);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.04), MAT.dark); mark.position.set(0.1, 0.09, 0); knob.add(mark);
  [-1, 1].forEach(sx => {
    const tab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.08), MAT.lead)); tab.position.set(sx * 0.55, 0.03, 0); g.add(tab);
    padMesh(g, sx * 0.75, 0, 0.13);
  });
  return { group: g, height: 0.6, animate() { knob.rotation.y = -(-2.4 + 4.8 * (p.pos ?? 0.5)); } };
}

function capacitor(): PartModel {
  const g = new THREE.Group(), R = 0.34, Hc = 0.9;
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R, Hc, 56), MAT.capBody)); body.position.y = Hc / 2 + 0.06; g.add(body);
  const topMat = MAT.capTop.clone();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.012, 56), topMat); top.position.y = Hc + 0.066; g.add(top);
  [0, Math.PI / 2].forEach(a => {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(R * 1.3, 0.008, 0.025), MAT.capGroove);
    gr.rotation.y = a + Math.PI / 4; gr.position.y = Hc + 0.074; g.add(gr);
  });
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.006, R * 1.006, Hc * 0.96, 24, 1, true, -0.35, 0.7), MAT.capStripe);
  stripe.position.y = Hc / 2 + 0.06; g.add(stripe);
  const sleeveGeo = new THREE.CylinderGeometry(R * 1.012, R * 1.012, 1, 56, 1, true); sleeveGeo.translate(0, 0.5, 0);
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.4, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat); sleeve.position.y = 0.06; sleeve.scale.y = 0.001; g.add(sleeve);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.03, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: 0x9a3412 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.06, 40), MAT.dark); base.position.y = 0.03; g.add(base);
  padMesh(g, 0, -0.5); padMesh(g, 0, 0.5);
  return {
    group: g, height: 1.15,
    animate(_dt, r) {
      const level = r?.level ?? 0, h = Math.max(0.001, level * Hc);
      sleeve.scale.y = h; ring.position.y = 0.06 + h; sleeveMat.opacity = 0.25 + level * 0.45;
      topMat.emissive.setRGB(level > 0.97 ? 0.35 : 0, level > 0.97 ? 0.12 : 0, 0);
    }
  };
}

function inductor(): PartModel {
  const g = new THREE.Group(), H = 0.3;
  const core = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.84, 24), MAT.ferrite)); core.rotation.z = Math.PI / 2; core.position.y = H; g.add(core);
  const turnMat = MAT.copper.clone();
  for (let k = 0; k < 9; k++) {
    const turn = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 32), turnMat));
    turn.rotation.y = Math.PI / 2; turn.position.set(-0.36 + k * 0.09, H, 0); g.add(turn);
  }
  axialLeads(g, H, 0.42);
  return {
    group: g, height: 0.6,
    animate(_dt, r) { const n = r ? Math.min(1, Math.abs(r.i) / (r.imax || 1e-9)) : 0; turnMat.emissive.setRGB(0.35 * n, 0.15 * n, 0.02 * n); }
  };
}

function diode(): PartModel {
  const g = new THREE.Group(), H = 0.22;
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 24), MAT.diodeGlass)); body.rotation.z = Math.PI / 2; body.position.y = H; g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.103, 0.103, 0.07, 24), MAT.dark); band.rotation.z = Math.PI / 2; band.position.set(0.17, H, 0); g.add(band);
  axialLeads(g, H, 0.25);
  return { group: g, height: 0.45, animate() {} };
}

function led(p: Part): PartModel {
  const g = new THREE.Group(), col = new THREE.Color(LED_SPECS[p.color ?? 'red'].hex);
  const dome = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.75), roughness: 0.15, transparent: true, opacity: 0.88, emissive: col.clone(), emissiveIntensity: 0 });
  const cyl = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 32), dome)); cyl.position.y = 0.3; g.add(cyl);
  const cap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), dome)); cap.position.y = 0.46; g.add(cap);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.05, 32), dome); rim.position.y = 0.16; g.add(rim);
  [-1, 1].forEach(sx => {
    const lv = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), MAT.lead)); lv.position.set(sx * 0.12, 0.08, 0); g.add(lv);
    const lh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.05), MAT.lead)); lh.position.set(sx * 0.31, 0.02, 0); g.add(lh);
    padMesh(g, sx * 0.5, 0, 0.12);
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  halo.position.y = 0.42; halo.scale.setScalar(1.2); g.add(halo);
  return {
    group: g, height: 0.8,
    animate(_dt, r) {
      const br = r?.bright ?? 0;
      dome.emissiveIntensity = br * 1.6;
      halo.material.opacity = br * (r && r.i > 0.03 ? 0.2 : 0.9);
      halo.scale.setScalar(0.8 + br * 1.4);
    }
  };
}

function toggleSwitch(p: Part): PartModel {
  const g = new THREE.Group();
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.42), MAT.switchBase)); base.position.y = 0.12; g.add(base);
  const pivot = new THREE.Group(); pivot.position.set(0, 0.22, 0); g.add(pivot);
  const lever = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.12), MAT.silver)); lever.position.y = 0.17; pivot.add(lever);
  const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.2), MAT.red)); cap.position.y = 0.36; pivot.add(cap);
  [-1, 1].forEach(sx => {
    const tab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.08), MAT.lead)); tab.position.set(sx * 0.6, 0.03, 0); g.add(tab);
    padMesh(g, sx * 0.75, 0, 0.13);
  });
  let angle = p.closed ? -0.45 : 0.45;
  return {
    group: g, height: 0.75,
    animate(dt) { const target = p.closed ? -0.45 : 0.45; angle += (target - angle) * Math.min(1, dt * 14 || 1); pivot.rotation.z = angle; }
  };
}

function mosfet(p: Part): PartModel {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 32, 1, false, 0, Math.PI), MAT.srcBody));
  body.position.set(-0.05, 0.38, 0); body.rotation.y = Math.PI / 2; g.add(body);
  const face = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.56), MAT.srcBody)); face.position.set(-0.05, 0.38, 0); g.add(face);
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 20), new THREE.MeshBasicMaterial({ color: p.type === 'nmos' ? 0x1f6bff : 0xd93a2b }));
  dot.position.set(-0.17, 0.635, 0); g.add(dot);
  const indicator = new THREE.MeshBasicMaterial({ color: 0x4a4d52 });
  const ind = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.3), indicator); ind.position.set(-0.07, 0.38, 0); g.add(ind);
  terminals(p).forEach(([lx, lz]) => {
    const leg = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), MAT.lead)); leg.position.set(-0.05, 0.08, lz * 0.3); g.add(leg);
    const dx = lx + 0.05, dz = lz - lz * 0.3, len = Math.hypot(dx, dz);
    const run = shadowed(new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.05), MAT.lead));
    run.position.set((-0.05 + lx) / 2, 0.02, (lz * 0.3 + lz) / 2); run.rotation.y = -Math.atan2(dz, dx); g.add(run);
    padMesh(g, lx, lz, 0.12);
  });
  const on = new THREE.Color(p.type === 'nmos' ? 0x5b9dff : 0xff6a5a), off = new THREE.Color(0x4a4d52);
  return { group: g, height: 0.8, animate(_dt, r) { indicator.color.copy(off).lerp(on, r?.k ?? 0); } };
}

function source(p: Part): PartModel {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.1), MAT.srcBody)); body.position.y = 0.32; g.add(body);
  const band = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.62, 0.18), p.wave === 'dc' ? MAT.copper : MAT.gold)); band.position.set(0, 0.32, -0.42); g.add(band);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.01, 0.5), MAT.srcPlate); plate.position.set(0, 0.625, 0.12); g.add(plate);
  const wave = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.04), MAT.dark); wave.position.set(0, 0.632, 0.12); g.add(wave);
  ([[-0.3, MAT.red], [0.3, MAT.dark]] as Array<[number, THREE.Material]>).forEach(([z, m]) => {
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 24), m)); post.position.set(0.22, 0.7, z * 1.2); g.add(post);
  });
  [-1, 1].forEach(sz => {
    const tab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.3), MAT.lead)); tab.position.set(0, 0.03, sz * 0.62); g.add(tab);
    padMesh(g, 0, sz * 0.75, 0.13);
  });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x2f9e44 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 12), ledMat); lamp.position.set(-0.22, 0.66, -0.15); g.add(lamp);
  const on = new THREE.Color(0x2fd05a), off = new THREE.Color(0x3a3d42);
  return {
    group: g, height: 0.95,
    animate(_dt, r) {
      ledMat.color.copy(r?.on ? on : off);
      if (p.wave !== 'dc') wave.scale.x = 0.15 + 0.85 * Math.abs(r?.on ? r.v / (p.value || 1) : 0);
    }
  };
}

function processor(): PartModel {
  const g = new THREE.Group(), pinGeo = new THREE.BoxGeometry(0.24, 0.05, 0.09);
  CPU_PINS.forEach(o => ([[-1.25, o, 0], [1.25, o, 0], [o, -1.25, 1], [o, 1.25, 1]] as number[][]).forEach(([a, b, r]) => {
    const pin = shadowed(new THREE.Mesh(pinGeo, MAT.gold)); pin.position.set(a, 0.04, b); if (r) pin.rotation.y = Math.PI / 2; g.add(pin);
  }));
  const sub = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 2.2), MAT.substrate)); sub.position.y = 0.1; g.add(sub);
  sub.add(new THREE.LineSegments(new THREE.EdgesGeometry(sub.geometry), new THREE.LineBasicMaterial({ color: 0x145234 })));
  for (let k = 0; k < 5; k++) [[-0.6 + k * 0.3, 0.93], [-0.6 + k * 0.3, -0.93]].forEach(([x, z]) => {
    const smd = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.07), MAT.smd)); smd.position.set(x, 0.185, z); g.add(smd);
  });
  const ihs = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.5), MAT.heatSpreader)); ihs.position.y = 0.23; g.add(ihs);
  const mark = new THREE.Mesh(new THREE.CircleGeometry(0.07, 3), new THREE.MeshBasicMaterial({ color: 0xd4a537 }));
  mark.rotation.x = -Math.PI / 2; mark.position.set(-0.95, 0.162, -0.95); g.add(mark);
  const cores: Array<{ mat: THREE.MeshBasicMaterial; seed: number; rate: number }> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9aa3ad });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.24), mat); core.position.set(-0.45 + c * 0.3, 0.306, -0.45 + r * 0.3); g.add(core);
    cores.push({ mat, seed: Math.random() * 10, rate: 1.5 + Math.random() * 2.5 });
  }
  const on = new THREE.Color(0x1f6bff), off = new THREE.Color(0xa9b0b8);
  let time = 0;
  return {
    group: g, height: 0.5,
    animate(dt, r) { time += dt; const powered = !!r && r.v > 1; cores.forEach(c => c.mat.color.copy(powered && Math.sin(time * c.rate + c.seed) > 0.35 ? on : off)); }
  };
}

const FACTORIES: Record<PartType, (p: Part) => PartModel> = {
  source, resistor, pot, capacitor, inductor, diode, led, switch: toggleSwitch, nmos: mosfet, pmos: mosfet, cpu: processor
};

export const buildPartModel = (p: Part): PartModel => FACTORIES[p.type](p);
