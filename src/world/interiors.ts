// Enterable interiors. Each is built on demand at INTERIOR_ORIGIN when the
// player walks through a door, and disposed when they leave.

import * as THREE from 'three';
import { FURNITURE_BY_ID, PROPERTY_BY_ID, VEHICLES } from '../../shared/catalog.js';
import { DISTRICTS, FEATURE_BY_ZONE, BLOCK_DISTRICT, type InteriorKind } from '../../shared/city.js';
import { api } from '../api.js';
import { Batcher, colorMat, glowMat, mat, planeUV } from '../engine/build.js';
import { carpet, checker, concreteFloor, marble, plaster, signTexture, skylineTexture, tiles, woodFloor } from '../engine/textures.js';
import { Humanoid, randomLook, type Anim } from '../entities/humanoid.js';
import { buildVehicle } from '../entities/vehicle.js';
import { act } from '../net/client.js';
import { store } from '../state.js';
import { Colliders } from './colliders.js';
import { surf } from './pbr.js';
import * as F from './furniture.js';
import { chartScreen, newsScreen, textScreen, tickerScreen, type Screen } from './screens.js';

export const INTERIOR_ORIGIN = new THREE.Vector3(3000, 0, 0);

export interface InteriorLight { pos: THREE.Vector3; color: number; intensity: number; distance: number }
export interface InteriorBuild {
  zone: string;
  group: THREE.Group;
  colliders: Colliders;
  spawn: THREE.Vector3;
  spawnRot: number;
  lights: InteriorLight[];
  ambient: { sky: number; ground: number; intensity: number };
  update: (dt: number, t: number, night: number) => void;
  music: { station: string; pos: THREE.Vector3; volume: number } | null;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number } | null;
  npcs: Humanoid[];
  dispose(): void;
}

export interface HomeData { ownerId: string; owner: string; property: string; layout: 'small' | 'medium' | 'large'; placements: { slot: number; item: string }[]; tier: string; achievements: string[] }


class Kit {
  group = new THREE.Group();
  colliders = new Colliders();
  lights: InteriorLight[] = [];
  updaters: ((dt: number, t: number, night: number) => void)[] = [];
  B = new Batcher();
  npcs: Humanoid[] = [];
  screens: Screen[] = [];
  windows: THREE.MeshBasicMaterial[] = [];
  spawn = new THREE.Vector3();
  spawnRot = Math.PI;
  ambient = { sky: 0xfff4e6, ground: 0x3a3430, intensity: 0.55 };
  music: InteriorBuild['music'] = null;
  remove: (() => void)[] = [];
  bounds: InteriorBuild['bounds'] = null;

  constructor(public zone: string) {
    this.group.position.copy(INTERIOR_ORIGIN);
    this.group.name = 'interior:' + zone;
  }
  w(x: number, z: number, y = 0) { return new THREE.Vector3(INTERIOR_ORIGIN.x + x, y, INTERIOR_ORIGIN.z + z); }

  /**
   * Place an object. `col`: explicit footprint, false for none, or 'auto' (default)
   * to derive a collision box from the object's real bounds — anything standing on
   * the floor and taller than ankle height becomes solid, so players can't walk into it.
   */
  put(obj: THREE.Object3D, x: number, z: number, rot = 0, y = 0, col: [number, number] | false | 'auto' = 'auto', batch = true) {
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.updateMatrixWorld(true);
    const own = obj.userData.colliders as [number, number, number, number][] | undefined;
    if (own && col !== false) {
      for (const [cx, cz, sx, sz] of own) {
        const wx = x + cx * Math.cos(rot) + cz * Math.sin(rot), wz = z - cx * Math.sin(rot) + cz * Math.cos(rot);
        this.colliders.addRotated(INTERIOR_ORIGIN.x + wx, INTERIOR_ORIGIN.z + wz, sx, sz, rot, 'furniture');
      }
    } else if (col === 'auto') {
      const b = new THREE.Box3().setFromObject(obj);
      const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
      if (b.min.y < 0.45 && b.max.y > 0.3 && sx > 0.12 && sz > 0.12) {
        const m = 0.04;
        this.colliders.add({ minX: INTERIOR_ORIGIN.x + b.min.x + m, maxX: INTERIOR_ORIGIN.x + b.max.x - m, minZ: INTERIOR_ORIGIN.z + b.min.z + m, maxZ: INTERIOR_ORIGIN.z + b.max.z - m, h: b.max.y, tag: 'furniture' });
      }
    } else if (col) this.colliders.addRotated(INTERIOR_ORIGIN.x + x, INTERIOR_ORIGIN.z + z, col[0], col[1], rot, 'furniture');
    if (batch) this.B.addObject(obj); else this.group.add(obj);
    return obj;
  }
  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, col = false) {
    this.B.add(new THREE.BoxGeometry(w, h, d), m, { x, y, z });
    if (col) this.colliders.addBox(INTERIOR_ORIGIN.x + x, INTERIOR_ORIGIN.z + z, w, d, 'wall', h);
  }
  act(x: number, z: number, label: string | (() => string), action: () => void, radius = 1.6, key: 'E' | 'R' | 'F' | 'G' = 'E', enabled?: () => boolean, y = 0) {
    this.remove.push(api.interact.add({ pos: this.w(x, z, y), zone: this.zone, label, action, radius, key, enabled }));
  }
  /** Sitting spot: furniture-local seat position is (x,z); sitter faces `rot`. */
  seat(x: number, z: number, rot: number, h = 0.45, label = 'Sit', anim: Anim = 'sit', after?: () => void) {
    this.act(x, z, label, () => { api.sit(this.w(x, z), rot, anim, h); after?.(); }, 1.1);
  }
  npc(x: number, z: number, rot: number, anim: Anim, seed: number, name: string, seatH = 0) {
    const h = new Humanoid(randomLook(seed));
    h.bake();
    h.setNameTag(name, 'npc');
    h.root.position.set(x, seatH ? seatH - 0.47 : 0, z);
    h.root.rotation.y = rot;
    this.group.add(h.root);
    this.npcs.push(h);
    if (!seatH) this.colliders.addBox(INTERIOR_ORIGIN.x + x, INTERIOR_ORIGIN.z + z, 0.6, 0.6, 'npc', 2);
    const speed = anim === 'walk' ? 1.2 : 0;
    this.updaters.push((dt) => h.update(dt, anim, speed));
    const lines = npcLines(name);
    let i = Math.floor(Math.random() * lines.length);
    this.act(x, z, `Talk to ${name.replace(' (NPC)', '')}`, () => { api.toast(`${name.replace(' (NPC)', '')}: “${lines[i++ % lines.length]}”`); api.emote('talk', 3); }, seatH ? 1.3 : 1.6, 'G');
    return h;
  }
  light(x: number, y: number, z: number, color = 0xffe2c0, intensity = 30, distance = 14) {
    this.lights.push({ pos: this.w(x, z, y), color, intensity, distance });
    // visible fixture
    this.B.add(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16), glowMat('#fff2dc', 2.5), { x, y: y + 0.12, z });
  }
  screen(s: Screen, w: number, h: number, x: number, y: number, z: number, rot = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), s.mat);
    m.position.set(x, y, z); m.rotation.y = rot;
    this.group.add(m);
    this.screens.push(s);
    s.draw();
    return m;
  }
  sign(text: string, color: string, w: number, x: number, y: number, z: number, rot = 0) {
    const t = signTexture(text, color);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 1024), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.5, transparent: true }));
    m.position.set(x, y, z); m.rotation.y = rot;
    this.group.add(m);
  }
  window(x: number, y: number, z: number, w: number, h: number, rot: number) {
    const m = new THREE.MeshBasicMaterial({ map: skylineTexture(false) });
    this.windows.push(m);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z); p.rotation.y = rot;
    this.group.add(p);
    const fr = mat('winframe', { color: '#2a2d33', metalness: 0.5, roughness: 0.4 });
    const fwd = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    for (const s of [-1, 1]) this.B.add(new THREE.BoxGeometry(0.08, h + 0.16, 0.1), fr, { x: x + side.x * s * w / 2, y, z: z + side.z * s * w / 2 }, rot);
    this.B.add(new THREE.BoxGeometry(w + 0.16, 0.08, 0.1), fr, { x, y: y + h / 2, z }, rot);
    this.B.add(new THREE.BoxGeometry(w + 0.16, 0.08, 0.1), fr, { x, y: y - h / 2, z }, rot);
    this.B.add(new THREE.BoxGeometry(0.05, h, 0.06), fr, { x, y, z }, rot);
  }

  /** Box room; entrance is the gap in the +z wall at x=0. */
  room(w: number, d: number, h: number, floor: THREE.Material, wall: THREE.Material, ceil: THREE.Material = surf('plaster', { tile: 3, mode: 'ground', color: '#ffffff', macro: 0.05 }), doorW = 2.4) {
    this.bounds = { minX: INTERIOR_ORIGIN.x - w / 2 + 0.35, maxX: INTERIOR_ORIGIN.x + w / 2 - 0.35, minZ: INTERIOR_ORIGIN.z - d / 2 + 0.35, maxZ: INTERIOR_ORIGIN.z + d / 2 - 0.35, maxY: h - 0.25 };
    this.B.add(planeUV(w, d, 1, 1), floor, { x: 0, y: 0, z: 0 }, 0, undefined, new THREE.Euler(-Math.PI / 2, 0, 0));
    this.B.add(new THREE.PlaneGeometry(w, d), ceil, { x: 0, y: h, z: 0 }, 0, undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    const t = 0.2;
    this.wallSeg(-w / 2, -d / 2, w / 2, -d / 2, h, wall);
    this.wallSeg(-w / 2, -d / 2, -w / 2, d / 2, h, wall);
    this.wallSeg(w / 2, -d / 2, w / 2, d / 2, h, wall);
    this.wallSeg(-w / 2, d / 2, w / 2, d / 2, h, wall, [{ at: 0, w: doorW }]);
    // door + exit
    const dm = mat('intdoor', { color: '#1a1c20', metalness: 0.4, roughness: 0.4 });
    this.box(doorW + 0.3, 0.2, t + 0.05, dm, 0, Math.min(h, 3) - 0.1, d / 2);
    this.B.add(new THREE.PlaneGeometry(doorW, Math.min(h, 3) - 0.2), glowMat('#fff0d8', 0.8), { x: 0, y: (Math.min(h, 3) - 0.2) / 2, z: d / 2 + 0.11 }, Math.PI);
    this.act(0, d / 2 - 0.6, 'Exit to street', () => api.exitBuilding(), 1.8);
    this.spawn = this.w(0, d / 2 - 1.6);
    this.spawnRot = Math.PI;
    // baseboards
    const bb = mat('baseboard', { color: '#ecebe6', roughness: 0.45 });
    this.box(w, 0.12, 0.03, bb, 0, 0.06, -d / 2 + 0.11);
    this.box(0.03, 0.12, d, bb, -w / 2 + 0.11, 0.06, 0);
    this.box(0.03, 0.12, d, bb, w / 2 - 0.11, 0.06, 0);
    // crown moulding where the walls meet the ceiling
    const cm = mat('crown', { color: '#f4f3ef', roughness: 0.6 });
    this.box(w, 0.08, 0.06, cm, 0, h - 0.04, -d / 2 + 0.12);
    this.box(0.06, 0.08, d, cm, -w / 2 + 0.12, h - 0.04, 0);
    this.box(0.06, 0.08, d, cm, w / 2 - 0.12, h - 0.04, 0);
    this.box(w, 0.08, 0.06, cm, 0, h - 0.04, d / 2 - 0.12);
  }

  /** Axis-aligned wall from (x1,z1) to (x2,z2) with door gaps (offset along the wall from its center). */
  wallSeg(x1: number, z1: number, x2: number, z2: number, h: number, m: THREE.Material, gaps: { at: number; w: number }[] = [], t = 0.2) {
    const horiz = Math.abs(z1 - z2) < 1e-6;
    const a = horiz ? Math.min(x1, x2) : Math.min(z1, z2);
    const b = horiz ? Math.max(x1, x2) : Math.max(z1, z2);
    const mid = (a + b) / 2;
    const cuts = gaps.map((g) => [mid + g.at - g.w / 2, mid + g.at + g.w / 2]).sort((p, q) => p[0] - q[0]);
    let s = a;
    const segs: [number, number][] = [];
    for (const [c0, c1] of cuts) { if (c0 > s) segs.push([s, c0]); s = Math.max(s, c1); }
    if (b > s) segs.push([s, b]);
    for (const [s0, s1] of segs) {
      const len = s1 - s0, c = (s0 + s1) / 2;
      if (len < 0.01) continue;
      if (horiz) this.box(len, h, t, m, c, h / 2, z1, true);
      else this.box(t, h, len, m, x1, h / 2, c, true);
    }
    // lintels above gaps
    for (const [c0, c1] of cuts) {
      const c = (c0 + c1) / 2, len = c1 - c0;
      if (h > 2.6) { if (horiz) this.box(len, h - 2.4, t, m, c, 2.4 + (h - 2.4) / 2, z1); else this.box(t, h - 2.4, len, m, x1, 2.4 + (h - 2.4) / 2, c); }
    }
  }

  finish(): InteriorBuild {
    this.B.flush(this.group, { cast: true, receive: true });
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.receiveShadow = true; } });
    let screenT = 0;
    const self = this;
    return {
      zone: this.zone, group: this.group, colliders: this.colliders, spawn: this.spawn, spawnRot: this.spawnRot,
      lights: this.lights, ambient: this.ambient, music: this.music, bounds: this.bounds, npcs: this.npcs,
      update(dt, t, night) {
        for (const u of self.updaters) u(dt, t, night);
        screenT += dt;
        if (screenT > 1.5) { screenT = 0; for (const s of self.screens) s.draw(); }
        const tex = skylineTexture(night > 0.5);
        for (const wm of self.windows) if (wm.map !== tex) { wm.map = tex; wm.needsUpdate = true; }
      },
      dispose() {
        for (const r of self.remove) r();
        for (const n of self.npcs) n.dispose();
        self.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
        self.group.removeFromParent();
      },
    };
  }
}

