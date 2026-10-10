// Realistic cars: a dozen CC-BY glTF car models (see README credits), each
// normalised offline (tools/cars) into body / opening front doors / one wheel,
// and rendered for every vehicle with GPU instancing. Each Car keeps a light
// transform hierarchy (root + wheel holders/spinners); the fleet copies those
// transforms into instanced meshes once per frame (per model and LOD).
// Paint, rim colour, head and brake lights are per-instance colours.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

type WheelId = 'FL' | 'FR' | 'RL' | 'RR';
type Role = 'paint' | 'glass' | 'trim' | 'chrome' | 'head' | 'brake' | 'rim' | 'tyre';
interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; role: Role }
interface Template {
  id: string;
  body: Part[];
  /** Hinged front doors (driver = L at +X, passenger = R): parts are relative to the hinge pivot. */
  doors: Partial<Record<'L' | 'R', { pivot: THREE.Vector3; parts: Part[] }>>;
  /** One wheel (the front-left), centred at its hub, axle along X. */
  wheel: Part[];
  wheels: Record<WheelId, THREE.Vector3>;
  radius: number;
  size: THREE.Vector3;
  seat: THREE.Vector3;
  seatR: THREE.Vector3;
}

/** Model files (public/assets/cars/<id>.glb and <id>_far.glb). */
export const CAR_MODELS = ['golf', 'sonata', 'tucson', 'creta', 'civic', 'f150', 'cayman', 'taycan', 'granturismo', 'mclaren', 'elantra', 'rs7'] as const;
export type CarModelId = (typeof CAR_MODELS)[number];
/** Which model each catalogue vehicle uses. */
const FOR_VEHICLE: Record<string, CarModelId> = { pico: 'golf', ledger: 'sonata', ampere: 'taycan', bastion: 'tucson', mirage: 'cayman', regent: 'rs7', halving: 'mclaren' };
const FOR_BODY: Record<string, CarModelId> = { hatch: 'golf', sedan: 'sonata', ev: 'taycan', suv: 'tucson', sports: 'cayman', luxury: 'rs7', super: 'mclaren' };
export function carModelFor(vehicleId: string, body: string): CarModelId {
  if (vehicleId.startsWith('npc_')) { const m = vehicleId.slice(4) as CarModelId; if (CAR_MODELS.includes(m)) return m; }
  return FOR_VEHICLE[vehicleId] ?? FOR_BODY[body] ?? 'sonata';
}

const near = new Map<CarModelId, Template>();
const far = new Map<CarModelId, Template>();
let loading: Promise<boolean> | null = null;
export const carModelReady = () => near.size > 0;

// shared materials (one shader program per role for every car)
const MATS: Record<Role, THREE.Material> = (() => {
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, clearcoat: 1, clearcoatRoughness: 0.06, roughness: 0.34, metalness: 0.5, envMapIntensity: 1.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0f1418, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62, envMapIntensity: 1.6 });
  const trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.08 });
  const chrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 1, envMapIntensity: 1.3 });
  const rim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
  const tyre = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  const light = (role: 'head' | 'brake') => {
    const m = new THREE.MeshStandardMaterial({ color: role === 'brake' ? '#6a0d0d' : '#e8e8e2', roughness: 0.12, metalness: 0.1 });
    // per-instance light level: emissive scaled by instance colour
    m.emissive = new THREE.Color(role === 'brake' ? '#ff2a1a' : '#fff4e0');
    m.emissiveIntensity = role === 'brake' ? 6 : 10;
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance *= vColor.r;
        diffuseColor.rgb /= max(vColor, vec3(0.001));
        #endif`);
    };
    m.customProgramCacheKey = () => 'carlight_' + role;
    return m;
  };
  return { paint, glass, trim, chrome, rim, tyre, head: light('head'), brake: light('brake') };
})();

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Plain float attributes (meshopt-quantized files store normalized integers). */
function plainGeometry(g: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color'] as const) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const size = name === 'color' ? 3 : a.itemSize;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array as ArrayLike<number>), 1));
  return out;
}

async function loadTemplate(id: CarModelId, file: string): Promise<Template> {
  const g = await loader.loadAsync((import.meta.env.BASE_URL ?? '/') + 'assets/cars/' + file);
  let info: any = null;
  g.scene.traverse((o) => { if (o.userData?.car) info = o.userData.car; });
  if (!info) throw new Error('car info missing in ' + file);
  g.scene.updateMatrixWorld(true);
  const partsOf = (node: THREE.Object3D | undefined): Part[] => {
    const out: Part[] = [];
    if (!node) return out;
    const inv = node.matrixWorld.clone().invert();
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const r = /_([a-z]+)$/.exec(m.name)?.[1] as Role | undefined;
      const role: Role = r && MATS[r] ? r : 'trim';
      // dequantize, then bake the mesh's transform relative to its part node
      const geo = plainGeometry(m.geometry);
      geo.applyMatrix4(inv.clone().multiply(m.matrixWorld));
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      out.push({ geo, mat: MATS[role], role });
    });
    return out;
  };
  const v = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
  const doors: Template['doors'] = {};
  for (const s of ['L', 'R'] as const) {
    const n = g.scene.getObjectByName('door' + s);
    if (n && info.doors?.[s]) doors[s] = { pivot: v(info.doors[s]), parts: partsOf(n) };
  }
  return {
    id, body: partsOf(g.scene.getObjectByName('body')), doors, wheel: partsOf(g.scene.getObjectByName('wheel')),
    wheels: { FL: v(info.wheels.FL), FR: v(info.wheels.FR), RL: v(info.wheels.RL), RR: v(info.wheels.RR) },
    radius: info.radius, size: v(info.size),
    // seat cushion → the controller's seat reference (hips sit ~0.5 m above it)
    seat: v(info.seat).setY(info.seat[1] - 0.4), seatR: v(info.seatR).setY(info.seatR[1] - 0.4),
  };
}

