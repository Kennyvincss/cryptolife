// Procedural vehicle models + arcade driving physics.

import * as THREE from 'three';
import { VEHICLE_BY_ID, type VehicleDef } from '../../shared/catalog.js';
import { mat, mergeStatic } from '../engine/build.js';
import type { Colliders } from '../world/colliders.js';
import { carDims, carModelFor, carModelReady, makeFleetCar } from './carmodel.js';

type Body = VehicleDef['body'];

interface Dims { L: number; W: number; wheelR: number; wheelbase: number; track: number; profile: [number, number][]; cabin: [number, number][]; cabinInset: number; seatY: number; seatZ: number }

// side profiles: x = along length (front at +L/2), y = height. Lower body then greenhouse.
const DIMS: Record<Exclude<Body, 'moto'>, Dims> = {
  hatch: { L: 3.9, W: 1.75, wheelR: 0.31, wheelbase: 2.45, track: 1.5, seatY: 0.45, seatZ: -0.1,
    profile: [[-1.95, 0.25], [-1.97, 0.75], [-1.85, 0.95], [-0.9, 0.98], [1.0, 0.92], [1.85, 0.75], [1.95, 0.5], [1.92, 0.25]],
    cabin: [[-1.8, 0.95], [-1.65, 1.48], [-0.6, 1.52], [0.25, 1.47], [0.95, 0.93]], cabinInset: 0.12 },
  sedan: { L: 4.7, W: 1.82, wheelR: 0.33, wheelbase: 2.8, track: 1.55, seatY: 0.42, seatZ: 0,
    profile: [[-2.35, 0.28], [-2.38, 0.72], [-2.2, 0.95], [-1.3, 0.98], [1.1, 0.95], [2.2, 0.78], [2.36, 0.55], [2.32, 0.28]],
    cabin: [[-1.45, 0.96], [-0.85, 1.42], [0.35, 1.45], [1.05, 0.95]], cabinInset: 0.13 },
  ev: { L: 4.6, W: 1.88, wheelR: 0.34, wheelbase: 2.85, track: 1.6, seatY: 0.42, seatZ: 0,
    profile: [[-2.3, 0.3], [-2.32, 0.75], [-2.15, 0.95], [-1.0, 1.0], [1.3, 0.92], [2.25, 0.7], [2.3, 0.45], [2.26, 0.3]],
    cabin: [[-2.0, 0.96], [-0.9, 1.45], [0.4, 1.47], [1.35, 0.92]], cabinInset: 0.12 },
  suv: { L: 4.8, W: 1.95, wheelR: 0.4, wheelbase: 2.9, track: 1.65, seatY: 0.65, seatZ: 0,
    profile: [[-2.4, 0.38], [-2.42, 1.0], [-2.3, 1.2], [-1.2, 1.22], [1.4, 1.2], [2.35, 1.05], [2.42, 0.7], [2.38, 0.38]],
    cabin: [[-2.3, 1.2], [-2.2, 1.85], [0.6, 1.88], [1.45, 1.2]], cabinInset: 0.1 },
  sports: { L: 4.5, W: 1.92, wheelR: 0.34, wheelbase: 2.6, track: 1.62, seatY: 0.3, seatZ: -0.2,
    profile: [[-2.25, 0.22], [-2.28, 0.62], [-2.1, 0.8], [-1.2, 0.85], [0.8, 0.78], [2.15, 0.55], [2.28, 0.38], [2.22, 0.22]],
    cabin: [[-1.5, 0.82], [-0.7, 1.2], [0.15, 1.22], [0.9, 0.78]], cabinInset: 0.17 },
  super: { L: 4.6, W: 2.0, wheelR: 0.35, wheelbase: 2.7, track: 1.7, seatY: 0.25, seatZ: 0,
    profile: [[-2.3, 0.2], [-2.32, 0.6], [-2.15, 0.78], [-0.8, 0.86], [0.8, 0.7], [2.2, 0.45], [2.32, 0.3], [2.28, 0.2]],
    cabin: [[-1.2, 0.84], [-0.4, 1.12], [0.3, 1.13], [1.2, 0.68]], cabinInset: 0.22 },
  luxury: { L: 5.2, W: 1.95, wheelR: 0.37, wheelbase: 3.2, track: 1.65, seatY: 0.45, seatZ: -0.2,
    profile: [[-2.6, 0.3], [-2.62, 0.78], [-2.45, 1.0], [-1.5, 1.04], [1.3, 1.02], [2.45, 0.85], [2.62, 0.6], [2.58, 0.3]],
    cabin: [[-1.7, 1.02], [-1.0, 1.5], [0.45, 1.52], [1.25, 1.02]], cabinInset: 0.12 },
};