function npcLines(name: string): string[] {
  const n = name.toLowerCase();
  const trending = () => store.trending[0] ?? 'crypto-city';
  if (/barista|cashier|cook|bartender|host|maître|waiter|sommelier/.test(n)) return ['What can I get you?', 'Card or wallet? Kidding — it’s all simulated here.', `Everyone keeps talking about #${trending()} today.`, 'We’re hiring — check the Jobs app if you want shifts.'];
  if (/trader|head trader/.test(n)) return ['Never risk what you can’t afford to lose — even in a sim.', 'Set a stop-loss. Your future self will thank you.', 'Consistency beats one lucky trade on the leaderboard.', `Watching #${trending()} closely.`];
  if (/dj/.test(n)) return ['Every track tonight is an original Crypto City FM cut.', 'Hit the floor — press 2 to dance!'];
  if (/recruit|ops|agent|sales|dealer|stylist|advisor|curator|concierge|desk|mechanic/.test(n)) return ['Happy to help — use the terminal or counter next to me.', 'Prices are in simulated dollars, no real money involved.', 'Come back any time.'];
  if (/partner|associate/.test(n)) return ['Show us traction: users, milestones, a clear narrative.', 'Market sentiment matters — VC waves make closing easier.'];
  if (/speaker|anchor/.test(n)) return [`Today’s theme: what #${trending()} means for builders.`, 'Questions? Use the venue chat — press T then Tab.'];
  return ['gm!', `Have you seen the news about #${trending()}?`, 'I heard the Airdrop Center has new campaigns.', 'Liquidity Nightclub is wild after midnight.', 'I’m saving up for a place in Summit Tower.'];
}

// ---------------------------------------------------------------------------
// Photoreal PBR surfaces (tools/gen_textures.py), world-aligned so any room size tiles cleanly.
const rgbHex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const wallPaint = (c: [number, number, number]) => surf('plaster', { tile: 3, mode: 'wall', color: new THREE.Color(rgbHex(c)).multiplyScalar(1.12).getHexString().replace(/^/, '#'), macro: 0.1 });
const floorWood = (tone = 0) => surf('woodfloor', { tile: 4, mode: 'ground', color: ['#ffffff', '#8c7464', '#ffeedd'][tone % 3] ?? '#ffffff', macro: 0.15 });
const floorMarble = (dark = false) => surf('marble', { tile: 3, mode: 'ground', color: dark ? '#3a3a40' : '#ffffff', macro: 0.08 });
const floorConcrete = () => surf('concrete', { tile: 4, mode: 'ground', color: '#c8c4bc', roughness: 0.7, macro: 0.2 });
const floorTiles = (c = '#e8ecef') => surf('tiles', { tile: 2.4, mode: 'ground', color: c, macro: 0.05 });
const floorCarpet = (c: [number, number, number]) => surf('carpet', { tile: 2, mode: 'ground', color: new THREE.Color(rgbHex(c)).multiplyScalar(1.5).getHexString().replace(/^/, '#'), macro: 0.1 });
void plaster; void woodFloor; void marble; void concreteFloor; void tiles; void carpet;

function nightish() { const m = ((store.clock.minutes % 1440) + 1440) % 1440; return m < 360 || m > 1200; }

// ---------------------------------------------------------------------------
export function buildInterior(zone: string, home?: HomeData): InteriorBuild {
  const k = new Kit(zone);
  if (zone.startsWith('home:') && home) buildHome(k, home);
  else {
    const f = FEATURE_BY_ZONE[zone];
    const kind: InteriorKind = f?.kind ?? 'cafe';
    const accent = f ? DISTRICTS[BLOCK_DISTRICT[f.block[1]][f.block[0]]].color : '#38f2a5';
    const builders: Partial<Record<InteriorKind, (k: Kit, accent: string) => void>> = {
      cafe, burger, grill: (kk, a) => restaurant(kk, a, false), finedining: (kk, a) => restaurant(kk, a, true), club, exchange,
      tradingfirm: (kk, a) => office(kk, a, 'tradingfirm'), research: (kk, a) => office(kk, a, 'research'), media: (kk, a) => office(kk, a, 'media'),
      studio: (kk, a) => office(kk, a, 'studio'), builderhub: (kk, a) => office(kk, a, 'builderhub'),
      jobs, vctower, hackhouse, defihub, airdrop, governance, boutique, furniture: furnitureStore, nftgallery: gallery, realestate,
      convention, dealership: (kk, a) => cars(kk, a, false), usedcars: (kk, a) => cars(kk, a, true), customs, transport, whaleclub,
    };
    (builders[kind] ?? cafe)(k, accent);
  }
  return k.finish();
}

// ------------------------------- HOMES -------------------------------------
const HOME_SLOTS: Record<'small' | 'medium' | 'large', [number, number, number][]> = {
  small: [[-4.4, 1.6, Math.PI / 2], [0.9, 0.6, 0], [-1.2, -1.2, 0], [1.9, 3.5, Math.PI], [4.4, -1.4, -Math.PI / 2], [-0.4, 3.6, Math.PI]],
  medium: [[-7.4, 1.5, Math.PI / 2], [-2.6, 1.2, -Math.PI / 2], [0.5, 3.6, 0], [2.2, 5.5, Math.PI], [-7.4, 4.8, Math.PI / 2], [0.3, -2.0, 0], [-0.9, -5.5, 0], [-3.0, -1.4, Math.PI], [2.8, -3.5, -Math.PI / 2], [7.4, -1.6, -Math.PI / 2], [-4.5, 0.2, 0], [5.5, 0.4, 0], [-1.6, 5.4, Math.PI], [3.0, 1.0, 0]],
  large: [[-11.4, 1.6, Math.PI / 2], [-11.4, 5.5, Math.PI / 2], [-2.6, 1.5, -Math.PI / 2], [0.0, 6.5, Math.PI], [1.5, 2.0, 0], [-6, 0.0, 0], [8.5, -6.5, 0], [10.6, -3.5, -Math.PI / 2], [8.2, -2.0, Math.PI], [11.4, -6.6, -Math.PI / 2], [-1.0, -6.6, 0], [1.6, -3.0, -Math.PI / 2], [-3.5, -2.0, Math.PI], [5.0, -6.6, 0], [6.0, 7.0, Math.PI], [11.4, 6.6, -Math.PI / 2], [-8.0, 7.6, Math.PI], [-4.0, 7.6, Math.PI], [9.0, 0.4, 0], [3.5, 0.4, 0], [-9.5, -1.6, Math.PI], [-6.5, -6.6, 0], [4.2, 3.2, 0], [-0.5, 3.2, 0]],
};

