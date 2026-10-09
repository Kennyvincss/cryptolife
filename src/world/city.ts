// Builds the exterior of Crypto City from the shared deterministic layout.

import * as THREE from 'three';
import {
  BLOCK, BLOCK_DISTRICT, COLS, DISTRICTS, FEATURES, ROAD, ROAD_X, ROAD_Z, ROWS, SIDEWALK,
  blockOrigin, featureGeom, type DistrictId, type Feature, type Style,
} from '../../shared/city.js';
import { Batcher, colorMat, glowMat, mat, planeUV, tiledBox } from '../engine/build.js';
import {
  FACADE_TILE, artTexture, asphalt, crosswalk, dirt, dynamicCanvas, facade, grass, rng, roadMarkings, sidewalk, signTexture,
  type FacadeStyle,
} from '../engine/textures.js';
import { buildVehicle } from '../entities/vehicle.js';
import { Colliders } from './colliders.js';
import { buildOcean, type Ocean } from './water.js';
import { boxWalls, facadeMaterial, type FacadeKind } from './facade.js';
import { surfaceMaterial, wearPaint } from './pbr.js';
import type { TreeSpot } from './trees.js';

export const CURB_H = 0.15;

export interface DoorInfo { zone: string; name: string; pos: THREE.Vector3; facing: number; feature: Feature }
export interface Bench { pos: THREE.Vector3; rot: number }

export interface CityBuild {
  group: THREE.Group;
  colliders: Colliders;
  doors: DoorInfo[];
  lamps: THREE.Vector3[];
  benches: Bench[];
  nightMats: { m: THREE.MeshStandardMaterial; base: number; night: number }[];
  signals: { ns: Record<'r' | 'y' | 'g', THREE.MeshStandardMaterial>; ew: Record<'r' | 'y' | 'g', THREE.MeshStandardMaterial> };
  screens: { draw: (prices: Record<string, number>, open: Record<string, number>, t: number) => void }[];
  groundAt: (x: number, z: number) => number;
  ocean: Ocean;
  trees: TreeSpot[];
  /** Places the parked cars (call after the car model loads). */
  populateParked: () => void;
  footprints: { x: number; z: number; w: number; d: number; h: number; district: DistrictId; feature?: string }[];
}

const DISTRICT_STYLE: Record<DistrictId, FacadeStyle[]> = {
  trading: ['glass', 'glass', 'concrete', 'marble'],
  builder: ['brick', 'glass', 'industrial', 'concrete'],
  defi: ['glass', 'neon', 'glass', 'concrete'],
  social: ['brick', 'neon', 'marble', 'residential'],
  creator: ['neon', 'concrete', 'industrial', 'brick'],
  residential: ['residential', 'brick', 'residential', 'concrete'],
  automotive: ['industrial', 'concrete', 'industrial'],
  convention: ['glass', 'concrete'],
  park: ['concrete'],
};
const DISTRICT_H: Record<DistrictId, [number, number]> = {
  trading: [45, 150], builder: [20, 85], defi: [28, 80], social: [9, 28], creator: [14, 48], residential: [12, 42], automotive: [6, 14], convention: [10, 24], park: [0, 0],
};