function extrudeProfile(points: [number, number][], width: number, bevel: number) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  // orient: shape x -> world z (forward), extrude z -> world x
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function paintMat(color: string) {
  return mat('paint_' + color, { color, physical: true, clearcoat: 1, roughness: 0.3, metalness: 0.45, envMapIntensity: 4 });
}
const GLASS = () => mat('carglass', { color: '#0c1118', roughness: 0.05, metalness: 0.9, envMapIntensity: 4 });
const RUBBER = () => mat('rubber', { color: '#141416', roughness: 0.92 });
const CHROME = () => mat('chrome', { color: '#e8eaee', roughness: 0.12, metalness: 1 });
const TRIM = () => mat('trim', { color: '#0d0d10', roughness: 0.5, metalness: 0.3 });

export function rimMat(rims: string) {
  switch (rims) {
    case 'gold': return mat('rim_gold', { color: '#d4af37', metalness: 1, roughness: 0.2 });
    case 'black': return mat('rim_black', { color: '#141418', metalness: 0.6, roughness: 0.3 });
    case 'mesh': return mat('rim_mesh', { color: '#cfd4da', metalness: 1, roughness: 0.15 });
    case 'sport': return mat('rim_sport', { color: '#b7bcc2', metalness: 1, roughness: 0.25 });
    default: return mat('rim_steel', { color: '#8a9096', metalness: 0.8, roughness: 0.45 });
  }
}

function wheel(r: number, w: number, rims: string) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.28, 10, 24), RUBBER());
  tire.scale.z = w / (r * 0.56);
  tire.castShadow = true;
  g.add(tire);
  const rm = rimMat(rims);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.6, 20), rm);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const spokes = rims === 'mesh' ? 10 : rims === 'gold' ? 8 : 5;
  for (let i = 0; i < spokes; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, r * 1.1, 0.04), rm);
    s.rotation.z = (i / spokes) * Math.PI * 2;
    s.position.z = w * 0.32;
    g.add(s);
    const s2 = s.clone(); s2.position.z = -w * 0.32; g.add(s2);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.15, w * 0.7, 10), CHROME());
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  const holder = new THREE.Group();
  g.rotation.y = Math.PI / 2;
  holder.add(g);
  mergeStatic(g);
  return { holder, spin: g };
}

export interface VehicleVisual {
  root: THREE.Group;
  wheels: { holder: THREE.Group; spin: THREE.Group; front: boolean }[];
  brake: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  seat: THREE.Vector3;
  /** Front passenger seat (cars only). */
  seatR?: THREE.Vector3;
  dims: { L: number; W: number; wheelR: number; wheelbase: number };
  isMoto: boolean;
  /** Animated door openings (glTF cars only). */
  doors?: { L: number; R: number };
}

