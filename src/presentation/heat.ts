/** Voltage map colors: negative → blue, 0 V → neutral trace color, positive → orange → red. */
import * as THREE from 'three';

const POS1 = new THREE.Color(0xff8a1f), POS2 = new THREE.Color(0xd92d20), NEG = new THREE.Color(0x1f6bff);
const neutral = new THREE.Color();

export function heatColor(v: number, ref: number, neutralHex: number, out: THREE.Color): THREE.Color {
  const x = Math.max(-1, Math.min(1, v / ref));
  neutral.set(neutralHex);
  if (x >= 0) {
    if (x < 0.5) out.copy(neutral).lerp(POS1, x * 2);
    else out.copy(POS1).lerp(POS2, (x - 0.5) * 2);
  } else out.copy(neutral).lerp(NEG, -x);
  return out;
}

export const heatHex = (v: number, ref: number, neutralHex: number): string => '#' + heatColor(v, ref, neutralHex, new THREE.Color()).getHexString();