export function buildCity(lowQuality = false): CityBuild {
  const group = new THREE.Group();
  group.name = 'city';
  const colliders = new Colliders();
  const B = new Batcher();
  const nightMats: CityBuild['nightMats'] = [];
  const doors: DoorInfo[] = [];
  const lamps: THREE.Vector3[] = [];
  const benches: Bench[] = [];
  const screens: CityBuild['screens'] = [];
  const footprints: CityBuild['footprints'] = [];
  const R = rng(1234);
  const trees: TreeSpot[] = [];
  const parked: { model: string; color: string; x: number; z: number; rot: number }[] = [];
  const pitM = mat('treepit', { color: '#3a2c22', roughness: 1 });
  const pitEdge = mat('pitedge', { color: '#2b2d30', roughness: 0.5, metalness: 0.6 });
  const KINDS: Record<FacadeStyle, FacadeKind[]> = {
    glass: ['curtain', 'curtain', 'office'], concrete: ['office', 'stone', 'office'], brick: ['brick', 'brick', 'industrial'], marble: ['stone'],
    neon: ['dark', 'office'], industrial: ['industrial', 'brick'], residential: ['plaster', 'brick', 'plaster'], villa: ['plaster'],
  };
  let bseed = 1;
  type Side = 'n' | 's' | 'e' | 'w';


  const facadeMats = new Map<string, THREE.MeshStandardMaterial>();
  function facadeMat(style: FacadeStyle, seed: number) {
    const key = style + seed;
    let m = facadeMats.get(key);
    if (m) return m;
    const f = facade(style, seed);
    const glass = style === 'glass';
    m = new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.0,
      roughness: glass ? 0.12 : style === 'marble' ? 0.45 : 0.85, metalness: glass ? 0.65 : 0.05, envMapIntensity: glass ? 1.3 : 0.6,
    });
    nightMats.push({ m, base: 0.0, night: 1.15 });
    facadeMats.set(key, m);
    return m;
  }
  const roofM = surfaceMaterial('roof', { tile: 6, mode: 'ground', macro: 0.35 });
  const roofTrim = surfaceMaterial('concrete', { tile: 3, mode: 'wall', color: '#c9c4ba', macro: 0.2 });
  const parapetM = surfaceMaterial('concrete', { tile: 3, mode: 'wall', color: '#a8a39a', macro: 0.3 });
  const stoneTrim = surfaceMaterial('stone', { tile: 3, mode: 'wall', macro: 0.15 });
  const hvacM = mat('hvac', { color: '#a9adb1', roughness: 0.45, metalness: 0.6 });
  const hvacDark = mat('hvacdark', { color: '#3c4044', roughness: 0.5, metalness: 0.5 });
  const ventM = mat('vent', { color: '#202224', roughness: 0.7, metalness: 0.3 });

  // ---------------- ground ----------------
  const minX = ROAD_X[0] - ROAD / 2, maxX = ROAD_X[ROAD_X.length - 1] + ROAD / 2;
  const minZ = ROAD_Z[0] - ROAD / 2, maxZ = ROAD_Z[ROAD_Z.length - 1] + ROAD / 2;
  const asph = asphalt().clone();
  asph.repeat.set((maxX - minX) / 10, (maxZ - minZ) / 10);
  asph.needsUpdate = true;
  void asph;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), surfaceMaterial('asphalt', { tile: 5, mode: 'ground', macro: 0.45, wet: true, normalScale: 1.2 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  road.receiveShadow = true;
  group.add(road);

  const gr = grass().clone();
  gr.repeat.set(160, 160); gr.needsUpdate = true;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1200 + maxZ), new THREE.MeshStandardMaterial({ map: gr, roughness: 1, color: 0x9aa890, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(0, -0.12, (maxZ - 1200) / 2); // well below the road: phones have little depth precision far out
  outer.receiveShadow = true;
  group.add(outer);

  // markings
  const markM = wearPaint(new THREE.MeshStandardMaterial({ map: roadMarkings(), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const crossM = wearPaint(new THREE.MeshStandardMaterial({ map: crosswalk(), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 0.7);
  for (const rx of ROAD_X) for (let j = 0; j < ROWS; j++) {
    const z0 = ROAD_Z[j] + ROAD / 2, z1 = ROAD_Z[j + 1] - ROAD / 2;
    const g = planeUV(ROAD, z1 - z0, ROAD, ROAD);
    B.add(g, markM, { x: rx, y: 0.01, z: (z0 + z1) / 2 }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, 0));
    for (const [zz, flip] of [[z0 + 1.6, 0], [z1 - 1.6, 1]] as const) B.add(new THREE.PlaneGeometry(ROAD, 3), crossM, { x: rx, y: 0.012, z: zz }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, flip * Math.PI));
  }
  for (const rz of ROAD_Z) for (let i = 0; i < COLS; i++) {
    const x0 = ROAD_X[i] + ROAD / 2, x1 = ROAD_X[i + 1] - ROAD / 2;
    const g = planeUV(ROAD, x1 - x0, ROAD, ROAD);
    B.add(g, markM, { x: (x0 + x1) / 2, y: 0.01, z: rz }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
    for (const xx of [x0 + 1.6, x1 - 1.6]) B.add(new THREE.PlaneGeometry(ROAD, 3), crossM, { x: xx, y: 0.012, z: rz }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
  }

  // ---------------- blocks ----------------
  const swM = surfaceMaterial('sidewalk', { tile: 3, mode: 'wall', macro: 0.3, wet: true });
  const curbM = surfaceMaterial('concrete', { tile: 2, mode: 'wall', color: '#d6d2c8', macro: 0.2 });
  const grassM = surfaceMaterial('grass', { tile: 3, mode: 'ground', macro: 0.5 });
  void sidewalk; void grass;
  const lampBulb = mat('lampbulb', { color: '#fff3d6', emissive: '#ffd9a0', emissiveIntensity: 0.2, roughness: 0.3 });
  nightMats.push({ m: lampBulb, base: 0.2, night: 6 });
  const featureOf = new Map<string, Feature[]>();
  for (const f of FEATURES) { const k = f.block.join(','); featureOf.set(k, [...(featureOf.get(k) ?? []), f]); }

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const [bx, bz] = blockOrigin(c, r);
    const district = BLOCK_DISTRICT[r][c];
    const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
    B.add(tiledBox(BLOCK, CURB_H, BLOCK, 4, 4), swM, { x: cx, y: CURB_H / 2, z: cz });
    // curb strip
    for (const [x, z, w, d] of [[cx, bz + 0.15, BLOCK, 0.3], [cx, bz + BLOCK - 0.15, BLOCK, 0.3], [bx + 0.15, cz, 0.3, BLOCK], [bx + BLOCK - 0.15, cz, 0.3, BLOCK]]) {
      B.add(new THREE.BoxGeometry(w, CURB_H + 0.01, d), curbM, { x, y: CURB_H / 2 + 0.003, z });
    }
    if (district === 'park') { buildPark(bx, bz); continue; }

    const feats = featureOf.get(c + ',' + r) ?? [];
    const occupied: { x0: number; x1: number; z0: number; z1: number }[] = [];
    for (const f of feats) {
      const g = featureGeom(f);
      occupied.push({ x0: g.cx - g.sx / 2 - 1.5, x1: g.cx + g.sx / 2 + 1.5, z0: g.cz - g.sz / 2 - 1.5, z1: g.cz + g.sz / 2 + 1.5 });
      buildFeature(f, district);
    }
    // filler buildings on a 3x3 grid of cells
    const cells = 3;
    const cw = (BLOCK - SIDEWALK * 2) / cells;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const isCenter = i === 1 && j === 1;
      const x0 = bx + SIDEWALK + i * cw, z0 = bz + SIDEWALK + j * cw;
      const w = cw - 2 - R() * 4, d = cw - 2 - R() * 4;
      // keep the street side flush with the sidewalk
      const px = i === 0 ? x0 + w / 2 : i === 2 ? x0 + cw - w / 2 : x0 + cw / 2;
      const pz = j === 0 ? z0 + d / 2 : j === 2 ? z0 + cw - d / 2 : z0 + cw / 2;
      const rect = { x0: px - w / 2, x1: px + w / 2, z0: pz - d / 2, z1: pz + d / 2 };
      if (occupied.some((o) => rect.x0 < o.x1 && rect.x1 > o.x0 && rect.z0 < o.z1 && rect.z1 > o.z0)) continue;
      if (isCenter && R() < 0.35 && district !== 'trading') { buildPlaza(px, pz, w, d); continue; }
      const [hmin, hmax] = DISTRICT_H[district];
      let h = hmin + Math.pow(R(), 1.6) * (hmax - hmin);
      if (isCenter) h *= 1.15;
      const styles = DISTRICT_STYLE[district];
      const style = styles[Math.floor(R() * styles.length)];
      const street: Side[] = [];
      if (i === 0) street.push('w'); if (i === 2) street.push('e'); if (j === 0) street.push('n'); if (j === 2) street.push('s');
      buildTower(px, pz, w, d, Math.max(h, 9), style, Math.floor(R() * 4), district, undefined, street);
    }
    // sidewalk props around the block
    propsAround(bx, bz, district);
  }

  // ---------------- building helpers ----------------
  /** One rectangular mass with facade walls, cornice, parapet and roof. Returns the roof level. */
  function mass(x: number, z: number, w: number, d: number, y0: number, y1: number, kind: FacadeKind, seed: number, o: { shopSides?: Side[]; plainGround?: boolean; base?: number } = {}) {
    const fm = facadeMaterial(kind, lowQuality);
    const base = o.base ?? y0;
    for (const g of boxWalls(x, z, w, d, y0, y1, base, { seed, shop: !!o.shopSides?.length, shopSides: o.shopSides, plainGround: o.plainGround })) B.add(g, fm);
    // cornice / cap
    const trim = kind === 'curtain' || kind === 'dark' ? hvacDark : kind === 'stone' || kind === 'brick' ? stoneTrim : roofTrim;
    const over = kind === 'curtain' ? 0.12 : kind === 'brick' || kind === 'stone' ? 0.45 : 0.25;
    B.add(new THREE.BoxGeometry(w + over * 2, kind === 'curtain' ? 0.35 : 0.55, d + over * 2), trim, { x, y: y1 - 0.2, z });
    if (kind === 'stone' || kind === 'brick') B.add(new THREE.BoxGeometry(w + 0.16, 0.28, d + 0.16), trim, { x, y: y1 - 0.9, z });
    // parapet: roof sits 1 m below the top, with inner walls
    const roofY = y1 - 1.0, t = 0.3;
    B.add(new THREE.PlaneGeometry(w - t * 2, d - t * 2), roofM, { x, y: roofY, z }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, 0));
    for (const [px, pz, pw, pd] of [[x, z - d / 2 + t / 2, w, t], [x, z + d / 2 - t / 2, w, t], [x - w / 2 + t / 2, z, t, d], [x + w / 2 - t / 2, z, t, d]]) {
      B.add(new THREE.BoxGeometry(pw - 0.02, 1.0, pd - 0.02), parapetM, { x: px, y: roofY + 0.5, z: pz });
    }
    return roofY;
  }

  /** Window-unit air conditioners and balconies aligned with the shader's window grid. */
  function facadeClutter(x: number, z: number, w: number, d: number, y1: number, kind: FacadeKind, seed: number) {
    const spec = { brick: [2.8, 3.2, 0.42, 0.3], plaster: [3.0, 3.1, 0.44, 0.3], industrial: [4.2, 4.6, 0.66, 0.35] } as Record<string, number[]>;
    const sp = spec[kind];
    if (!sp) return;
    const [bay, fh, ww, sill] = sp;
    const r = rng(seed * 7 + 3);
    const faces: [number, number, [number, number], number][] = [[x, z + d / 2, [0, 1], w], [x, z - d / 2, [0, -1], w], [x + w / 2, z, [1, 0], d], [x - w / 2, z, [-1, 0], d]];
    const acM = mat('acunit', { color: '#d9dad6', roughness: 0.5, metalness: 0.3 });
    const balM = surfaceMaterial('concrete', { tile: 2, mode: 'wall', color: '#e4e0d8', macro: 0.1 });
    const railM = mat('rail_dark', { color: '#26282b', roughness: 0.4, metalness: 0.7 });
    for (const [cx, cz, n, fw] of faces) {
      const tdir = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(n[0], 0, n[1]));
      const bays = Math.max(1, Math.floor((fw - 1.2) / bay));
      const margin = (fw - bays * bay) / 2;
      const floors = Math.floor((y1 - CURB_H - 4.4 - 1.3) / fh);
      const balconies = kind === 'plaster' && r() < 0.55;
      for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
        const u = -fw / 2 + margin + (b + 0.5) * bay;
        const px = cx + tdir.x * u, pz = cz + tdir.z * u;
        const winBottom = CURB_H + 4.4 + f * fh + sill * fh;
        const rot = Math.atan2(n[0], n[1]);
        if (balconies && b % 2 === 0 && f % 1 === 0) {
          const bw = bay * 0.9;
          B.add(new THREE.BoxGeometry(bw, 0.16, 1.3), balM, { x: px + n[0] * 0.65, y: CURB_H + 4.4 + f * fh, z: pz + n[1] * 0.65 }, rot);
          B.add(new THREE.BoxGeometry(bw, 0.05, 0.05), railM, { x: px + n[0] * 1.28, y: CURB_H + 4.4 + f * fh + 1.0, z: pz + n[1] * 1.28 }, rot);
          for (let k = -4; k <= 4; k++) B.add(new THREE.BoxGeometry(0.03, 1.0, 0.03), railM, { x: px + n[0] * 1.28 + tdir.x * k * bw / 9, y: CURB_H + 4.4 + f * fh + 0.5, z: pz + n[1] * 1.28 + tdir.z * k * bw / 9 });
        } else if (r() < 0.14) {
          B.add(new THREE.BoxGeometry(0.62, 0.42, 0.5), acM, { x: px + n[0] * 0.25, y: winBottom - 0.3, z: pz + n[1] * 0.25 }, rot);
          B.add(new THREE.BoxGeometry(0.5, 0.3, 0.02), ventM, { x: px + n[0] * 0.51, y: winBottom - 0.3, z: pz + n[1] * 0.51 }, rot);
        }
      }
    }
  }

  function rooftop(x: number, z: number, w: number, d: number, roofY: number, kind: FacadeKind, h: number) {
    const n = 1 + Math.floor(R() * Math.min(5, w * d / 120));
    for (let i = 0; i < n; i++) {
      const ax = x + (R() - 0.5) * (w - 4), az = z + (R() - 0.5) * (d - 4);
      const big = R() < 0.4;
      const sx = big ? 3.2 : 1.6, sy = big ? 1.6 : 1.1, sz = big ? 2.2 : 1.2;
      B.add(new THREE.BoxGeometry(sx, sy, sz), hvacM, { x: ax, y: roofY + sy / 2 + 0.15, z: az });
      B.add(new THREE.BoxGeometry(sx + 0.2, 0.15, sz + 0.2), hvacDark, { x: ax, y: roofY + 0.075, z: az });
      if (big) for (const o of [-0.7, 0.7]) B.add(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 16), ventM, { x: ax + o, y: roofY + sy + 0.2, z: az });
      else B.add(new THREE.BoxGeometry(sx * 0.8, sy * 0.6, 0.02), ventM, { x: ax, y: roofY + sy / 2 + 0.15, z: az + sz / 2 + 0.01 });
    }
    // stair / lift bulkhead
    if (w > 10 && d > 10) {
      const bx = x + (R() - 0.5) * (w - 8), bz = z + (R() - 0.5) * (d - 8);
      B.add(new THREE.BoxGeometry(3.4, 3, 4), parapetM, { x: bx, y: roofY + 1.5, z: bz });
      B.add(new THREE.BoxGeometry(3.7, 0.25, 4.3), roofTrim, { x: bx, y: roofY + 3.1, z: bz });
    }
    if ((kind === 'brick' || kind === 'plaster') && R() < 0.45) {
      // classic timber water tank on a steel stand
      const tx = x + w * 0.2, tz = z - d * 0.2;
      B.add(new THREE.CylinderGeometry(1.5, 1.6, 3.0, 16), mat('tankwood', { color: '#5b4330', roughness: 0.95 }), { x: tx, y: roofY + 3.6, z: tz });
      B.add(new THREE.ConeGeometry(1.7, 0.9, 16), mat('tankroof', { color: '#3a3532', roughness: 0.8 }), { x: tx, y: roofY + 5.55, z: tz });
      for (let k = 0; k < 3; k++) B.add(new THREE.TorusGeometry(1.58, 0.03, 4, 24), mat('steel', { color: '#444', metalness: 0.6, roughness: 0.5 }), { x: tx, y: roofY + 2.6 + k, z: tz }, 0, undefined, new THREE.Euler(Math.PI / 2, 0, 0));
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 6), mat('steel', { color: '#444', metalness: 0.6, roughness: 0.5 }), { x: tx + ox, y: roofY + 1.05, z: tz + oz });
    }
    if (h > 60) {
      B.add(new THREE.CylinderGeometry(0.12, 0.22, 12, 6), mat('antenna', { color: '#b8bcc2', metalness: 0.8, roughness: 0.3 }), { x: x + w * 0.25, y: roofY + 6, z: z + d * 0.25 });
      B.add(new THREE.SphereGeometry(0.3, 8, 6), glowMat('#ff2020', 4), { x: x + w * 0.25, y: roofY + 12.2, z: z + d * 0.25 });
      if (R() < 0.5) B.add(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20), mat('dish', { color: '#e6e6e2', roughness: 0.4, metalness: 0.2 }), { x: x - w * 0.25, y: roofY + 1.2, z: z - d * 0.2 }, 0, undefined, new THREE.Euler(0.9, 0.4, 0));
    }
  }

  function buildTower(x: number, z: number, w: number, d: number, h: number, style: FacadeStyle, seed: number, district: DistrictId, featureZone?: string, street: Side[] = []) {
    const kinds = KINDS[style];
    const kind = kinds[seed % kinds.length];
    const id = bseed++;
    const lively = ['social', 'creator', 'builder', 'trading', 'defi', 'residential'].includes(district);
    const shopSides = !featureZone && lively ? street : [];
    // podium + setback tiers for tall towers
    const tall = h > 50 && (kind === 'curtain' || kind === 'office' || kind === 'stone');
    let top: number;
    if (tall && R() < 0.65) {
      const podH = CURB_H + 4.4 + (kind === 'curtain' ? 3.8 : 3.6) * (2 + Math.floor(R() * 3));
      mass(x, z, w, d, CURB_H, podH, kind === 'curtain' ? 'office' : kind, id, { shopSides });
      const w2 = w * (0.72 + R() * 0.12), d2 = d * (0.72 + R() * 0.12);
      if (R() < 0.5) {
        const mid = podH + (h - podH) * 0.68;
        mass(x, z, w2, d2, podH - 1, mid, kind, id + 1, { plainGround: true, base: CURB_H });
        top = mass(x, z, w2 * 0.8, d2 * 0.8, mid - 1, h, kind, id + 2, { plainGround: true, base: CURB_H });
        rooftop(x, z, w2 * 0.8, d2 * 0.8, top, kind, h);
        w = w2 * 0.8; d = d2 * 0.8;
      } else {
        top = mass(x, z, w2, d2, podH - 1, h, kind, id + 1, { plainGround: true, base: CURB_H });
        rooftop(x, z, w2, d2, top, kind, h);
      }
    } else {
      top = mass(x, z, w, d, CURB_H, h, kind, id, { shopSides });
      rooftop(x, z, w, d, top, kind, h);
      facadeClutter(x, z, w, d, h, kind, id);
      // fire escape on brick walk-ups
      if (kind === 'brick' && h < 40 && street.length) fireEscape(x, z, w, d, h, street[0], id);
    }
    if (shopSides.length) awnings(x, z, w, d, shopSides, district);
    colliders.addBox(x, z, w, d, 'building', h);
    footprints.push({ x, z, w, d, h, district, feature: featureZone });
    return top;
  }

  function fireEscape(x: number, z: number, w: number, d: number, h: number, side: Side, seed: number) {
    const n = side === 'n' ? [0, -1] : side === 's' ? [0, 1] : side === 'e' ? [1, 0] : [-1, 0];
    const len = side === 'n' || side === 's' ? w : d;
    const tdir = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(n[0], 0, n[1]));
    const cx = x + n[0] * (w / 2), cz = z + n[1] * (d / 2);
    const off = ((seed % 3) - 1) * len * 0.2;
    const iron = mat('fireescape', { color: '#1b1c1e', roughness: 0.6, metalness: 0.7 });
    const rot = Math.atan2(n[0], n[1]);
    for (let y = CURB_H + 4.4 + 3.2; y < h - 2; y += 3.2) {
      const p = { x: cx + n[0] * 0.75 + tdir.x * off, z: cz + n[1] * 0.75 + tdir.z * off };
      B.add(new THREE.BoxGeometry(3.2, 0.06, 1.4), iron, { x: p.x, y, z: p.z }, rot);
      B.add(new THREE.BoxGeometry(3.2, 0.04, 0.04), iron, { x: p.x + n[0] * 0.68, y: y + 0.95, z: p.z + n[1] * 0.68 }, rot);
      for (let k = -4; k <= 4; k++) B.add(new THREE.BoxGeometry(0.025, 0.95, 0.025), iron, { x: p.x + n[0] * 0.68 + tdir.x * k * 0.38, y: y + 0.48, z: p.z + n[1] * 0.68 + tdir.z * k * 0.38 });
      // diagonal stair
      const st = new THREE.BoxGeometry(0.7, 0.05, 3.6);
      B.add(st, iron, { x: p.x + n[0] * 0.2, y: y + 1.6, z: p.z + n[1] * 0.2 }, 0, undefined, new THREE.Euler(0, rot + Math.PI / 2, 0.75, 'YXZ'));
    }
  }

  function awnings(x: number, z: number, w: number, d: number, sides: Side[], district: DistrictId) {
    const cols = ['#2f4f3f', '#7a1f2a', '#1f2f4a', '#3a3a3a', '#8a5a1a', '#5a2a4a'];
    for (const side of sides) {
      if (R() < 0.4) continue;
      const n = side === 'n' ? [0, -1] : side === 's' ? [0, 1] : side === 'e' ? [1, 0] : [-1, 0];
      const len = (side === 'n' || side === 's' ? w : d) * (0.3 + R() * 0.4);
      const tdir = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(n[0], 0, n[1]));
      const off = (R() - 0.5) * ((side === 'n' || side === 's' ? w : d) - len);
      const cx = x + n[0] * (w / 2 + 0.75) + tdir.x * off, cz = z + n[1] * (d / 2 + 0.75) + tdir.z * off;
      const rot = Math.atan2(n[0], n[1]);
      const c = district === 'trading' ? '#222428' : cols[Math.floor(R() * cols.length)];
      B.add(new THREE.BoxGeometry(len, 0.06, 1.6), mat('awn_' + c, { color: c, roughness: 0.85 }), { x: cx, y: CURB_H + 3.35, z: cz }, 0, undefined, new THREE.Euler(0, rot, 0).setFromQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32))));
      B.add(new THREE.BoxGeometry(len, 0.3, 0.03), mat('awn_' + c, { color: c, roughness: 0.85 }), { x: cx + n[0] * 0.78, y: CURB_H + 3.0, z: cz + n[1] * 0.78 }, rot);
    }
  }

  function glowMatNight(color: string, night: number) {
    const key = 'gn_' + color + night;
    const m = mat(key, { color: '#222', emissive: color, emissiveIntensity: 0.15, roughness: 0.5 });
    if (!nightMats.some((n) => n.m === m)) nightMats.push({ m, base: 0.15, night });
    return m;
  }

  function buildFeature(f: Feature, district: DistrictId) {
    const g = featureGeom(f);
    const styleMap: Record<Style, FacadeStyle> = { glass: 'glass', marble: 'marble', brick: 'brick', neon: 'neon', concrete: 'concrete', villa: 'villa', industrial: 'industrial' };
    const style = styleMap[f.style];
    const accent = DISTRICTS[district].color;
    if (f.style === 'villa') buildVilla(f, g);
    else {
      // podium (venue storefront level, plain so the venue's own frontage reads) + tower
      const kinds = KINDS[style];
      const kind = kinds[(7 + f.zone.length) % kinds.length];
      const id = bseed++;
      const podH = Math.min(CURB_H + 4.4 + 0.6, f.h);
      const towerH = f.h - podH;
      if (towerH > 2) {
        mass(g.cx, g.cz, g.sx, g.sz, CURB_H, podH, f.style === 'glass' ? 'dark' : kind, id, { shopSides: [f.side] });
        const top = mass(g.cx, g.cz, g.sx - 1, g.sz - 1, podH - 1, f.h, kind, id + 1, { base: CURB_H, plainGround: true });
        rooftop(g.cx, g.cz, g.sx - 1, g.sz - 1, top, kind, f.h);
      } else {
        const top = mass(g.cx, g.cz, g.sx, g.sz, CURB_H, Math.max(f.h, podH), kind, id, { shopSides: [f.side] });
        rooftop(g.cx, g.cz, g.sx, g.sz, top, kind, f.h);
      }
      colliders.addBox(g.cx, g.cz, g.sx, g.sz, 'building', f.h);
      footprints.push({ x: g.cx, z: g.cz, w: g.sx, d: g.sz, h: f.h, district, feature: f.zone });
      void facadeMat;
    }
    // storefront on the street side
    const FRONTS = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] } as const;
    const front = new THREE.Vector3(FRONTS[f.side][0], 0, FRONTS[f.side][1]); // outward normal
    const along = new THREE.Vector3(front.z, 0, -front.x);
    const fw = f.side === 'n' || f.side === 's' ? g.sx : g.sz;
    const fdepth = f.side === 'n' || f.side === 's' ? g.sz : g.sx;
    const faceC = new THREE.Vector3(g.cx, 0, g.cz).addScaledVector(front, fdepth / 2 + 0.05);
    const rotY = Math.atan2(front.x, front.z);
    // entrance: aluminium frame, glass double doors, accent light strip (glazing comes from the facade shader)
    const doorC = faceC.clone().addScaledVector(front, 0.08);
    const frameM = mat('doorframe', { color: '#2a2c30', metalness: 0.8, roughness: 0.32 });
    B.add(new THREE.BoxGeometry(2.7, 3.25, 0.18), frameM, { x: doorC.x, y: CURB_H + 1.62, z: doorC.z }, rotY);
    B.add(new THREE.BoxGeometry(2.3, 2.95, 0.2), mat('doorglass', { color: '#0b0f14', metalness: 0.7, roughness: 0.04 }), { x: doorC.x, y: CURB_H + 1.48, z: doorC.z }, rotY);
    B.add(new THREE.BoxGeometry(0.05, 2.95, 0.22), frameM, { x: doorC.x, y: CURB_H + 1.48, z: doorC.z }, rotY);
    for (const sx of [-0.25, 0.25]) B.add(new THREE.BoxGeometry(0.04, 0.6, 0.06), mat('chromehandle', { color: '#d8dce0', metalness: 1, roughness: 0.15 }), { x: doorC.x + along.x * sx + front.x * 0.13, y: CURB_H + 1.3, z: doorC.z + along.z * sx + front.z * 0.13 }, rotY);
    B.add(new THREE.BoxGeometry(2.7, 0.08, 0.24), glowMatNight(accent, 3), { x: doorC.x, y: CURB_H + 3.28, z: doorC.z }, rotY);
    // entrance mat
    B.add(new THREE.BoxGeometry(2.2, 0.02, 1.3), mat('doormat', { color: '#24221f', roughness: 1 }), { x: doorC.x + front.x * 0.8, y: CURB_H + 0.01, z: doorC.z + front.z * 0.8 }, rotY);
    // awning
    B.add(new THREE.BoxGeometry(fw * 0.85, 0.15, 2.2), mat('awning_' + accent, { color: accent, roughness: 0.6 }), { x: faceC.x + front.x * 1.1, y: CURB_H + 4.3, z: faceC.z + front.z * 1.1 }, rotY);
    // sign (emissive canvas)
    const sm = new THREE.MeshStandardMaterial({ map: signTexture(f.sign, accent), emissiveMap: signTexture(f.sign, accent), emissive: 0xffffff, emissiveIntensity: 0.6, transparent: true, roughness: 0.5 });
    nightMats.push({ m: sm, base: 0.6, night: 2.2 });
    const sw = Math.min(fw * 0.9, f.sign.length * 1.0 + 3);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 160 / 1024), sm);
    sign.position.set(faceC.x + front.x * 0.35, CURB_H + 5.3, faceC.z + front.z * 0.35);
    sign.rotation.y = rotY;
    group.add(sign);
    const door = new THREE.Vector3(...g.door);
    door.y = CURB_H;
    doors.push({ zone: f.zone, name: f.name, pos: door, facing: rotY, feature: f });
    // marker ring
    B.add(new THREE.RingGeometry(0.7, 0.9, 32), glowMat(accent, 2.5), { x: door.x, y: CURB_H + 0.02, z: door.z }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, 0));

    if (f.zone === 'exchange') {
      // giant ticker wall on the facade
      const scr = dynamicCanvas(1024, 256);
      const m = new THREE.MeshStandardMaterial({ map: scr.texture, emissiveMap: scr.texture, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.4 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(fw * 0.9, fw * 0.9 / 4), m);
      p.position.copy(faceC).addScaledVector(front, 0.2);
      p.position.y = 14;
      p.rotation.y = rotY;
      group.add(p);
      screens.push({ draw: (prices, open, t) => drawTicker(scr.ctx, prices, open, t, scr.texture) });
    }
    if (f.zone === 'convention') {
      for (let i = -2; i <= 2; i++) {
        const p = faceC.clone().addScaledVector(front, 2.2).addScaledVector(along, i * 8);
        B.add(new THREE.CylinderGeometry(0.06, 0.06, 8, 6), mat('steel', { color: '#444', metalness: 0.6, roughness: 0.5 }), { x: p.x, y: 4, z: p.z });
        B.add(new THREE.PlaneGeometry(1.4, 2.2), mat('flag' + (i & 3), { color: ['#ffe14f', '#3fa7ff', '#ff4fa3', '#3fffb0'][(i + 2) & 3], side: THREE.DoubleSide, roughness: 0.8 }), { x: p.x + along.x * 0.7, y: 6.8, z: p.z + along.z * 0.7 }, rotY + Math.PI / 2);
      }
    }
  }

  function buildVilla(f: Feature, g: ReturnType<typeof featureGeom>) {
    const wallM = mat('villa_wall', { color: '#f1ece2', roughness: 0.75 });
    const glassM = mat('villa_glass', { color: '#1b2a36', roughness: 0.05, metalness: 0.8 });
    B.add(new THREE.BoxGeometry(g.sx, 5, g.sz), wallM, { x: g.cx, y: 2.5, z: g.cz });
    B.add(new THREE.BoxGeometry(g.sx * 0.6, 4.5, g.sz * 0.7), wallM, { x: g.cx - g.sx * 0.15, y: 7.25, z: g.cz + 2 });
    B.add(new THREE.BoxGeometry(g.sx * 0.62, 0.3, g.sz * 0.74), mat('villa_roof', { color: '#2b2b2e', roughness: 0.7 }), { x: g.cx - g.sx * 0.15, y: 9.6, z: g.cz + 2 });
    B.add(new THREE.BoxGeometry(g.sx + 1, 0.3, g.sz + 1), mat('villa_roof', { color: '#2b2b2e', roughness: 0.7 }), { x: g.cx, y: 5.1, z: g.cz });
    // glass walls
    B.add(new THREE.BoxGeometry(g.sx * 0.8, 3.4, 0.1), glassM, { x: g.cx, y: 2.2, z: g.cz - g.sz / 2 - 0.05 });
    B.add(new THREE.BoxGeometry(g.sx * 0.5, 3.4, 0.1), glassM, { x: g.cx - g.sx * 0.15, y: 7.2, z: g.cz + 2 - g.sz * 0.35 - 0.06 });
    // pool
    const [bx, bz] = blockOrigin(f.block[0], f.block[1]);
    const poolZ = g.cz + g.sz / 2 + 10;
    B.add(new THREE.BoxGeometry(18, 0.3, 8), mat('pooldeck', { color: '#d8cfbf', roughness: 0.8 }), { x: g.cx, y: CURB_H + 0.15, z: poolZ });
    B.add(new THREE.PlaneGeometry(16, 6), mat('water', { color: '#2fb6d9', roughness: 0.05, metalness: 0.2, emissive: '#0a4a66', emissiveIntensity: 0.3 }), { x: g.cx, y: CURB_H + 0.32, z: poolZ }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, 0));
    colliders.addBox(g.cx, g.cz, g.sx, g.sz, 'building', 10);
    footprints.push({ x: g.cx, z: g.cz, w: g.sx, d: g.sz, h: 10, district: 'residential', feature: f.zone });
    // hedges around the estate lot
    const hedge = mat('hedge', { color: '#2f5a2a', roughness: 1 });
    for (const [x, z, w, d] of [[bx + 40, bz + 77, 72, 1.2], [bx + 4, bz + 40, 1.2, 72], [bx + 76, bz + 40, 1.2, 72]]) {
      B.add(new THREE.BoxGeometry(w, 1.6, d), hedge, { x, y: CURB_H + 0.8, z });
      colliders.addBox(x, z, w, d, 'hedge', 1.6);
    }
  }

  function buildPlaza(x: number, z: number, w: number, d: number) {
    B.add(new THREE.BoxGeometry(w, 0.05, d), mat('plaza', { color: '#b9b2a6', roughness: 0.85 }), { x, y: CURB_H + 0.03, z });
    tree(x - w / 3, z - d / 3); tree(x + w / 3, z + d / 3); tree(x - w / 3, z + d / 3); tree(x + w / 3, z - d / 3);
    bench(x, z - 2, 0); bench(x, z + 2, Math.PI);
  }

  function buildPark(bx: number, bz: number) {
    const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
    B.add(new THREE.BoxGeometry(BLOCK - 8, 0.06, BLOCK - 8), grassM, { x: cx, y: CURB_H + 0.03, z: cz });
    const path = new THREE.MeshStandardMaterial({ map: (() => { const t = dirt().clone(); t.repeat.set(1, 8); return t; })(), roughness: 1 });
    B.add(new THREE.BoxGeometry(4, 0.08, BLOCK - 8), path, { x: cx, y: CURB_H + 0.04, z: cz });
    B.add(new THREE.BoxGeometry(BLOCK - 8, 0.08, 4), path, { x: cx, y: CURB_H + 0.041, z: cz });
    // fountain
    B.add(new THREE.CylinderGeometry(6, 6.4, 0.8, 32), mat('stone', { color: '#bdb6a8', roughness: 0.8 }), { x: cx, y: CURB_H + 0.4, z: cz });
    B.add(new THREE.CylinderGeometry(5.6, 5.6, 0.1, 32), mat('water', { color: '#2fb6d9', roughness: 0.05, metalness: 0.2, emissive: '#0a4a66', emissiveIntensity: 0.3 }), { x: cx, y: CURB_H + 0.7, z: cz });
    B.add(new THREE.CylinderGeometry(0.6, 0.9, 2.2, 16), mat('stone', { color: '#bdb6a8', roughness: 0.8 }), { x: cx, y: CURB_H + 1.4, z: cz });
    // coin sculpture
    B.add(new THREE.CylinderGeometry(1.6, 1.6, 0.35, 40), mat('gold', { color: '#d4af37', metalness: 1, roughness: 0.25 }), { x: cx, y: CURB_H + 4.2, z: cz }, 0, undefined, new THREE.Euler(Math.PI / 2, 0, 0.3));
    colliders.addBox(cx, cz, 12, 12, 'fountain', 1);
    const R2 = rng(77);
    for (let i = 0; i < 26; i++) {
      const x = bx + 8 + R2() * (BLOCK - 16), z = bz + 8 + R2() * (BLOCK - 16);
      if (Math.abs(x - cx) < 9 && Math.abs(z - cz) < 9) continue;
      if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      tree(x, z, 1.2 + R2() * 0.6, 'park');
    }
    for (const [x, z, r] of [[cx - 10, cz - 4, Math.PI / 2], [cx + 10, cz + 4, -Math.PI / 2], [cx - 4, cz + 10, Math.PI], [cx + 4, cz - 10, 0], [cx - 10, cz + 4, Math.PI / 2], [cx + 10, cz - 4, -Math.PI / 2]]) bench(x, z, r);
  }

  // ---------------- props ----------------
  /** Real trees are grown and instanced later (world/trees.ts); here we record the spot and add the tree pit. */
  function tree(x: number, z: number, s = 1, kind: 'street' | 'park' = 'street') {
    trees.push({ x, y: CURB_H, z, s: kind === 'park' ? s * 0.85 : 1, kind });
    if (kind === 'street') {
      B.add(new THREE.BoxGeometry(1.5, 0.02, 1.5), pitM, { x, y: CURB_H + 0.005, z });
      B.add(new THREE.BoxGeometry(1.55, 0.06, 0.06), pitEdge, { x, y: CURB_H + 0.02, z: z - 0.76 });
      B.add(new THREE.BoxGeometry(1.55, 0.06, 0.06), pitEdge, { x, y: CURB_H + 0.02, z: z + 0.76 });
      B.add(new THREE.BoxGeometry(0.06, 0.06, 1.55), pitEdge, { x: x - 0.76, y: CURB_H + 0.02, z });
      B.add(new THREE.BoxGeometry(0.06, 0.06, 1.55), pitEdge, { x: x + 0.76, y: CURB_H + 0.02, z });
    }
    colliders.addBox(x, z, 0.5, 0.5, 'tree', 3);
  }
  function bench(x: number, z: number, rot: number) {
    const wood = mat('benchwood', { color: '#8a5a34', roughness: 0.8 });
    const iron = mat('iron', { color: '#2a2c30', metalness: 0.7, roughness: 0.4 });
    const o = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), wood); seat.position.y = 0.45; o.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.06), wood); back.position.set(0, 0.75, -0.24); back.rotation.x = -0.15; o.add(back);
    for (const sx of [-0.8, 0.8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.5), iron); l.position.set(sx, 0.22, 0); o.add(l); }
    o.position.set(x, CURB_H, z); o.rotation.y = rot;
    B.addObject(o);
    benches.push({ pos: new THREE.Vector3(x, CURB_H, z), rot });
    colliders.addBox(x, z, 0.6, 0.6, 'bench', 0.5);
  }
  function lamp(x: number, z: number, rot: number) {
    const pole = mat('lamppole', { color: '#2a2d33', metalness: 0.7, roughness: 0.4 });
    const o = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 6.5, 8), pole); p.position.y = 3.25; o.add(p);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.6), pole); arm.position.set(0, 6.4, 0.75); o.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.7), pole); head.position.set(0, 6.35, 1.45); o.add(head);
    o.position.set(x, CURB_H, z); o.rotation.y = rot;
    B.addObject(o);
    const bulbPos = new THREE.Vector3(0, 6.25, 1.45).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(x, CURB_H, z));
    B.add(new THREE.BoxGeometry(0.34, 0.04, 0.6), lampBulb, bulbPos, rot);
    lamps.push(bulbPos);
    colliders.addBox(x, z, 0.3, 0.3, 'lamp', 6);
  }

  function propsAround(bx: number, bz: number, district: DistrictId) {
    const edges: [number, number, number, number, number][] = [
      // x, z, dx, dz, rot (rot faces road)
      [bx, bz + 1.2, 1, 0, Math.PI], [bx, bz + BLOCK - 1.2, 1, 0, 0], [bx + 1.2, bz, 0, 1, -Math.PI / 2], [bx + BLOCK - 1.2, bz, 0, 1, Math.PI / 2],
    ];
    for (const [sx, sz, dx, dz, rot] of edges) {
      for (let t = 10; t < BLOCK - 5; t += 22) {
        const x = sx + dx * t, z = sz + dz * t;
        if (nearDoor(x, z, 3)) continue;
        lamp(x, z, rot);
      }
      if (district !== 'trading' && district !== 'automotive') {
        for (let t = 21; t < BLOCK - 5; t += 22) {
          const x = sx + dx * t + (dz ? 0.6 * Math.sign(rot) : 0), z = sz + dz * t + (dx ? (rot === 0 ? -0.6 : 0.6) : 0);
          if (nearDoor(x, z, 3)) continue;
          tree(x, z, 0.8 + R() * 0.3);
        }
      }
      // bins & hydrants
      const t = 5 + R() * 60;
      const x = sx + dx * t, z = sz + dz * t;
      if (!nearDoor(x, z, 3)) {
        B.add(new THREE.CylinderGeometry(0.28, 0.25, 0.9, 10), mat('bin', { color: '#2f5f3a', roughness: 0.7, metalness: 0.2 }), { x, y: CURB_H + 0.45, z });
        colliders.addBox(x, z, 0.5, 0.5, 'bin', 1);
      }
      const t2 = 30 + R() * 30;
      const hx = sx + dx * t2, hz = sz + dz * t2;
      if (!nearDoor(hx, hz, 3)) B.add(new THREE.CylinderGeometry(0.14, 0.16, 0.7, 8), mat('hydrant', { color: '#c02a2a', roughness: 0.5, metalness: 0.3 }), { x: hx, y: CURB_H + 0.35, z: hz });
    }
  }
  function nearDoor(x: number, z: number, r: number) {
    for (const f of FEATURES) { const d = featureGeom(f).door; if (Math.hypot(d[0] - x, d[2] - z) < r + 1.5) return true; }
    return false;
  }

  // ---------------- traffic signals ----------------
  const sig = (c: string) => mat('sig_' + c + Math.random(), { color: '#111', emissive: c, emissiveIntensity: 0.1, roughness: 0.3 }) as THREE.MeshStandardMaterial;
  const signals = { ns: { r: sig('#ff2020'), y: sig('#ffb020'), g: sig('#20ff60') }, ew: { r: sig('#ff2020'), y: sig('#ffb020'), g: sig('#20ff60') } };
  const poleM = mat('lamppole', { color: '#2a2d33', metalness: 0.7, roughness: 0.4 });
  for (let i = 1; i < ROAD_X.length - 1; i++) for (let j = 1; j < ROAD_Z.length - 1; j++) {
    const ix = ROAD_X[i], iz = ROAD_Z[j];
    // one signal per approach, on the right-hand corner
    const corners: [number, number, 'ns' | 'ew', number][] = [
      [ix - 9, iz - 9, 'ns', 0], [ix + 9, iz + 9, 'ns', Math.PI], [ix + 9, iz - 9, 'ew', -Math.PI / 2], [ix - 9, iz + 9, 'ew', Math.PI / 2],
    ];
    for (const [x, z, axis, rot] of corners) {
      B.add(new THREE.CylinderGeometry(0.1, 0.12, 4.2, 8), poleM, { x, y: CURB_H + 2.1, z });
      const head = new THREE.Vector3(x, CURB_H + 3.6, z);
      const fwd = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
      B.add(new THREE.BoxGeometry(0.35, 1.0, 0.3), mat('sighousing', { color: '#1a1a1a', roughness: 0.6 }), head, rot);
      const s = signals[axis];
      ([['r', 0.3], ['y', 0], ['g', -0.3]] as const).forEach(([k, dy]) => {
        B.add(new THREE.SphereGeometry(0.1, 8, 6), s[k], { x: head.x - fwd.x * 0.16, y: head.y + dy, z: head.z - fwd.z * 0.16 });
      });
      colliders.addBox(x, z, 0.3, 0.3, 'signal', 4);
    }
  }

  // ---------------- billboards (original ads + live SIM price board) ----------------
  const ads = [
    { t: 'MOONSHOT MOTORS — HALVING X IN SHOWROOM', c: '#f7931a' },
    { t: 'CITYRIDE — GET THERE. DRIVE & EARN', c: '#38f2a5' },
    { t: 'LIQUIDITY FRIDAYS — DJ TILL SUNRISE', c: '#ff4fa3' },
    { t: 'HODL THREADS — NEW SEASON', c: '#b46bff' },
    { t: 'NEVER SHARE YOUR SEED PHRASE', c: '#ff5a5a' },
    { t: 'YIELD PLAZA — STAKE RESPONSIBLY', c: '#3fffb0' },
  ];
  let adI = 0;
  for (const fp of footprints.slice()) {
    if (fp.feature || fp.h < 18 || fp.h > 60 || R() > 0.22) continue;
    const ad = ads[adI++ % ads.length];
    const t = signTexture(ad.t, ad.c, 'rgba(8,10,16,0.95)', 'bold 64px "Segoe UI", Arial', 1024, 256);
    const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6 });
    nightMats.push({ m, base: 0.5, night: 1.6 });
    const bw = Math.min(fp.w, 16);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 4), m);
    b.position.set(fp.x, fp.h + bw / 8 + 1.2, fp.z - fp.d / 2 + 0.5);
    b.rotation.y = Math.PI;
    group.add(b);
    const b2 = b.clone(); b2.position.z = fp.z + fp.d / 2 - 0.5; b2.rotation.y = 0; group.add(b2);
    B.add(new THREE.BoxGeometry(bw, 0.3, 0.3), poleM, { x: fp.x, y: fp.h + 1, z: fp.z });
  }
  // live price board on top of a trading tower
  const tradingTower = footprints.filter((f) => f.district === 'trading' && !f.feature).sort((a, b) => b.h - a.h)[0];
  if (tradingTower) {
    const scr = dynamicCanvas(1024, 256);
    const m = new THREE.MeshStandardMaterial({ map: scr.texture, emissiveMap: scr.texture, emissive: 0xffffff, emissiveIntensity: 1.2 });
    for (const [dz, ry] of [[-1, Math.PI], [1, 0]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(tradingTower.w * 0.95, tradingTower.w * 0.95 / 4), m);
      p.position.set(tradingTower.x, tradingTower.h * 0.7, tradingTower.z + dz * (tradingTower.d / 2 + 0.3));
      p.rotation.y = ry;
      group.add(p);
    }
    screens.push({ draw: (prices, open, t) => drawTicker(scr.ctx, prices, open, t + 3, scr.texture) });
  }

  // ---------------- parked cars ----------------
  const parkModels = ['pico', 'ledger', 'ampere', 'bastion', 'ledger', 'pico'];
  const paints = ['#c8d1d8', '#111114', '#2d3a55', '#8c2f39', '#f2f2f2', '#3d4247', '#7d8287', '#1c2a3f', '#d9d4c7'];
  let pc = 0;
  for (const rx of ROAD_X.slice(1, -1)) for (let j = 0; j < ROWS; j++) {
    if (R() < 0.45) continue;
    const z = ROAD_Z[j] + 20 + R() * 50;
    const side = R() < 0.5 ? -1 : 1;
    if (nearDoor(rx + side * 7, z, 6)) continue;
    // created once the car model has loaded (see populateParked)
    parked.push({ model: parkModels[pc % parkModels.length], color: paints[pc++ % paints.length], x: rx + side * 6.6, z, rot: side < 0 ? 0 : Math.PI });
    colliders.addBox(rx + side * 6.6, z, 2, 4.6, 'parked', 1.5);
  }

  // ---------------- distant skyline & hills ----------------
  const farM = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9, emissive: 0xffd9a0, emissiveIntensity: 0, emissiveMap: facade('concrete', 9).emissive, map: facade('glass', 9).map });
  nightMats.push({ m: farM, base: 0, night: 0.8 });
  const RF = rng(4242);
  for (let i = 0; i < 90; i++) {
    const a = RF() * Math.PI * 2;
    const dist = 520 + RF() * 380;
    const w = 20 + RF() * 40, h = 30 + RF() * 160;
    if (Math.sin(a) * dist * 0.85 > 120) continue; // ocean to the south
    B.add(tiledBox(w, h, w, FACADE_TILE.w, FACADE_TILE.h), farM, { x: Math.cos(a) * dist, y: h / 2, z: Math.sin(a) * dist * 0.85 });
  }
  const hillM = mat('hill', { color: '#4f6a45', roughness: 1 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (Math.sin(a) > 0.2) continue; // ocean to the south
    B.add(new THREE.SphereGeometry(260, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hillM, { x: Math.cos(a) * 1150, y: -40, z: Math.sin(a) * 1150 }, 0, { x: 1, y: 0.45, z: 1 });
  }

  // ---------------- coastline: boardwalk, beach, pier, ocean ----------------
  const coast = buildCoast();

  // city limits (invisible walls); the south limit is knee-deep in the surf
  const bnd = 30;
  colliders.addBox((minX + maxX) / 2, minZ - bnd, maxX - minX + bnd * 4, 4, 'limit', 99);
  {
    const wz = coast.wadeZ + 2, l0 = minX - bnd * 2, r1 = maxX + bnd * 2;
    colliders.addBox((l0 + coast.pierX0) / 2, wz, coast.pierX0 - l0, 4, 'limit', 99);
    colliders.addBox((coast.pierX1 + r1) / 2, wz, r1 - coast.pierX1, 4, 'limit', 99);
  }
  colliders.addBox(minX - bnd, (minZ + maxZ) / 2, 4, maxZ - minZ + bnd * 4, 'limit', 99);
  colliders.addBox(maxX + bnd, (minZ + maxZ) / 2, 4, maxZ - minZ + bnd * 4, 'limit', 99);

  const noShadow = new Set<THREE.Material>([markM, crossM, swM, grassM, farM, hillM]);
  B.flush(group, { cast: true, receive: true, noShadow });
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material === farM || m.material === hillM)) { m.castShadow = false; m.receiveShadow = false; } });

  const blocks = [] as { x0: number; x1: number; z0: number; z1: number }[];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const [bx, bz] = blockOrigin(c, r); blocks.push({ x0: bx, x1: bx + BLOCK, z0: bz, z1: bz + BLOCK }); }
  const groundAt = (x: number, z: number) => {
    if (z > maxZ) return coast.groundAt(x, z);
    for (const b of blocks) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return CURB_H;
    return 0;
  };

  void artTexture;
  return { group, colliders, doors, lamps, benches, nightMats, signals, screens, groundAt, footprints, ocean: coast.ocean, trees,
    populateParked: () => {
      for (const p of parked) {
        const v = buildVehicle(p.model, p.color);
        v.root.position.set(p.x, 0, p.z);
        v.root.rotation.y = p.rot;
        if (v.root.children.some((c) => (c as THREE.Mesh).isMesh)) { B.addObject(v.root); B.flush(group); } else group.add(v.root);
      }
    },
  };

  function buildCoast() {
    const BW0 = maxZ, BW1 = maxZ + 9; // boardwalk
    const SLOPE = 0.028, LEVEL = -0.25;
    const sandY = (z: number) => Math.max(-1.8, CURB_H - (z - BW1) * SLOPE);
    const shoreZ = BW1 + (CURB_H - LEVEL) / SLOPE;
    const wadeZ = shoreZ + 7;
    const pierX0 = -3, pierX1 = 3, PIER_Y = 1.15, PIER_Z0 = BW1 + 8, PIER_Z1 = shoreZ + 105;
    const X0 = -1300, X1 = 1300;

    // boardwalk planks
    const plankC = document.createElement('canvas'); plankC.width = 256; plankC.height = 256;
    {
      const x = plankC.getContext('2d')!; const r = rng(55);
      for (let i = 0; i < 8; i++) {
        const v = 120 + r() * 30;
        x.fillStyle = `rgb(${v + 40},${v + 8},${v - 30})`; x.fillRect(0, i * 32, 256, 31);
        for (let k = 0; k < 60; k++) { x.fillStyle = `rgba(60,35,15,${0.05 + r() * 0.08})`; x.fillRect(r() * 256, i * 32 + r() * 30, 20 + r() * 80, 1); }
        x.fillStyle = 'rgba(30,18,8,0.9)'; x.fillRect(0, i * 32 + 31, 256, 1);
      }
    }
    const plankT = new THREE.CanvasTexture(plankC); plankT.colorSpace = THREE.SRGBColorSpace; plankT.wrapS = plankT.wrapT = THREE.RepeatWrapping;
    const deckT = plankT.clone(); deckT.repeat.set(1, (BW1 - BW0) / 2.5); deckT.needsUpdate = true;
    const walkT = plankT.clone(); walkT.repeat.set((X1 - X0) / 6, (BW1 - BW0) / 4); walkT.needsUpdate = true;
    const boardM = new THREE.MeshStandardMaterial({ map: walkT, roughness: 0.85 });
    const bw = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.3, BW1 - BW0), boardM);
    bw.position.set(0, CURB_H - 0.15, (BW0 + BW1) / 2);
    bw.receiveShadow = true;
    group.add(bw);

    // sand: sloped strip, wet & darker towards the water (vertex colours)
    const sandC = document.createElement('canvas'); sandC.width = sandC.height = 256;
    {
      const x = sandC.getContext('2d')!; const img = x.createImageData(256, 256); const r = rng(91);
      for (let i = 0; i < 256 * 256; i++) { const n = (r() - 0.5) * 34 + (r() < 0.02 ? -40 : 0); img.data[i * 4] = 226 + n; img.data[i * 4 + 1] = 204 + n; img.data[i * 4 + 2] = 160 + n; img.data[i * 4 + 3] = 255; }
      x.putImageData(img, 0, 0);
    }
    const sandT = new THREE.CanvasTexture(sandC); sandT.colorSpace = THREE.SRGBColorSpace; sandT.wrapS = sandT.wrapT = THREE.RepeatWrapping; sandT.repeat.set((X1 - X0) / 6, 20);
    const SZ1 = shoreZ + 120;
    const sandG = new THREE.PlaneGeometry(X1 - X0, SZ1 - BW1, 8, 60);
    sandG.rotateX(-Math.PI / 2);
    const sp = sandG.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i) + (BW1 + SZ1) / 2;
      sp.setY(i, sandY(z));
      const wet = THREE.MathUtils.smoothstep(z, shoreZ - 6, shoreZ - 1);
      const c = 1 - wet * 0.38;
      cols[i * 3] = c; cols[i * 3 + 1] = c * (1 - wet * 0.04); cols[i * 3 + 2] = c * (1 - wet * 0.06);
    }
    sandG.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    sandG.computeVertexNormals();
    const sand = new THREE.Mesh(sandG, new THREE.MeshStandardMaterial({ map: sandT, vertexColors: true, roughness: 0.95 }));
    sand.position.set(0, 0, (BW1 + SZ1) / 2);
    sand.receiveShadow = true;
    group.add(sand);

    const ocean = buildOcean({ shoreZ, level: LEVEL, x0: X0, x1: X1, z1: 1500 });
    group.add(ocean.mesh);

    // seafront railing (pedestrian gaps every 32 m) keeps cars off the sand
    const rail = mat('rail', { color: '#e8e6e0', roughness: 0.5, metalness: 0.3 });
    for (let x = minX - 20; x < maxX + 20; x += 32) {
      const a = x + 0.7, b = x + 32 - 0.7, len = b - a;
      B.add(new THREE.BoxGeometry(len, 0.08, 0.08), rail, { x: (a + b) / 2, y: CURB_H + 0.95, z: BW0 + 0.4 });
      B.add(new THREE.BoxGeometry(len, 0.06, 0.06), rail, { x: (a + b) / 2, y: CURB_H + 0.5, z: BW0 + 0.4 });
      for (let px = a; px <= b + 0.01; px += len / 8) B.add(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), rail, { x: px, y: CURB_H + 0.5, z: BW0 + 0.4 });
      colliders.addBox((a + b) / 2, BW0 + 0.4, len, 0.3, 'rail', 1);
    }
    // palms, lamps and benches along the promenade
    for (let x = minX - 10, i = 0; x < maxX + 10; x += 18, i++) {
      if (Math.abs(x) < 8) continue;
      palm(x, BW1 - 1.2, 0.9 + ((i * 37) % 10) / 25, i);
      if (i % 2 === 0) bench(x + 9, BW1 - 1.6, Math.PI);
      if (i % 3 === 1) lamp(x + 9, BW0 + 1.2, Math.PI);
    }

    // pier
    const pierT = plankT.clone(); pierT.repeat.set(1.5, (PIER_Z1 - PIER_Z0) / 2.5); pierT.needsUpdate = true;
    const pierM = new THREE.MeshStandardMaterial({ map: pierT, roughness: 0.85 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(pierX1 - pierX0, 0.25, PIER_Z1 - PIER_Z0), pierM);
    deck.position.set((pierX0 + pierX1) / 2, PIER_Y - 0.125, (PIER_Z0 + PIER_Z1) / 2);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    const rampLen = PIER_Z0 - BW1, rampRise = PIER_Y - CURB_H;
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(pierX1 - pierX0, 0.25, Math.hypot(rampLen, rampRise)), new THREE.MeshStandardMaterial({ map: deckT, roughness: 0.85 }));
    ramp.position.set(0, (CURB_H + PIER_Y) / 2 - 0.125, (BW1 + PIER_Z0) / 2);
    ramp.rotation.x = -Math.atan2(rampRise, rampLen);
    ramp.receiveShadow = true;
    group.add(ramp);
    const pile = mat('pile', { color: '#4a3a2c', roughness: 0.95 });
    for (let z = PIER_Z0 + 2; z < PIER_Z1; z += 6) for (const x of [pierX0 + 0.3, pierX1 - 0.3]) B.add(new THREE.CylinderGeometry(0.18, 0.2, 4.5, 8), pile, { x, y: PIER_Y - 2.4, z });
    for (const x of [pierX0 + 0.1, pierX1 - 0.1]) {
      B.add(new THREE.BoxGeometry(0.08, 0.08, PIER_Z1 - BW1), rail, { x, y: PIER_Y + 0.95, z: (BW1 + PIER_Z1) / 2 }, 0, undefined, new THREE.Euler(0, 0, 0));
      for (let z = PIER_Z0; z <= PIER_Z1; z += 3) B.add(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), rail, { x, y: PIER_Y + 0.5, z });
      colliders.addBox(x + (x < 0 ? -0.15 : 0.15), (BW1 + PIER_Z1) / 2, 0.3, PIER_Z1 - BW1, 'rail', 1);
    }
    B.add(new THREE.BoxGeometry(pierX1 - pierX0, 0.08, 0.08), rail, { x: 0, y: PIER_Y + 0.95, z: PIER_Z1 - 0.1 });
    colliders.addBox(0, PIER_Z1 + 0.1, pierX1 - pierX0 + 0.6, 0.4, 'rail', 1);
    lamp(pierX1 - 0.4, PIER_Z1 - 20, -Math.PI / 2);
    lamp(pierX0 + 0.4, PIER_Z1 - 50, Math.PI / 2);
    // lifeguard tower & umbrellas
    {
      const wood = mat('lifeguard', { color: '#f2efe6', roughness: 0.7 });
      const red = mat('lifeguardred', { color: '#d23b2f', roughness: 0.6 });
      const lx = 60, lz = shoreZ - 6, ly = sandY(lz);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(new THREE.BoxGeometry(0.15, 2.6, 0.15), wood, { x: lx + dx, y: ly + 1.3, z: lz + dz });
      B.add(new THREE.BoxGeometry(2.6, 1.6, 2.6), red, { x: lx, y: ly + 3.4, z: lz });
      B.add(new THREE.ConeGeometry(2.2, 0.8, 4), wood, { x: lx, y: ly + 4.6, z: lz }, Math.PI / 4);
      colliders.addBox(lx, lz, 2.4, 2.4, 'tower', 3);
      const umb = ['#ff6b4a', '#3fa7ff', '#ffd23f', '#3fd67a', '#ff4fa3'].map((c) => mat('umb' + c, { color: c, roughness: 0.7, side: THREE.DoubleSide }));
      const pole = mat('umbpole', { color: '#eeeeee', roughness: 0.5 });
      const towel = ['#f5f5f5', '#2f6fd6', '#e8452c', '#f2c230'].map((c) => mat('towel' + c, { color: c, roughness: 0.95 }));
      const RU = rng(303);
      for (let i = 0; i < 26; i++) {
        const x = minX + RU() * (maxX - minX), z = BW1 + 3 + RU() * (shoreZ - BW1 - 9);
        if (Math.abs(x) < 8 || Math.abs(x - lx) < 5) continue;
        const y = sandY(z);
        B.add(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), pole, { x, y: y + 1.15, z });
        B.add(new THREE.ConeGeometry(1.5, 0.5, 10, 1, true), umb[i % umb.length], { x, y: y + 2.3, z });
        B.add(new THREE.BoxGeometry(0.9, 0.02, 1.9), towel[i % towel.length], { x: x + 1.1, y: y + 0.02, z: z + 0.6 }, RU() * 0.6 - 0.3);
        colliders.addBox(x, z, 0.3, 0.3, 'umbrella', 2);
      }
    }

    const groundAt = (x: number, z: number) => {
      if (x > pierX0 && x < pierX1 && z > BW1 && z < PIER_Z1) {
        if (z < PIER_Z0) return CURB_H + ((z - BW1) / rampLen) * rampRise;
        return PIER_Y;
      }
      if (z < BW1) return CURB_H;
      return sandY(z);
    };
    return { groundAt, ocean, shoreZ, wadeZ, pierX0, pierX1 };
  }

  function palm(x: number, z: number, s: number, seed: number) {
    const bark = mat('palmbark', { color: '#8a7055', roughness: 1 });
    const frondM = mat('palmfrond', { color: '#3e7a32', roughness: 0.9, side: THREE.DoubleSide });
    const r = rng(seed * 31 + 7);
    const lean = (r() - 0.5) * 0.5, dir = r() * Math.PI * 2;
    let px = x, py = CURB_H, pz = z;
    const segs = 6, segH = 1.35 * s;
    for (let i = 0; i < segs; i++) {
      const t = (i + 1) / segs;
      const tilt = lean * t * t;
      const nx = px + Math.cos(dir) * Math.sin(tilt) * segH, nz = pz + Math.sin(dir) * Math.sin(tilt) * segH, ny = py + Math.cos(tilt) * segH;
      const g = new THREE.CylinderGeometry(0.15 * s * (1 - t * 0.35), 0.18 * s * (1 - (i / segs) * 0.35), segH * 1.04, 7);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx - px, ny - py, nz - pz).normalize());
      B.add(g, bark, { x: (px + nx) / 2, y: (py + ny) / 2, z: (pz + nz) / 2 }, 0, undefined, new THREE.Euler().setFromQuaternion(q));
      px = nx; py = ny; pz = nz;
    }
    const frond = new THREE.PlaneGeometry(0.75 * s, 3.4 * s, 1, 4);
    frond.translate(0, 1.7 * s, 0);
    const fp = frond.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) { const v = fp.getY(i) / (3.4 * s); fp.setZ(i, -v * v * 1.6 * s); fp.setX(i, fp.getX(i) * (1 - v * 0.7)); }
    frond.computeVertexNormals();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + r() * 0.3;
      B.add(frond, frondM, { x: px, y: py, z: pz }, 0, undefined, new THREE.Euler(-1.05 + r() * 0.3, a, 0, 'YXZ'));
    }
    B.add(new THREE.SphereGeometry(0.22 * s, 8, 6), mat('coconut', { color: '#5a4026', roughness: 0.8 }), { x: px, y: py - 0.15, z: pz });
    colliders.addBox(x, z, 0.5, 0.5, 'palm', 6);
  }
}

