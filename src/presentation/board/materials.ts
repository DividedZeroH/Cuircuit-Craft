/** Shared materials. Board-dependent ones are recolored when the theme changes. */
import * as THREE from 'three';
import type { ScenePalette } from '../theme';

const M = (color: number, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...o });

export const MAT = {
  board: M(0xf7f7f5, { roughness: 0.8 }),
  pad: M(0xe9eaeb, { roughness: 0.25, metalness: 0.35 }),
  lead: M(0xcfd2d4, { roughness: 0.25, metalness: 0.5 }),
  hole: M(0xc9ccce, { roughness: 0.9 }),
  resBody: M(0xdcc39a, { roughness: 0.6 }),
  potBody: M(0x2457c5, { roughness: 0.5 }),
  knob: M(0xf2f2f0, { roughness: 0.4 }),
  capBody: M(0xff8a1f, { roughness: 0.35 }),
  capStripe: M(0xffd2a6, { side: THREE.DoubleSide }),
  capTop: M(0xe9ecee, { roughness: 0.3, metalness: 0.4 }),
  capGroove: M(0xb8bdc2),
  dark: M(0x24262a, { roughness: 0.45 }),
  substrate: M(0x1d6b45, { roughness: 0.5 }),
  heatSpreader: M(0xc9ced3, { roughness: 0.28, metalness: 0.75 }),
  gold: M(0xd4a537, { roughness: 0.3, metalness: 0.85 }),
  smd: M(0x8a6a3c, { roughness: 0.5 }),
  srcBody: M(0x1e1f22, { roughness: 0.45 }),
  srcPlate: M(0xf2f2f0, { roughness: 0.6 }),
  red: M(0xd93a2b, { roughness: 0.4 }),
  copper: M(0xc98a4b, { roughness: 0.3, metalness: 0.8 }),
  ferrite: M(0x3b3d42, { roughness: 0.8 }),
  diodeGlass: M(0xb5462c, { roughness: 0.15, transparent: true, opacity: 0.85 }),
  silver: M(0xd7dade, { roughness: 0.25, metalness: 0.8 }),
  switchBase: M(0x30333a, { roughness: 0.5 }),
  warn: new THREE.MeshBasicMaterial({ color: 0xd92d20, transparent: true, opacity: 0.25, depthWrite: false }),
  edge: new THREE.LineBasicMaterial({ color: 0xc4c7ca }),
  draft: new THREE.MeshBasicMaterial({ color: 0x1f6bff, transparent: true, opacity: 0.55 }),
  erase: new THREE.MeshBasicMaterial({ color: 0xd9381e, transparent: true, opacity: 0.2, depthWrite: false }),
  select: new THREE.MeshBasicMaterial({ color: 0x1f6bff, transparent: true, opacity: 0.8, depthWrite: false })
};

export function applyPalette(p: ScenePalette): void {
  MAT.board.color.set(p.board);
  MAT.pad.color.set(p.pad);
  MAT.hole.color.set(p.hole);
  MAT.edge.color.set(p.edge);
}

export function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function padMesh(parent: THREE.Object3D, x: number, z: number, r = 0.11): void {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 28), MAT.pad);
  p.position.set(x, 0.015, z);
  p.receiveShadow = true;
  parent.add(p);
}

/** Frees geometries of a group's children and empties it. Materials are shared and kept. */
export function clearGroup(group: THREE.Object3D, keep: Set<THREE.BufferGeometry> = new Set()): void {
  group.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !keep.has(mesh.geometry)) mesh.geometry.dispose();
  });
  while (group.children.length) group.remove(group.children[0]);
}