function buildHome(k: Kit, home: HomeData) {
  const own = home.ownerId === store.me?.id;
  const lay = home.layout;
  const def = PROPERTY_BY_ID[home.property];
  const lux = ['luxury', 'penthouse', 'mansion'].includes(home.tier);
  const W = lay === 'small' ? 10 : lay === 'medium' ? 16 : 24;
  const D = lay === 'small' ? 8 : lay === 'medium' ? 12 : 18;
  const H = lay === 'large' ? 3.4 : 2.9;
  const wall = wallPaint(lux ? [232, 228, 220] : home.tier === 'starter' ? [214, 204, 186] : [226, 222, 214]);
  k.room(W, D, H, lux ? floorMarble(home.tier === 'mansion') : floorWood(home.tier === 'starter' ? 0 : 2), wall);
  k.ambient = { sky: 0xfff1de, ground: 0x4a3e34, intensity: 0.65 };

  const sitBed = (x: number, z: number, rot: number) => {
    k.act(x, z, 'Sleep', () => (own ? api.sleep() : api.toast("This isn't your bed.")), 1.6);
    k.act(x, z, 'Lie down', () => api.lie(k.w(x, z, 0.62), rot), 1.6, 'R');
  };
  const kitchenActs = (fx: number, fz: number, sx: number, sz: number, cx: number, cz: number) => {
    k.act(fx, fz, 'Grab a snack', () => { api.hold('pastry'); api.emote('eat', 6); act('activity.home', { what: 'cook' }).catch(() => {}); }, 1.3);
    k.act(sx, sz, 'Cook a meal', () => api.fade(async () => { await act('activity.home', { what: 'cook' }).catch(() => {}); api.hold('plate'); api.toast('You cooked a meal. Well fed: +10% XP for a while.'); }), 1.3);
    k.act(cx, cz, 'Make coffee', () => { api.hold('cup'); api.toast('Fresh coffee.'); }, 1.2);
  };
  const bathActs = (sx: number, sz: number, tx: number, tz: number, wx: number, wz: number, tub = false) => {
    k.act(sx, sz, tub ? 'Take a bath' : 'Take a shower', () => api.fade(async () => { await act('activity.home', { what: 'shower' }).catch(() => {}); api.toast('Refreshed.'); }), 1.4);
    k.act(tx, tz, 'Use toilet', () => api.fade(() => {}), 1.0);
    k.act(wx, wz, 'Wash up', () => api.emote('idle', 2), 1.0);
  };
  const tvAct = (x: number, z: number, tvMesh: THREE.Object3D | undefined) => {
    const scr = newsScreen();
    if (tvMesh) { (tvMesh as THREE.Mesh).material = scr.mat; k.screens.push(scr); scr.draw(); }
    k.act(x, z, 'Watch CityNews', () => api.panel('news'), 1.6, 'R');
  };
  const decorAct = (x: number, z: number) => {
    if (!own) return;
    k.put(F.toolbox(), x, z, 0, 0);
    k.act(x, z, 'Decorate home', () => api.panel('decorate'), 1.5);
    k.act(x, z, 'Garage & vehicles', () => api.panel('garage'), 1.5, 'R');
  };
  const computer = (x: number, z: number) => { k.act(x, z, own ? 'Use computer' : 'Computer (owner only)', () => own && api.panel('computer'), 1.4); };

  if (lay === 'small') {
    k.put(F.bed(1.6), -3.2, -2.85, 0, 0, [1.7, 2.2]);
    sitBed(-3.2, -2.6, 0);
    k.put(F.nightstand(), -4.5, -3.6, 0, 0, [0.45, 0.4]);
    k.put(F.wardrobe(1.4), -4.65, -0.4, Math.PI / 2, 0, [1.4, 0.6]);
    k.act(-4.1, -0.4, 'Change outfit', () => api.panel('wardrobe'), 1.3);
    k.put(F.mirror(), -4.9, 1.2, Math.PI / 2);
    k.act(-4.3, 1.2, 'Mirror — appearance', () => api.panel('mirror'), 1.2);
    // kitchen
    k.put(F.counter(2.4, true, true), 2.3, -3.65, 0, 0, [2.4, 0.65]);
    k.put(F.upperCabinets(2.4), 2.3, -3.65);
    k.put(F.fridge(), 4.4, -3.6, 0, 0, [0.8, 0.7]);
    k.put(F.coffeeMachine(), 1.4, -3.75, 0, 0.9);
    k.put(F.microwave(), 3.2, -3.75, 0, 0.9);
    kitchenActs(4.4, -2.9, 2.9, -2.9, 1.4, -2.9);
    // bathroom
    k.wallSeg(2.2, 0.8, 2.2, 4, H, wall, [{ at: -0.6, w: 0.9 }]);
    k.wallSeg(2.2, 0.8, 5, 0.8, H, wall);
    k.put(F.shower(), 4.4, 3.4, 0, 0);
    k.put(F.toilet(), 4.6, 1.5, -Math.PI / 2, 0, [0.6, 0.5]);
    k.put(F.bathSink(), 3.0, 3.75, Math.PI, 0, [0.8, 0.5]);
    bathActs(4.2, 3.0, 4.1, 1.5, 3.0, 3.2);
    // living
    k.put(F.sofa('#5a6270', 2.0), -2.8, 3.4, Math.PI, 0, [2.0, 0.9]);
    for (const sx of [-3.4, -2.2]) k.seat(sx, 3.3, Math.PI);
    k.put(F.coffeeTable(), -2.8, 2.2, 0, 0, [1.2, 0.6]);
    k.put(F.rug(2.4, 1.6, '#8a4a3a'), -2.8, 2.3);
    k.put(F.tvStand(1.6), -2.8, 0.9, 0, 0, [1.6, 0.42]);
    const tvG = F.tv(1.1); k.put(tvG, -2.8, 0.85, 0, 0.98, false, false);
    tvAct(-2.8, 2.6, tvG.userData.screen);
    k.put(F.desk(1.2, 0.65), -0.3, -3.6, 0, 0, [1.2, 0.65]);
    k.put(F.laptop(), -0.3, -3.6, 0, 0.76);
    k.put(F.officeChair(), -0.3, -2.9, Math.PI);
    computer(-0.3, -2.8);
    k.put(F.plant(), 1.2, 3.6);
    decorAct(1.0, 2.6);
    k.window(-1.2, 1.6, -3.88, 1.6, 1.3, 0);
    k.window(-4.88, 1.6, -2.0, 1.2, 1.2, Math.PI / 2);
    k.light(-2.5, H - 0.1, 2, 0xffe2c0, 18, 8);
    k.light(-2.5, H - 0.1, -2.2, 0xffe2c0, 16, 8);
    k.light(3, H - 0.1, -2, 0xfff0e0, 16, 8);
    k.light(3.6, H - 0.1, 2.4, 0xffffff, 8, 4);
  } else if (lay === 'medium') {
    k.wallSeg(-8, -0.5, 8, -0.5, H, wall, [{ at: -5, w: 1.4 }, { at: 0.75, w: 1.4 }, { at: 5.75, w: 1.0 }]);
    k.wallSeg(-2, -6, -2, -0.5, H, wall);
    k.wallSeg(3.5, -6, 3.5, -0.5, H, wall);
    // bedroom
    k.put(F.bed(1.8, '#c9d4e6'), -5, -4.8, 0, 0, [1.9, 2.2]);
    sitBed(-5, -4.5, 0);
    k.put(F.nightstand(), -6.3, -5.6); k.put(F.nightstand(), -3.7, -5.6);
    k.put(F.wardrobe(1.8), -7.65, -2.8, Math.PI / 2, 0, [1.8, 0.6]);
    k.act(-7.1, -2.8, 'Change outfit', () => api.panel('wardrobe'), 1.3);
    k.put(F.mirror(), -2.15, -3.2, -Math.PI / 2);
    k.act(-2.7, -3.2, 'Mirror — appearance', () => api.panel('mirror'), 1.2);
    k.window(-5, 1.6, -5.88, 2.2, 1.4, 0);
    // office / trading room
    k.put(F.desk(1.8, 0.75), 0.75, -5.4, 0, 0, [1.8, 0.75]);
    const scrA = chartScreen('SGLD'), scrB = chartScreen('ETHN');
    const m1 = F.monitor(scrA.mat, 0.6); k.put(m1, 0.4, -5.55, 0.15, 0.76, false, false);
    const m2 = F.monitor(scrB.mat, 0.6); k.put(m2, 1.1, -5.55, -0.15, 0.76, false, false);
    k.screens.push(scrA, scrB); scrA.draw(); scrB.draw();
    k.put(F.keyboard(), 0.75, -5.15, 0, 0.76);
    k.put(F.officeChair(true), 0.75, -4.6, Math.PI);
    computer(0.75, -4.5);
    k.put(F.bookshelf(1.2), 3.2, -3.0, -Math.PI / 2, 0, [1.2, 0.35]);
    k.act(2.7, -3.0, 'Read a book', () => { api.emote('phone', 4); act('activity.home', { what: 'read' }).then(() => api.toast('+Research XP')).catch((e) => api.toast(e.message)); }, 1.2);
    k.window(0.75, 1.7, -5.88, 1.8, 1.2, 0);
    // bathroom
    k.put(F.bathtub(), 6.6, -5.3, 0, 0, [1.7, 0.8]);
    k.put(F.toilet(), 7.6, -2.2, -Math.PI / 2, 0, [0.6, 0.5]);
    k.put(F.bathSink(), 4.3, -5.6, 0, 0, [0.8, 0.5]);
    bathActs(6.6, -4.4, 7.0, -2.2, 4.3, -4.9, true);
    // living
    k.put(F.sofa('#3b4a5c', 2.6), -5, 4.6, Math.PI, 0, [2.6, 0.95]);
    for (const sx of [-5.8, -5, -4.2]) k.seat(sx, 4.5, Math.PI);
    k.put(F.armchair('#7a5a3a'), -2.4, 3.2, -Math.PI / 2, 0, [0.85, 0.85]);
    k.seat(-2.5, 3.2, -Math.PI / 2);
    k.put(F.coffeeTable(), -5, 3.2, 0, 0, [1.2, 0.6]);
    k.put(F.rug(3, 2.2, '#2d3a55'), -5, 3.2);
    k.put(F.tvStand(2.0), -5, 1.0, 0, 0, [2.0, 0.42]);
    const tvG = F.tv(1.5); k.put(tvG, -5, 0.95, 0, 1.05, false, false);
    tvAct(-5, 3.8, tvG.userData.screen);
    k.put(F.speaker(true), -6.4, 0.9); k.put(F.speaker(true), -3.6, 0.9);
    k.act(-6.4, 1.4, 'Play music on speakers', () => api.setSpeakerMusic(k.w(-5, 1, 1.2)), 1.3, 'R');
    // kitchen & dining
    k.put(F.counter(3.2, true, true), 7.65, 2.4, -Math.PI / 2, 0, [3.2, 0.65]);
    k.put(F.fridge(), 7.6, 4.9, -Math.PI / 2, 0, [0.8, 0.7]);
    k.put(F.coffeeMachine(), 7.7, 1.0, -Math.PI / 2, 0.9);
    kitchenActs(6.9, 4.9, 6.9, 3.2, 6.9, 1.0);
    k.put(F.diningTable(1.8, 1.0), 3.8, 3.2, 0, 0, [1.8, 1.0]);
    for (const [cx, cz, r] of [[3.3, 2.35, 0], [4.3, 2.35, 0], [3.3, 4.05, Math.PI], [4.3, 4.05, Math.PI]]) { k.put(F.chair(), cx, cz, r); k.seat(cx, cz, r); }
    decorAct(1.5, 5.3);
    k.window(-7.88, 1.6, 3.5, 2.4, 1.4, Math.PI / 2);
    k.window(7.88, 1.7, -2.6, 1.2, 1.0, -Math.PI / 2);
    for (const [x, z] of [[-5, 3], [3.8, 3], [-5, -3.5], [0.75, -3.5], [5.7, -3.5], [0.5, 2]]) k.light(x, H - 0.1, z, 0xffe6c8, 18, 9);
  } else {
    k.wallSeg(-12, -1, 12, -1, H, wall, [{ at: -8, w: 1.6 }, { at: -0.5, w: 1.6 }, { at: 5, w: 1.2 }, { at: 9.5, w: 1.6 }]);
    k.wallSeg(-4, -9, -4, -1, H, wall);
    k.wallSeg(3, -9, 3, -1, H, wall);
    k.wallSeg(7, -9, 7, -1, H, wall);
    // master bedroom
    k.put(F.bed(2.0, '#e8e0d0'), -8, -7.6, 0, 0, [2.1, 2.2]);
    sitBed(-8, -7.3, 0);
    k.put(F.nightstand(), -9.5, -8.4); k.put(F.nightstand(), -6.5, -8.4);
    k.put(F.wardrobe(2.4), -11.65, -4.5, Math.PI / 2, 0, [2.4, 0.6]);
    k.act(-11.0, -4.5, 'Change outfit', () => api.panel('wardrobe'), 1.4);
    k.put(F.mirror(), -4.15, -5.0, -Math.PI / 2);
    k.act(-4.8, -5.0, 'Mirror — appearance', () => api.panel('mirror'), 1.2);
    k.put(F.armchair('#c8b48a'), -10.5, -2.2, Math.PI * 0.75);
    k.window(-8, 1.7, -8.88, 4, 1.8, 0);
    // trading room
    const screensMats = ['SGLD', 'ETHN', 'SOLR', 'MDOG', 'YLD', 'CITY'].map((s) => chartScreen(s));
    screensMats.forEach((s) => { k.screens.push(s); s.draw(); });
    const rigG = F.rig(screensMats.map((s) => s.mat));
    k.put(rigG, -0.5, -8.2, 0, 0, [2.0, 0.8], false);
    k.put(F.officeChair(true), -0.5, -7.2, Math.PI);
    computer(-0.5, -7.0);
    k.put(F.bookshelf(1.4), 2.65, -5, -Math.PI / 2, 0, [1.4, 0.35]);
    k.act(2.1, -5, 'Read a book', () => { api.emote('phone', 4); act('activity.home', { what: 'read' }).then(() => api.toast('+Research XP')).catch((e) => api.toast(e.message)); }, 1.2);
    k.window(-0.5, 1.9, -8.88, 3, 1.6, 0);
    // bath
    k.put(F.bathtub(), 5, -8.2, 0, 0, [1.7, 0.8]);
    k.put(F.shower(), 6.3, -2.0, 0, 0);
    k.put(F.toilet(), 3.6, -3.4, Math.PI / 2, 0, [0.6, 0.5]);
    k.put(F.bathSink(), 5.0, -1.6, Math.PI, 0, [0.8, 0.5]);
    bathActs(5, -7.4, 4.1, -3.4, 5.0, -2.2, true);
    // gaming room
    k.put(F.sofa('#2a1050', 2.2), 9.5, -2.2, Math.PI, 0, [2.2, 0.9]);
    k.seat(9.0, -2.3, Math.PI); k.seat(10.0, -2.3, Math.PI);
    k.put(F.tvStand(2.0), 9.5, -8.3, 0, 0, [2, 0.42]);
    const gtv = F.tv(1.8); k.put(gtv, 9.5, -8.35, 0, 1.15, false, false);
    k.put(F.gameConsole(), 9.5, -8.3, 0, 0.48);
    k.act(9.5, -3.4, 'Play Block Breaker', () => api.panel('arcade'), 1.4, 'R');
    const sl = F.smartLights(); k.put(sl, 9.5, -8.8, 0, 0, false, false);
    k.updaters.push((dt, t) => { (sl.userData.lightMat as THREE.MeshStandardMaterial).emissive.setHSL((t * 0.05) % 1, 0.9, 0.5); });
    // living
    k.put(F.sofa('#d9d2c2', 3.2), -7, 6.6, Math.PI, 0, [3.2, 0.95]);
    for (const sx of [-8, -7, -6]) k.seat(sx, 6.5, Math.PI);
    k.put(F.armchair('#3b2618'), -3.6, 4.5, -Math.PI / 2, 0, [0.85, 0.85]);
    k.seat(-3.7, 4.5, -Math.PI / 2);
    k.put(F.coffeeTable(), -7, 4.8, 0, 0, [1.2, 0.6]);
    k.put(F.rug(4, 3, '#6b6f75'), -7, 4.6);
    k.put(F.tvStand(2.4), -7, 1.6, 0, 0, [2.4, 0.42]);
    const tvG = F.tv(2.0); k.put(tvG, -7, 1.55, 0, 1.2, false, false);
    tvAct(-7, 5.4, tvG.userData.screen);
    k.put(F.speakerStack(), -10.5, 1.2, 0, 0, [1, 0.8]);
    k.act(-10.5, 2.0, 'Play music on speakers', () => api.setSpeakerMusic(k.w(-7, 1.6, 1.4)), 1.4, 'R');
    { const pn = F.piano(); k.put(pn, -10.2, 4.2, Math.PI / 2, 0, 'auto'); furnitureActs(k, 'piano', 'piano', -10.2, 4.2, Math.PI / 2, pn, own, 0, true); }
    // kitchen island & dining
    k.put(F.counter(4.0, true, true), 9.0, 8.6, Math.PI, 0, [4, 0.65]);
    k.put(F.fridge(), 11.5, 8.5, Math.PI, 0, [0.8, 0.7]);
    k.put(F.counter(3.0), 8.5, 5.6, 0, 0, [3, 0.65]);
    k.put(F.coffeeMachine(), 7.5, 8.65, Math.PI, 0.9);
    kitchenActs(11.5, 7.8, 9.0, 7.9, 7.5, 7.9);
    for (const sx of [7.6, 8.5, 9.4]) { k.put(F.stool(0.75), sx, 4.9, Math.PI); k.seat(sx, 4.9, Math.PI, 0.78); }
    k.put(F.diningTable(2.4, 1.1, true), 4.0, 5.5, 0, 0, [2.4, 1.1]);
    for (const [cx, cz, r] of [[3.2, 4.6, 0], [4.8, 4.6, 0], [3.2, 6.4, Math.PI], [4.8, 6.4, Math.PI]]) { k.put(F.chair('#1d1d20'), cx, cz, r); k.seat(cx, cz, r); }
    decorAct(-1.0, 8.2);
    for (const z of [3, 6]) k.window(11.88, 1.9, z, 2.4, 2.0, -Math.PI / 2);
    k.window(-11.88, 1.9, 6.5, 3, 2.0, Math.PI / 2);
    for (const [x, z] of [[-7, 4], [4, 5.5], [9, 6], [-8, -5], [-0.5, -5], [5, -5], [9.5, -5], [0, 1.5]]) k.light(x, H - 0.1, z, 0xffe6c8, 20, 10);
  }

  // trophies (owner's real achievements)
  const n = home.achievements.length;
  if (n > 0 && !home.placements.some((p) => p.item === 'trophy')) {
    /* trophies only visible when the shelf furniture is placed */
  }
  // placed furniture
  const slots = HOME_SLOTS[lay];
  for (const p of home.placements) {
    const s = slots[p.slot];
    const fd = FURNITURE_BY_ID[p.item];
    if (!s || !fd) continue;
    const obj = fd.model === 'trophy' ? F.trophyShelf(n) : F.catalogModel(fd.model);
    const dynamic = ['aquarium', 'smartlights', 'tv55', 'tv85', 'lamp'].includes(fd.model);
    k.put(obj, s[0], s[1], s[2], 0, ['rug', 'smartlights', 'aircon', 'camera', 'art_small', 'art_large'].includes(fd.model) ? false : 'auto', !dynamic);
    furnitureActs(k, fd.model, fd.name, s[0], s[1], s[2], obj, own, n);
  }
  if (!own) k.sign(`@${home.owner}'s home`, '#38f2a5', 3, 0, 2.4, D / 2 - 0.15, Math.PI);
  void def;
}

