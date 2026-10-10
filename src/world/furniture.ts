// Furniture & fixture library: real models where we have them (see furnmodels.ts),
// procedural designs for everything else and as a fallback.

import * as THREE from 'three';
import { mat, roundedBox } from '../engine/build.js';
import { artTexture, fabric } from '../engine/textures.js';
import { surf } from './pbr.js';
import { houseplantParts } from './trees.js';
import { real } from './furnmodels.js';
void fabric;

type V = number;
function box(g: THREE.Object3D, w: V, h: V, d: V, m: THREE.Material, x = 0, y = 0, z = 0, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.rotation.y = ry;
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
function rbox(g: THREE.Object3D, w: V, h: V, d: V, r: V, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(roundedBox(w, h, d, r), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
function cyl(g: THREE.Object3D, rt: V, rb: V, h: V, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

/** Brighten a colour (the PBR albedo textures are mid-grey, so tints need lifting). */
const lift = (c: string, k: number) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();

export const M = {
  wood: () => surf('wood', { tile: 0.9, mode: 'wall', color: '#ffffff', macro: 0.05 }),
  darkWood: () => surf('wood', { tile: 0.9, mode: 'wall', color: '#6e5a4c', macro: 0.05 }),
  lightWood: () => surf('wood', { tile: 0.9, mode: 'wall', color: '#ffe4c4', macro: 0.05 }),
  white: () => mat('f_white', { color: '#f2f1ec', roughness: 0.5 }),
  black: () => mat('f_black', { color: '#141518', roughness: 0.45, metalness: 0.2 }),
  steel: () => mat('f_steel', { color: '#c4c8cc', roughness: 0.25, metalness: 0.9 }),
  chrome: () => mat('f_chrome', { color: '#eef0f2', roughness: 0.08, metalness: 1 }),
  gold: () => mat('f_gold', { color: '#d4af37', roughness: 0.25, metalness: 1 }),
  glass: () => mat('f_glass', { color: '#a8c8d8', roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.25 }),
  screenOff: () => mat('f_screen', { color: '#06070a', roughness: 0.08, metalness: 0.5 }),
  leather: (c = '#3b2618') => surf('leather', { tile: 0.6, mode: 'wall', color: lift(c, 1.35), macro: 0.05 }),
  fabric: (c = '#5a6270') => surf('fabric', { tile: 0.5, mode: 'wall', color: lift(c, 1.35), macro: 0.08 }),
  porcelain: () => mat('f_porc', { color: '#fbfbf8', roughness: 0.15 }),
  marbleTop: () => surf('marble', { tile: 1.5, mode: 'wall', color: '#ffffff', macro: 0.03 }),
  plant: () => mat('f_leaf', { color: '#3f7a35', roughness: 0.9 }),
  pot: () => mat('f_pot', { color: '#b0603a', roughness: 0.8 }),
  emissive: (c: string, i = 2) => mat('f_em' + c + i, { color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 }),
};

export function sofa(color = '#5a6270', w = 2.2) {
  const r = real('sofa', { w }); if (r) return r;
  const g = new THREE.Group();
  const f = M.fabric(color);
  rbox(g, w, 0.42, 0.95, 0.08, f, 0, 0.28, 0);
  rbox(g, w, 0.55, 0.22, 0.08, f, 0, 0.62, -0.38);
  rbox(g, 0.22, 0.6, 0.95, 0.08, f, -w / 2 + 0.11, 0.42, 0);
  rbox(g, 0.22, 0.6, 0.95, 0.08, f, w / 2 - 0.11, 0.42, 0);
  for (let i = 0; i < Math.round(w / 0.8); i++) rbox(g, w / Math.round(w / 0.8) - 0.1, 0.14, 0.7, 0.06, f, -w / 2 + 0.3 + (i + 0.5) * (w - 0.6) / Math.round(w / 0.8), 0.55, 0.05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.03, 0.03, 0.1, M.black(), sx * (w / 2 - 0.1), 0.05, sz * 0.38);
  return g;
}
export function armchair(color = '#7a5a3a') {
  const r = real('armchair'); if (r) return r;
  const g = new THREE.Group();
  const l = M.leather(color);
  rbox(g, 0.85, 0.4, 0.85, 0.08, l, 0, 0.3, 0);
  rbox(g, 0.85, 0.55, 0.18, 0.06, l, 0, 0.65, -0.34);
  rbox(g, 0.16, 0.5, 0.85, 0.06, l, -0.35, 0.45, 0);
  rbox(g, 0.16, 0.5, 0.85, 0.06, l, 0.35, 0.45, 0);
  return g;
}
export function coffeeTable() {
  const r = real('coffeeTable'); if (r) return r;
  const g = new THREE.Group();
  box(g, 1.2, 0.05, 0.6, M.darkWood(), 0, 0.42, 0);
  box(g, 1.1, 0.03, 0.5, M.darkWood(), 0, 0.12, 0);
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.25, 0.25]) box(g, 0.04, 0.42, 0.04, M.black(), sx, 0.21, sz);
  return g;
}
export function tv(size = 1.4, screen?: THREE.Material) {
  const g = new THREE.Group();
  box(g, size, size * 0.58, 0.05, M.black(), 0, 0, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.96, size * 0.54), screen ?? M.screenOff());
  s.position.z = 0.03; g.add(s);
  g.userData.screen = s;
  return g;
}
export function tvStand(w = 1.8) {
  const r = real('tvStand', { w }); if (r) return r;
  const g = new THREE.Group();
  box(g, w, 0.45, 0.42, M.darkWood(), 0, 0.25, 0);
  box(g, w * 0.95, 0.02, 0.43, M.black(), 0, 0.2, 0.01);
  return g;
}
export function speaker(tall = false) {
  const g = new THREE.Group();
  const h = tall ? 1.1 : 0.4;
  box(g, 0.25, h, 0.28, M.black(), 0, h / 2 + (tall ? 0 : 0), 0);
  const cone = mat('cone', { color: '#2a2a2e', roughness: 0.8 });
  for (let i = 0; i < (tall ? 3 : 1); i++) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), cone);
    c.position.set(0, (tall ? 0.25 + i * 0.3 : 0.22), 0.141);
    g.add(c);
  }
  return g;
}
export function floorLamp() {
  const g = new THREE.Group();
  cyl(g, 0.15, 0.18, 0.03, M.black(), 0, 0.015, 0);
  cyl(g, 0.015, 0.015, 1.6, M.steel(), 0, 0.8, 0, 8);
  const shade = cyl(g, 0.16, 0.25, 0.3, mat('lampshade', { color: '#f3e9d6', emissive: '#ffd9a0', emissiveIntensity: 0.6, roughness: 0.8, side: THREE.DoubleSide }), 0, 1.65, 0);
  shade.castShadow = false;
  g.userData.bulb = shade;
  return g;
}
export function rug(w = 2.4, d = 1.7, c = '#8a4a3a') {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.015, d), M.fabric(c));
  r.position.y = 0.008; r.receiveShadow = true; g.add(r);
  return g;
}
export function plant(big = false) {
  const r = real(big ? 'plantBig' : 'plantSmall'); if (r) return r;
  const g = new THREE.Group();
  const s = big ? 1.6 : 1;
  cyl(g, 0.2 * s, 0.15 * s, 0.4 * s, M.pot(), 0, 0.2 * s, 0, 16);
  cyl(g, 0.18 * s, 0.18 * s, 0.02, mat('soil', { color: '#2e2219', roughness: 1 }), 0, 0.39 * s, 0, 16);
  // a real grown shrub instead of blobs
  const hp = houseplantParts();
  for (const [geo, m] of [[hp.branches, hp.bark], [hp.leaves, hp.leaf]] as const) {
    const me = new THREE.Mesh(geo, m);
    me.position.y = 0.38 * s;
    me.scale.setScalar(s);
    me.castShadow = true;
    g.add(me);
  }
  return g;
}
export function bed(w = 1.6, color = '#dfe4ea') {
  const g = new THREE.Group();
  box(g, w + 0.1, 0.3, 2.15, M.darkWood(), 0, 0.2, 0);
  rbox(g, w, 0.25, 2.0, 0.08, M.white(), 0, 0.45, 0.02);
  rbox(g, w + 0.02, 0.06, 1.4, 0.03, M.fabric(color), 0, 0.6, 0.3);
  box(g, w + 0.1, 1.0, 0.1, M.fabric('#4a4f5a'), 0, 0.6, -1.05);
  for (const sx of [-w / 4, w / 4]) rbox(g, w / 2 - 0.12, 0.14, 0.4, 0.06, M.white(), sx, 0.64, -0.75);
  return g;
}
export function nightstand() {
  const r = real('nightstand');
  if (r) {
    const l = cyl(r, 0.1, 0.12, 0.2, mat('lampshade', { color: '#f3e9d6', emissive: '#ffd9a0', emissiveIntensity: 0.6, roughness: 0.8 }), 0, 0.73, 0);
    l.castShadow = false;
    cyl(r, 0.02, 0.05, 0.12, M.gold(), 0, 0.61, 0);
    return r;
  }
  const g = new THREE.Group();
  box(g, 0.45, 0.5, 0.4, M.wood(), 0, 0.25, 0);
  box(g, 0.4, 0.02, 0.02, M.gold(), 0, 0.35, 0.205);
  const l = cyl(g, 0.1, 0.12, 0.2, mat('lampshade', { color: '#f3e9d6', emissive: '#ffd9a0', emissiveIntensity: 0.6, roughness: 0.8 }), 0, 0.68, 0);
  l.castShadow = false;
  cyl(g, 0.02, 0.05, 0.12, M.gold(), 0, 0.56, 0);
  return g;
}
export function wardrobe(w = 1.6) {
  const r = real('wardrobe', { w }); if (r) return r;
  const g = new THREE.Group();
  box(g, w, 2.2, 0.6, M.lightWood(), 0, 1.1, 0);
  box(g, 0.01, 2.1, 0.01, M.black(), 0, 1.1, 0.305);
  for (const sx of [-0.06, 0.06]) box(g, 0.02, 0.3, 0.03, M.steel(), sx, 1.1, 0.32);
  return g;
}
export function mirror() {
  const r = real('mirror'); if (r) { r.children[0].position.y = 0.3; return r; }
  const g = new THREE.Group();
  box(g, 0.7, 1.8, 0.05, M.gold(), 0, 1.0, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.72), mat('mirror', { color: '#d8e4ec', metalness: 1, roughness: 0.02, envMapIntensity: 1.6 }));
  s.position.set(0, 1.0, 0.03); g.add(s);
  return g;
}
export function fridge() {
  const g = new THREE.Group();
  rbox(g, 0.8, 1.9, 0.7, 0.04, M.steel(), 0, 0.95, 0);
  box(g, 0.78, 0.01, 0.01, M.black(), 0, 1.25, 0.351);
  box(g, 0.03, 0.5, 0.04, M.chrome(), 0.3, 1.55, 0.37);
  box(g, 0.03, 0.4, 0.04, M.chrome(), 0.3, 0.9, 0.37);
  return g;
}
export function counter(w = 2.4, withSink = false, withStove = false) {
  const g = new THREE.Group();
  box(g, w, 0.86, 0.62, M.white(), 0, 0.43, 0);
  box(g, w + 0.02, 0.04, 0.65, M.marbleTop(), 0, 0.88, 0);
  for (let i = 0; i < Math.floor(w / 0.6); i++) box(g, 0.2, 0.02, 0.02, M.steel(), -w / 2 + 0.3 + i * 0.6, 0.75, 0.32);
  if (withSink) {
    box(g, 0.5, 0.02, 0.38, M.steel(), -w / 4, 0.905, 0);
    cyl(g, 0.015, 0.015, 0.3, M.chrome(), -w / 4, 1.05, -0.2, 8);
  }
  if (withStove) {
    box(g, 0.6, 0.02, 0.5, M.black(), w / 4, 0.905, 0);
    for (const [ox, oz] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.12], [0.14, 0.12]]) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.08, 16), mat('burner', { color: '#333', emissive: '#ff3300', emissiveIntensity: 0, roughness: 0.6 }));
      r.rotation.x = -Math.PI / 2; r.position.set(w / 4 + ox, 0.917, oz); g.add(r);
    }
  }
  return g;
}
export function upperCabinets(w = 2.4) {
  const g = new THREE.Group();
  box(g, w, 0.7, 0.35, M.white(), 0, 1.85, -0.13);
  return g;
}
export function coffeeMachine() {
  const g = new THREE.Group();
  box(g, 0.28, 0.38, 0.32, M.black(), 0, 0.19, 0);
  box(g, 0.2, 0.05, 0.1, M.steel(), 0, 0.25, 0.18);
  const led = box(g, 0.04, 0.02, 0.01, M.emissive('#38f2a5', 2), 0.08, 0.32, 0.165);
  led.castShadow = false;
  return g;
}
export function microwave() {
  const g = new THREE.Group();
  box(g, 0.5, 0.3, 0.38, M.black(), 0, 0.15, 0);
  box(g, 0.32, 0.22, 0.01, mat('mwglass', { color: '#1a1e24', roughness: 0.1, metalness: 0.5 }), -0.06, 0.15, 0.191);
  return g;
}
export function diningTable(w = 1.6, d = 0.9, cloth = false) {
  const r = cloth ? null : real('diningTable', { w, d, h: 0.78 }); if (r) return r;
  const g = new THREE.Group();
  box(g, w, 0.05, d, cloth ? M.white() : M.wood(), 0, 0.76, 0);
  if (cloth) box(g, w + 0.06, 0.3, d + 0.06, M.white(), 0, 0.63, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.05, 0.75, 0.05, M.darkWood(), sx * (w / 2 - 0.08), 0.375, sz * (d / 2 - 0.08));
  return g;
}
export function roundTable(r = 0.45, h = 0.76, top?: THREE.Material) {
  const rm = top ? null : real('roundTable', { w: r * 2, d: r * 2, h: h + 0.02 }); if (rm) return rm;
  const g = new THREE.Group();
  cyl(g, r, r, 0.04, top ?? M.marbleTop(), 0, h, 0, 24);
  cyl(g, 0.04, 0.04, h, M.black(), 0, h / 2, 0, 8);
  cyl(g, 0.25, 0.28, 0.03, M.black(), 0, 0.015, 0, 16);
  return g;
}
export function chair(color = '#3d2a1e') {
  const r = real('chair'); if (r) return r;
  const g = new THREE.Group();
  const w = mat('chairwood' + color, { color, roughness: 0.6 });
  box(g, 0.44, 0.05, 0.44, w, 0, 0.46, 0);
  box(g, 0.44, 0.48, 0.04, w, 0, 0.72, -0.2);
  for (const sx of [-0.19, 0.19]) for (const sz of [-0.19, 0.19]) box(g, 0.035, 0.46, 0.035, w, sx, 0.23, sz);
  return g;
}
export function stool(h = 0.75) {
  const r = real('stool', { h: h + 0.03 }); if (r) return r;
  const g = new THREE.Group();
  cyl(g, 0.19, 0.19, 0.06, M.leather('#1d1d20'), 0, h, 0);
  cyl(g, 0.025, 0.025, h, M.chrome(), 0, h / 2, 0, 8);
  cyl(g, 0.2, 0.22, 0.02, M.chrome(), 0, 0.01, 0);
  return g;
}
export function officeChair(gaming = false) {
  const g = new THREE.Group();
  const seatM = gaming ? M.leather('#16161a') : M.fabric('#2a2e36');
  rbox(g, 0.52, 0.1, 0.5, 0.04, seatM, 0, 0.5, 0);
  rbox(g, 0.5, gaming ? 0.85 : 0.55, 0.08, 0.04, seatM, 0, gaming ? 0.98 : 0.83, -0.24);
  if (gaming) { box(g, 0.08, 0.6, 0.09, M.emissive('#ff2f6d', 0.8), -0.2, 0.98, -0.24); box(g, 0.08, 0.6, 0.09, M.emissive('#ff2f6d', 0.8), 0.2, 0.98, -0.24); }
  cyl(g, 0.03, 0.03, 0.4, M.chrome(), 0, 0.27, 0, 8);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; box(g, 0.04, 0.03, 0.3, M.black(), Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15, a); }
  return g;
}
export function desk(w = 1.6, d = 0.75) {
  const r = real('desk', { w, d, h: 0.76 }); if (r) return r;
  const g = new THREE.Group();
  box(g, w, 0.04, d, M.lightWood(), 0, 0.74, 0);
  for (const sx of [-1, 1]) box(g, 0.05, 0.72, d - 0.05, M.black(), sx * (w / 2 - 0.05), 0.36, 0);
  return g;
}
export function monitor(screen?: THREE.Material, w = 0.6) {
  const g = new THREE.Group();
  box(g, w, w * 0.58, 0.03, M.black(), 0, 0.25 + w * 0.29, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, w * 0.53), screen ?? M.screenOff());
  s.position.set(0, 0.25 + w * 0.29, 0.017); g.add(s);
  box(g, 0.04, 0.25, 0.04, M.black(), 0, 0.125, -0.03);
  box(g, 0.2, 0.01, 0.15, M.black(), 0, 0.005, -0.03);
  g.userData.screen = s;
  return g;
}
export function laptop(screen?: THREE.Material) {
  const g = new THREE.Group();
  box(g, 0.34, 0.015, 0.24, M.steel(), 0, 0.0075, 0);
  const lid = new THREE.Group();
  lid.position.set(0, 0.015, -0.12); lid.rotation.x = -0.25; g.add(lid);
  box(lid, 0.34, 0.22, 0.01, M.steel(), 0, 0.11, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.19), screen ?? M.emissive('#1f4fa8', 0.6));
  s.position.set(0, 0.11, 0.006); lid.add(s);
  return g;
}
export function keyboard() {
  const g = new THREE.Group();
  box(g, 0.44, 0.02, 0.14, M.black(), 0, 0.01, 0);
  box(g, 0.42, 0.005, 0.12, M.emissive('#7a5cff', 0.4), 0, 0.022, 0);
  return g;
}
export function bookshelf(w = 1.2) {
  const g = new THREE.Group();
  box(g, w, 2.0, 0.35, M.darkWood(), 0, 1.0, 0);
  const cols = ['#8c2f39', '#2d3a55', '#2f7d5b', '#d9a441', '#e8e4da', '#3b2618'];
  let k = 0;
  for (let shelf = 0; shelf < 5; shelf++) {
    box(g, w - 0.06, 0.02, 0.33, M.wood(), 0, 0.12 + shelf * 0.4, 0.01);
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.12) {
      const bw = 0.03 + ((k * 7) % 5) * 0.01;
      const bh = 0.24 + ((k * 3) % 4) * 0.025;
      box(g, bw, bh, 0.22, mat('book' + (k % 6), { color: cols[k % 6], roughness: 0.8 }), x + bw / 2, 0.13 + shelf * 0.4 + bh / 2, 0.04);
      x += bw + 0.005; k++;
    }
  }
  return g;
}
export function trophyShelf(n = 3) {
  const g = new THREE.Group();
  box(g, 1.2, 0.04, 0.3, M.darkWood(), 0, 1.3, 0);
  box(g, 1.2, 0.04, 0.3, M.darkWood(), 0, 1.75, 0);
  for (let i = 0; i < Math.min(n, 6); i++) {
    const t = new THREE.Group();
    cyl(t, 0.04, 0.05, 0.05, M.black(), 0, 0.025, 0);
    cyl(t, 0.012, 0.012, 0.08, M.gold(), 0, 0.09, 0);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.03, 0.1, 12, 1, true), M.gold());
    cup.position.y = 0.18; t.add(cup);
    t.position.set(-0.45 + (i % 3) * 0.45, i < 3 ? 1.32 : 1.77, 0);
    g.add(t);
  }
  return g;
}
export function aquarium() {
  const g = new THREE.Group();
  box(g, 1.2, 0.75, 0.45, M.black(), 0, 0.375, 0);
  const w = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.55, 0.42), mat('aqwater', { color: '#3fb4e8', transparent: true, opacity: 0.45, roughness: 0.05, emissive: '#1a5a80', emissiveIntensity: 0.5 }));
  w.position.y = 1.05; g.add(w);
  const fish = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.emissive(['#ff8a1a', '#ffd23f', '#2fe6ff', '#ff4fa3'][i % 4], 1));
    f.scale.set(1.6, 1, 0.6);
    f.position.set((Math.random() - 0.5) * 0.9, 0.85 + Math.random() * 0.4, (Math.random() - 0.5) * 0.25);
    fish.add(f);
  }
  g.add(fish);
  g.userData.fish = fish;
  box(g, 1.2, 0.05, 0.45, M.black(), 0, 1.35, 0);
  return g;
}
export function poolTable() {
  const g = new THREE.Group();
  box(g, 2.5, 0.15, 1.4, M.darkWood(), 0, 0.8, 0);
  box(g, 2.3, 0.02, 1.2, mat('felt', { color: '#1f6b3a', roughness: 1 }), 0, 0.885, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.15, 0.75, 0.15, M.darkWood(), sx * 1.1, 0.375, sz * 0.55);
  const cols = ['#ffffff', '#d92b3a', '#ffd23f', '#1e4fd9', '#111111', '#2f7d5b', '#e46f2e'];
  cols.forEach((c, i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat('ball' + c, { color: c, roughness: 0.15 })); b.position.set(-0.4 + (i % 3) * 0.07 + (i > 2 ? 0.4 : 0), 0.925, -0.1 + Math.floor(i / 3) * 0.07); g.add(b); });
  return g;
}
/**
 * Home gym: power rack with a loaded barbell on the J-hooks (squats), a flat
 * bench with its own uprights and bar (bench press), a dumbbell rack, rubber
 * flooring. userData.squatBar / benchBar / dumbbells are hidden while in use.
 * Local layout (front = +z): rack at z -0.45, bench along z from 0.2 to 1.4,
 * dumbbell rack on the left at x -1.15.
 */