function drawTicker(x: CanvasRenderingContext2D, prices: Record<string, number>, open: Record<string, number>, t: number, tex: THREE.Texture) {
  const W = x.canvas.width, H = x.canvas.height;
  x.fillStyle = '#05070c'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#0d1424'; x.fillRect(0, 0, W, 48);
  x.font = 'bold 30px "Segoe UI", Arial'; x.fillStyle = '#38f2a5'; x.textAlign = 'left';
  x.fillText('SATOSHI SQUARE · SIMULATED MARKET', 16, 34);
  x.fillStyle = '#ffb03f'; x.textAlign = 'right'; x.fillText('SIM', W - 16, 34);
  const syms = Object.keys(prices);
  const off = (t * 40) % (syms.length * 250);
  x.font = 'bold 40px "Consolas", monospace';
  x.textAlign = 'left';
  for (let pass = 0; pass < 2; pass++) syms.forEach((s, i) => {
    const px = i * 250 - off + pass * syms.length * 250;
    if (px < -260 || px > W) return;
    const p = prices[s], o = open[s] ?? p;
    const ch = ((p - o) / o) * 100;
    x.fillStyle = '#e8eef8'; x.fillText(s, px + 10, 110);
    x.fillStyle = ch >= 0 ? '#38f2a5' : '#ff5a6e';
    x.fillText(fmtP(p), px + 10, 160);
    x.font = 'bold 30px "Consolas", monospace';
    x.fillText((ch >= 0 ? '▲' : '▼') + Math.abs(ch).toFixed(2) + '%', px + 10, 205);
    x.font = 'bold 40px "Consolas", monospace';
  });
  tex.needsUpdate = true;
}
function fmtP(p: number) { return p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toPrecision(3); }
