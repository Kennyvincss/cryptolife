// Geometry helpers: a batcher that merges static meshes by material (to keep
// draw calls low) and a cached material factory.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const matCache = new Map<string, THREE.Material>();

export interface MatOpts {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  envMapIntensity?: number;
  physical?: boolean;
  clearcoat?: number;
  normalMap?: THREE.Texture | null;
  depthWrite?: boolean;
}

export function mat(key: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  const params: THREE.MeshPhysicalMaterialParameters = {
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    roughness: o.roughness ?? 0.8,
    metalness: o.metalness ?? 0,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    emissiveMap: o.emissiveMap ?? null,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    envMapIntensity: o.envMapIntensity ?? 1,
    normalMap: o.normalMap ?? null,
    depthWrite: o.depthWrite ?? true,
  };
  if (o.physical) {
    m = new THREE.MeshPhysicalMaterial({ ...params, clearcoat: o.clearcoat ?? 1, clearcoatRoughness: 0.08 });
  } else {
    m = new THREE.MeshStandardMaterial(params);
  }
  matCache.set(key, m);
  return m;
}

export function colorMat(hex: string, roughness = 0.8, metalness = 0) {
  return mat(`c_${hex}_${roughness}_${metalness}`, { color: hex, roughness, metalness });
}
export function glowMat(hex: string, intensity = 2) {
  return mat(`glow_${hex}_${intensity}`, { color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4 });
}

export class Batcher {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private tmp = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, material: THREE.Material, pos?: THREE.Vector3Like, rotY = 0, scale?: THREE.Vector3Like, rot?: THREE.Euler) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aFacade'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    const q = new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler(0, rotY, 0));
    this.tmp.compose(
      new THREE.Vector3(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0),
      q,
      new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1),
    );
    g.applyMatrix4(this.tmp);
    let arr = this.buckets.get(material);
    if (!arr) { arr = []; this.buckets.set(material, arr); }
    arr.push(g);
    return g;
  }

  /** Add an existing mesh hierarchy (with world transforms relative to `root`). */
  addObject(obj: THREE.Object3D, offset?: THREE.Matrix4) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aFacade'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const mw = m.matrixWorld.clone();
      if (offset) mw.premultiply(offset);
      g.applyMatrix4(mw);
      const material = Array.isArray(m.material) ? m.material[0] : m.material;
      let arr = this.buckets.get(material);
      if (!arr) { arr = []; this.buckets.set(material, arr); }
      arr.push(g);
    });
  }

  flush(parent: THREE.Object3D, opts: { cast?: boolean; receive?: boolean; noShadow?: Set<THREE.Material> } = {}) {
    const out: THREE.Mesh[] = [];
    for (const [m, geos] of this.buckets) {
      // merge in chunks to keep individual buffers reasonable and allow frustum culling
      const CH = 400;
      for (let i = 0; i < geos.length; i += CH) {
        const merged = mergeGeometries(geos.slice(i, i + CH), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, m);
        const ns = opts.noShadow?.has(m) || (m as THREE.MeshStandardMaterial).transparent;
        mesh.castShadow = !ns && (opts.cast ?? true);
        mesh.receiveShadow = opts.receive ?? true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
        out.push(mesh);
      }
      for (const g of geos) g.dispose();
    }
    this.buckets.clear();
    return out;
  }
}

/** Box geometry with UVs scaled to world meters / tile size (so textures tile correctly when merged). */
export function tiledBox(w: number, h: number, d: number, tileW: number, tileH: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let sx: number, sy: number;
    if (ny > 0.5) { sx = w / tileW; sy = d / tileW; }
    else if (nx > 0.5) { sx = d / tileW; sy = h / tileH; }
    else { sx = w / tileW; sy = h / tileH; }
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  return g;
}

export function planeUV(w: number, h: number, tile: number, tileH = tile) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tileH);
  return g;
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 3) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const bev = Math.min(r * 0.6, d / 3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: seg, curveSegments: seg });
  g.translate(0, 0, -(d - bev * 2) / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Merge the static meshes under `root` (skipping subtrees in `stops`) into one
 * mesh per material, expressed in root-local space. Cuts draw calls for
 * multi-part props like vehicles.
 */
export function mergeStatic(root: THREE.Object3D, stops: Set<THREE.Object3D> = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const remove: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (stops.has(c)) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aFacade'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        let arr = buckets.get(m.material);
        if (!arr) { arr = []; buckets.set(m.material, arr); }
        arr.push(g);
        remove.push(m);
      }
      visit(c);
    }
  };
  visit(root);
  for (const m of remove) m.removeFromParent();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}