export function gymRack() {
  const g = new THREE.Group();
  const frame = mat('gym_frame', { color: '#1d1f22', roughness: 0.5, metalness: 0.7 });
  const iron = mat('gym_iron', { color: '#1b1c1f', roughness: 0.45, metalness: 0.6 });
  const steel = mat('gym_steel', { color: '#c9cdd2', roughness: 0.25, metalness: 1 });
  const rubber = mat('gym_rubber', { color: '#202224', roughness: 0.95 });
  const pad = M.leather('#141416');
  box(g, 2.9, 0.02, 2.4, rubber, -0.35, 0.01, 0.3);
  // power rack
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.95, 0.05]) box(g, 0.07, 2.3, 0.07, frame, sx, 1.15, sz - 0.0);
  for (const sz of [-0.95, 0.05]) box(g, 1.31, 0.07, 0.07, frame, 0, 2.3, sz);
  for (const sx of [-0.62, 0.62]) { box(g, 0.07, 0.07, 1.07, frame, sx, 2.3, -0.45); box(g, 0.07, 0.07, 1.07, frame, sx, 0.05, -0.45); }
  for (const sx of [-0.62, 0.62]) box(g, 0.1, 0.06, 0.12, steel, sx, 1.33, 0.1);
  const bar = (y: number, z: number) => {
    const b = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.0, 8), steel); c.rotation.z = Math.PI / 2; b.add(c);
    for (const x of [-0.82, 0.82]) for (const [r, w, o] of [[0.22, 0.05, 1], [0.17, 0.04, 1.06]] as const) { const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), iron); p.rotation.z = Math.PI / 2; p.position.x = x * o; p.castShadow = true; b.add(p); }
    b.position.set(0, y, z);
    g.add(b);
    return b;
  };
  g.userData.squatBar = bar(1.4, 0.1);
  // flat bench with uprights
  box(g, 0.3, 0.09, 1.2, pad, 0, 0.45, 0.85);
  box(g, 0.08, 0.4, 0.08, frame, 0, 0.2, 0.4); box(g, 0.08, 0.4, 0.08, frame, 0, 0.2, 1.3);
  box(g, 0.5, 0.05, 0.08, frame, 0, 0.03, 0.4); box(g, 0.5, 0.05, 0.08, frame, 0, 0.03, 1.3);
  for (const sx of [-0.55, 0.55]) { box(g, 0.06, 1.05, 0.06, frame, sx, 0.52, 0.32); box(g, 0.1, 0.06, 0.1, steel, sx, 1.02, 0.34); }
  g.userData.benchBar = bar(1.07, 0.36);
  // dumbbell rack (two tiers) on the left
  box(g, 0.45, 0.04, 1.3, frame, -1.2, 0.45, 0.2); box(g, 0.45, 0.04, 1.3, frame, -1.2, 0.8, 0.2);
  for (const sz of [-0.42, 0.82]) box(g, 0.45, 0.85, 0.05, frame, -1.2, 0.42, sz);
  const dbs = new THREE.Group();
  for (let i = 0; i < 6; i++) for (const tier of [0.5, 0.85]) {
    const d = new THREE.Group();
    const hnd = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 8), steel); hnd.rotation.z = Math.PI / 2; d.add(hnd);
    const r = 0.045 + i * 0.006;
    for (const x of [-0.1, 0.1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 6), iron); p.rotation.z = Math.PI / 2; p.position.x = x; d.add(p); }
    d.position.set(-1.2, tier + r, -0.3 + i * 0.2);
    d.rotation.y = Math.PI / 2;
    dbs.add(d);
  }
  g.add(dbs);
  g.userData.dumbbells = dbs.children[0];
  // precise colliders [cx, cz, sx, sz] so you can step into the rack and up to the bench
  g.userData.colliders = [[-0.62, -0.95, 0.15, 0.15], [0.62, -0.95, 0.15, 0.15], [-0.62, 0.05, 0.15, 0.15], [0.62, 0.05, 0.15, 0.15], [0, 0.85, 0.32, 1.1], [-1.2, 0.2, 0.45, 1.3]];
  return g;
}
export function homeBar() {
  const g = new THREE.Group();
  box(g, 2.0, 1.05, 0.55, M.darkWood(), 0, 0.525, 0);
  box(g, 2.1, 0.05, 0.65, M.marbleTop(), 0, 1.07, 0);
  box(g, 2.0, 0.04, 0.3, M.darkWood(), 0, 1.6, -0.6);
  box(g, 2.0, 0.04, 0.3, M.darkWood(), 0, 2.0, -0.6);
  for (let i = 0; i < 8; i++) cyl(g, 0.04, 0.04, 0.28, mat('bottle' + (i % 4), { color: ['#3a7a3a', '#8c2f39', '#d9a441', '#2d3a55'][i % 4], roughness: 0.1, transparent: true, opacity: 0.85 }), -0.85 + i * 0.24, 1.76 + (i % 2) * 0.4, -0.6, 10);
  box(g, 2.0, 0.03, 0.03, M.emissive('#ffb03f', 1.5), 0, 1.04, 0.3);
  return g;
}
export function arcade() {
  const g = new THREE.Group();
  box(g, 0.7, 1.8, 0.7, mat('arcadebody', { color: '#2a1050', roughness: 0.5 }), 0, 0.9, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), M.emissive('#2fe6ff', 0.9));
  s.position.set(0, 1.35, 0.351); s.rotation.x = -0.15; g.add(s);
  box(g, 0.6, 0.06, 0.25, M.black(), 0, 1.02, 0.42);
  box(g, 0.66, 0.15, 0.05, M.emissive('#ff2f9a', 2), 0, 1.72, 0.36);
  return g;
}
export function gameConsole() {
  const g = new THREE.Group();
  box(g, 0.35, 0.08, 0.28, M.white(), 0, 0.04, 0);
  box(g, 0.3, 0.01, 0.01, M.emissive('#4fb3ff', 2), 0, 0.06, 0.141);
  return g;
}
export function smartLights() {
  const g = new THREE.Group();
  const m = mat('smartlight_' + Math.random(), { color: '#ffffff', emissive: '#7a5cff', emissiveIntensity: 2.5, roughness: 0.4 });
  box(g, 2.0, 0.03, 0.03, m, 0, 2.4, 0);
  g.userData.lightMat = m;
  return g;
}
export function aircon() {
  const g = new THREE.Group();
  rbox(g, 0.9, 0.3, 0.22, 0.05, M.white(), 0, 2.3, 0);
  box(g, 0.7, 0.02, 0.02, M.black(), 0, 2.2, 0.11);
  return g;
}
export function securityCam() {
  const g = new THREE.Group();
  box(g, 0.1, 0.1, 0.1, M.white(), 0, 2.4, 0);
  cyl(g, 0.05, 0.05, 0.18, M.white(), 0, 2.33, 0.08, 10).rotation.x = Math.PI / 2 - 0.4;
  const led = box(g, 0.02, 0.02, 0.02, M.emissive('#ff2020', 3), 0.03, 2.36, 0.17);
  led.castShadow = false;
  return g;
}
export function art(seed: number, w = 0.8, h = 1.0) {
  const g = new THREE.Group();
  box(g, w + 0.06, h + 0.06, 0.04, M.black(), 0, 1.6, 0);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat('art' + seed, { map: artTexture(seed), roughness: 0.7 }));
  p.position.set(0, 1.6, 0.025); g.add(p);
  return g;
}
export function rig(screens?: THREE.Material[]) {
  const g = new THREE.Group();
  g.add(desk(2.0, 0.8));
  for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) {
    const m = monitor(screens?.[(row * 3 + i) % (screens?.length ?? 1)], 0.55);
    m.position.set((i - 1) * 0.58, 0.76 + row * 0.33 - (row ? 0.25 : 0), -0.2);
    m.rotation.y = (1 - i) * 0.2;
    if (row) { m.children.slice(2).forEach((c) => (c.visible = false)); }
    g.add(m);
  }
  const k = keyboard(); k.position.set(0, 0.77, 0.15); g.add(k);
  return g;
}
export function shower() {
  const g = new THREE.Group();
  box(g, 1.0, 0.08, 1.0, M.porcelain(), 0, 0.04, 0);
  box(g, 0.02, 2.0, 1.0, M.glass(), 0.5, 1.04, 0);
  box(g, 1.0, 2.0, 0.02, M.glass(), 0, 1.04, 0.5);
  cyl(g, 0.12, 0.12, 0.02, M.chrome(), 0, 2.1, -0.3, 16);
  cyl(g, 0.015, 0.015, 0.5, M.chrome(), 0, 2.2, -0.45, 6);
  return g;
}
export function bathtub() {
  const g = new THREE.Group();
  rbox(g, 1.7, 0.55, 0.8, 0.15, M.porcelain(), 0, 0.28, 0);
  box(g, 1.5, 0.02, 0.6, mat('bathwater', { color: '#9fd8ef', transparent: true, opacity: 0.6, roughness: 0.05 }), 0, 0.5, 0);
  cyl(g, 0.02, 0.02, 0.3, M.chrome(), -0.75, 0.7, 0, 8);
  return g;
}
export function toilet() {
  const g = new THREE.Group();
  rbox(g, 0.4, 0.4, 0.55, 0.12, M.porcelain(), 0, 0.2, 0.05);
  rbox(g, 0.42, 0.45, 0.18, 0.05, M.porcelain(), 0, 0.6, -0.22);
  box(g, 0.38, 0.03, 0.45, M.porcelain(), 0, 0.42, 0.06);
  return g;
}
export function bathSink() {
  const g = new THREE.Group();
  box(g, 0.8, 0.8, 0.5, M.white(), 0, 0.4, 0);
  rbox(g, 0.5, 0.12, 0.38, 0.08, M.porcelain(), 0, 0.86, 0);
  cyl(g, 0.015, 0.015, 0.22, M.chrome(), 0, 0.98, -0.18, 8);
  const mr = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.8), mat('mirror', { color: '#d8e4ec', metalness: 1, roughness: 0.02, envMapIntensity: 1.6 }));
  mr.position.set(0, 1.6, -0.24); g.add(mr);
  return g;
}
export function counterBar(w = 4, color = '#2a2a30', top?: THREE.Material) {
  const g = new THREE.Group();
  box(g, w, 1.05, 0.7, mat('bar_' + color, { color, roughness: 0.45 }), 0, 0.525, 0);
  box(g, w + 0.1, 0.05, 0.85, top ?? M.marbleTop(), 0, 1.07, 0);
  return g;
}
export function djBooth() {
  const g = new THREE.Group();
  box(g, 2.6, 1.1, 0.9, M.black(), 0, 0.55, 0);
  box(g, 2.6, 0.08, 0.9, M.emissive('#2fe6ff', 2.5), 0, 0.2, 0.46);
  for (const sx of [-0.7, 0.7]) cyl(g, 0.18, 0.18, 0.04, M.steel(), sx, 1.13, 0, 24);
  box(g, 0.6, 0.06, 0.4, M.black(), 0, 1.13, 0);
  return g;
}
export function speakerStack() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    box(g, 1.0, 0.9, 0.8, M.black(), 0, 0.45 + i * 0.92, 0);
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), mat('cone', { color: '#2a2a2e', roughness: 0.8 }));
    c.position.set(0, 0.45 + i * 0.92, 0.41); g.add(c);
  }
  return g;
}
export function boothSeat(w = 1.6, color = '#8c2f39') {
  const g = new THREE.Group();
  const l = M.leather(color);
  rbox(g, w, 0.45, 0.6, 0.08, l, 0, 0.225, 0);
  rbox(g, w, 0.7, 0.18, 0.06, l, 0, 0.75, -0.25);
  return g;
}
export function menuBoard(tex: THREE.Texture) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5 }));
  p.position.y = 2.3; g.add(p);
  return g;
}
export function kiosk(screen?: THREE.Material) {
  const g = new THREE.Group();
  rbox(g, 0.6, 1.1, 0.4, 0.06, M.white(), 0, 0.55, 0);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), screen ?? M.emissive('#38f2a5', 0.8));
  s.position.set(0, 1.45, 0.05); s.rotation.x = -0.2; g.add(s);
  box(g, 0.56, 0.76, 0.06, M.black(), 0, 1.45, 0);
  return g;
}
export function whiteboard() {
  const g = new THREE.Group();
  box(g, 2.0, 1.1, 0.04, M.white(), 0, 1.5, 0);
  const lines = mat('wbink', { color: '#2d3a55', roughness: 0.8 });
  for (let i = 0; i < 5; i++) box(g, 0.4 + (i * 37 % 9) / 10, 0.02, 0.005, lines, -0.5 + (i % 2) * 0.4, 1.8 - i * 0.15, 0.025);
  return g;
}
export function clothingRack(colors: string[]) {
  const g = new THREE.Group();
  for (const sx of [-0.7, 0.7]) box(g, 0.03, 1.5, 0.03, M.chrome(), sx, 0.75, 0);
  cyl(g, 0.015, 0.015, 1.45, M.chrome(), 0, 1.5, 0, 8).rotation.z = Math.PI / 2;
  colors.forEach((c, i) => box(g, 0.05, 0.75, 0.45, mat('rackcloth' + c, { map: fabric(c), roughness: 0.9 }), -0.6 + i * (1.2 / Math.max(1, colors.length - 1)), 1.1, 0));
  return g;
}
export function mannequin(color: string) {
  const g = new THREE.Group();
  const w = mat('manq', { color: '#e8e4dc', roughness: 0.4 });
  cyl(g, 0.2, 0.22, 0.04, M.black(), 0, 0.02, 0);
  cyl(g, 0.02, 0.02, 0.9, M.chrome(), 0, 0.45, 0, 6);
  const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.35, 4, 10), mat('manqcloth' + color, { map: fabric(color), roughness: 0.9 }));
  t.position.y = 1.2; t.scale.z = 0.7; g.add(t);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), w); h.position.y = 1.62; g.add(h);
  return g;
}
export function stanchion(len = 2) {
  const g = new THREE.Group();
  for (const sx of [-len / 2, len / 2]) { cyl(g, 0.03, 0.03, 1.0, M.gold(), sx, 0.5, 0, 8); cyl(g, 0.15, 0.15, 0.03, M.gold(), sx, 0.015, 0, 12); }
  const rope = new THREE.Mesh(new THREE.TorusGeometry(len / 2, 0.025, 6, 20, Math.PI), mat('rope', { color: '#8c1a2a', roughness: 0.8 }));
  rope.rotation.z = Math.PI; rope.position.y = 0.95; rope.scale.y = 0.15; g.add(rope);
  return g;
}
export function piano() {
  const g = new THREE.Group();
  const pm = mat('pianoblack', { color: '#08080a', roughness: 0.08, metalness: 0.3 });
  rbox(g, 1.5, 0.3, 1.9, 0.3, pm, 0, 0.95, 0);
  for (const [x, z] of [[-0.6, -0.7], [0.6, -0.7], [0, 0.8]]) cyl(g, 0.05, 0.05, 0.8, pm, x, 0.4, z, 8);
  box(g, 1.3, 0.04, 0.15, M.white(), 0, 0.85, -0.95);
  return g;
}
export function liftPost() {
  const g = new THREE.Group();
  for (const sx of [-1.6, 1.6]) box(g, 0.25, 3.2, 0.25, mat('liftred', { color: '#c02a2a', roughness: 0.5, metalness: 0.4 }), sx, 1.6, 0);
  box(g, 3.4, 0.15, 0.3, M.black(), 0, 3.2, 0);
  return g;
}
export function toolbox() {
  const g = new THREE.Group();
  box(g, 1.0, 1.0, 0.5, mat('toolred', { color: '#c02a2a', roughness: 0.4, metalness: 0.5 }), 0, 0.5, 0);
  for (let i = 0; i < 5; i++) box(g, 0.9, 0.01, 0.02, M.steel(), 0, 0.15 + i * 0.18, 0.26);
  return g;
}
export function stage(w = 10, d = 5, h = 0.9) {
  const g = new THREE.Group();
  box(g, w, h, d, M.black(), 0, h / 2, 0);
  box(g, w, 0.04, d, mat('stagefloor', { color: '#1e1e24', roughness: 0.3, metalness: 0.2 }), 0, h + 0.02, 0);
  box(g, w, 0.05, 0.05, M.emissive('#38f2a5', 2), 0, h - 0.05, d / 2);
  return g;
}
export function podium() {
  const g = new THREE.Group();
  box(g, 0.7, 1.1, 0.5, M.darkWood(), 0, 0.55, 0);
  box(g, 0.75, 0.05, 0.55, M.black(), 0, 1.12, 0.02).rotation.x = 0.2;
  cyl(g, 0.01, 0.01, 0.3, M.black(), 0, 1.3, 0.1, 6);
  return g;
}
export function booth(screen?: THREE.Material, color = '#3fa7ff') {
  const g = new THREE.Group();
  box(g, 3.0, 2.6, 0.1, mat('boothwall' + color, { color: '#f2f1ec', roughness: 0.7 }), 0, 1.3, -1.0);
  box(g, 3.0, 0.4, 0.12, M.emissive(color, 1.2), 0, 2.7, -0.95);
  box(g, 1.6, 1.0, 0.6, M.white(), 0, 0.5, 0.3);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), screen ?? M.screenOff());
  s.position.set(0, 1.6, -0.94); g.add(s);
  g.userData.screen = s;
  return g;
}
export function audienceChair() {
  const g = new THREE.Group();
  const m = M.fabric('#2d3a55');
  box(g, 0.5, 0.08, 0.5, m, 0, 0.45, 0);
  box(g, 0.5, 0.5, 0.06, m, 0, 0.72, -0.22);
  box(g, 0.04, 0.45, 0.04, M.black(), -0.2, 0.22, 0); box(g, 0.04, 0.45, 0.04, M.black(), 0.2, 0.22, 0);
  return g;
}
export function espressoMachine() {
  const g = new THREE.Group();
  rbox(g, 0.75, 0.48, 0.5, 0.05, M.steel(), 0, 0.24, 0);
  for (const sx of [-0.2, 0.2]) cyl(g, 0.04, 0.04, 0.08, M.black(), sx, 0.1, 0.27, 10);
  box(g, 0.7, 0.04, 0.45, M.chrome(), 0, 0.5, 0);
  return g;
}
export function foodItem(model: string) {
  const g = new THREE.Group();
  switch (model) {
    case 'cup': cyl(g, 0.045, 0.035, 0.09, M.porcelain(), 0, 0.045, 0, 12); cyl(g, 0.04, 0.04, 0.005, mat('coffee', { color: '#3b2210', roughness: 0.3 }), 0, 0.088, 0, 12); break;
    case 'glass': cyl(g, 0.04, 0.035, 0.14, M.glass(), 0, 0.07, 0, 12); cyl(g, 0.036, 0.032, 0.1, mat('drinkgreen', { color: '#7fd06a', roughness: 0.2, transparent: true, opacity: 0.8 }), 0, 0.05, 0, 12); break;
    case 'can': cyl(g, 0.033, 0.033, 0.12, mat('can', { color: '#2fe6ff', metalness: 0.8, roughness: 0.3 }), 0, 0.06, 0, 12); break;
    case 'bottle': cyl(g, 0.045, 0.045, 0.26, mat('bottlegreen', { color: '#1e4a2a', roughness: 0.1, metalness: 0.3 }), 0, 0.13, 0, 12); cyl(g, 0.015, 0.02, 0.1, M.gold(), 0, 0.31, 0, 8); break;
    case 'burger': cyl(g, 0.09, 0.09, 0.04, mat('bun', { color: '#c8862e', roughness: 0.7 }), 0, 0.02, 0); cyl(g, 0.095, 0.095, 0.025, mat('patty', { color: '#4a2a18', roughness: 0.8 }), 0, 0.05, 0); const t = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('bun', { color: '#c8862e', roughness: 0.7 })); t.position.y = 0.062; t.scale.y = 0.6; g.add(t); break;
    case 'fries': box(g, 0.1, 0.1, 0.06, mat('friesbox', { color: '#d92b3a', roughness: 0.6 }), 0, 0.05, 0); for (let i = 0; i < 8; i++) box(g, 0.012, 0.08, 0.012, mat('fry', { color: '#f2c94c', roughness: 0.7 }), -0.035 + (i % 4) * 0.022, 0.12, -0.01 + Math.floor(i / 4) * 0.02); break;
    case 'pastry': { const p = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.03, 8, 12, Math.PI), mat('pastry', { color: '#d9a04a', roughness: 0.6 })); p.rotation.x = -Math.PI / 2; p.position.y = 0.03; g.add(p); break; }
    default: cyl(g, 0.14, 0.12, 0.02, M.porcelain(), 0, 0.01, 0, 20); { const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat('meal', { color: '#9a5a2a', roughness: 0.7 })); f.scale.y = 0.4; f.position.y = 0.035; g.add(f); const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat('greens', { color: '#4f8f35', roughness: 0.8 })); s.position.set(0.05, 0.035, 0.03); s.scale.y = 0.5; g.add(s); }
  }
  return g;
}