/** Load every car model (near + far LOD). */
export function loadCarModel(): Promise<boolean> {
  if (loading) return loading;
  loading = (async () => {
    const results = await Promise.allSettled(CAR_MODELS.map(async (id) => {
      const [n, f] = await Promise.all([loadTemplate(id, id + '.glb'), loadTemplate(id, id + '_far.glb')]);
      near.set(id, n); far.set(id, f);
    }));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) console.warn('[cars] some car models failed', failed);
    if (!near.size) { console.warn('[cars] glTF cars failed, using procedural cars'); return false; }
    return true;
  })();
  return loading;
}

const tplFor = (id: CarModelId) => near.get(id) ?? near.get('sonata') ?? [...near.values()][0];

const RIM: Record<string, string> = { gold: '#d4af37', black: '#2a2b2e', mesh: '#e6e9ee', sport: '#c2c6cc', steel: '#ffffff' };

export interface FleetCar {
  root: THREE.Group;
  model: CarModelId;
  wheels: { holder: THREE.Group; spin: THREE.Group; front: boolean; id: WheelId }[];
  paint: THREE.Color; rim: THREE.Color;
  brake: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial;
  lastSeen: number;
  /** Half extents for on-foot collision (local X = width, Z = length). */
  half: { w: number; l: number };
  /** Door opening 0 (shut) .. 1 (open) for the driver (L) and passenger (R) side. */
  door: { L: number; R: number };
}

export function carDims(model: CarModelId) {
  const t = tplFor(model);
  return {
    L: t.size.z, W: t.size.x, wheelR: t.radius, wheelbase: t.wheels.FL.z - t.wheels.RL.z,
    seat: t.seat.clone(), seatR: t.seatR.clone(), hasDoors: !!t.doors.L,
  };
}

/** Builds the transform hierarchy for one car and registers it with the fleet. */
export function makeFleetCar(model: CarModelId, color: string, rims: string): FleetCar {
  const t = tplFor(model);
  const root = new THREE.Group();
  root.name = 'car';
  const wheels: FleetCar['wheels'] = [];
  for (const id of ['FL', 'FR', 'RL', 'RR'] as WheelId[]) {
    const holder = new THREE.Group();
    holder.position.copy(t.wheels[id]);
    const spin = new THREE.Group();
    holder.add(spin);
    root.add(holder);
    wheels.push({ holder, spin, front: id[0] === 'F', id });
  }
  const car: FleetCar = {
    root, wheels, model: t.id as CarModelId,
    paint: new THREE.Color(color), rim: new THREE.Color(RIM[rims] ?? RIM.steel),
    brake: new THREE.MeshStandardMaterial({ emissiveIntensity: 0.4 }), head: new THREE.MeshStandardMaterial({ emissiveIntensity: 0.4 }),
    lastSeen: performance.now(),
    half: { w: t.size.x / 2 - 0.05, l: t.size.z / 2 },
    door: { L: 0, R: 0 },
  };
  fleet.add(car);
  return car;
}

interface Batch { im: THREE.InstancedMesh; part: Part; kind: 'body' | 'door' | 'wheel'; door?: 'L' | 'R'; n: number }

class Fleet {
  group = new THREE.Group();
  cars: FleetCar[] = [];
  /** Per model and LOD: instanced meshes for every part. */
  private batches = new Map<string, Batch[]>();
  private cap = 0;
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private m3 = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private col = new THREE.Color();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  /** Cars closer than this use the detailed model. */
  nearDist = 40;

  add(c: FleetCar) {
    this.cars.push(c);
    if (this.cars.length > this.cap) this.rebuild(Math.max(32, this.cap * 2));
  }

  private rebuild(cap: number) {
    for (const list of this.batches.values()) for (const { im } of list) { im.removeFromParent(); im.dispose(); }
    this.batches.clear();
    this.cap = cap;
    for (const [lod, map] of [[0, near], [1, far]] as const) for (const [id, t] of map) {
      const list: Batch[] = [];
      const mk = (part: Part, kind: Batch['kind'], door?: 'L' | 'R') => {
        const n = kind === 'wheel' ? cap * 4 : cap;
        const im = new THREE.InstancedMesh(part.geo, part.mat, n);
        im.frustumCulled = false;
        im.castShadow = lod === 0 && part.role !== 'glass';
        im.receiveShadow = true;
        im.count = 0;
        im.visible = false;
        if (['paint', 'rim', 'head', 'brake'].includes(part.role)) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
        this.group.add(im);
        list.push({ im, part, kind, door, n: 0 });
      };
      for (const p of t.body) mk(p, 'body');
      for (const d of ['L', 'R'] as const) for (const p of t.doors[d]?.parts ?? []) mk(p, 'door', d);
      for (const p of t.wheel) mk(p, 'wheel');
      this.batches.set(id + ':' + lod, list);
    }
  }