/**
 * Interactions for usable objects. Used for furniture placed at home and for the
 * try-out display pieces in shops. `demo` skips server-side home rewards.
 */
function furnitureActs(k: Kit, model: string, name: string, x: number, z: number, rot: number, obj: THREE.Object3D, own: boolean, achievements: number, demo = false) {
  // interaction zone sized from the object's real footprint, so it's reachable from any side
  const b = new THREE.Box3().setFromObject(obj);
  const reach = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 1.0;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const fwd = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  const depth = Math.abs(fwd.x) * (b.max.x - b.min.x) / 2 + Math.abs(fwd.z) * (b.max.z - b.min.z) / 2;
  const front = k.w(cx + fwd.x * (depth + 0.45), cz + fwd.z * (depth + 0.45)); // standing spot facing the object
  const use = (label: string, fn: () => void, key: 'E' | 'R' = 'R') => k.act(cx, cz, label, fn, reach, key);
  const home = (what: string, ok: string) => { if (demo) return; act('activity.home', { what }).then(() => api.toast(ok)).catch((e) => api.toast(e.message)); };
  const faceIt = () => api.placeAt(front, rot + Math.PI);
  switch (model) {
    case 'armchair': k.seat(x + Math.sin(rot) * 0.1, z + Math.cos(rot) * 0.1, rot); break;
    case 'speaker': case 'tower_speaker': use('Play music on speakers', () => api.setSpeakerMusic(k.w(x, z, 1))); break;
    case 'tv55': case 'tv85': { const sc = newsScreen(); if (obj.userData.screen) { (obj.userData.screen as THREE.Mesh).material = sc.mat; k.screens.push(sc); sc.draw(); } use('Watch CityNews', () => { faceIt(); api.panel('news'); }); break; }
    case 'console': use('Play video games', () => { faceIt(); api.emote('phone', 30); api.panel('arcade'); }); break;
    case 'arcade': use('Play the arcade', () => { faceIt(); api.panel('arcade'); }); break;
    case 'bookshelf': use('Read a book', () => { faceIt(); api.emote('phone', 6); home('read', '+Research XP from reading'); }); break;
    case 'rig': use('Use trading rig', () => { api.sit(front, rot + Math.PI, 'type', 0.5); api.panel('trade'); home('rig', 'Trading practice: +Trading XP'); }); break;
    case 'gym': {
      // real lifts at the right spots: bench press, back squat, dumbbell curls
      const P = (lx: number, lz: number) => [x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)] as const;
      const lift = (label: string, anim: 'bench' | 'squat' | 'curl', prop: 'barbell' | 'dumbbells', at: [number, number], stand: [number, number], face: number, hide: THREE.Object3D | undefined) => {
        const [ax, az] = P(...at), [sx, sz] = P(...stand);
        k.act(ax, az, label, () => {
          if (hide) hide.visible = false;
          api.lift(anim, prop, k.w(sx, sz), rot + face, () => { if (hide) hide.visible = true; });
          home('gym', 'Good workout — rested bonus (+10% XP).');
        }, 1.0, 'R');
      };
      lift('Bench press', 'bench', 'barbell', [0, 1.7], [0, 1.75], 0, obj.userData.benchBar);
      lift('Barbell squats', 'squat', 'barbell', [0, -0.25], [0, -0.3], 0, obj.userData.squatBar);
      lift('Dumbbell curls', 'curl', 'dumbbells', [-0.7, 0.2], [-0.72, 0.2], Math.PI / 2, obj.userData.dumbbells);
      break;
    }
    case 'bar': use('Mix a mocktail', () => { faceIt(); api.hold('glass'); api.toast('Citrus mocktail, alcohol-free.'); }); break;
    case 'pool': use('Play pool (snooker)', () => { faceIt(); api.panel('pool'); }); break;
    case 'piano': use('Play the piano', () => { api.sit(front, rot + Math.PI, 'type', 0.5); api.panel('piano'); }); break;
    case 'aquarium': { const fish = obj.userData.fish as THREE.Group; k.updaters.push((dt, t) => fish.children.forEach((f, i) => { f.position.x = Math.sin(t * 0.4 + i) * 0.45; f.rotation.y = Math.cos(t * 0.4 + i) > 0 ? 0 : Math.PI; })); use('Feed the fish', () => { faceIt(); api.emote('wave', 3); api.toast('The fish swarm to the food. 🐠'); }); break; }
    case 'smartlights': { const m = obj.userData.lightMat as THREE.MeshStandardMaterial; let hue = 0.7; use('Cycle light colors', () => { hue = (hue + 0.15) % 1; m.emissive.setHSL(hue, 0.9, 0.5); }); break; }
    case 'lamp': { const bl = obj.userData.bulb as THREE.Mesh; let on = true; use('Toggle lamp', () => { on = !on; (bl.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 0.6 : 0; }); break; }
    case 'trophy': use(`Trophy shelf (${achievements} achievements)`, () => api.panel('profile')); break;
    case 'camera': use('Check security camera', () => api.toast('All clear. No intruders.')); break;
    case 'aircon': use('Toggle A/C', () => api.toast('A/C toggled.')); break;
    case 'plant': use('Water the plant', () => { faceIt(); api.emote('wave', 2); api.toast('The plant looks happier. 🌿'); }); break;
    case 'art_small': case 'art_large': use('Admire the art', () => { faceIt(); api.toast('A generative piece. You notice new details every time.'); }); break;
    case 'rug': break;
    default: break;
  }
  void name; void own;
}

// ------------------------------- FOOD --------------------------------------
function orderCounter(k: Kit, venue: string, x: number, z: number, staff: string, seed: number, rot = 0) {
  k.npc(x, z - 1.0, rot, 'idle', seed, staff);
  k.act(x, z + 0.8, 'Order', () => api.panel('menu', { venue }), 1.6);
}

function cafe(k: Kit, accent: string) {
  k.room(14, 10, 3.4, floorWood(1), wallPaint([196, 176, 150]));
  k.ambient = { sky: 0xffe6c8, ground: 0x4a3a2a, intensity: 0.6 };
  k.put(F.counterBar(5, '#5a3a24'), 0, -3.2, 0, 0, [5.1, 0.85]);
  k.put(F.espressoMachine(), -1.2, -3.35, 0, 1.1);
  k.put(F.coffeeMachine(), 1.3, -3.35, 0, 1.1);
  k.box(5, 0.5, 0.3, mat('pastrycase', { color: '#dfe8ee', transparent: true, opacity: 0.4, roughness: 0.05 }), 1.6, 1.35, -3.0);
  orderCounter(k, 'cafe', 0, -3.2, 'Barista Lena (NPC)', 3);
  k.sign('BLOCK BREW CAFÉ', accent, 4, 0, 2.7, -4.88);
  k.put(F.bookshelf(1.6), -6.7, -2, Math.PI / 2, 0, [1.6, 0.35]);
  const tables: [number, number][] = [[-4.5, 0.5], [-4.5, 3.2], [4.5, 0.5], [4.5, 3.2], [0, 1.6]];
  tables.forEach(([x, z], i) => {
    k.put(F.roundTable(0.45), x, z, 0, 0, [0.9, 0.9]);
    for (const s of [-1, 1]) { k.put(F.chair('#2a2a2e'), x + s * 0.85, z, -s * Math.PI / 2); k.seat(x + s * 0.85, z, -s * Math.PI / 2); }
    if (i % 2) k.npc(x + 0.85, z, -Math.PI / 2, 'eat', 40 + i, 'Customer (NPC)', 0.45);
  });
  k.put(F.plant(true), -6.4, 4.2); k.put(F.plant(true), 6.4, 4.2);
  k.window(-6.88, 1.8, 1.5, 3, 1.8, Math.PI / 2);
  k.window(6.88, 1.8, 1.5, 3, 1.8, -Math.PI / 2);
  for (const [x, z] of [[-4, 0], [4, 0], [0, -2.5], [0, 3]]) k.light(x, 3.3, z, 0xffd6a0, 22, 9);
  k.music = { station: 'lofi', pos: k.w(0, -2, 2.5), volume: 0.5 };
}

