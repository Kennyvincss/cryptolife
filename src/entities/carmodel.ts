// Realistic cars: one CC0 glTF car (Khronos "CarConcept", decimated) rendered
// for every vehicle with GPU instancing. Each Car keeps a light-weight transform
// hierarchy (root + wheel holders/spinners); the fleet copies those transforms
// into instanced meshes once per frame, so 30 cars cost ~40 draw calls total.
// Paint, rim colour, head and brake lights are per-instance colours.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type WheelId = 'FL' | 'FR' | 'RL' | 'RR';
interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; role: 'paint' | 'rim' | 'brake' | 'head' | 'plain' }
interface Template {
  body: Part[];
  wheels: Record<WheelId, { center: THREE.Vector3; parts: Part[] }>;
  size: THREE.Vector3;
}

let template: Template | null = null;
let loading: Promise<boolean> | null = null;
export const carModelReady = () => !!template;

/** Dequantize to plain float attributes so parts can be merged. */
function plain(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) { if (name === 'uv') out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2)); continue; }
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (g.index) out.setIndex(Array.from(g.index.array as ArrayLike<number>));
  out.applyMatrix4(m);
  return out;
}

function roleOf(m: THREE.Material): Part['role'] {
  const n = m.name;
  if (/^Paint 1/.test(n)) return 'paint';
  if (/^Rim/.test(n)) return 'rim';
  if (/Brakelight/.test(n)) return 'brake';
  if (/Headlight/.test(n)) return 'head';
  return 'plain';
}

function prepMaterial(m: THREE.Material, role: Part['role']) {
  const mm = m as THREE.MeshPhysicalMaterial;
  if (role === 'paint' || role === 'rim') mm.color.set(0xffffff);
  if (role === 'paint') { mm.clearcoat = 1; mm.clearcoatRoughness = 0.06; mm.roughness = 0.32; mm.metalness = 0.55; }
  if (role === 'brake' || role === 'head') {
    // per-instance light level: emissive scaled by instance colour
    mm.emissive = new THREE.Color(role === 'brake' ? '#ff2a1a' : '#fff4e0');
    mm.emissiveIntensity = role === 'brake' ? 6 : 10;
    mm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance *= vColor.r;
        diffuseColor.rgb /= max(vColor, vec3(0.001));
        #endif`);
    };
    mm.customProgramCacheKey = () => 'carlight_' + role;
  }
  mm.envMapIntensity = role === 'paint' ? 1.4 : 1;
  return mm;
}

export function loadCarModel(): Promise<boolean> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const g = await new GLTFLoader().loadAsync((import.meta.env.BASE_URL ?? '/') + 'assets/cars/concept_lod.glb');
      g.scene.updateMatrixWorld(true);
      const body = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const wheelGeos: Record<WheelId, Map<THREE.Material, THREE.BufferGeometry[]>> = { FL: new Map(), FR: new Map(), RL: new Map(), RR: new Map() };
      const wheelBox: Record<WheelId, THREE.Box3> = { FL: new THREE.Box3(), FR: new THREE.Box3(), RL: new THREE.Box3(), RR: new THREE.Box3() };
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        let p: THREE.Object3D | null = mesh, wid: WheelId | null = null;
        while (p) { const m = /^Wheel(Front|Rear)(L|R)/.exec(p.name); if (m) { wid = ((m[1] === 'Front' ? 'F' : 'R') + m[2]) as WheelId; break; } p = p.parent; }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const geo = plain(mesh.geometry, mesh.matrixWorld);
        const target = wid ? wheelGeos[wid] : body;
        if (wid) { geo.computeBoundingBox(); wheelBox[wid].union(geo.boundingBox!); }
        const m = mats[0];
        if (!target.has(m)) target.set(m, []);
        target.get(m)!.push(geo);
      });
      const merge = (map: Map<THREE.Material, THREE.BufferGeometry[]>, offset?: THREE.Vector3): Part[] => [...map.entries()].map(([m, geos]) => {
        const merged = mergeGeometries(geos, false)!;
        if (offset) merged.translate(-offset.x, -offset.y, -offset.z);
        const role = roleOf(m);
        return { geo: merged, mat: prepMaterial(m, role), role };
      });
      const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      const wheels = {} as Template['wheels'];
      for (const id of ['FL', 'FR', 'RL', 'RR'] as WheelId[]) {
        const c = wheelBox[id].getCenter(new THREE.Vector3());
        wheels[id] = { center: c, parts: merge(wheelGeos[id], c) };
      }
      template = { body: merge(body), wheels, size };
      return true;
    } catch (e) {
      console.warn('[cars] glTF car failed, using procedural cars', e);
      return false;
    }
  })();
  return loading;
}

/** Proportions per catalogue body style (the base model is a low sports car). */
const STYLE: Record<string, { s: [number, number, number]; lift: number; wheel: number }> = {
  hatch: { s: [0.94, 1.12, 0.86], lift: 0.04, wheel: 0.92 },
  sedan: { s: [0.97, 1.14, 1.04], lift: 0.05, wheel: 0.95 },
  ev: { s: [0.98, 1.1, 1.02], lift: 0.04, wheel: 0.97 },
  suv: { s: [1.02, 1.32, 1.06], lift: 0.16, wheel: 1.12 },
  sports: { s: [1, 1.02, 1], lift: 0, wheel: 1 },
  super: { s: [1.02, 0.96, 1.03], lift: -0.02, wheel: 1 },
  luxury: { s: [1.0, 1.12, 1.12], lift: 0.04, wheel: 1.02 },
};

