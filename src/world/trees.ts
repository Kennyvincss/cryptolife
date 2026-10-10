// Realistic street and park trees: procedurally grown with ez-tree (bark and
// leaf textures from the vendored package), then drawn as instanced meshes
// with PBR materials, wind sway and canopy-shaped leaf normals.

import * as THREE from 'three';
import { Tree } from '../vendor/ez-tree/index.js';

export interface TreeSpot { x: number; y: number; z: number; s: number; kind?: 'street' | 'park' | 'bush' }

interface Variant { branches: THREE.BufferGeometry; leaves: THREE.BufferGeometry; bark: THREE.Material; leaf: THREE.Material; park: boolean }

const VARIANTS: { preset: string; seed: number; height: number; leafScale: number; park: boolean; bush?: boolean; tint?: string }[] = [
  { preset: 'Oak Medium', seed: 1234, height: 9, leafScale: 0.75, park: false, tint: '#7fa05a' },
  { preset: 'Ash Medium', seed: 77, height: 9.5, leafScale: 0.75, park: false, tint: '#8aa864' },
  { preset: 'Aspen Medium', seed: 9, height: 11, leafScale: 0.8, park: false, tint: '#93b06a' },
  { preset: 'Oak Medium', seed: 4321, height: 12.5, leafScale: 0.85, park: true, tint: '#76984f' },
  { preset: 'Ash Medium', seed: 31, height: 12, leafScale: 0.85, park: true, tint: '#86a35c' },
  { preset: 'Bush 1', seed: 5, height: 1.5, leafScale: 1.6, park: false, bush: true, tint: '#5e8a3e' },
  { preset: 'Bush 2', seed: 8, height: 1.3, leafScale: 1.6, park: false, bush: true, tint: '#6a9446' },
];

const windU = { uTime: { value: 0 } };

function grow(v: typeof VARIANTS[number], far = false): Variant {
  const t = new Tree();
  t.loadPreset(v.preset);
  t.options.seed = v.seed;
  // game-ready budget: fewer, slimmer branch rings and fewer but larger leaves
  const o = t.options;
  o.leaves.count = Math.round(o.leaves.count * v.leafScale * (far ? 0.45 : 0.9));
  o.leaves.size *= far ? 1.75 : 1.25;
  if (far) { o.branch.levels = Math.max(1, o.branch.levels - 1); if (o.leaves.billboard) o.leaves.billboard = 'single'; }
  for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * (k === '0' ? (far ? 0.6 : 0.85) : far ? 0.4 : 0.6)));
  for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(1, Math.round(o.branch.sections[k] * (k === '0' ? 0.8 : 0.6)));
  t.generate();
  const box = new THREE.Box3().setFromObject(t);
  const k = v.height / Math.max(0.1, box.max.y - box.min.y);
  const m = new THREE.Matrix4().makeScale(k, k, k).premultiply(new THREE.Matrix4().makeTranslation(0, -box.min.y * k, 0));
  const branches = t.branchesMesh.geometry.clone().applyMatrix4(m);
  const leaves = t.leavesMesh.geometry.clone().applyMatrix4(m);
  // canopy-shaped normals: light the crown as a soft volume instead of flat cards
  leaves.computeBoundingBox();
  const c = leaves.boundingBox!.getCenter(new THREE.Vector3());
  c.y -= (leaves.boundingBox!.max.y - leaves.boundingBox!.min.y) * 0.15;
  const p = leaves.attributes.position as THREE.BufferAttribute, n = leaves.attributes.normal as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i).sub(c).normalize();
    b.fromBufferAttribute(n, i);
    a.multiplyScalar(0.8).addScaledVector(b, 0.2).normalize();
    n.setXYZ(i, a.x, a.y, a.z);
  }
  const src = t.branchesMesh.material as THREE.MeshPhongMaterial;
  const bark = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, roughnessMap: (src as unknown as { roughnessMap: THREE.Texture | null }).roughnessMap ?? null, aoMap: src.aoMap, color: src.color, roughness: 0.95 });
  const lsrc = t.leavesMesh.material as THREE.MeshPhongMaterial;
  const leaf = new THREE.MeshStandardMaterial({ map: lsrc.map, color: v.tint ? new THREE.Color(v.tint) : lsrc.color.clone().multiplyScalar(0.9), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.78 });
  leaf.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, windU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          #else
          vec3 ip = vec3(0.0);
          #endif
          float ph = ip.x * 0.37 + ip.z * 0.21;
          float sway = transformed.y * 0.012;
          transformed.x += sin(uTime * 1.1 + ph + transformed.y * 0.2) * sway;
          transformed.z += cos(uTime * 0.9 + ph * 1.3 + transformed.x * 0.3) * sway * 0.7;
          transformed += normal * sin(uTime * 4.0 + dot(transformed, vec3(3.1, 2.3, 1.7))) * 0.02;
        }`);
    // fake light transmission: sunlit leaves glow slightly when seen against the light
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.06;`);
  };
  leaf.customProgramCacheKey = () => 'eztree_leaf';
  if (far) { bark.map = src.map; }
  t.branchesMesh.geometry.dispose(); t.leavesMesh.geometry.dispose();
  return { branches, leaves, bark, leaf, park: v.park };
}