function burger(k: Kit, accent: string) {
  k.room(14, 10, 3.4, mat('chk', { map: checker('#f2f2f2', '#1c1c1f'), roughness: 0.3 }), wallPaint([230, 80, 60]));
  k.ambient = { sky: 0xffffff, ground: 0x553333, intensity: 0.75 };
  k.put(F.counterBar(6, '#c02a2a', F.M.steel()), 0, -3.2, 0, 0, [6.1, 0.85]);
  orderCounter(k, 'burger', -1, -3.2, 'Cashier Kofi (NPC)', 8);
  k.npc(1.8, -4.3, 0, 'talk', 9, 'Cook (NPC)');
  const menu = textScreen(() => ['Gas Fee Burger ...... $6.00', 'Layer-2 Fries ....... $3.00', 'Gwei Combo .......... $9.00', 'Moon Shake .......... $4.00', '', 'Low fees. Fast finality.'], 'MENU', accent);
  k.screen(menu, 3.6, 2, 0, 2.5, -4.85);
  for (let i = 0; i < 3; i++) {
    const x = -5 + i * 0, z = -1 + i * 2;
    k.put(F.boothSeat(1.6, '#c02a2a'), -5.6, z - 0.55, 0, 0, [1.6, 0.6]);
    k.put(F.diningTable(1.4, 0.7), -5.6, z + 0.2, 0, 0, [1.4, 0.7]);
    k.seat(-5.9, z - 0.55, 0); k.seat(-5.3, z - 0.55, 0);
    k.put(F.boothSeat(1.6, '#c02a2a'), 5.6, z - 0.55, 0, 0, [1.6, 0.6]);
    k.put(F.diningTable(1.4, 0.7), 5.6, z + 0.2, 0, 0, [1.4, 0.7]);
    k.seat(5.3, z - 0.55, 0); k.seat(5.9, z - 0.55, 0);
    void x;
  }
  k.npc(5.9, -1.55, 0, 'eat', 77, 'Customer (NPC)', 0.45);
  for (const [x, z] of [[-4, 0], [4, 0], [0, -2.5], [0, 2.5]]) k.light(x, 3.3, z, 0xffffff, 24, 9);
  k.music = { station: 'pop', pos: k.w(0, -2, 2.5), volume: 0.45 };
}

function restaurant(k: Kit, accent: string, fine: boolean) {
  const venue = fine ? 'finedining' : 'grill';
  k.room(18, 13, fine ? 4.2 : 3.6, fine ? floorMarble(true) : floorWood(1), fine ? wallPaint([60, 50, 46]) : wallPaint([200, 170, 140]));
  k.ambient = fine ? { sky: 0xffd9b0, ground: 0x221a14, intensity: 0.4 } : { sky: 0xffe6c8, ground: 0x4a3a2a, intensity: 0.6 };
  k.put(F.counterBar(4, fine ? '#1a1410' : '#5a3a24'), -5.5, -5.2, 0, 0, [4.1, 0.85]);
  k.npc(-5.5, -5.9, 0, 'idle', fine ? 21 : 22, fine ? 'Maître d\' Jules (NPC)' : 'Host Nia (NPC)');
  k.npc(3, -3, 0.5, 'walk', 23, 'Waiter (NPC)');
  k.sign(fine ? 'THE LEDGER' : 'GENESIS GRILL', accent, 4, 3, 3, -6.38);
  const tables: [number, number][] = [[-5, -1.5], [-5, 2.5], [0, -1.5], [0, 2.5], [5, -1.5], [5, 2.5]];
  tables.forEach(([x, z], i) => {
    k.put(F.diningTable(1.4, 0.9, true), x, z, 0, 0, [1.4, 0.9]);
    for (const s of [-1, 1]) {
      const cz = z + s * 0.75;
      k.put(F.chair(fine ? '#1d1d20' : '#5a3a24'), x, cz, s > 0 ? Math.PI : 0);
      k.act(x, cz, 'Sit & order', () => { api.sit(k.w(x, cz), s > 0 ? Math.PI : 0, 'sit', 0.45); api.panel('menu', { venue }); }, 1.0);
    }
    if (fine) k.put(F.floorLamp(), x + 1.1, z, 0, 0, 'auto', false);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), glowMat('#ffcc66', 3));
    candle.position.set(x, 0.85, z); k.group.add(candle);
    if (i === 1 || i === 4) { k.npc(x, z - 0.75, 0, 'eat', 60 + i, 'Diner (NPC)', 0.45); k.npc(x, z + 0.75, Math.PI, 'talk', 70 + i, 'Diner (NPC)', 0.45); }
  });
  if (fine) { const pn = F.piano(); k.put(pn, 7.4, -4.6, -Math.PI / 2, 0, 'auto'); furnitureActs(k, 'piano', 'piano', 7.4, -4.6, -Math.PI / 2, pn, false, 0, true); k.put(F.art(5, 1.6, 1.0), -8.85, 0, Math.PI / 2); k.put(F.art(6, 1.6, 1.0), 8.85, 0, -Math.PI / 2); }
  k.window(-8.88, 2, 3.5, 2.4, 2, Math.PI / 2); k.window(8.88, 2, 3.5, 2.4, 2, -Math.PI / 2);
  for (const [x, z] of [[-5, 0.5], [0, 0.5], [5, 0.5], [-5, -4.5]]) k.light(x, fine ? 4.1 : 3.5, z, fine ? 0xffc890 : 0xffe0b0, fine ? 14 : 22, 10);
  k.music = { station: fine ? 'jazz' : 'lofi', pos: k.w(0, 0, 3), volume: 0.4 };
}

// ------------------------------- CLUB --------------------------------------
function club(k: Kit, accent: string) {
  k.room(32, 26, 7, floorMarble(true), mat('clubwall', { color: '#0d0b14', roughness: 0.7 }), mat('clubceil', { color: '#050508', roughness: 1 }), 3);
  k.ambient = { sky: 0x6a40ff, ground: 0x200830, intensity: 0.22 };
  // dance floor tiles
  const tiles: THREE.Mesh[] = [];
  const cols = ['#ff2f9a', '#2fe6ff', '#7a5cff', '#38f2a5'];
  for (let i = -4; i < 4; i++) for (let j = -3; j < 3; j++) {
    const m = new THREE.MeshStandardMaterial({ color: '#111', emissive: cols[(i + j + 8) % 4], emissiveIntensity: 0.8, roughness: 0.2 });
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, 1.45), m);
    t.position.set(i * 1.5 + 0.75, 0.03, j * 1.5 + 0.75 - 1);
    k.group.add(t); tiles.push(t);
  }
  k.updaters.push((dt, t) => tiles.forEach((tile, i) => { (tile.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.max(0, Math.sin(t * 4 + i * 1.7)) * 2.2; }));
  k.act(0, 0, 'Dance', () => api.emote('dance', 9999), 6);
  k.act(0, 0, 'Dance move: next', () => api.emote('dance', 9999), 6, 'R');
  // DJ
  k.put(F.stage(10, 4, 1.0), 0, -10.5, 0, 0, [10, 4]);
  k.put(F.djBooth(), 0, -10, 0, 1.0, false);
  k.npc(0, -10.8, 0, 'dance', 99, 'DJ Nova (NPC)').root.position.y = 1.0;
  for (const sx of [-6.5, 6.5]) k.put(F.speakerStack(), sx, -10.5, 0, 0, [1, 0.8]);
  k.act(0, -7.6, 'Talk to the DJ', () => api.toast('DJ Nova: "Requests? I only play original Crypto City FM cuts — royalty-free and licensed for the club."'), 2);
  k.sign('LIQUIDITY', accent, 8, 0, 5.4, -12.85);
  // light beams
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.MeshBasicMaterial({ color: cols[i % 4], transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const b = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 16, 1, true), m);
    b.position.set(-9 + i * 2.6, 3.5, -6 + (i % 2) * 3);
    k.group.add(b); beams.push(b);
  }
  k.updaters.push((dt, t) => beams.forEach((b, i) => { b.rotation.z = Math.sin(t * 0.9 + i) * 0.5; b.rotation.x = Math.cos(t * 0.7 + i * 2) * 0.4; }));
  // bar
  k.put(F.counterBar(8, '#1a1424', F.M.emissive('#ff2f9a', 0.6)), -13, 2, Math.PI / 2, 0, [0.85, 8.1]);
  k.npc(-14.1, 2, Math.PI / 2, 'talk', 31, 'Bartender Rafa (NPC)');
  k.act(-12, 2, 'Order drinks', () => api.panel('menu', { venue: 'club' }), 2);
  for (let i = -3; i < 4; i += 2) { k.put(F.stool(0.8), -11.9, 2 + i, -Math.PI / 2); k.seat(-11.9, 2 + i, -Math.PI / 2, 0.83); }
  // VIP
  k.box(9, 0.6, 9, mat('vipfloor', { color: '#1a1424', roughness: 0.3 }), 11, 0.3, 6);
  k.put(F.stanchion(3), 6.4, 4, Math.PI / 2, 0.6, false);
  k.sign('VIP', '#ffd23f', 2.4, 11, 4.2, 1.3);
  k.act(6, 6, 'VIP area', () => api.panel('vip'), 2.4);
  for (const [x, z, r] of [[11, 9.6, Math.PI], [13.8, 6, -Math.PI / 2]]) { k.put(F.sofa('#3a0f2a', 3), x, z, r, 0.6, false); }
  for (const [x, z, r] of [[10, 9.5, Math.PI], [12, 9.5, Math.PI], [13.7, 5, -Math.PI / 2], [13.7, 7, -Math.PI / 2]]) k.act(x, z, 'Sit (VIP)', () => api.sit(k.w(x, z, 0.6), r, 'sit', 1.05), 1.0, 'E', undefined, 0.6);
  k.put(F.roundTable(0.5, 0.5, F.M.gold()), 11.5, 7.5, 0, 0.6, [0.9, 0.9]);
  // dancers
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const h = k.npc(Math.cos(a) * (3 + (i % 3)), Math.sin(a) * 2.4 - 1, a + Math.PI, 'dance', 200 + i, 'Clubber (NPC)');
    h.danceMove = i;
  }
  for (const [x, z] of [[-13, 9], [-13, -6], [12, -7]]) k.npc(x, z, Math.random() * 6, 'talk', Math.floor(x * z), 'Guest (NPC)');
  k.light(0, 6.5, -1, 0xff4fd8, 60, 18);
  k.light(-10, 6, 2, 0xffa040, 30, 12);
  k.light(11, 6, 6, 0xffd23f, 30, 12);
  k.light(0, 6, -10, 0x2fe6ff, 40, 14);
  k.music = { station: 'club', pos: k.w(0, -10, 2), volume: 1 };
}

// ----------------------------- TRADING -------------------------------------
function exchange(k: Kit, accent: string) {
  k.room(32, 24, 7, floorMarble(true), mat('exwall', { color: '#1a2230', roughness: 0.6 }), mat('exceil', { color: '#0c1018', roughness: 1 }), 3);
  k.ambient = { sky: 0xbcd8ff, ground: 0x1a2030, intensity: 0.45 };
  const tick = tickerScreen();
  k.screen(tick, 20, 5, 0, 4.4, -11.85);
  k.sign('SATOSHI SQUARE EXCHANGE — SIMULATED MARKETS', accent, 14, 0, 6.6, -11.8);
  const syms = ['SGLD', 'ETHN', 'SOLR', 'YLD', 'LQD', 'BLD', 'PXL', 'MDOG', 'CITY'];
  const charts = syms.map((s) => chartScreen(s));
  charts.forEach((c, i) => k.screen(c, 3.2, 2, -15.85, 2.6, -8 + i * 2.1, Math.PI / 2));
  // trading desks
  let n = 0;
  for (let r = 0; r < 3; r++) for (let c = -2; c <= 2; c++) {
    const x = c * 4.6, z = -5 + r * 4;
    k.put(F.desk(3.2, 0.9), x, z, 0, 0, [3.2, 0.9]);
    for (const dx of [-0.8, 0.8]) {
      const m = F.monitor(charts[(n++) % charts.length].mat, 0.55);
      k.put(m, x + dx, z - 0.25, 0, 0.76, false, false);
    }
    if ((r + c) % 2 === 0) k.npc(x - 0.8, z + 0.6, Math.PI, 'type', 300 + n, 'Trader (NPC)', 0.5);
    else { k.put(F.officeChair(), x + 0.8, z + 0.65, Math.PI); k.act(x + 0.8, z + 0.9, 'Trade at a desk', () => { api.sit(k.w(x + 0.8, z + 0.75), Math.PI, 'type', 0.5); api.panel('trade'); }, 1.2); }
  }
  // order terminals near entrance
  for (const [x, z] of [[-13, 4], [-13, 8], [13, 4]] as const) {
    k.put(F.kiosk(), x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0, [0.6, 0.4], true);
    k.act(x + (x < 0 ? 0.8 : -0.8), z, 'Trading terminal', () => api.panel('trade'), 1.4);
  }
  k.npc(10, 8, -Math.PI / 2, 'idle', 333, 'Exchange Concierge (NPC)');
  k.act(9, 8, 'Ask about the market', () => api.panel('news'), 1.6);
  for (const [x, z] of [[-8, -3], [0, -3], [8, -3], [-8, 5], [0, 5], [8, 5]]) k.light(x, 6.8, z, 0xcfe4ff, 34, 14);
  k.music = { station: 'ambient', pos: k.w(0, 0, 4), volume: 0.3 };
}

