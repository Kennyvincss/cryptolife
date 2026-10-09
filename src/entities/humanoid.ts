// Procedurally modelled, procedurally animated human character.

import * as THREE from 'three';
import { CLOTHING_BY_ID } from '../../shared/catalog.js';
import type { Look } from '../../shared/types.js';
import { mat } from '../engine/build.js';
import { fabric } from '../engine/textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BAKED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });

export type Anim = 'idle' | 'walk' | 'run' | 'sit' | 'sleep' | 'dance' | 'drive' | 'phone' | 'eat' | 'talk' | 'wave' | 'workout' | 'type' | 'ride';

const capsule = (r: number, len: number, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
const sphere = (r: number, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75));

function skinMat(hex: string) {
  return mat('skin_' + hex, { color: hex, roughness: 0.55, metalness: 0 });
}
function clothMat(hex: string, style = 'cotton') {
  const rough = style === 'leather' ? 0.38 : style === 'suit' ? 0.7 : 0.88;
  const m = mat(`cloth_${hex}_${style}`, { color: '#ffffff', map: style === 'leather' ? null : fabric(hex), roughness: rough, metalness: 0, ...(style === 'leather' ? { color: hex } : {}) });
  m.userData.base = hex;
  return m;
}
function darker(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

interface Joint { g: THREE.Group; target: THREE.Euler }

export class Humanoid {
  root = new THREE.Group();
  body = new THREE.Group(); // offset for bobbing / lying
  hips = new THREE.Group();
  spine = new THREE.Group();
  chest = new THREE.Group();
  neck = new THREE.Group();
  head = new THREE.Group();
  lShoulder = new THREE.Group(); rShoulder = new THREE.Group();
  lElbow = new THREE.Group(); rElbow = new THREE.Group();
  lHip = new THREE.Group(); rHip = new THREE.Group();
  lKnee = new THREE.Group(); rKnee = new THREE.Group();
  lFoot = new THREE.Group(); rFoot = new THREE.Group();
  rHand = new THREE.Group();
  phone: THREE.Mesh;
  heldItem: THREE.Object3D | null = null;
  anim: Anim = 'idle';
  phase = Math.random() * 10;
  speed = 0;
  danceMove = 0;
  private joints: Joint[] = [];
  private tag?: THREE.Sprite;
  look: Look;
  hipHeight = 0.95;
  private blink = 0;
  private eyes: THREE.Object3D[] = [];
  castShadows = true;

  constructor(look: Look) {
    this.look = look;
    this.root.add(this.body);
    this.phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.012), mat('phone', { color: '#101014', roughness: 0.2, metalness: 0.6, emissive: '#2a6cff', emissiveIntensity: 0.25 }));
    this.build();
  }

  setLook(look: Look) {
    this.look = look;
    this.body.clear();
    this.joints = [];
    this.eyes = [];
    for (const g of [this.hips, this.spine, this.chest, this.neck, this.head, this.lShoulder, this.rShoulder, this.lElbow, this.rElbow, this.lHip, this.rHip, this.lKnee, this.rKnee, this.lFoot, this.rFoot, this.rHand]) g.clear();
    this.build();
    if (this.tag) this.root.add(this.tag);
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  private build() {
    const L = this.look;
    const f = L.body === 'f';
    const H = L.height;
    const W = L.build * (f ? 0.9 : 1);
    const skin = skinMat(L.skin);
    const topId = L.outfit.top ?? 'tee';
    const topDef = CLOTHING_BY_ID[topId];
    const topStyle = topDef?.style ?? 'tee';
    const topColor = L.colors.top ?? '#eeeeee';
    const top = clothMat(topColor, topStyle === 'jacket' ? 'leather' : topStyle === 'suit' || topStyle === 'blazer' ? 'suit' : 'cotton');
    const botDef = CLOTHING_BY_ID[L.outfit.bottom ?? 'jeans'];
    const botStyle = botDef?.style ?? 'pants';
    const bot = clothMat(L.colors.bottom ?? '#2f4a7a', 'cotton');
    const shoeDef = CLOTHING_BY_ID[L.outfit.shoes ?? 'sneakers'];
    const shoe = mat('shoe_' + (L.colors.shoes ?? '#fff'), { color: L.colors.shoes ?? '#ffffff', roughness: 0.6 });
    const sole = mat('sole', { color: '#e8e4dc', roughness: 0.9 });
    const hairM = mat('hair_' + L.hairColor, { color: L.hairColor, roughness: 0.75, metalness: 0.05 });

    this.hipHeight = 0.95 * H;
    this.body.add(this.hips);
    this.hips.position.set(0, this.hipHeight, 0);

    // pelvis
    if (botStyle === 'skirt') {
      const sk = new THREE.CylinderGeometry(0.15 * W, 0.26 * W, 0.34, 18, 1, true);
      const m = this.add(this.hips, sk, mat('skirt_' + (L.colors.bottom ?? ''), { color: L.colors.bottom ?? '#333', roughness: 0.85, side: THREE.DoubleSide }), 0, -0.12, 0, 1, 1, 0.8);
      m.castShadow = true;
      this.add(this.hips, sphere(0.16), bot, 0, 0.02, 0, W * (f ? 1.12 : 1.05), 0.7, 0.75);
    } else {
      this.add(this.hips, sphere(0.16), bot, 0, 0.02, 0, W * (f ? 1.12 : 1.05), 0.75, 0.75);
    }

    // spine / torso
    this.hips.add(this.spine);
    this.spine.position.set(0, 0.06, 0);
    this.spine.add(this.chest);
    this.chest.position.set(0, 0.16, 0);
    const torsoW = (f ? 0.92 : 1.08) * W;
    this.add(this.spine, capsule(0.14, 0.14), top, 0, 0.06, 0, torsoW * 0.95, 1, 0.72); // abdomen
    this.add(this.chest, capsule(0.16, 0.16), top, 0, 0.1, 0, torsoW, 1, 0.74); // chest
    if (f) {
      this.add(this.chest, sphere(0.07), top, 0.065, 0.1, 0.075, 1, 0.85, 0.8);
      this.add(this.chest, sphere(0.07), top, -0.065, 0.1, 0.075, 1, 0.85, 0.8);
    }
    // shoulders yoke
    this.add(this.chest, capsule(0.075, 0.26 * torsoW, 8), top, 0, 0.22, -0.005, 1, 1, 0.9).rotation.z = Math.PI / 2;

    // top details
    if (topStyle === 'hoodie' || topStyle === 'hoodie_logo') {
      this.add(this.chest, new THREE.TorusGeometry(0.1, 0.04, 8, 16), top, 0, 0.27, -0.05, 1.1, 1, 1.2).rotation.x = Math.PI / 2.4;
      this.add(this.spine, new THREE.BoxGeometry(0.2, 0.08, 0.02), mat('pocket_' + topColor, { color: darker(topColor, 0.85), roughness: 0.9 }), 0, 0.02, 0.105 * 0.72 + 0.02);
      if (topStyle === 'hoodie_logo') this.add(this.chest, new THREE.CircleGeometry(0.045, 20), mat('logo_btc', { color: '#f7931a', emissive: '#f7931a', emissiveIntensity: 0.15, roughness: 0.5 }), 0, 0.12, 0.125);
    }
    if (topStyle === 'blazer' || topStyle === 'suit') {
      const shirt = mat('shirt_white', { color: '#f4f4f2', roughness: 0.7 });
      this.add(this.chest, new THREE.BoxGeometry(0.1, 0.24, 0.02), shirt, 0, 0.12, 0.118);
      const lapel = mat('lapel_' + topColor, { color: darker(topColor, 0.7), roughness: 0.6 });
      const lg = new THREE.BoxGeometry(0.035, 0.2, 0.012);
      this.add(this.chest, lg, lapel, 0.055, 0.14, 0.122).rotation.z = 0.35;
      this.add(this.chest, lg, lapel, -0.055, 0.14, 0.122).rotation.z = -0.35;
      if (topStyle === 'suit') this.add(this.chest, new THREE.BoxGeometry(0.03, 0.18, 0.01), mat('tie', { color: '#7a1f2a', roughness: 0.5 }), 0, 0.1, 0.13);
    }
    if (topStyle === 'shirt') {
      const bm = mat('button', { color: '#ddd', roughness: 0.4 });
      for (let i = 0; i < 4; i++) this.add(this.chest, sphere(0.008, 6), bm, 0, 0.2 - i * 0.07, 0.12);
      this.add(this.chest, new THREE.BoxGeometry(0.16, 0.03, 0.08), top, 0, 0.29, 0.02);
    }
    if (topStyle === 'jersey') {
      this.add(this.chest, new THREE.BoxGeometry(0.12, 0.08, 0.01), mat('jersey_num', { color: '#ffffff', roughness: 0.7 }), 0, 0.1, 0.124);
    }

    // neck & head
    this.chest.add(this.neck);
    this.neck.position.set(0, 0.3, 0);
    this.add(this.neck, new THREE.CylinderGeometry(0.048, 0.055, 0.1, 12), skin, 0, 0.03, 0);
    this.neck.add(this.head);
    this.head.position.set(0, 0.17, 0.01);
    const headM = this.add(this.head, sphere(0.112, 24), skin, 0, 0, 0, f ? 0.88 : 0.92, 1.08, 1);
    headM.castShadow = true;
    // jaw
    this.add(this.head, sphere(0.08, 16), skin, 0, -0.055, 0.025, f ? 0.95 : 1.08, 0.75, 1);
    // ears
    this.add(this.head, sphere(0.025, 8), skin, 0.1, 0, 0, 0.5, 1, 0.8);
    this.add(this.head, sphere(0.025, 8), skin, -0.1, 0, 0, 0.5, 1, 0.8);
    // nose
    this.add(this.head, new THREE.ConeGeometry(0.018, 0.045, 8), skin, 0, -0.012, 0.11).rotation.x = Math.PI / 2.3;
    // eyes
    const white = mat('eyewhite', { color: '#f4f2ee', roughness: 0.25 });
    const iris = mat('iris_' + L.eyeColor, { color: L.eyeColor, roughness: 0.2 });
    const pupil = mat('pupil', { color: '#0a0a0a', roughness: 0.1 });
    for (const sx of [-1, 1]) {
      const eg = new THREE.Group();
      eg.position.set(sx * 0.038, 0.018, 0.088);
      this.head.add(eg);
      const e = this.add(eg, sphere(0.017, 12), white, 0, 0, 0, 1, 0.8, 0.6);
      e.castShadow = false;
      this.add(eg, sphere(0.009, 10), iris, 0, 0, 0.009, 1, 1, 0.5).castShadow = false;
      this.add(eg, sphere(0.004, 6), pupil, 0, 0, 0.0125).castShadow = false;
      this.eyes.push(eg);
      // brows
      const brow = this.add(this.head, new THREE.BoxGeometry(0.035, 0.007, 0.01), hairM, sx * 0.04, 0.045, 0.098);
      brow.rotation.z = sx * -0.12;
      brow.castShadow = false;
    }
    // mouth
    this.add(this.head, new THREE.BoxGeometry(0.038, 0.006, 0.01), mat('lips_' + L.skin, { color: darker(L.skin, 0.7), roughness: 0.5 }), 0, -0.055, 0.1).castShadow = false;

    this.buildHair(L, hairM);
    this.buildHat(L);
    this.buildGlasses(L);

    // arms
    const sleeveFull = ['hoodie', 'hoodie_logo', 'shirt', 'blazer', 'jacket', 'suit'].includes(topStyle);
    const sleeveShort = topStyle === 'tee' || topStyle === 'jersey';
    for (const side of [-1, 1] as const) {
      const sh = side < 0 ? this.lShoulder : this.rShoulder;
      const el = side < 0 ? this.lElbow : this.rElbow;
      sh.position.set(side * (0.2 * torsoW + 0.02), 0.22, 0);
      this.chest.add(sh);
      const upper = sleeveFull || sleeveShort ? top : skin;
      this.add(sh, capsule(0.048 * W, 0.2), upper, 0, -0.14, 0);
      if (sleeveShort) this.add(sh, capsule(0.044 * W, 0.04), skin, 0, -0.26, 0);
      el.position.set(0, -0.29, 0);
      sh.add(el);
      this.add(el, capsule(0.04 * W, 0.18), sleeveFull ? top : skin, 0, -0.12, 0);
      // hand
      const hand = this.add(el, sphere(0.045, 12), skin, 0, -0.27, 0.005, 0.75, 1.1, 0.5);
      hand.castShadow = false;
      this.add(el, capsule(0.012, 0.04, 4), skin, side * -0.025, -0.25, 0.025).rotation.z = side * 0.6; // thumb
      if (side > 0) { this.rHand.position.set(0, -0.3, 0.03); el.add(this.rHand); }
    }
    // watch on left wrist
    if (L.outfit.watch) {
      const c = L.colors.watch ?? '#c0c6cc';
      this.add(this.lElbow, new THREE.TorusGeometry(0.038, 0.012, 6, 16), mat('watch_' + c, { color: c, metalness: 0.9, roughness: 0.25 }), 0, -0.22, 0).rotation.x = Math.PI / 2;
      this.add(this.lElbow, new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12), mat('watchface', { color: '#0d0f12', roughness: 0.1, metalness: 0.3 }), 0, -0.22, 0.045).rotation.x = Math.PI / 2;
    }
    // chain
    if (L.outfit.chain) {
      const c = L.colors.chain ?? '#d4af37';
      this.add(this.chest, new THREE.TorusGeometry(0.085, 0.008, 6, 24), mat('chain_' + c, { color: c, metalness: 1, roughness: 0.2 }), 0, 0.24, 0.04, 1, 1.3, 1).rotation.x = Math.PI / 2.6;
      if (CLOTHING_BY_ID[L.outfit.chain]?.style === 'chain_pendant') this.add(this.chest, new THREE.OctahedronGeometry(0.022), mat('diamond', { color: '#eaf6ff', metalness: 0.2, roughness: 0, emissive: '#99ccff', emissiveIntensity: 0.4 }), 0, 0.15, 0.13);
    }

    // legs
    const pants = botStyle === 'pants';
    const shorts = botStyle === 'shorts';
    for (const side of [-1, 1] as const) {
      const hp = side < 0 ? this.lHip : this.rHip;
      const kn = side < 0 ? this.lKnee : this.rKnee;
      const ft = side < 0 ? this.lFoot : this.rFoot;
      hp.position.set(side * 0.09 * W, -0.04, 0);
      this.hips.add(hp);
      this.add(hp, capsule(0.075 * W, 0.28), pants || shorts ? bot : skin, 0, -0.21, 0);
      if (shorts) this.add(hp, capsule(0.064 * W, 0.08), skin, 0, -0.38, 0);
      kn.position.set(0, -0.44, 0);
      hp.add(kn);
      this.add(kn, capsule(0.058 * W, 0.3), pants ? bot : skin, 0, -0.2, 0);
      ft.position.set(0, -0.42 * H / H, 0);
      kn.add(ft);
      const st = shoeDef?.style ?? 'sneaker';
      const sh = st === 'boot' || st === 'hightop' ? 0.12 : st === 'loafer' ? 0.06 : 0.08;
      this.add(ft, new THREE.BoxGeometry(0.1, sh, 0.24), shoe, 0, -0.02 - (0.08 - sh) / 2, 0.045);
      this.add(ft, sphere(0.05, 10), shoe, 0, -0.025, 0.15, 1, 0.7, 0.8);
      this.add(ft, new THREE.BoxGeometry(0.105, 0.025, 0.26), st === 'loafer' || st === 'boot' ? mat('sole_dark', { color: '#2a2018', roughness: 0.9 }) : sole, 0, -0.065, 0.05);
    }
    // feet height correction: total leg = 0.04+0.44+0.42+0.075 ≈ hip height
    const legLen = 0.04 + 0.44 + 0.42 + 0.077;
    this.hips.position.y = legLen;
    this.hipHeight = legLen;
    this.body.scale.setScalar(H);

    // bag
    if (L.outfit.bag) {
      const c = L.colors.bag ?? '#333';
      const st = CLOTHING_BY_ID[L.outfit.bag]?.style;
      const bm = mat('bag_' + c, { color: c, roughness: 0.7 });
      if (st === 'backpack') {
        this.add(this.chest, new THREE.BoxGeometry(0.26, 0.34, 0.12), bm, 0, 0.06, -0.16);
        this.add(this.chest, new THREE.BoxGeometry(0.03, 0.3, 0.02), bm, 0.09, 0.1, 0.1).rotation.x = 0.1;
        this.add(this.chest, new THREE.BoxGeometry(0.03, 0.3, 0.02), bm, -0.09, 0.1, 0.1).rotation.x = 0.1;
      } else if (st === 'messenger') {
        this.add(this.hips, new THREE.BoxGeometry(0.28, 0.2, 0.08), bm, 0.2, 0.05, 0.02);
        this.add(this.chest, new THREE.BoxGeometry(0.04, 0.6, 0.02), bm, 0, 0.0, 0.12).rotation.z = 0.7;
      } else {
        this.add(this.rElbow, new THREE.BoxGeometry(0.06, 0.26, 0.3), mat('tote_' + c, { color: c, roughness: 0.35, metalness: 0.1 }), 0.05, -0.45, 0);
      }
    }

    this.rHand.add(this.phone);
    this.phone.position.set(0, 0, 0.02);
    this.phone.rotation.set(-0.3, 0, 0);
    this.phone.visible = false;

    const J = (g: THREE.Group) => this.joints.push({ g, target: new THREE.Euler() });
    for (const g of [this.hips, this.spine, this.chest, this.neck, this.head, this.lShoulder, this.rShoulder, this.lElbow, this.rElbow, this.lHip, this.rHip, this.lKnee, this.rKnee, this.lFoot, this.rFoot]) J(g);
    this.setShadows(this.castShadows);
  }

  private buildHair(L: Look, hm: THREE.Material) {
    const s = L.hairStyle;
    if (s === 6) return; // bald
    const capR = s === 0 ? 0.116 : 0.122;
    const cap = new THREE.SphereGeometry(capR, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const m = this.add(this.head, cap, hm, 0, 0.012, -0.008, L.body === 'f' ? 0.92 : 0.96, 1.08, 1.05);
    m.rotation.x = -0.32;
    // back of head coverage
    this.add(this.head, sphere(capR * 0.98, 16), hm, 0, -0.005, -0.03, 0.95, 1.02, 0.9);
    if (s === 2) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const sp = this.add(this.head, new THREE.ConeGeometry(0.025, 0.07, 6), hm, Math.cos(a) * 0.06, 0.1, Math.sin(a) * 0.06 - 0.01);
        sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
    }
    if (s === 3) {
      this.add(this.head, new THREE.BoxGeometry(0.22, 0.3, 0.08), hm, 0, -0.12, -0.075);
      this.add(this.head, capsule(0.04, 0.2), hm, 0.1, -0.08, -0.01);
      this.add(this.head, capsule(0.04, 0.2), hm, -0.1, -0.08, -0.01);
    }
    if (s === 4) this.add(this.head, sphere(0.06), hm, 0, 0.1, -0.08);
    if (s === 5) this.add(this.head, sphere(0.17, 20), hm, 0, 0.05, -0.03, 1, 0.95, 1);
    if (s === 7) {
      this.add(this.head, sphere(0.035), hm, 0, 0.03, -0.125);
      this.add(this.head, capsule(0.03, 0.22), hm, 0, -0.12, -0.14).rotation.x = 0.15;
    }
    if (s === 1) this.add(this.head, new THREE.BoxGeometry(0.17, 0.035, 0.06), hm, 0.02, 0.085, 0.07).rotation.z = -0.15;
  }

  private buildHat(L: Look) {
    const id = L.outfit.hat;
    if (!id) return;
    const st = CLOTHING_BY_ID[id]?.style;
    const c = L.colors.hat ?? '#222';
    const hm = mat('hat_' + c, { color: c, roughness: 0.8 });
    if (st === 'cap') {
      this.add(this.head, new THREE.SphereGeometry(0.128, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hm, 0, 0.03, 0).rotation.x = -0.1;
      this.add(this.head, new THREE.CylinderGeometry(0.1, 0.1, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), hm, 0, 0.035, 0.09).rotation.x = 0.12;
    } else if (st === 'beanie') {
      this.add(this.head, new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hm, 0, 0.025, -0.005, 1, 1.15, 1);
    } else {
      this.add(this.head, new THREE.CylinderGeometry(0.11, 0.13, 0.1, 20), hm, 0, 0.09, 0);
      this.add(this.head, new THREE.CylinderGeometry(0.19, 0.19, 0.01, 24), hm, 0, 0.045, 0).rotation.x = 0.05;
    }
  }

  private buildGlasses(L: Look) {
    const id = L.outfit.glasses;
    if (!id) return;
    const st = CLOTHING_BY_ID[id]?.style;
    const c = L.colors.glasses ?? '#111';
    if (st === 'visor') {
      this.add(this.head, new THREE.CylinderGeometry(0.118, 0.118, 0.035, 24, 1, true, -1.1, 2.2), mat('visor_' + c, { color: c, emissive: c, emissiveIntensity: 1.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), 0, 0.02, 0.005).rotation.y = Math.PI;
      return;
    }
    const frame = mat('frame_' + c, { color: c, metalness: st === 'round' ? 0.9 : 0.2, roughness: 0.3 });
    const lens = mat('lens_' + st, { color: st === 'shades' ? '#050505' : '#9fc4ff', transparent: true, opacity: st === 'shades' ? 0.92 : 0.25, roughness: 0.05, metalness: 0.5 });
    for (const sx of [-1, 1]) {
      if (st === 'round') this.add(this.head, new THREE.TorusGeometry(0.024, 0.003, 6, 16), frame, sx * 0.04, 0.018, 0.108);
      else this.add(this.head, new THREE.BoxGeometry(0.05, 0.03, 0.006), frame, sx * 0.04, 0.018, 0.108);
      this.add(this.head, st === 'round' ? new THREE.CircleGeometry(0.023, 16) : new THREE.PlaneGeometry(0.046, 0.026), lens, sx * 0.04, 0.018, 0.112);
      this.add(this.head, new THREE.BoxGeometry(0.004, 0.004, 0.1), frame, sx * 0.095, 0.02, 0.06);
    }
    this.add(this.head, new THREE.BoxGeometry(0.03, 0.004, 0.004), frame, 0, 0.022, 0.11);
  }

  /**
   * Merge every joint's static meshes into one vertex-coloured mesh. Used for
   * NPCs and remote players to cut draw calls ~4x (the local player keeps full detail).
   */
  bake() {
    const stops = new Set<THREE.Object3D>([...this.joints.map((j) => j.g), this.rHand, this.body]);
    const inv = new THREE.Matrix4();
    const rel = new THREE.Matrix4();
    this.root.updateMatrixWorld(true);
    for (const j of this.joints) {
      const geos: THREE.BufferGeometry[] = [];
      const remove: THREE.Object3D[] = [];
      inv.copy(j.g.matrixWorld).invert();
      const visit = (o: THREE.Object3D) => {
        for (const c of [...o.children]) {
          if (stops.has(c)) continue;
          const m = c as THREE.Mesh;
          if (!m.isMesh) { visit(c); continue; }
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
          for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
          rel.multiplyMatrices(inv, m.matrixWorld);
          g.applyMatrix4(rel);
          const mm = m.material as THREE.MeshStandardMaterial;
          const col = mm.userData.base ? new THREE.Color(mm.userData.base) : (mm.color ?? new THREE.Color(1, 1, 1)).clone();
          if (mm.emissiveIntensity > 0.3 && mm.emissive && mm.emissive.getHex() !== 0) col.copy(mm.emissive);
          const n = g.attributes.position.count;
          const arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
          g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          geos.push(g);
          remove.push(m);
        }
      };
      visit(j.g);
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      for (const r of remove) r.removeFromParent();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, BAKED_MAT);
      mesh.castShadow = this.castShadows;
      j.g.add(mesh);
    }
    this.eyes = [];
  }

  setShadows(on: boolean) {
    this.castShadows = on;
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = on; });
  }

  setNameTag(text: string, kind: 'player' | 'npc' | 'self') {
    if (this.tag) { this.root.remove(this.tag); (this.tag.material as THREE.SpriteMaterial).map?.dispose(); }
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const x = c.getContext('2d')!;
    x.font = 'bold 44px "Segoe UI", Arial';
    x.textAlign = 'center';
    const tw = Math.min(480, x.measureText(text).width + 120);
    x.fillStyle = 'rgba(10,12,20,0.7)';
    roundRect(x, 256 - tw / 2, 18, tw, 64, 30); x.fill();
    x.fillStyle = kind === 'npc' ? '#9aa3ad' : '#38f2a5';
    x.font = 'bold 26px "Segoe UI", Arial';
    x.fillText(kind === 'npc' ? 'NPC' : 'PLAYER', 256 - tw / 2 + 50, 60);
    x.fillStyle = '#fff';
    x.font = 'bold 36px "Segoe UI", Arial';
    x.textAlign = 'left';
    x.fillText(text, 256 - tw / 2 + 96, 63);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
    s.scale.set(1.6, 0.4, 1);
    s.position.y = 2.15 * this.look.height;
    s.renderOrder = 10;
    this.tag = s;
    if (kind !== 'self') this.root.add(s);
  }
  showTag(v: boolean) { if (this.tag) this.tag.visible = v; }

  setHeld(obj: THREE.Object3D | null) {
    if (this.heldItem) this.rHand.remove(this.heldItem);
    this.heldItem = obj;
    if (obj) { obj.position.set(0, -0.02, 0.06); this.rHand.add(obj); }
  }

  /** Procedural animation. `speed` in m/s for locomotion. */
  update(dt: number, anim: Anim, speed = 0) {
    this.anim = anim;
    this.speed = speed;
    const T = this.joints;
    for (const j of T) j.target.set(0, 0, 0);
    const [hips, spine, chest, neck, head, lS, rS, lE, rE, lH, rH, lK, rK, lF, rF] = T.map((j) => j.target);
    let bob = 0, lie = 0, hipsY = 0;
    this.phone.visible = anim === 'phone';
    const breathe = Math.sin(this.phase * 0.5) * 0.02;

    switch (anim) {
      case 'walk':
      case 'run': {
        const run = anim === 'run';
        const freq = run ? 1.45 : 1.05 + speed * 0.08;
        this.phase += dt * Math.max(speed, 1) * freq * 1.4;
        const s = Math.sin(this.phase), c = Math.cos(this.phase);
        const amp = run ? 0.75 : 0.42;
        lH.x = s * amp; rH.x = -s * amp;
        lK.x = Math.max(0, -c) * (run ? 1.5 : 0.7) + 0.05;
        rK.x = Math.max(0, c) * (run ? 1.5 : 0.7) + 0.05;
        lF.x = -lH.x * 0.3; rF.x = -rH.x * 0.3;
        lS.x = -s * amp * 0.9; rS.x = s * amp * 0.9;
        lS.z = 0.08; rS.z = -0.08;
        lE.x = -(run ? 1.3 : 0.25) - Math.max(0, s) * 0.2; rE.x = -(run ? 1.3 : 0.25) - Math.max(0, -s) * 0.2;
        spine.y = s * 0.08; chest.y = -s * 0.06;
        spine.x = run ? 0.18 : 0.04;
        neck.x = run ? -0.12 : 0;
        bob = Math.abs(s) * (run ? 0.06 : 0.025);
        break;
      }
      case 'sit':
      case 'drive':
      case 'ride':
      case 'eat':
      case 'type': {
        this.phase += dt;
        lH.x = rH.x = -1.5; lK.x = rK.x = 1.45;
        lH.z = 0.06; rH.z = -0.06;
        hipsY = 0;
        if (anim === 'drive') { lS.x = rS.x = -1.0; lE.x = rE.x = -0.5; lS.z = 0.15; rS.z = -0.15; spine.x = -0.05; }
        else if (anim === 'ride') { lS.x = rS.x = -0.9; lE.x = rE.x = -0.3; spine.x = 0.35; lH.x = rH.x = -1.1; lK.x = rK.x = 1.6; lH.z = 0.25; rH.z = -0.25; }
        else if (anim === 'type') { lS.x = rS.x = -0.5; lE.x = rE.x = -1.0; const tt = Math.sin(this.phase * 18); lE.z = tt * 0.04; rE.z = -tt * 0.04; neck.x = 0.15; }
        else if (anim === 'eat') { const e = (Math.sin(this.phase * 1.6) + 1) / 2; rS.x = -0.6 - e * 0.6; rE.x = -1.2 - e * 0.9; lS.x = -0.3; lE.x = -0.8; neck.x = 0.12 - e * 0.15; }
        else { lS.x = rS.x = -0.3; lE.x = rE.x = -0.6; lS.z = 0.1; rS.z = -0.1; chest.x = breathe; }
        break;
      }
      case 'sleep':
        this.phase += dt;
        lie = 1;
        lS.z = 0.25; rS.z = -0.25; lE.x = rE.x = -0.3;
        lK.x = 0.2; rK.x = 0.35; lH.x = -0.15; rH.x = -0.3;
        chest.x = Math.sin(this.phase * 0.8) * 0.03;
        head.y = 0.3;
        break;
      case 'dance': {
        this.phase += dt * 4.2;
        const s = Math.sin(this.phase), c = Math.cos(this.phase);
        const mv = Math.floor(this.danceMove) % 4;
        bob = Math.abs(s) * 0.08;
        lK.x = rK.x = 0.25 + Math.abs(s) * 0.35;
        lH.x = rH.x = -0.15 - Math.abs(s) * 0.25;
        if (mv === 0) { lS.z = 2.5 + s * 0.3; rS.z = -2.5 + s * 0.3; lE.x = rE.x = -0.4; hips.y = s * 0.3; }
        else if (mv === 1) { lS.x = -1.2 + s * 0.8; rS.x = -1.2 - s * 0.8; lE.x = rE.x = -1.2; spine.z = s * 0.15; hips.z = -s * 0.1; }
        else if (mv === 2) { rS.z = -2.8; rS.x = s * 0.3; rE.x = -0.2; lS.z = 0.5; lE.x = -1.5; hips.y = c * 0.4; neck.y = c * 0.4; }
        else { lS.x = -0.8 + c; rS.x = -0.8 - c; lE.x = -1.4; rE.x = -1.4; lH.x = s * 0.5 - 0.2; rH.x = -s * 0.5 - 0.2; spine.y = s * 0.3; }
        head.x = s * 0.15;
        this.danceMove += dt * 0.12;
        break;
      }
      case 'phone':
        this.phase += dt;
        rS.x = -0.75; rS.z = 0.1; rE.x = -1.6; rE.y = 0.3;
        lS.z = 0.05; lE.x = -0.15;
        neck.x = 0.28;
        chest.x = breathe;
        break;
      case 'talk':
      case 'wave': {
        this.phase += dt * 3;
        const s = Math.sin(this.phase);
        if (anim === 'wave') { rS.z = -2.6; rE.z = s * 0.4; }
        else { rS.x = -0.5 + s * 0.2; rE.x = -1.2; lS.x = -0.4 - s * 0.2; lE.x = -1; head.y = s * 0.1; }
        chest.x = breathe;
        break;
      }
      case 'workout': {
        this.phase += dt * 3;
        const s = (Math.sin(this.phase) + 1) / 2;
        lS.z = 1.5 + s * 1.3; rS.z = -1.5 - s * 1.3; lE.z = -s * 1.2; rE.z = s * 1.2;
        lK.x = rK.x = s * 0.9; lH.x = rH.x = -s * 0.8; bob = -s * 0.25;
        break;
      }
      default: {
        this.phase += dt;
        chest.x = breathe;
        lS.z = 0.07; rS.z = -0.07;
        lE.x = rE.x = -0.12 + breathe;
        head.y = Math.sin(this.phase * 0.23) * 0.25;
        lH.z = 0.03; rH.z = -0.03;
      }
    }

    const k = 1 - Math.exp(-dt * 14);
    for (const j of T) {
      j.g.rotation.x += (j.target.x - j.g.rotation.x) * k;
      j.g.rotation.y += (j.target.y - j.g.rotation.y) * k;
      j.g.rotation.z += (j.target.z - j.g.rotation.z) * k;
    }
    const sitting = ['sit', 'drive', 'eat', 'type', 'ride'].includes(anim);
    const targetY = sitting ? -this.hipHeight + 0.47 + hipsY : bob;
    this.body.position.y += (targetY - this.body.position.y) * k;
    this.body.rotation.x += ((lie ? -Math.PI / 2 : 0) - this.body.rotation.x) * k;
    this.body.position.z += ((lie ? -this.hipHeight * 0.0 : 0) - this.body.position.z) * k;

    // blinking
    this.blink -= dt;
    const closed = this.blink < 0.12 || anim === 'sleep';
    if (this.blink < 0) this.blink = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = closed ? 0.1 : 1;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}