export class Forest {
  group = new THREE.Group();
  private chunks: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; c: THREE.Vector3 }[] = [];
  /** Trees closer than this (chunk centre distance) use the detailed model. */
  nearDist = 85;

  /** Grows the tree variants (near + far LOD) and instances them over `spots` in culling chunks. */
  build(spots: TreeSpot[], opts: { shadows: boolean; low: boolean }) {
    const list = opts.low ? VARIANTS.filter((v, i) => i < 2 || v.bush) : VARIANTS;
    const near = list.map((v) => grow(v)), far = list.map((v) => grow(v, true));
    const streetIdx = list.map((v, i) => (v.park || v.bush ? -1 : i)).filter((i) => i >= 0);
    const parkIdx = list.map((v, i) => (v.park ? i : -1)).filter((i) => i >= 0);
    const bushIdx = list.map((v, i) => (v.bush ? i : -1)).filter((i) => i >= 0);
    const CH = 80;
    const buckets = new Map<string, { vi: number; m: THREE.Matrix4[]; c: THREE.Vector3 }>();
    let i = 0;
    for (const s of spots) {
      const pool = s.kind === 'bush' ? bushIdx : s.kind === 'park' && parkIdx.length ? parkIdx : streetIdx;
      const vi = pool[(i++ * 7 + Math.floor(Math.abs(s.x * 13 + s.z * 7))) % pool.length];
      const cx = Math.floor(s.x / CH), cz = Math.floor(s.z / CH);
      const key = `${cx},${cz},${vi}`;
      let b = buckets.get(key);
      if (!b) { b = { vi, m: [], c: new THREE.Vector3((cx + 0.5) * CH, 0, (cz + 0.5) * CH) }; buckets.set(key, b); }
      const rot = (Math.sin(s.x * 12.9 + s.z * 78.2) * 43758.5) % (Math.PI * 2);
      const sc = s.s * (0.85 + ((Math.abs(Math.sin(s.x * 3.1 + s.z)) * 1000) % 1) * 0.3);
      b.m.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(sc, sc, sc)));
    }
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4[], shadow: boolean) => {
      const im = new THREE.InstancedMesh(geo, mat, m.length);
      m.forEach((mx, k) => im.setMatrixAt(k, mx));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = shadow;
      im.receiveShadow = true;
      this.group.add(im);
      return im;
    };
    for (const b of buckets.values()) {
      const n = near[b.vi], f = far[b.vi];
      this.chunks.push({
        c: b.c,
        near: [inst(n.branches, n.bark, b.m, opts.shadows), inst(n.leaves, n.leaf, b.m, opts.shadows)],
        far: [inst(f.branches, f.bark, b.m, false), inst(f.leaves, f.leaf, b.m, opts.shadows)],
      });
    }
  }

  /** Wind animation, LOD selection and distance culling per chunk. */
  update(t: number, cam?: THREE.Vector3, maxDist = 380) {
    windU.uTime.value = t;
    if (!cam) return;
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.c.x - cam.x, ch.c.z - cam.z);
      const isNear = d < this.nearDist, show = d < maxDist + 60;
      for (const m of ch.near) m.visible = show && isNear;
      for (const m of ch.far) m.visible = show && !isNear;
    }
  }
}

let houseplant: Variant | null = null;
/** A small real shrub (ez-tree) for potted indoor plants; grown once and shared. */
export function houseplantParts() {
  houseplant ??= grow({ preset: 'Bush 1', seed: 12, height: 0.95, leafScale: 1.5, park: false, bush: true, tint: '#5c9440' });
  return houseplant;
}