function office(k: Kit, accent: string, kind: string) {
  const big = kind === 'builderhub';
  k.room(big ? 24 : 20, 16, 3.6, kind === 'studio' ? floorConcrete() : kind === 'builderhub' ? floorWood(3) : floorCarpet([70, 76, 88]), wallPaint(kind === 'studio' ? [40, 36, 50] : [228, 226, 220]));
  const names: Record<string, string> = { tradingfirm: 'DELTA NEUTRAL CAPITAL', research: 'ALPHA LABS RESEARCH', media: 'COINWIRE MEDIA', studio: 'MEME FACTORY STUDIOS', builderhub: 'GENESIS HUB' };
  k.sign(names[kind] ?? kind, accent, 6, 0, 2.8, -7.85);
  const scr = kind === 'tradingfirm' ? chartScreen('ETHN') : kind === 'media' ? newsScreen() : textScreen(() => store.trending.map((t) => '#' + t), kind === 'studio' ? 'TRENDING NOW' : 'CITY TRENDS', accent);
  k.screen(scr, 4, 2.25, 0, 1.6, -7.85);
  let n = 0;
  for (let r = 0; r < 2; r++) for (let c = -2; c <= 2; c++) {
    const x = c * 3.6, z = -3 + r * 3.6;
    k.put(F.desk(1.6, 0.8), x, z, 0, 0, [1.6, 0.8]);
    const ms = kind === 'tradingfirm' ? chartScreen(['SGLD', 'SOLR', 'YLD', 'MDOG'][n % 4]) : null;
    if (ms) { k.screens.push(ms); ms.draw(); }
    k.put(F.monitor(ms?.mat, 0.6), x, z - 0.2, 0, 0.76, false, !ms);
    k.put(F.keyboard(), x, z + 0.1, 0, 0.76);
    if (n % 3 !== 1) k.npc(x, z + 0.7, Math.PI, 'type', 500 + n + kind.length * 10, 'Staff (NPC)', 0.5);
    else k.put(F.officeChair(), x, z + 0.7, Math.PI);
    n++;
  }
  // work station
  const wx = big ? -9 : 7, wz = 5.5;
  k.put(F.desk(1.8, 0.8), wx, wz, Math.PI, 0, [1.8, 0.8]);
  k.put(F.laptop(), wx, wz, Math.PI, 0.76);
  k.put(F.officeChair(true), wx, wz - 0.7, 0);
  k.sign('YOUR WORKSTATION', '#38f2a5', 2.2, wx, 2.0, wz + 0.5, Math.PI);
  k.act(wx, wz - 0.9, () => { const j = store.me?.job; return j && j.zone === k.zone ? `Work shift: ${j.title}` : 'Workstation (need a job here)'; }, () => {
    const j = store.me?.job;
    if (!j || j.zone !== k.zone) { api.panel('jobs'); return; }
    api.sit(k.w(wx, wz - 0.75), 0, 'type', 0.5);
    api.panel('work');
  }, 1.4);
  if (kind === 'research') { k.put(F.whiteboard(), -9.85, 0, Math.PI / 2); k.put(F.bookshelf(2), 9.8, -4, -Math.PI / 2, 0, [2, 0.35]); }
  if (kind === 'studio') {
    k.box(6, 3.4, 0.1, mat('greenscreen', { color: '#1fbf4a', roughness: 0.9 }), -5, 1.7, -7.7);
    k.npc(-5, -6, 0, 'talk', 808, 'Creator (NPC)');
    k.npc(-5, -3.5, Math.PI, 'phone', 809, 'Camera op (NPC)');
  }
  if (kind === 'media') { k.put(F.stage(5, 3, 0.4), 6, -6, 0, 0, [5, 3]); k.npc(6, -6.2, 0, 'talk', 901, 'Anchor (NPC)').root.position.y = 0.4; }
  if (kind === 'builderhub') {
    k.put(F.kiosk(), 9, 6, Math.PI, 0, [0.6, 0.4]);
    k.act(9, 5.3, 'Project HQ — create & manage projects', () => api.panel('projects'), 1.5);
    k.put(F.kiosk(), 6.5, 6, Math.PI, 0, [0.6, 0.4]);
    k.act(6.5, 5.3, 'Startup job board', () => api.panel('jobs'), 1.5);
    k.put(F.whiteboard(), 11.85, -2, -Math.PI / 2);
    k.put(F.sofa('#ffb03f', 2.4), -10.5, -5.5, Math.PI / 2, 0, [0.95, 2.4]);
    k.seat(-10.4, -6, Math.PI / 2); k.seat(-10.4, -5, Math.PI / 2);
  }
  if (kind === 'tradingfirm') { k.npc(-8, 5, Math.PI / 2, 'talk', 702, 'Head Trader (NPC)'); }
  k.put(F.plant(true), -9, -7); k.put(F.plant(true), 9, -7);
  for (const [x, z] of [[-6, -2], [0, -2], [6, -2], [-6, 4], [0, 4], [6, 4]]) k.light(x, 3.5, z, 0xf4f6ff, 22, 10);
  k.window(-(big ? 11.88 : 9.88), 1.8, -2, 4, 1.6, Math.PI / 2);
}

function jobs(k: Kit, accent: string) {
  k.room(16, 12, 3.6, floorTiles('#dfe3e6'), wallPaint([220, 226, 232]));
  k.sign('CITY JOBS CENTER', accent, 5, 0, 2.8, -5.85);
  const board = textScreen(() => ['Barista · Junior Dev · Research Associate', 'Community Moderator · Meme Producer', 'Market Analyst · Startup roles', '', 'Apply here or via the Jobs app.'], 'NOW HIRING', accent);
  k.screen(board, 4, 2.25, 0, 1.6, -5.85);
  for (const x of [-4, 0, 4]) { k.put(F.counterBar(2.2, '#2d3a55'), x, -2.5, 0, 0, [2.3, 0.85]); k.npc(x, -3.3, 0, 'idle', 120 + x, 'Recruiter (NPC)'); k.act(x, -1.6, 'Talk to a recruiter', () => api.panel('jobs'), 1.5); }
  for (const x of [-5, -3, 3, 5]) { k.put(F.audienceChair(), x, 3, Math.PI); k.seat(x, 3, Math.PI); }
  k.npc(-3, 3, Math.PI, 'phone', 131, 'Job seeker (NPC)', 0.45);
  for (const [x, z] of [[-4, 0], [4, 0], [0, 3]]) k.light(x, 3.5, z, 0xffffff, 22, 10);
}

function vctower(k: Kit, accent: string) {
  k.room(20, 16, 4.5, floorMarble(false), wallPaint([238, 236, 232]));
  k.sign('SEED ROUND TOWER — PARTNERS', accent, 6, 0, 3.6, -7.85);
  k.put(F.diningTable(4.5, 1.6, false), 0, -2, 0, 0, [4.5, 1.6]);
  for (const x of [-1.5, 0, 1.5]) { k.put(F.officeChair(), x, -3.2, 0); k.npc(x, -3.2, 0, x === 0 ? 'talk' : 'idle', 600 + x * 10, x === 0 ? 'Partner Sasha (NPC)' : 'Associate (NPC)', 0.5); }
  k.put(F.officeChair(), 0, -0.6, Math.PI);
  k.act(0, -0.2, 'Pitch your project', () => { api.sit(k.w(0, -0.55), Math.PI, 'talk', 0.5); api.panel('pitch'); }, 1.6);
  const scr = textScreen(() => ['We fund: traction, team, timing.', 'Bring users, milestones and a clear narrative.', 'Market sentiment affects our appetite.', '', 'Funding is simulated in-game currency.'], 'PITCH NIGHT', accent);
  k.screen(scr, 4, 2.25, 0, 2.2, -7.85);
  k.put(F.plant(true), -8, -6); k.put(F.plant(true), 8, -6); k.put(F.art(17, 1.6, 1.1), -9.85, 0, Math.PI / 2); k.put(F.art(18, 1.6, 1.1), 9.85, 0, -Math.PI / 2);
  k.window(-9.88, 2, 4, 3, 2.4, Math.PI / 2); k.window(9.88, 2, 4, 3, 2.4, -Math.PI / 2);
  for (const [x, z] of [[-4, -2], [4, -2], [0, 4]]) k.light(x, 4.4, z, 0xfff6ea, 26, 12);
}

function hackhouse(k: Kit, accent: string) {
  k.room(22, 16, 5, floorConcrete(), mat('brickint', { color: '#6a3a2a', roughness: 0.9 }));
  k.sign('HACKATHON HOUSE', accent, 6, 0, 4, -7.85);
  k.put(F.stage(8, 3, 0.6), 0, -6.2, 0, 0, [8, 3]);
  const board = textScreen(() => {
    const ev = activeEvent(k.zone);
    return ev ? [ev.name, ev.status.toUpperCase(), 'Solve challenges at the terminal.', ...(ev.registered?.length ? [`${ev.registered.length} registered`] : [])] : ['No hackathon right now.', 'Check the Events app for the schedule.'];
  }, 'HACKATHON', accent);
  k.screen(board, 5, 2.8, 0, 2.5, -7.85);
  for (let r = 0; r < 2; r++) for (let c = -1; c <= 1; c++) {
    const x = c * 5, z = -1 + r * 4;
    k.put(F.diningTable(3, 1.1), x, z, 0, 0, [3, 1.1]);
    k.put(F.laptop(), x - 0.7, z - 0.1, 0, 0.78); k.put(F.laptop(), x + 0.7, z - 0.1, 0, 0.78);
    k.npc(x - 0.7, z + 0.75, Math.PI, 'type', 700 + r * 3 + c, 'Hacker (NPC)', 0.45);
    k.put(F.chair('#2a2a2e'), x + 0.7, z + 0.75, Math.PI);
    k.act(x + 0.7, z + 0.9, 'Hack (event terminal)', () => { api.sit(k.w(x + 0.7, z + 0.75), Math.PI, 'type', 0.45); api.panel('events', { venue: k.zone }); }, 1.2);
  }
  for (const [x, z] of [[-6, 0], [0, 0], [6, 0], [0, 5]]) k.light(x, 4.8, z, 0xfff0d0, 28, 12);
  k.music = { station: 'synthwave', pos: k.w(0, -6, 2), volume: 0.35 };
}