/** Map furniture catalog model keys to builders. */
export function catalogModel(model: string): THREE.Group {
  switch (model) {
    case 'plant': return plant(true);
    case 'lamp': return floorLamp();
    case 'rug': return rug();
    case 'bookshelf': return bookshelf();
    case 'armchair': return armchair();
    case 'speaker': { const g = new THREE.Group(); const a = speaker(); a.position.x = -0.4; const b = speaker(); b.position.x = 0.4; g.add(a, b); return g; }
    case 'tower_speaker': { const g = new THREE.Group(); const a = speaker(true); a.position.x = -0.5; const b = speaker(true); b.position.x = 0.5; g.add(a, b); return g; }
    case 'smartlights': return smartLights();
    case 'trophy': return trophyShelf(6);
    case 'camera': return securityCam();
    case 'art_small': return art(11, 0.6, 0.8);
    case 'aircon': return aircon();
    case 'tv55': { const g = new THREE.Group(); const s = tvStand(1.6); g.add(s); const t = tv(1.25); t.position.y = 1.0; g.add(t); g.userData.screen = t.userData.screen; return g; }
    case 'tv85': { const g = new THREE.Group(); const s = tvStand(2.2); g.add(s); const t = tv(1.9); t.position.y = 1.15; g.add(t); g.userData.screen = t.userData.screen; return g; }
    case 'console': { const g = new THREE.Group(); const s = tvStand(1.0); g.add(s); const c = gameConsole(); c.position.y = 0.48; g.add(c); return g; }
    case 'aquarium': return aquarium();
    case 'arcade': return arcade();
    case 'gym': return gymRack();
    case 'rig': return rig();
    case 'bar': return homeBar();
    case 'pool': return poolTable();
    case 'art_large': return art(42, 1.6, 1.1);
    default: return plant();
  }
}
