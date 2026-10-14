/**
 * The 3D board. Renders the shared circuit, animates electrons along traces from the
 * simulated currents, and forwards pointer input to the shared Editor.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Editor } from '../../application/editor';
import { isPlaceTool, toBoardPoint } from '../../application/editor';
import type { Probe } from '../../application/probe';
import type { CircuitStore } from '../../application/store';
import type { Warning } from '../../domain/analysis';
import { referenceVoltage } from '../../domain/analysis';
import { BOARD, DEFAULTS, UNIT, footprint } from '../../domain/components';
import type { Point } from '../../domain/components';
import type { Simulator } from '../../domain/simulation/simulator';
import { formatSI } from '../../domain/units';
import { t } from '../../infrastructure/i18n';
import { describe, warningText } from '../describe';
import { heatColor } from '../heat';
import { scenePalette } from '../theme';
import { MAT, applyPalette, clearGroup, padMesh, shadowed } from './materials';
import { buildPartModel } from './parts';
import type { PartModel } from './parts';
import { Silkscreen } from './silkscreen';

interface PartSlot { model: PartModel; warn: THREE.Mesh; tag: HTMLDivElement }
interface Path { segs: Array<{ x1: number; z1: number; x2: number; z2: number; len: number; start: number }>; total: number }
interface TracePulses { path: Path; pulses: THREE.Mesh[][]; phase: number; speed: number; on: boolean; mat: THREE.MeshStandardMaterial }

const HOME = new THREE.Vector3(11, 13, 11);
const PULSE_GEO = new THREE.BoxGeometry(0.2, 0.05, 0.09);
const PULSE_MATS = [0x1f6bff, 0x4d8bff, 0x86b0ff, 0xbcd3ff].map(c => new THREE.MeshBasicMaterial({ color: c }));
const WARN_GEO = new THREE.CircleGeometry(1, 40);
const KEEP = new Set<THREE.BufferGeometry>([PULSE_GEO, WARN_GEO]);

function buildPath(pts: Point[]): Path {
  const segs: Path['segs'] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    segs.push({ x1, z1, x2, z2, len, start: total });
    total += len;
  }
  return { segs, total };
}

function pointAt(path: Path, d: number): { x: number; z: number; a: number } {
  d = ((d % path.total) + path.total) % path.total;
  for (const s of path.segs) if (d <= s.start + s.len) {
    const k = (d - s.start) / s.len;
    return { x: s.x1 + (s.x2 - s.x1) * k, z: s.z1 + (s.z2 - s.z1) * k, a: -Math.atan2(s.z2 - s.z1, s.x2 - s.x1) };
  }
  const s = path.segs[path.segs.length - 1];
  return { x: s.x2, z: s.z2, a: 0 };
}

function traceMeshes(parent: THREE.Object3D, pts: Point[], mat: THREE.Material): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.085, 0.022, 0.085), mat);
    m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    m.receiveShadow = true;
    parent.add(m);
  }
  padMesh(parent, pts[0][0], pts[0][1]);
  padMesh(parent, pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

export class BoardView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  readonly controls: OrbitControls;
  private hemi = new THREE.HemisphereLight(0xffffff, 0xe6e6e4, 0.75 * Math.PI);
  private sun = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI);
  private shadowMat = new THREE.ShadowMaterial({ opacity: 0.08 });
  private root = new THREE.Group();
  private dynamic = new THREE.Group();
  private ghost = new THREE.Group();
  private draftGroup = new THREE.Group();
  private eraseMarker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), MAT.erase);
  private selectRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), MAT.select);
  private probeRed: THREE.Group;
  private probeBlack: THREE.Group;
  private silk: Silkscreen;
  private parts: PartSlot[] = [];
  private traces: TracePulses[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private v3 = new THREE.Vector3();
  heatMap = false;
  labelsVisible = true;

  constructor(private host: HTMLElement, private tagLayer: HTMLElement, private probeTag: HTMLElement,
    private store: CircuitStore, private sim: Simulator, private editor: Editor, private probe: Probe) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.camera.position.copy(HOME); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minPolarAngle: 0.15, maxPolarAngle: 1.25, minZoom: 0.6, maxZoom: 3.5, autoRotateSpeed: 1.2 });

    this.scene.add(this.hemi);
    this.sun.position.set(-6, 14, 8); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    this.sun.shadow.radius = 4; this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);

    this.scene.add(this.root);
    this.root.add(this.dynamic, this.ghost, this.draftGroup);
    const board = shadowed(new THREE.Mesh(new THREE.BoxGeometry(BOARD.width, BOARD.thickness, BOARD.depth), MAT.board));
    board.position.y = -BOARD.thickness / 2;
    board.add(new THREE.LineSegments(new THREE.EdgesGeometry(board.geometry), MAT.edge));
    this.root.add(board);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.shadowMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -BOARD.thickness - 0.6; ground.receiveShadow = true;
    this.scene.add(ground);
    [[-5.5, -3.5], [5.5, -3.5], [-5.5, 3.5], [5.5, 3.5]].forEach(([x, z]) => {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 40), MAT.pad); ring.position.set(x, 0.01, z); ring.receiveShadow = true; this.root.add(ring);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 32), MAT.hole); hole.position.set(x, 0.015, z); this.root.add(hole);
    });
    this.silk = new Silkscreen(this.renderer);
    const silkMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.width, BOARD.depth), new THREE.MeshStandardMaterial({ map: this.silk.texture, roughness: 0.85 }));
    silkMesh.rotation.x = -Math.PI / 2; silkMesh.position.y = 0.001; silkMesh.receiveShadow = true;
    this.root.add(silkMesh);

    this.eraseMarker.rotation.x = -Math.PI / 2; this.eraseMarker.visible = false; this.root.add(this.eraseMarker);
    this.selectRing.rotation.x = -Math.PI / 2; this.selectRing.visible = false; this.root.add(this.selectRing);
    this.probeRed = this.probeModel(0xd92d20);
    this.probeBlack = this.probeModel(0x1d1e21);

    this.bindPointer();
    editor.on(e => { if (e === 'tool') this.updateGhost(); this.updateOverlay(); });
    probe.on(() => this.updateProbes());
    this.applyTheme();
    this.resize();
  }

  private probeModel(color: number): THREE.Group {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 16), MAT.lead); tip.rotation.x = Math.PI; tip.position.y = 0.1; g.add(tip);
    const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 16), m)); body.position.y = 0.55; g.add(body);
    const grip = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), m)); grip.position.y = 0.25; g.add(grip);
    g.visible = false;
    this.root.add(g);
    return g;
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    const point = (e: PointerEvent): ReturnType<typeof toBoardPoint> => {
      const r = el.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
      this.root.worldToLocal(hit);
      return toBoardPoint(hit.x, hit.z);
    };
    el.addEventListener('pointerdown', e => {
      if (this.editor.pointerDown({ x: e.clientX, y: e.clientY }, point(e))) { this.controls.enabled = false; el.setPointerCapture(e.pointerId); }
    });
    el.addEventListener('pointermove', e => {
      const p = point(e);
      this.editor.pointerMove({ x: e.clientX, y: e.clientY }, p);
      document.body.classList.toggle('over-part', !!(p && this.editor.tool === 'view' && this.editor.partAt(p)));
    });
    el.addEventListener('pointerup', e => { this.controls.enabled = true; this.editor.pointerUp({ x: e.clientX, y: e.clientY }, point(e)); });
    el.addEventListener('pointerleave', () => { if (!this.editor.drag) this.editor.hoverAt(null); });
    el.addEventListener('dblclick', () => { if (this.editor.tool === 'trace') this.editor.finishDraft(); });
  }

  resize(): void {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight, aspect = w / h;
    const half = Math.max(5.6, 8.2 / aspect);
    Object.assign(this.camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  resetCamera(): void {
    this.camera.position.copy(HOME); this.camera.zoom = 1; this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0); this.controls.update();
  }

  applyTheme(): void {
    const pal = scenePalette();
    applyPalette(pal);
    this.hemi.color.set(pal.hemiSky); this.hemi.groundColor.set(pal.hemiGround);
    this.hemi.intensity = pal.hemi * Math.PI; this.sun.intensity = pal.sun * Math.PI; this.shadowMat.opacity = pal.shadow;
    this.silk.draw(this.store.circuit, pal);
    this.traces.forEach(tr => tr.mat.color.set(pal.trace));
  }

  redrawSilk(): void { this.silk.draw(this.store.circuit, scenePalette()); }

  /** Rebuilds every mesh from the store. Called when the circuit structure changes. */
  rebuild(): void {
    clearGroup(this.dynamic, KEEP);
    this.parts = [];
    this.traces = [];
    this.tagLayer.textContent = '';
    const pal = scenePalette();
    this.store.circuit.components.forEach(p => {
      const model = buildPartModel(p);
      model.group.position.set(p.x, 0, p.z);
      model.group.rotation.y = (-p.rot * Math.PI) / 2;
      this.dynamic.add(model.group);
      const [hx, hz] = footprint(p);
      const warn = new THREE.Mesh(WARN_GEO, MAT.warn);
      warn.rotation.x = -Math.PI / 2; warn.position.set(p.x, 0.035, p.z); warn.scale.setScalar(Math.max(hx, hz) + 0.15); warn.visible = false;
      this.dynamic.add(warn);
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.innerHTML = '<b></b><span></span>';
      this.tagLayer.appendChild(tag);
      this.parts.push({ model, warn, tag });
    });
    this.store.circuit.traces.forEach(pts => {
      const mat = new THREE.MeshStandardMaterial({ color: pal.trace, roughness: 0.35, metalness: 0.15 });
      traceMeshes(this.dynamic, pts, mat);
      const path = buildPath(pts), n = path.total < 0.05 ? 0 : Math.max(1, Math.round(path.total / 1.6));
      const pulses: THREE.Mesh[][] = [];
      for (let k = 0; k < n; k++) pulses.push(PULSE_MATS.map((m, i) => { const ms = new THREE.Mesh(PULSE_GEO, m); ms.scale.setScalar(1 - i * 0.17); this.dynamic.add(ms); return ms; }));
      this.traces.push({ path, pulses, phase: 0, speed: 0, on: false, mat });
    });
    this.silk.draw(this.store.circuit, pal);
    this.updateSelection();
    this.updateProbes();
  }

  updateSelection(): void {
    const p = this.store.selectedId ? this.store.find(this.store.selectedId) : undefined;
    this.selectRing.visible = !!p;
    if (!p) return;
    const [hx, hz] = footprint(p);
    this.selectRing.position.set(p.x, 0.04, p.z);
    this.selectRing.scale.setScalar(Math.max(hx, hz) + 0.2);
  }

  private updateProbes(): void {
    const { red, black } = this.probe;
    this.probeRed.visible = !!red; this.probeBlack.visible = !!black;
    if (red) this.probeRed.position.set(red[0], 0, red[1]);
    if (black) this.probeBlack.position.set(black[0], 0, black[1]);
    this.probeTag.hidden = !red;
  }

  private updateGhost(): void {
    clearGroup(this.ghost);
    const tool = this.editor.tool;
    if (!isPlaceTool(tool)) return;
    const fake = { type: tool, id: '', x: 0, z: 0, rot: this.editor.rot, ...JSON.parse(JSON.stringify(DEFAULTS[tool])) };
    const { group } = buildPartModel(fake);
    group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.material) { const mat = (m.material as THREE.Material).clone(); mat.transparent = true; mat.opacity = 0.45; mat.depthWrite = false; m.material = mat; }
      o.castShadow = false;
    });
    group.rotation.y = (-this.editor.rot * Math.PI) / 2;
    this.ghost.add(group);
  }

  private updateOverlay(): void {
    const ed = this.editor, p = ed.hover;
    this.ghost.visible = !!p && this.ghost.children.length > 0;
    if (p) this.ghost.position.set(p.x, 0, p.z);
    clearGroup(this.draftGroup);
    const draft = ed.draftPreview();
    if (draft) { if (draft.length >= 2) traceMeshes(this.draftGroup, draft, MAT.draft); else padMesh(this.draftGroup, draft[0][0], draft[0][1]); }
    this.eraseMarker.visible = false;
    if (ed.tool === 'erase' && p) {
      const hit = ed.targetAt(p);
      if (hit?.kind === 'part') { this.eraseMarker.visible = true; this.eraseMarker.position.set(hit.part.x, 0.03, hit.part.z); this.eraseMarker.scale.set(hit.hx * 2, hit.hz * 2, 1); }
      else if (hit) { this.eraseMarker.visible = true; this.eraseMarker.position.set(p.rx, 0.03, p.rz); this.eraseMarker.scale.set(0.5, 0.5, 1); }
    }
    // Live drag preview: lift the part while it moves.
    this.parts.forEach((slot, i) => {
      const part = this.store.circuit.components[i];
      if (!part) return;
      const d = ed.drag;
      if (d && d.moved && d.index === i) { slot.model.group.position.set(d.nx, 0.08, d.nz); slot.warn.position.set(d.nx, 0.035, d.nz); }
      else { slot.model.group.position.set(part.x, 0, part.z); slot.warn.position.set(part.x, 0.035, part.z); }
    });
  }

  /** Text labels, warning rings and the voltage map. Called a few times per second. */
  updateReadings(warnings: Array<Warning | null>): void {
    const c = this.store.circuit;
    this.parts.forEach((slot, i) => {
      const p = c.components[i];
      if (!p) return;
      const r = this.sim.results[i], w = warnings[i];
      slot.tag.querySelector('b')!.textContent = p.id + (p.type === 'switch' || p.type === 'led' || p.type === 'diode' ? '' : ' · ' + formatSI(p.value, UNIT[p.type] ?? ''));
      slot.tag.querySelector('span')!.textContent = w ? '⚠ ' + warningText(w) : describe(p, r).tag;
      slot.tag.classList.toggle('bad', !!w);
      slot.warn.visible = !!w;
    });
    const vref = referenceVoltage(c), pal = scenePalette();
    this.traces.forEach((tr, i) => {
      const v = this.sim.voltageAt(this.sim.topo.traceNode[i]);
      if (this.heatMap && v !== null) heatColor(v, vref, pal.trace, tr.mat.color); else tr.mat.color.set(pal.trace);
    });
  }

  /** Per-frame: electrons, part animations, render, label positions. */
  frame(dt: number, running: boolean): void {
    if (running) this.traces.forEach((tr, i) => {
      const I = this.sim.traceCurrent[i] || 0, mag = Math.abs(I);
      const target = mag < 1e-6 ? 0 : -Math.sign(I) * Math.min(2.4, 0.3 + 0.55 * Math.log10(1 + mag * 1e4));
      tr.speed += (target - tr.speed) * Math.min(1, dt * 6);
      tr.phase += tr.speed * dt;
      tr.on = mag >= 1e-6;
    });
    this.traces.forEach(tr => tr.pulses.forEach((parts, k) => {
      const d0 = (k / tr.pulses.length) * tr.path.total + tr.phase, dir = tr.speed >= 0 ? 1 : -1;
      parts.forEach((m, j) => {
        m.visible = tr.on;
        if (!tr.on) return;
        const p = pointAt(tr.path, d0 - dir * j * 0.13);
        m.position.set(p.x, 0.045, p.z); m.rotation.y = p.a;
      });
    }));
    this.parts.forEach((slot, i) => slot.model.animate(running ? dt : 0, this.sim.results[i] ?? null));
    MAT.warn.opacity = 0.18 + 0.12 * Math.sin(performance.now() / 180);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const place = (el: HTMLElement, x: number, y: number, z: number): void => {
      this.v3.set(x, y, z); this.root.localToWorld(this.v3); this.v3.project(this.camera);
      el.style.transform = 'translate(' + (((this.v3.x + 1) / 2) * w).toFixed(1) + 'px,' + (((1 - this.v3.y) / 2) * h).toFixed(1) + 'px) translate(-50%, -100%)';
    };
    if (this.labelsVisible) this.parts.forEach((slot, i) => {
      const p = this.store.circuit.components[i];
      if (p) place(slot.tag, p.x, slot.model.height, p.z);
    });
    if (this.probe.red) {
      const v = this.probe.reading();
      this.probeTag.textContent = v === null ? t('noConn') : (this.probe.black ? 'ΔV ' : 'V ') + formatSI(v, 'V');
      place(this.probeTag, this.probe.red[0], 1.05, this.probe.red[1]);
    }
  }

  /** PNG of the current frame (rendered on demand so the drawing buffer is fresh). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