function defihub(k: Kit, accent: string) {
  k.room(22, 16, 5, floorMarble(false), mat('defiwall', { color: '#0e1a1a', roughness: 0.6 }));
  k.ambient = { sky: 0xb0ffe6, ground: 0x0a2020, intensity: 0.45 };
  k.sign('YIELD PLAZA — STAKING & LENDING (SIMULATED)', accent, 10, 0, 4, -7.85);
  const apr = textScreen(() => ['City Lending sUSD ........ 6.0% APR', 'Etherion Staking ......... 4.5% APR', 'Solaris Staking .......... 7.0% APR', 'Yieldstone Vault ........ 18.0% APR (high risk)', 'CITY Governance ......... 10.0% APR', '', 'Yields accrue in simulated currency.', 'Protocol exploits can cause losses.'], 'POOLS', accent);
  k.screen(apr, 6, 3.4, 0, 2.2, -7.85);
  for (const x of [-7, -3.5, 0, 3.5, 7]) { k.put(F.kiosk(), x, 1, 0, 0, [0.6, 0.4]); k.act(x, 1.8, 'Staking terminal', () => api.panel('defi'), 1.4); }
  k.npc(-8, 5, Math.PI / 2, 'idle', 1001, 'DeFi Advisor (NPC)');
  k.act(-7, 5, 'Ask about risk', () => api.toast('Advisor: "Higher APR usually means higher risk. The Yieldstone Vault can be exploited — never stake what you can\'t lose, even in a simulation."'), 1.6);
  for (const [x, z] of [[-6, -2], [0, -2], [6, -2], [0, 4]]) k.light(x, 4.8, z, 0xc0ffe8, 26, 12);
  k.music = { station: 'ambient', pos: k.w(0, 0, 3), volume: 0.3 };
}

function airdrop(k: Kit, accent: string) {
  k.room(22, 18, 5, floorConcrete(), mat('airwall', { color: '#120c20', roughness: 0.6 }));
  k.ambient = { sky: 0xc0a0ff, ground: 0x100820, intensity: 0.4 };
  k.sign('AIRDROP CENTER', accent, 6, 0, 4, -8.85);
  const board = textScreen(() => ['Campaigns rotate. Outcomes vary.', 'Some pay well, some pay little,', 'some pay NOTHING. No guarantees.', '', 'These are simulated protocols —', 'not real-world airdrops.'], 'READ BEFORE YOU HUNT', '#ff4fa3');
  k.screen(board, 6, 3.4, 0, 2.3, -8.85);
  for (const [x, z] of [[-6, -2], [-2, -2], [2, -2], [6, -2], [-4, 3], [0, 3], [4, 3]]) { k.put(F.kiosk(), x, z, 0, 0, [0.6, 0.4]); k.act(x, z + 0.8, 'Campaign kiosk', () => api.panel('airdrops'), 1.3); }
  k.npc(8, 5, -Math.PI / 2, 'phone', 1101, 'Hunter (NPC)');
  k.npc(-8, 5, Math.PI / 2, 'phone', 1102, 'Hunter (NPC)');
  // floating parachute crates
  const crates: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat('crate', { color: '#c49a6c', roughness: 0.8 }));
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), F.M.emissive(['#ff4fa3', '#2fe6ff', '#ffd23f'][i % 3], 0.8));
    p.position.y = 1.6; g.add(c, p);
    g.position.set(-8 + i * 4, 3.3, -5);
    k.group.add(g); crates.push(g);
  }
  k.updaters.push((dt, t) => crates.forEach((c, i) => { c.position.y = 3.2 + Math.sin(t + i) * 0.25; c.rotation.y = t * 0.3 + i; }));
  for (const [x, z] of [[-6, 0], [6, 0], [0, 5]]) k.light(x, 4.8, z, 0xd8c0ff, 26, 12);
  k.music = { station: 'synthwave', pos: k.w(0, 0, 3), volume: 0.3 };
}

function governance(k: Kit, accent: string) {
  k.room(22, 18, 6, floorMarble(false), wallPaint([226, 218, 204]));
  k.sign('GOVERNANCE HALL', accent, 6, 0, 4.8, -8.85);
  k.put(F.stage(8, 3, 0.5), 0, -7, 0, 0, [8, 3]);
  k.put(F.podium(), 0, -7, 0, 0.5);
  const board = textScreen(() => ['Create a DAO, propose, vote.', 'Treasury transfers execute when', 'proposals pass (database governance', 'in this prototype — not on-chain).'], 'DAO HALL', accent);
  k.screen(board, 5, 2.8, 0, 3.2, -8.85);
  for (let r = 0; r < 4; r++) for (let c = -4; c <= 4; c++) {
    if (c === 0) continue;
    const x = c * 1.2, z = -2 + r * 1.6;
    k.put(F.audienceChair(), x, z, Math.PI, r * 0.15);
    k.seat(x, z, Math.PI, 0.45 + r * 0.15);
  }
  k.put(F.kiosk(), 8, 5, Math.PI, 0, [0.6, 0.4]); k.act(8, 4.3, 'DAO terminal', () => api.panel('dao'), 1.4);
  k.put(F.kiosk(), -8, 5, Math.PI, 0, [0.6, 0.4]); k.act(-8, 4.3, 'DAO terminal', () => api.panel('dao'), 1.4);
  k.npc(-1.2, 1.2, Math.PI, 'sit', 1201, 'Delegate (NPC)', 0.6);
  for (const [x, z] of [[-5, 0], [5, 0], [0, -6], [0, 5]]) k.light(x, 5.8, z, 0xfff2dc, 30, 14);
}

// ------------------------------ SHOPS --------------------------------------
function boutique(k: Kit, accent: string) {
  k.room(18, 14, 4, floorMarble(false), wallPaint([242, 238, 232]));
  k.sign('HODL THREADS', accent, 5, 0, 3.1, -6.85);
  const palette = ['#111114', '#f2f2f2', '#f7931a', '#4b5bdc', '#8c2f39', '#2f7d5b'];
  for (const [x, z, r] of [[-6, -3, Math.PI / 2], [-6, 1, Math.PI / 2], [6, -3, -Math.PI / 2], [6, 1, -Math.PI / 2], [0, -1, 0]]) k.put(F.clothingRack(palette.slice(0, 5)), x, z, r, 0, [1.5, 0.6]);
  for (let i = 0; i < 4; i++) k.put(F.mannequin(palette[i]), -4.5 + i * 3, -5.8, 0, 0, [0.5, 0.5]);
  k.put(F.counterBar(3, '#1a1a1e'), 4, 4.5, Math.PI, 0, [3.1, 0.85]);
  k.npc(4, 5.3, Math.PI, 'idle', 1301, 'Stylist Ivy (NPC)');
  k.act(4, 3.6, 'Shop clothing', () => api.panel('boutique'), 1.6);
  k.act(0, 0.2, 'Browse racks', () => api.panel('boutique'), 1.8);
  k.put(F.mirror(), -8.85, 4, Math.PI / 2);
  k.act(-8.2, 4, 'Fitting mirror — wardrobe', () => api.panel('wardrobe'), 1.3);
  for (const [x, z] of [[-4, -2], [4, -2], [0, 3]]) k.light(x, 3.9, z, 0xffffff, 26, 11);
  k.music = { station: 'pop', pos: k.w(0, 0, 3), volume: 0.35 };
}

function furnitureStore(k: Kit, accent: string) {
  k.room(22, 16, 4.5, floorWood(2), wallPaint([236, 232, 226]));
  k.sign('NEST & NODE FURNITURE', accent, 6, 0, 3.5, -7.85);
  const show = ['tv85', 'aquarium', 'arcade', 'bookshelf', 'gym', 'bar', 'pool', 'armchair', 'tower_speaker', 'plant', 'lamp', 'rig'];
  show.forEach((m, i) => {
    const x = -8 + (i % 4) * 5.3, z = -4.5 + Math.floor(i / 4) * 4.2;
    const obj = F.catalogModel(m);
    const dynamic = ['aquarium', 'smartlights', 'tv55', 'tv85', 'lamp'].includes(m);
    k.put(obj, x, z, 0, 0, 'auto', !dynamic);
    furnitureActs(k, m, m, x, z, 0, obj, false, 0, true);
  });
  k.put(F.counterBar(3, '#5a3a24'), 7, 6, Math.PI, 0, [3.1, 0.85]);
  k.npc(7, 6.8, Math.PI, 'idle', 1401, 'Sales (NPC)');
  k.act(7, 5.1, 'Furniture catalog', () => api.panel('furniture'), 1.6);
  for (const x of [-6, 0]) { k.put(F.kiosk(), x, 6.5, Math.PI, 0, [0.6, 0.4]); k.act(x, 5.8, 'Furniture catalog', () => api.panel('furniture'), 1.4); }
  for (const [x, z] of [[-5, -2], [5, -2], [0, 3]]) k.light(x, 4.4, z, 0xfff0dc, 26, 12);
}

function gallery(k: Kit, accent: string) {
  k.room(24, 16, 6, floorConcrete(), wallPaint([246, 246, 244]));
  k.sign('MINT GALLERY', accent, 5, 0, 5, -7.85);
  let s = 100;
  for (const [x, z, r] of [[-11.85, -4, Math.PI / 2], [-11.85, 0, Math.PI / 2], [-11.85, 4, Math.PI / 2], [11.85, -4, -Math.PI / 2], [11.85, 0, -Math.PI / 2], [11.85, 4, -Math.PI / 2], [-6, -7.85, 0], [6, -7.85, 0]]) {
    k.put(F.art(s++, 2.0, 1.4), x, z, r);
    const fx = x + Math.sin(r) * 1.6, fz = z + Math.cos(r) * 1.6;
    k.act(fx, fz, 'Admire the piece', () => api.toast(`"Untitled #${s}" — generative work on display (simulated collectible).`), 1.4);
  }
  for (const x of [-4, 0, 4]) {
    k.box(1, 1.1, 1, F.M.white(), x, 0.55, 1, true);
    const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.1, 64, 8), mat('sculpt' + x, { color: ['#ff4fa3', '#2fe6ff', '#ffd23f'][(x + 4) / 4], metalness: 0.8, roughness: 0.2 }));
    sculpt.position.set(x, 1.6, 1); k.group.add(sculpt);
    k.updaters.push((dt) => { sculpt.rotation.y += dt * 0.5; });
  }
  k.npc(-6, 4, 0.5, 'talk', 1501, 'Curator (NPC)');
  k.npc(5, 3, -0.8, 'phone', 1502, 'Collector (NPC)');
  for (const [x, z] of [[-8, 0], [0, 0], [8, 0], [0, -6]]) k.light(x, 5.8, z, 0xffffff, 30, 14);
  k.music = { station: 'ambient', pos: k.w(0, 0, 3), volume: 0.25 };
}

function realestate(k: Kit, accent: string) {
  k.room(14, 11, 3.6, floorWood(3), wallPaint([236, 230, 220]));
  k.sign('KEYSTONE REALTY', accent, 4, 0, 2.9, -5.35);
  k.put(F.desk(2.2, 1.0), 0, -2.5, 0, 0, [2.2, 1.0]);
  k.put(F.monitor(undefined, 0.6), 0, -2.8, 0, 0.76);
  k.npc(0, -3.4, 0, 'idle', 1601, 'Agent Priya (NPC)', 0);
  for (const x of [-0.6, 0.6]) { k.put(F.chair('#3d2a1e'), x, -1.5, Math.PI); }
  k.act(0, -1.2, 'Browse properties', () => { api.sit(k.w(0.6, -1.5), Math.PI, 'sit', 0.45); api.panel('realestate'); }, 1.6);
  for (let i = 0; i < 4; i++) k.put(F.art(200 + i, 1.0, 0.7), -6.85, -3 + i * 2, Math.PI / 2);
  k.put(F.plant(true), 6, -4.5);
  k.light(0, 3.5, -2, 0xfff0dc, 20, 9); k.light(0, 3.5, 2.5, 0xfff0dc, 18, 9);
}

// ---------------------------- CONVENTION -----------------------------------
function activeEvent(zone: string) {
  return store.events.find((e) => e.venue === zone && e.status !== 'ended');
}