function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

/** Random NPC look generator. */
export function randomLook(seed: number): Look {
  let s = seed * 9301 + 49297;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pickA = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const f = r() < 0.5;
  const skins = ['#f6d7c3', '#ecc0a0', '#d9a57e', '#c58b62', '#a8704a', '#8a5636', '#6b3f26', '#4a2a19'];
  const hairs = ['#1a1412', '#3b2618', '#6b4a2b', '#a87b4f', '#d8b880', '#e6e0d4', '#b33a2a'];
  const tops = ['tee', 'hoodie', 'shirt', 'blazer', 'jacket', 'tank', 'jersey', 'suit'];
  const topStyleToId: Record<string, string> = { tee: 'tee', hoodie: 'hoodie', shirt: 'shirt', blazer: 'blazer', jacket: 'leather', tank: 'tank', jersey: 'jersey', suit: 'whale_suit' };
  const top = topStyleToId[pickA(tops)];
  const bottom = f && r() < 0.35 ? 'skirt' : pickA(['jeans', 'chinos', 'joggers', 'shorts', 'suit_pants']);
  const cols = ['#f2f2f2', '#1c1c1f', '#3a5a8c', '#8c2f39', '#2f7d5b', '#d9a441', '#6b4ea8', '#e46f2e', '#9aa3ad', '#c8b48a', '#2d3a55'];
  const look: Look = {
    body: f ? 'f' : 'm',
    skin: pickA(skins),
    hairStyle: f ? pickA([3, 4, 7, 1, 5]) : pickA([0, 1, 2, 5, 6, 1]),
    hairColor: pickA(hairs),
    eyeColor: pickA(['#3b2618', '#2f6b3a', '#2f5a9c']),
    height: f ? 0.93 + r() * 0.08 : 0.97 + r() * 0.1,
    build: 0.9 + r() * 0.25,
    outfit: { top, bottom, shoes: pickA(['sneakers', 'boots', 'loafers', 'runners']) },
    colors: { top: pickA(cols), bottom: pickA(['#2f4a7a', '#1b2233', '#c8b48a', '#1c1c1f', '#6f89b5', '#3a3a3a']), shoes: pickA(['#f2f2f2', '#1c1c1f', '#3b2618']) },
  };
  if (r() < 0.2) { look.outfit.hat = pickA(['cap', 'beanie', 'bucket']); look.colors.hat = pickA(cols); }
  if (r() < 0.25) { look.outfit.glasses = pickA(['shades', 'round']); look.colors.glasses = '#111111'; }
  if (r() < 0.25) { look.outfit.bag = pickA(['backpack', 'messenger']); look.colors.bag = pickA(cols); }
  if (r() < 0.2) { look.outfit.watch = 'steel'; look.colors.watch = '#c0c6cc'; }
  return look;
}