const RIM: Record<string, string> = { gold: '#d4af37', black: '#2a2b2e', mesh: '#e6e9ee', sport: '#c2c6cc', steel: '#9ca2a8' };

export interface FleetCar {
  root: THREE.Group;
  wheels: { holder: THREE.Group; spin: THREE.Group; front: boolean; id: WheelId }[];
  paint: THREE.Color; rim: THREE.Color;
  brake: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial;
  style: (typeof STYLE)[string];
  lastSeen: number;
}

export function carDims(body: string) {
  const st = STYLE[body] ?? STYLE.sedan;
  const t = template!;
  const fl = t.wheels.FL.center, rl = t.wheels.RL.center;
  return {
    L: t.size.z * st.s[2], W: 1.96 * st.s[0], wheelR: 0.38 * st.wheel * st.s[1] ** 0.3, wheelbase: (fl.z - rl.z) * st.s[2],
    seat: new THREE.Vector3(0.38 * st.s[0], 0.3 * st.s[1] + st.lift, -0.25 * st.s[2]),
  };
}

/** Builds the transform hierarchy for one car and registers it with the fleet. */
export function makeFleetCar(body: string, color: string, rims: string): FleetCar {
  const t = template!;
  const st = STYLE[body] ?? STYLE.sedan;
  const root = new THREE.Group();
  root.name = 'car';
  const wheels: FleetCar['wheels'] = [];
  for (const id of ['FL', 'FR', 'RL', 'RR'] as WheelId[]) {
    const c = t.wheels[id].center;
    const holder = new THREE.Group();
    holder.position.set(c.x * st.s[0], c.y * st.wheel + st.lift * 0, c.z * st.s[2]);
    const spin = new THREE.Group();
    holder.add(spin);
    root.add(holder);
    wheels.push({ holder, spin, front: id[0] === 'F', id });
  }
  const car: FleetCar = {
    root, wheels, style: st,
    paint: new THREE.Color(color), rim: new THREE.Color(RIM[rims] ?? RIM.steel),
    brake: new THREE.MeshStandardMaterial({ emissiveIntensity: 0.4 }), head: new THREE.MeshStandardMaterial({ emissiveIntensity: 0.4 }),
    lastSeen: performance.now(),
  };
  fleet.add(car);
  return car;
}

/** Wheels in the source spin about their local X axis. */
export const WHEEL_SPIN_AXIS = 'x' as const;

class Fleet {
  group = new THREE.Group();
  private cars: FleetCar[] = [];
  private meshes: { im: THREE.InstancedMesh; part: Part; wheel: WheelId | null }[] = [];
  private cap = 0;
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private m3 = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private col = new THREE.Color();

  add(c: FleetCar) {
    this.cars.push(c);
    if (this.cars.length > this.cap) this.rebuild(Math.max(48, this.cap * 2));
  }

  private rebuild(cap: number) {
    const t = template!;
    for (const { im } of this.meshes) { im.removeFromParent(); im.dispose(); }
    this.meshes = [];
    this.cap = cap;
    const mk = (part: Part, wheel: WheelId | null) => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, cap);
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      if (part.role !== 'plain') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      this.group.add(im);
      this.meshes.push({ im, part, wheel });
    };
    for (const p of t.body) mk(p, null);
    for (const id of ['FL', 'FR', 'RL', 'RR'] as WheelId[]) for (const p of t.wheels[id].parts) mk(p, id);
  }

  private visible(o: THREE.Object3D) {
    let p: THREE.Object3D | null = o;
    while (p) { if (!p.visible) return false; if ((p as THREE.Scene).isScene) return true; p = p.parent; }
    return false;
  }

  update(cam?: THREE.Vector3, maxDist = 260) {
    if (!this.cap) return;
    const now = performance.now();
    // forget cars that were removed from the scene a while ago
    this.cars = this.cars.filter((c) => { if (c.root.parent) c.lastSeen = now; return now - c.lastSeen < 4000; });
    const wheelIdx: Record<WheelId, number> = { FL: 0, FR: 1, RL: 2, RR: 3 };
    let n = 0;
    for (const c of this.cars) {
      if (!this.visible(c.root)) continue;
      c.root.updateWorldMatrix(true, true);
      if (cam && c.root.matrixWorld.elements[12] !== undefined && cam.distanceToSquared(this.p.setFromMatrixPosition(c.root.matrixWorld)) > maxDist * maxDist) continue;
      const i = n++;
      for (const { im, part, wheel } of this.meshes) {
        if (wheel) {
          // vehicle code spins wheels via spin.rotation.z (procedural convention); our axles run along X
          const w = c.wheels[wheelIdx[wheel]];
          this.m.copy(w.holder.matrixWorld).multiply(this.m2.makeRotationX(-w.spin.rotation.z)).multiply(this.m3.makeScale(c.style.wheel, c.style.wheel, c.style.wheel));
        } else {
          this.m.copy(c.root.matrixWorld).multiply(this.m2.makeScale(c.style.s[0], c.style.s[1], c.style.s[2]).setPosition(0, c.style.lift, 0));
        }
        im.setMatrixAt(i, this.m);
        if (im.instanceColor) {
          if (part.role === 'paint') im.setColorAt(i, c.paint);
          else if (part.role === 'rim') im.setColorAt(i, c.rim);
          else if (part.role === 'brake') im.setColorAt(i, this.col.setScalar(Math.min(1, c.brake.emissiveIntensity / 3)));
          else if (part.role === 'head') im.setColorAt(i, this.col.setScalar(Math.min(1, c.head.emissiveIntensity / 3)));
        }
      }
    }
    for (const { im } of this.meshes) im.count = n;
    for (const { im } of this.meshes) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
}

export const fleet = new Fleet();