function convention(k: Kit, accent: string) {
  k.room(44, 34, 9, floorCarpet([40, 46, 70]), mat('convwall', { color: '#1c2233', roughness: 0.7 }), mat('convceil', { color: '#0c0f18', roughness: 1 }), 4);
  k.ambient = { sky: 0xd0d8ff, ground: 0x181c28, intensity: 0.45 };
  // main stage
  k.put(F.stage(16, 6, 1.2), 0, -13.5, 0, 0, [16, 6]);
  const stageScr = textScreen(() => {
    const ev = activeEvent(k.zone);
    const lines = ev ? [ev.name, ev.status === 'live' ? '● LIVE NOW' : 'Starts ' + new Date(ev.start).toLocaleTimeString(), ev.description ?? ''] : ['Crypto City Convention Center', 'Next event: see the Events app'];
    return [...lines, '', ...store.news.slice(0, 3).map((n) => '› ' + n.title)];
  }, 'MAIN STAGE', accent);
  k.screen(stageScr, 12, 6.75, 0, 5.4, -16.85);
  k.put(F.podium(), 4, -13, 0, 1.2);
  const speaker = k.npc(4, -13.6, 0, 'talk', 1701, 'Keynote Speaker (NPC)');
  speaker.root.position.y = 1.2;
  for (let r = 0; r < 5; r++) for (let c = -6; c <= 6; c++) {
    if (c === 0) continue;
    const x = c * 1.1, z = -7.5 + r * 1.3;
    k.put(F.audienceChair(), x, z, Math.PI);
    if ((r * 13 + c) % 4 === 0) k.npc(x, z, Math.PI, 'sit', 1800 + r * 20 + c, 'Attendee (NPC)', 0.45);
    else k.seat(x, z, Math.PI);
  }
  k.act(0, -3.5, 'React to the talk', () => api.panel('react'), 3, 'R');
  // networking area (left)
  for (let i = 0; i < 8; i++) {
    const a = i * 0.8;
    k.npc(-15 + Math.cos(a) * (2 + (i % 2)), 4 + Math.sin(a) * 2, a + Math.PI, i % 3 ? 'talk' : 'phone', 1900 + i, 'Networker (NPC)');
  }
  for (const [x, z] of [[-15, 4], [-12, 9]]) k.put(F.roundTable(0.5, 1.05), x, z, 0, 0, [0.9, 0.9]);
  k.sign('NETWORKING', '#38f2a5', 4, -15, 4.5, -2.5);
  // startup showcase (right): top projects on booth screens
  k.sign('STARTUP SHOWCASE', '#ffb03f', 5, 14, 4.5, -2.5);
  for (let i = 0; i < 4; i++) {
    const x = 9 + (i % 2) * 8, z = 2 + Math.floor(i / 2) * 7;
    const scr = textScreen(() => {
      const p = store.projects[i];
      return p ? [p.name, `${p.category} · ${p.chain}`, `Founder @${p.founder}`, `${p.users.toLocaleString()} users`, `Milestones: ${p.milestones.join(', ') || 'building'}`] : ['Booth available', 'Create a project at Genesis Hub', 'to be featured here.'];
    }, 'BOOTH ' + (i + 1), ['#3fa7ff', '#ff4fa3', '#3fffb0', '#ffb03f'][i]);
    const b = F.booth(scr.mat, ['#3fa7ff', '#ff4fa3', '#3fffb0', '#ffb03f'][i]);
    k.put(b, x, z, 0, 0, [3, 2.2], false);
    k.screens.push(scr); scr.draw();
    k.act(x, z + 1.4, 'Visit booth', () => { const p = store.projects[i]; api.panel('project', p ? { id: p.id } : null); }, 1.8);
  }
  // competition area
  k.put(F.kiosk(), -6, 13, Math.PI, 0, [0.6, 0.4]); k.act(-6, 12.3, 'Events & competitions', () => api.panel('events', { venue: k.zone }), 1.5);
  k.put(F.kiosk(), 6, 13, Math.PI, 0, [0.6, 0.4]); k.act(6, 12.3, 'Events & competitions', () => api.panel('events', { venue: k.zone }), 1.5);
  const lb = tickerScreen();
  k.screen(lb, 8, 2, 0, 3, 16.8, Math.PI);
  for (const [x, z] of [[-10, -8], [0, -8], [10, -8], [-12, 6], [12, 6], [0, 10]]) k.light(x, 8.6, z, 0xe8eeff, 40, 18);
  k.light(0, 7, -13, 0xfff0d0, 50, 14);
  k.music = { station: 'ambient', pos: k.w(0, -12, 4), volume: 0.35 };
}

// ---------------------------- AUTOMOTIVE -----------------------------------
function cars(k: Kit, accent: string, used: boolean) {
  k.room(32, 22, 6, used ? floorConcrete() : floorMarble(false), used ? wallPaint([180, 176, 168]) : wallPaint([242, 242, 240]));
  k.sign(used ? 'SECOND BLOCK USED CARS' : 'MOONSHOT MOTORS', accent, 6, 0, 4.8, -10.85);
  const list = VEHICLES.filter((v) => !!v.used === used);
  list.forEach((v, i) => {
    const cols = used ? 2 : 4;
    const x = -10.5 + (i % cols) * (used ? 10 : 7), z = -5 + Math.floor(i / cols) * 7;
    if (!used) {
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.2, 40), mat('platform', { color: '#dcdcdc', roughness: 0.2, metalness: 0.3 }));
      plat.position.set(x, 0.1, z); k.group.add(plat);
      k.updaters.push((dt) => { plat.rotation.y += dt * 0.2; });
    }
    const car = buildVehicle(v.id, v.color, used ? 'steel' : 'sport');
    car.root.position.set(x, used ? 0 : 0.2, z);
    car.root.rotation.y = 0.6;
    k.group.add(car.root);
    k.colliders.addBox(INTERIOR_ORIGIN.x + x, INTERIOR_ORIGIN.z + z, 3, 3, 'car', 1.5);
    if (!used) k.updaters.push((dt) => { car.root.rotation.y += dt * 0.2; });
    k.act(x, z + 2.6, `Inspect ${v.name}`, () => api.panel('dealer', { model: v.id }), 1.8);
  });
  k.put(F.desk(2.2, 1), 11, 7, Math.PI, 0, [2.2, 1]);
  k.npc(11, 7.8, Math.PI, 'idle', used ? 1902 : 1901, used ? 'Dealer Tomás (NPC)' : 'Sales Lead Zoe (NPC)');
  k.act(11, 6.1, used ? 'Sell a vehicle / browse lot' : 'Talk to sales', () => api.panel(used ? 'sellcar' : 'dealer', {}), 1.6);
  if (!used) { k.window(-15.88, 2.5, 0, 8, 4, Math.PI / 2); k.window(15.88, 2.5, -2, 6, 4, -Math.PI / 2); }
  for (const [x, z] of [[-8, -3], [0, -3], [8, -3], [-8, 4], [0, 4], [8, 4]]) k.light(x, 5.8, z, 0xffffff, 34, 14);
  k.music = { station: 'pop', pos: k.w(0, 0, 3), volume: 0.25 };
}

function customs(k: Kit, accent: string) {
  k.room(24, 18, 6, floorConcrete(), mat('garagewall', { color: '#4a4f56', roughness: 0.8 }), undefined, 4);
  k.sign('GWEI CUSTOMS', accent, 5, 0, 4.8, -8.85);
  for (const x of [-6, 6]) {
    k.put(F.liftPost(), x, -4, 0, 0, false);
    const car = buildVehicle(x < 0 ? 'mirage' : 'bastion', x < 0 ? '#1e4fd9' : '#2f3b2f', 'black');
    car.root.position.set(x, 1.4, -4); k.group.add(car.root);
    k.colliders.addBox(INTERIOR_ORIGIN.x + x, INTERIOR_ORIGIN.z - 4, 3.6, 5, 'lift', 3);
  }
  k.put(F.toolbox(), -10.5, 2, Math.PI / 2, 0, [0.5, 1]); k.put(F.toolbox(), 10.5, 2, -Math.PI / 2, 0, [0.5, 1]);
  k.npc(-4, 1, 0.4, 'idle', 2001, 'Mechanic Hiro (NPC)');
  k.put(F.kiosk(), 0, 4, Math.PI, 0, [0.6, 0.4]);
  k.act(0, 3.3, 'Customize & repair', () => api.panel('customs'), 1.6);
  k.npc(3, 5, Math.PI, 'idle', 2002, 'Service Desk (NPC)');
  for (const [x, z] of [[-6, -3], [6, -3], [0, 3]]) k.light(x, 5.8, z, 0xf0f4ff, 34, 14);
  k.music = { station: 'rock', pos: k.w(0, 0, 3), volume: 0.35 };
}

function transport(k: Kit, accent: string) {
  k.room(16, 12, 3.8, floorTiles('#d8dde2'), wallPaint([226, 232, 236]));
  k.sign('CITYRIDE HQ', accent, 4, 0, 3, -5.85);
  const board = textScreen(() => {
    const me = store.me;
    return [me?.driver.registered ? 'You are a registered driver.' : 'Register with a car (2+ seats).', 'Go on duty from the Drive app', 'while sitting in your car.', '', 'Fleet owners: 5+ rides, $5,000 fee.', 'Hire NPC drivers for spare cars.'];
  }, 'DRIVE & EARN', accent);
  k.screen(board, 4, 2.25, 0, 1.6, -5.85);
  k.put(F.counterBar(4, '#1a3a2a'), 0, -2.2, 0, 0, [4.1, 0.85]);
  k.npc(0, -3, 0, 'idle', 2101, 'Driver Ops (NPC)');
  k.act(0, -1.3, 'Driver & fleet desk', () => api.panel('transport'), 1.6);
  for (const x of [-5, -3, 3, 5]) { k.put(F.audienceChair(), x, 3, Math.PI); k.seat(x, 3, Math.PI); }
  k.light(-3, 3.7, 0, 0xffffff, 20, 10); k.light(3, 3.7, 0, 0xffffff, 20, 10);
}

function whaleclub(k: Kit, accent: string) {
  k.room(22, 16, 5, floorMarble(true), mat('whalewall', { color: '#1b1612', roughness: 0.5 }), mat('whaleceil', { color: '#0e0b08', roughness: 1 }));
  k.ambient = { sky: 0xffd9a0, ground: 0x140e08, intensity: 0.35 };
  k.sign('THE WHALE CLUB', '#d4af37', 5, 0, 3.8, -7.85);
  k.put(F.homeBar(), 0, -6.6, 0, 0, [2.1, 0.7]);
  k.npc(0, -7.3, 0, 'idle', 2201, 'Sommelier Oskar (NPC)');
  k.act(0, -5.6, 'Order', () => api.panel('menu', { venue: 'whaleclub' }), 1.6);
  for (const [x, z, r] of [[-6, -1, Math.PI / 2], [-6, 2, Math.PI / 2], [6, -1, -Math.PI / 2], [6, 2, -Math.PI / 2], [-2, 4, Math.PI], [2, 4, Math.PI]]) {
    k.put(F.armchair('#3b2618'), x, z, r, 0, [0.85, 0.85]);
    k.seat(x, z, r);
  }
  k.put(F.roundTable(0.5, 0.55, F.M.gold()), -4.8, 0.5, 0, 0, [0.9, 0.9]);
  k.put(F.roundTable(0.5, 0.55, F.M.gold()), 4.8, 0.5, 0, 0, [0.9, 0.9]);
  { const pn = F.piano(); k.put(pn, 8, -5.5, -Math.PI / 2, 0, 'auto'); furnitureActs(k, 'piano', 'piano', 8, -5.5, -Math.PI / 2, pn, false, 0, true); }
  { const aq = F.aquarium(); k.put(aq, -9, -5.5, Math.PI / 2, 0, 'auto', false); furnitureActs(k, 'aquarium', 'aquarium', -9, -5.5, Math.PI / 2, aq, false, 0, true); }
  k.npc(-6, 2, Math.PI / 2, 'sit', 2202, 'Whale (NPC)', 0.45);
  k.npc(6, -1, -Math.PI / 2, 'phone', 2203, 'Whale (NPC)', 0.45);
  k.put(F.art(301, 2, 1.3), -10.85, 1, Math.PI / 2); k.put(F.art(302, 2, 1.3), 10.85, 1, -Math.PI / 2);
  k.window(0, 2.4, 7.88 - 0.1, 0.01, 0.01, Math.PI);
  for (const [x, z] of [[-5, 0], [5, 0], [0, -5], [0, 4]]) k.light(x, 4.8, z, 0xffc890, 18, 10);
  k.music = { station: 'jazz', pos: k.w(8, -5.5, 1), volume: 0.45 };
  void accent;
}

void nightish; void colorMat;