export function buildVehicle(model: string, color: string, rims = 'steel'): VehicleVisual {
  const def = VEHICLE_BY_ID[model] ?? VEHICLE_BY_ID['ledger'];
  if (def.body === 'moto') return buildMoto(color, rims, def.id === 'scoot');
  if (carModelReady()) {
    // realistic glTF car drawn by the instanced fleet renderer
    const fc = makeFleetCar(carModelFor(model, def.body), color, rims);
    const d = carDims(fc.model);
    return { root: fc.root, wheels: fc.wheels.map((w) => ({ holder: w.holder, spin: w.spin, front: w.front })), brake: fc.brake, head: fc.head, seat: d.seat, seatR: d.seatR, dims: { L: d.L, W: d.W, wheelR: d.wheelR, wheelbase: d.wheelbase }, isMoto: false, doors: fc.door };
  }
  const d = DIMS[def.body];
  const root = new THREE.Group();
  const paint = paintMat(color);
  const body = new THREE.Mesh(extrudeProfile(d.profile, d.W, 0.12), paint);
  body.castShadow = true; body.receiveShadow = true;
  root.add(body);
  const cabinW = d.W - d.cabinInset * 2;
  const cabin = new THREE.Mesh(extrudeProfile(d.cabin, cabinW, 0.08), GLASS());
  cabin.castShadow = true;
  root.add(cabin);
  // roof panel in paint over the glass
  const roofPts = d.cabin.slice(1, d.cabin.length - 1);
  if (roofPts.length >= 2) {
    const zs = roofPts.map((p) => p[0]);
    const ys = roofPts.map((p) => p[1]);
    const roofLen = Math.max(...zs) - Math.min(...zs);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabinW - 0.06, 0.05, roofLen * 0.92), paint);
    roof.position.set(0, Math.max(...ys) + 0.01, (Math.max(...zs) + Math.min(...zs)) / 2);
    roof.castShadow = true;
    root.add(roof);
    // pillars
    const pillarM = def.body === 'super' || def.body === 'sports' ? TRIM() : paint;
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, Math.max(...ys) - d.cabin[0][1], 0.08), pillarM);
      b.position.set(sx * (cabinW / 2 - 0.02), (Math.max(...ys) + d.cabin[0][1]) / 2, (d.cabin[0][0] + d.cabin[d.cabin.length - 1][0]) / 2 + 0.05);
      root.add(b);
    }
  }
  // lights
  const head = mat('headlight_' + model, { color: '#fffbe8', emissive: '#fff4d0', emissiveIntensity: 0.4, roughness: 0.1 });
  const brake = mat('brake_' + model + Math.random(), { color: '#5a0505', emissive: '#ff1010', emissiveIntensity: 0.6, roughness: 0.3 }) as THREE.MeshStandardMaterial;
  const front = d.profile.reduce((a, p) => Math.max(a, p[0]), -9);
  const back = d.profile.reduce((a, p) => Math.min(a, p[0]), 9);
  const lightY = d.profile[d.profile.length - 2][1] - 0.08;
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.08), head);
    hl.position.set(sx * (d.W / 2 - 0.3), lightY, front - 0.02);
    root.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.06), brake);
    tl.position.set(sx * (d.W / 2 - 0.3), d.profile[1][1] - 0.08, back + 0.02);
    root.add(tl);
    // mirrors
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), paint);
    mir.position.set(sx * (d.W / 2 + 0.06), d.cabin[0][1] + 0.08, d.cabin[d.cabin.length - 1][0] - 0.15);
    root.add(mir);
  }
  if (def.body === 'luxury' || def.body === 'suv' || def.body === 'sedan') {
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.05), def.body === 'luxury' ? CHROME() : TRIM());
    grille.position.set(0, lightY - 0.05, front + 0.0);
    root.add(grille);
  }
  // plates
  const plate = mat('plate', { color: '#f2f2ee', roughness: 0.5 });
  const fp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.02), plate);
  fp.position.set(0, 0.42 * (d.profile[0][1] / 0.28), front + 0.03);
  root.add(fp);
  const bp = fp.clone(); bp.position.z = back - 0.03; root.add(bp);
  // underbody & interior hints
  const under = new THREE.Mesh(new THREE.BoxGeometry(d.W - 0.2, 0.1, d.L - 0.6), TRIM());
  under.position.y = d.profile[0][1] + 0.02;
  root.add(under);
  const seatM = mat('seat', { color: '#2a2622', roughness: 0.6 });
  for (const sx of [-0.4, 0.4]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.15), seatM);
    seat.position.set(sx, d.seatY + d.profile[0][1] + 0.35, d.seatZ - 0.35);
    seat.rotation.x = -0.15;
    root.add(seat);
  }
  if (def.body === 'super') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(d.W - 0.2, 0.04, 0.35), TRIM());
    wing.position.set(0, 1.05, back + 0.25);
    root.add(wing);
    for (const sx of [-0.6, 0.6]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.1), TRIM()); st.position.set(sx, 0.9, back + 0.3); root.add(st); }
  }
  const wheels: VehicleVisual['wheels'] = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = wheel(d.wheelR, 0.24, rims);
    w.holder.position.set(sx * (d.track / 2), d.wheelR, sz * (d.wheelbase / 2));
    if (sx > 0) w.spin.rotation.y = -Math.PI / 2;
    root.add(w.holder);
    wheels.push({ ...w, front: sz > 0 });
  }
  mergeStatic(root, new Set(wheels.map((w) => w.holder)));
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; } });
  return { root, wheels, brake, head, seat: new THREE.Vector3(-0.4, d.seatY - 0.16, d.seatZ - 0.15), dims: { L: d.L, W: d.W, wheelR: d.wheelR, wheelbase: d.wheelbase }, isMoto: false };
}