  /** Push a circle (at `pos`, radius r) out of every nearby car's oriented box, optionally ignoring one car. */
  push(pos: THREE.Vector3, r: number, ignore?: THREE.Object3D) {
    let moved = false;
    for (const c of this.cars) {
      if (!c.root.parent || !c.root.visible || c.root === ignore) continue;
      const cp = c.root.getWorldPosition(this.p);
      const dx = pos.x - cp.x, dz = pos.z - cp.z;
      if (dx * dx + dz * dz > 40) continue;
      const yaw = this.e.setFromQuaternion(c.root.getWorldQuaternion(this.q), 'YXZ').y;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      // into car-local space (car forward = +Z)
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      const hw = c.half.w * 0.95 + r, hl = c.half.l * 0.96 + r;
      if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) continue;
      let px = 0, pz = 0;
      if (hw - Math.abs(lx) < hl - Math.abs(lz)) px = Math.sign(lx || 1) * (hw - Math.abs(lx)); else pz = Math.sign(lz || 1) * (hl - Math.abs(lz));
      pos.x += px * cs + pz * sn;
      pos.z += -px * sn + pz * cs;
      moved = true;
    }
    return moved;
  }

  /** Nearest visible car within `maxDist` of `pos`. */
  nearest(pos: THREE.Vector3, maxDist: number) {
    let best: FleetCar | null = null, bd = maxDist * maxDist;
    for (const c of this.cars) {
      if (!c.root.parent || !this.visible(c.root)) continue;
      const d = c.root.getWorldPosition(this.p).distanceToSquared(pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private visible(o: THREE.Object3D) {
    let p: THREE.Object3D | null = o;
    while (p) { if (!p.visible) return false; if ((p as THREE.Scene).isScene) return true; p = p.parent; }
    return false;
  }

  update(cam?: THREE.Vector3, maxDist = 260) {
    if (!this.cap) return;
    const now = performance.now();
    this.cars = this.cars.filter((c) => { if (c.root.parent) c.lastSeen = now; return now - c.lastSeen < 4000; });
    for (const list of this.batches.values()) for (const b of list) b.n = 0;
    for (const c of this.cars) {
      if (!this.visible(c.root)) continue;
      c.root.updateWorldMatrix(true, true);
      const d2 = cam ? cam.distanceToSquared(this.p.setFromMatrixPosition(c.root.matrixWorld)) : 0;
      if (d2 > maxDist * maxDist) continue;
      const lod = d2 < this.nearDist * this.nearDist ? 0 : 1;
      const list = this.batches.get(c.model + ':' + lod);
      if (!list) continue;
      const t = (lod === 0 ? near : far).get(c.model)!;
      for (const b of list) {
        const { im, part } = b;
        if (b.kind === 'wheel') {
          for (const w of c.wheels) {
            // right-side wheels are the same wheel turned around; their spin flips with it
            const right = w.id[1] === 'R';
            this.m.copy(w.holder.matrixWorld);
            if (right) this.m.multiply(this.m2.makeRotationY(Math.PI));
            this.m.multiply(this.m3.makeRotationX(right ? w.spin.rotation.z : -w.spin.rotation.z));
            im.setMatrixAt(b.n, this.m);
            if (im.instanceColor) im.setColorAt(b.n, c.rim);
            b.n++;
          }
          continue;
        }
        if (b.kind === 'door') {
          const pv = t.doors[b.door!]!.pivot;
          const ang = (b.door === 'L' ? -1.05 : 1.05) * c.door[b.door!];
          this.m.copy(c.root.matrixWorld).multiply(this.m2.makeTranslation(pv.x, pv.y, pv.z)).multiply(this.m3.makeRotationY(ang));
        } else this.m.copy(c.root.matrixWorld);
        im.setMatrixAt(b.n, this.m);
        if (im.instanceColor) {
          if (part.role === 'paint') im.setColorAt(b.n, c.paint);
          else if (part.role === 'brake') im.setColorAt(b.n, this.col.setScalar(Math.min(1, c.brake.emissiveIntensity / 3)));
          else if (part.role === 'head') im.setColorAt(b.n, this.col.setScalar(Math.min(1, c.head.emissiveIntensity / 3)));
        }
        b.n++;
      }
    }
    for (const list of this.batches.values()) for (const b of list) {
      b.im.count = b.n;
      b.im.visible = b.n > 0;
      if (b.n) { b.im.instanceMatrix.needsUpdate = true; if (b.im.instanceColor) b.im.instanceColor.needsUpdate = true; }
    }
  }
}

export const fleet = new Fleet();
