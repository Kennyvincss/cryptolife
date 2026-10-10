// Real furniture models (Poly Haven CC0 scans/models, one Khronos CC-BY sofa)
// loaded once and handed out as clones sized to the space they fill. Interiors
// batch them by material, so a room full of chairs is still a few draw calls.
// Builders fall back to the procedural versions until (or if) these load.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** name → file and which dimension (metres) the default size fixes. */
const LIB = {
  sofa: { file: 'GlamVelvetSofa.glb', w: 2.2 },
  armchair: { file: 'modern_arm_chair_01.glb', w: 0.72 },
  lounge: { file: 'mid_century_lounge_chair.glb', w: 0.8 },
  coffeeTable: { file: 'modern_coffee_table_01.glb', w: 1.2 },
  roundCoffee: { file: 'coffee_table_round_01.glb', w: 0.8 },
  plantSmall: { file: 'potted_plant_01.glb', h: 0.8 },
  plantBig: { file: 'potted_plant_02.glb', h: 1.15 },
  nightstand: { file: 'painted_wooden_nightstand.glb', h: 0.55 },
  wardrobe: { file: 'vintage_cabinet_01.glb', w: 1.6 },
  diningTable: { file: 'wooden_table_02.glb', w: 1.6 },
  roundTable: { file: 'round_wooden_table_01.glb', w: 0.9 },
  chair: { file: 'painted_wooden_chair_02.glb', h: 0.92 },
  stool: { file: 'metal_stool_01.glb', h: 0.75 },
  desk: { file: 'small_wooden_table_01.glb', w: 1.4 },
  bookshelf: { file: 'wooden_display_shelves_01.glb', w: 1.2 },
  shelves: { file: 'steel_frame_shelves_01.glb', w: 0.9 },
  mirror: { file: 'ornate_mirror_01.glb', h: 1.5 },
  tvStand: { file: 'modern_wooden_cabinet.glb', w: 1.8 },
  clock: { file: 'wall_clock.glb', w: 0.36 },
  painting: { file: 'fancy_picture_frame_01.glb', w: 0.9 },
  ottoman: { file: 'Ottoman_01.glb', w: 0.6 },
  sideTable: { file: 'side_table_tall_01.glb', h: 0.7 },
} as const;
export type RealName = keyof typeof LIB;

const loaded = new Map<RealName, { obj: THREE.Object3D; size: THREE.Vector3 }>();
let loading: Promise<void> | null = null;

/** Plain float attributes (the files are meshopt-quantized) so interiors can merge them. */
function dequantize(g: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array as ArrayLike<number>), 1));
  return out;
}

export function loadFurnitureModels(): Promise<void> {
  loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const base = (import.meta.env.BASE_URL ?? '/') + 'assets/furniture/';
    await Promise.allSettled((Object.keys(LIB) as RealName[]).map(async (name) => {
      const g = await loader.loadAsync(base + LIB[name].file);
      g.scene.updateMatrixWorld(true);
      // bake every mesh into the model's space, sitting on the floor, centred
      const root = new THREE.Group();
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geo = dequantize(m.geometry);
        geo.applyMatrix4(m.matrixWorld);
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
        for (const mm of mats) { mm.envMapIntensity = 0.8; if (mm.map) mm.map.anisotropy = 4; }
        const mesh = new THREE.Mesh(geo, mats[0]);
        mesh.castShadow = true; mesh.receiveShadow = true;
        root.add(mesh);
      });
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      for (const ch of root.children) (ch as THREE.Mesh).geometry.translate(-c.x, -box.min.y, -c.z);
      loaded.set(name, { obj: root, size: box.getSize(new THREE.Vector3()) });
    }));
  })();
  return loading;
}

/**
 * A clone of a real model sized by one dimension (uniform scale) or, when
 * several are given, stretched to fit them (tables, desks). Null if not loaded.
 */
export function real(name: RealName, fit: { w?: number; h?: number; d?: number } = {}): THREE.Group | null {
  const m = loaded.get(name);
  if (!m) return null;
  const def = LIB[name] as { w?: number; h?: number };
  const want = { w: fit.w, h: fit.h, d: fit.d };
  if (want.w === undefined && want.h === undefined && want.d === undefined) { want.w = def.w; want.h = def.h; }
  const k = (v: number | undefined, s: number) => (v === undefined ? undefined : v / Math.max(1e-3, s));
  const kx = k(want.w, m.size.x), ky = k(want.h, m.size.y), kz = k(want.d, m.size.z);
  const u = kx ?? ky ?? kz ?? 1;
  const g = new THREE.Group();
  const inner = m.obj.clone();
  inner.scale.set(kx ?? u, ky ?? u, kz ?? u);
  g.add(inner);
  g.userData.real = name;
  return g;
}