function buildMoto(color: string, rims: string, scooter: boolean): VehicleVisual {
  const root = new THREE.Group();
  const paint = paintMat(color);
  const r = scooter ? 0.27 : 0.33;
  const wb = scooter ? 1.25 : 1.45;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, wb * 0.8), TRIM());
  frame.position.set(0, r + 0.25, 0);
  root.add(frame);
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 4, 12), paint);
  tank.rotation.x = Math.PI / 2; tank.position.set(0, r + 0.5, 0.15);
  root.add(tank);
  const fairing = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 12), paint);
  fairing.rotation.x = Math.PI / 2; fairing.position.set(0, r + 0.55, wb / 2 - 0.05);
  root.add(fairing);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.55), mat('seat', { color: '#2a2622', roughness: 0.6 }));
  seat.position.set(0, r + 0.55, -0.25);
  root.add(seat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.35), paint);
  tail.position.set(0, r + 0.55, -0.6); tail.rotation.x = -0.2;
  root.add(tail);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), CHROME());
  bar.rotation.z = Math.PI / 2; bar.position.set(0, r + 0.75, wb / 2 - 0.2);
  root.add(bar);
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), CHROME());
  fork.position.set(0, r + 0.3, wb / 2 - 0.05); fork.rotation.x = 0.35;
  root.add(fork);
  const head = mat('moto_head', { color: '#fffbe8', emissive: '#fff4d0', emissiveIntensity: 0.4 });
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), head);
  hl.position.set(0, r + 0.55, wb / 2 + 0.2);
  root.add(hl);
  const brake = mat('brake_moto' + Math.random(), { color: '#5a0505', emissive: '#ff1010', emissiveIntensity: 0.6 }) as THREE.MeshStandardMaterial;
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.04), brake);
  tl.position.set(0, r + 0.6, -0.8);
  root.add(tl);
  const wheels: VehicleVisual['wheels'] = [];
  for (const sz of [1, -1]) {
    const w = wheel(r, 0.14, rims);
    w.holder.position.set(0, r, sz * wb / 2);
    root.add(w.holder);
    wheels.push({ ...w, front: sz > 0 });
  }
  mergeStatic(root, new Set(wheels.map((w) => w.holder)));
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { root, wheels, brake, head, seat: new THREE.Vector3(0, 0.38, -0.2), dims: { L: wb + 0.7, W: 0.7, wheelR: r, wheelbase: wb }, isMoto: true };
}

// ---------------- physics ----------------
export interface DriveInput { throttle: number; brake: number; steer: number; handbrake: boolean }

export class Car {
  visual: VehicleVisual;
  def: VehicleDef;
  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  steer = 0;
  rpm = 0;
  wheelSpin = 0;
  lean = 0;
  damageAccum = 0;
  upgrades = { engine: 0, handling: 0 };
  onImpact?: (strength: number) => void;

  constructor(public model: string, public color: string, public rims = 'steel') {
    this.def = VEHICLE_BY_ID[model] ?? VEHICLE_BY_ID['ledger'];
    this.visual = buildVehicle(model, color, rims);
  }

  get root() { return this.visual.root; }
  get radius() { return this.visual.dims.W / 2 + 0.1; }

  setPose(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.sync();
  }

  sync() {
    this.visual.root.position.copy(this.pos);
    this.visual.root.rotation.set(0, this.heading, this.visual.isMoto ? this.lean : 0);
  }

  update(dt: number, inp: DriveInput, colliders: Colliders | null) {
    const top = this.def.top * (1 + this.upgrades.engine * 0.08);
    const accel = this.def.accel * (1 + this.upgrades.engine * 0.12);
    const grip = this.def.grip * (1 + this.upgrades.handling * 0.1);
    if (inp.throttle > 0) {
      if (this.speed < -0.5) this.speed += 18 * dt;
      else this.speed += accel * inp.throttle * dt * (1 - Math.max(0, this.speed) / top);
    }
    if (inp.brake > 0) {
      if (this.speed > 0.5) this.speed -= 22 * inp.brake * dt;
      else this.speed -= accel * 0.6 * inp.brake * dt * (1 + this.speed / 9);
      this.speed = Math.max(this.speed, -9);
    }
    if (inp.handbrake) this.speed *= 1 - 2.2 * dt;
    if (!inp.throttle && !inp.brake) this.speed *= 1 - 0.45 * dt;
    this.speed -= this.speed * Math.abs(this.speed) * 0.0009 * dt;
    if (Math.abs(this.speed) < 0.05 && !inp.throttle && !inp.brake) this.speed = 0;
    const maxSteer = 0.6 / (1 + Math.abs(this.speed) * 0.04 / grip);
    this.steer += (inp.steer * maxSteer - this.steer) * Math.min(1, dt * 6);
    const wb = this.visual.dims.wheelbase;
    const yawRate = (this.speed / wb) * Math.tan(this.steer) * (inp.handbrake ? 1.5 : 1);
    this.heading += yawRate * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;
    if (this.visual.isMoto) this.lean += (-this.steer * Math.min(1, Math.abs(this.speed) / 12) * 0.9 - this.lean) * Math.min(1, dt * 5);

    if (colliders) {
      const L = this.visual.dims.L * 0.4;
      const r = this.radius;
      for (const off of [L, 0, -L]) {
        const cx = this.pos.x + fx * off, cz = this.pos.z + fz * off;
        const hit = colliders.resolveCircle(cx, cz, r);
        if (hit) {
          this.pos.x += hit.dx; this.pos.z += hit.dz;
          const impact = Math.abs(this.speed);
          if (impact > 3) { this.onImpact?.(impact); this.damageAccum += impact * 0.6; }
          this.speed *= -0.25;
        }
      }
    }
    // visuals
    this.wheelSpin += (this.speed / this.visual.dims.wheelR) * dt;
    for (const w of this.visual.wheels) {
      w.spin.rotation.z = -this.wheelSpin * (w.spin.rotation.y < 0 ? -1 : 1);
      if (w.front) w.holder.rotation.y = this.steer;
    }
    this.visual.brake.emissiveIntensity = inp.brake > 0 && this.speed > 0.5 ? 3 : inp.brake > 0 ? 1.4 : 0.6;
    this.rpm = Math.abs(this.speed) / top;
    this.sync();
  }

  setHeadlights(on: boolean) { this.visual.head.emissiveIntensity = on ? 3 : 0.4; }

  dispose() {
    this.visual.root.removeFromParent();
    this.visual.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
