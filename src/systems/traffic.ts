// NPC traffic on the road grid (right-hand lanes, signals, car following) and sidewalk pedestrians.

import * as THREE from 'three';
import { BLOCK, COLS, ROAD, ROAD_X, ROAD_Z, ROWS, blockOrigin } from '../../shared/city.js';
import { Humanoid, randomLook } from '../entities/humanoid.js';
import { Car } from '../entities/vehicle.js';

const LANE = 2.2;
const STOP = 9.5;
type Seg = { kind: 'line'; p0: THREE.Vector3; p1: THREE.Vector3; len: number; dir: THREE.Vector3; signal?: { axis: 'ns' | 'ew'; node: [number, number] } }
  | { kind: 'bez'; p0: THREE.Vector3; c: THREE.Vector3; p1: THREE.Vector3; len: number };

export function signalPhase(t: number): { ns: 'g' | 'y' | 'r'; ew: 'g' | 'y' | 'r' } {
  const c = t % 24;
  if (c < 10) return { ns: 'g', ew: 'r' };
  if (c < 12) return { ns: 'y', ew: 'r' };
  if (c < 22) return { ns: 'r', ew: 'g' };
  return { ns: 'r', ew: 'y' };
}

const node = (i: number, j: number) => new THREE.Vector3(ROAD_X[i], 0, ROAD_Z[j]);
const hasSignal = (i: number, j: number) => i > 0 && j > 0 && i < COLS && j < ROWS;

interface Agent { car: Car; at: [number, number]; to: [number, number]; segs: Seg[]; s: number; v: number; honk: number; dir: THREE.Vector3 }

export class Traffic {
  agents: Agent[] = [];
  group = new THREE.Group();

  constructor(count = 22) {
    const models = ['pico', 'ledger', 'ampere', 'bastion', 'ledger', 'regent', 'mirage', 'pico', 'byte'];
    const paints = ['#c8d1d8', '#111114', '#2d3a55', '#8c2f39', '#f2f2f2', '#2f3b2f', '#d92b3a', '#1e4fd9', '#f7931a'];
    for (let k = 0; k < count; k++) {
      const i = Math.floor(Math.random() * (COLS + 1)), j = Math.floor(Math.random() * (ROWS + 1));
      const car = new Car(models[k % models.length], paints[(k * 3) % paints.length]);
      car.visual.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
      this.group.add(car.root);
      const a: Agent = { car, at: [i, j], to: [i, j], segs: [], s: 0, v: 8, honk: 0, dir: new THREE.Vector3(0, 0, 1) };
      this.pickNext(a, null);
      a.s = Math.random() * (a.segs[0]?.len ?? 0);
      this.agents.push(a);
    }
  }

  private neighbors(i: number, j: number) {
    const out: [number, number][] = [];
    if (i > 0) out.push([i - 1, j]); if (i < COLS) out.push([i + 1, j]);
    if (j > 0) out.push([i, j - 1]); if (j < ROWS) out.push([i, j + 1]);
    return out;
  }

  private pickNext(a: Agent, prevDir: THREE.Vector3 | null) {
    const [i, j] = a.to;
    let opts = this.neighbors(i, j);
    if (prevDir) {
      opts = opts.filter(([ni, nj]) => { const d = node(ni, nj).sub(node(i, j)).normalize(); return d.dot(prevDir) > -0.5; });
      if (!opts.length) opts = this.neighbors(i, j);
    }
    const [ni, nj] = opts[Math.floor(Math.random() * opts.length)];
    const A = node(i, j), B = node(ni, nj);
    const d = B.clone().sub(A).normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const segs: Seg[] = [];
    const p0 = A.clone().addScaledVector(d, STOP).addScaledVector(right, LANE);
    if (prevDir) {
      const pr = new THREE.Vector3(-prevDir.z, 0, prevDir.x);
      const q0 = A.clone().addScaledVector(prevDir, -STOP).addScaledVector(pr, LANE);
      const straight = prevDir.dot(d) > 0.9;
      const c = straight ? q0.clone().lerp(p0, 0.5) : A.clone().addScaledVector(pr, LANE).addScaledVector(right, LANE);
      segs.push({ kind: 'bez', p0: q0, c, p1: p0, len: q0.distanceTo(c) + c.distanceTo(p0) * 0.9 });
    }
    const p1 = B.clone().addScaledVector(d, -STOP).addScaledVector(right, LANE);
    segs.push({ kind: 'line', p0, p1, len: p0.distanceTo(p1), dir: d, signal: hasSignal(ni, nj) ? { axis: Math.abs(d.x) > 0.5 ? 'ew' : 'ns', node: [ni, nj] } : undefined });
    a.at = [i, j]; a.to = [ni, nj]; a.segs = segs; a.s = 0; a.dir = d;
  }

  update(dt: number, t: number, focus: THREE.Vector3, obstacles: { pos: THREE.Vector3; r: number }[], onHonk?: () => void) {
    const phase = signalPhase(t);
    for (const a of this.agents) {
      const far = a.car.pos.distanceTo(focus) > 260;
      a.car.root.visible = !far;
      let seg = a.segs[0];
      if (!seg) { this.pickNext(a, a.dir.clone()); seg = a.segs[0]; }
      // target speed
      let target = seg.kind === 'bez' ? 6 : 11;
      const pos = a.car.pos;
      const heading = new THREE.Vector3(Math.sin(a.car.heading), 0, Math.cos(a.car.heading));
      if (seg.kind === 'line' && seg.signal) {
        const remain = seg.len - a.s;
        const light = phase[seg.signal.axis];
        if (light !== 'g' && remain < 14 && remain > 0.5) target = Math.min(target, Math.max(0, (remain - 1) * 0.9));
      }
      // car following & obstacles
      for (const o of this.agents) {
        if (o === a) continue;
        const rel = o.car.pos.clone().sub(pos);
        const ahead = rel.dot(heading);
        if (ahead <= 0 || ahead > 12) continue;
        const lat = Math.abs(rel.x * heading.z - rel.z * heading.x);
        if (lat < 2.0) target = Math.min(target, Math.max(0, (ahead - 5.5) * 1.2));
      }
      for (const ob of obstacles) {
        const rel = ob.pos.clone().sub(pos);
        const ahead = rel.dot(heading);
        if (ahead <= 0 || ahead > 11) continue;
        const lat = Math.abs(rel.x * heading.z - rel.z * heading.x);
        if (lat < 1.6 + ob.r) {
          target = Math.min(target, Math.max(0, (ahead - 4.5) * 1.2));
          if (ahead < 7 && t > a.honk) { a.honk = t + 6 + Math.random() * 6; if (!far && ahead < 9) onHonk?.(); }
        }
      }
      a.v += (target - a.v) * Math.min(1, dt * (target < a.v ? 4 : 1.5));
      if (far) a.v = Math.max(a.v, 6);
      a.s += a.v * dt;
      while (seg && a.s >= seg.len) {
        a.s -= seg.len;
        a.segs.shift();
        if (!a.segs.length) { this.pickNext(a, a.dir.clone()); }
        seg = a.segs[0];
      }
      if (!seg) continue;
      const u = seg.len > 0 ? a.s / seg.len : 0;
      let p: THREE.Vector3, tan: THREE.Vector3;
      if (seg.kind === 'line') { p = seg.p0.clone().lerp(seg.p1, u); tan = seg.dir; }
      else {
        const m = 1 - u;
        p = seg.p0.clone().multiplyScalar(m * m).addScaledVector(seg.c, 2 * m * u).addScaledVector(seg.p1, u * u);
        tan = seg.c.clone().sub(seg.p0).multiplyScalar(2 * m).add(seg.p1.clone().sub(seg.c).multiplyScalar(2 * u)).normalize();
      }
      const prevH = a.car.heading;
      a.car.pos.copy(p);
      a.car.heading = Math.atan2(tan.x, tan.z);
      a.car.speed = a.v;
      if (!far) {
        a.car.wheelSpin += (a.v / a.car.visual.dims.wheelR) * dt;
        for (const w of a.car.visual.wheels) {
          w.spin.rotation.z = -a.car.wheelSpin * (w.spin.rotation.y < 0 ? -1 : 1);
          if (w.front) w.holder.rotation.y = THREE.MathUtils.clamp(Math.atan2(Math.sin(a.car.heading - prevH), Math.cos(a.car.heading - prevH)) * 25, -0.5, 0.5);
        }
        a.car.visual.brake.emissiveIntensity = target < a.v - 0.5 ? 3 : 0.6;
        if (a.car.visual.isMoto) a.car.lean = 0;
        a.car.sync();
      }
    }
  }

  setHeadlights(on: boolean) { for (const a of this.agents) a.car.setHeadlights(on); }

  /** Push the player's car out of traffic cars. Returns impact speed (0 if none). */
  collide(pos: THREE.Vector3, r: number): { dx: number; dz: number } | null {
    for (const a of this.agents) {
      const dx = pos.x - a.car.pos.x, dz = pos.z - a.car.pos.z;
      const d = Math.hypot(dx, dz);
      const min = r + a.car.radius + 0.6;
      if (d < min && d > 0.001) return { dx: (dx / d) * (min - d), dz: (dz / d) * (min - d) };
    }
    return null;
  }
}

// ---------------- pedestrians ----------------
interface Ped { h: Humanoid; loop: THREE.Vector3[]; seg: number; t: number; dir: 1 | -1; speed: number; pause: number; anim: 'walk' | 'idle' | 'phone' | 'talk'; side: number }

export class Pedestrians {
  peds: Ped[] = [];
  group = new THREE.Group();

  constructor(count = 30) {
    for (let k = 0; k < count; k++) {
      const c = k % COLS, r = Math.floor(k / COLS) % ROWS;
      const [bx, bz] = blockOrigin(c, r);
      const inset = 2 + (k % 2) * 0.8;
      const loop = [
        new THREE.Vector3(bx + inset, 0.15, bz + inset), new THREE.Vector3(bx + BLOCK - inset, 0.15, bz + inset),
        new THREE.Vector3(bx + BLOCK - inset, 0.15, bz + BLOCK - inset), new THREE.Vector3(bx + inset, 0.15, bz + BLOCK - inset),
      ];
      const h = new Humanoid(randomLook(1000 + k * 7));
      h.bake();
      h.setNameTag('Citizen', 'npc');
      h.showTag(false);
      this.group.add(h.root);
      this.peds.push({ h, loop, seg: k % 4, t: Math.random(), dir: k % 3 === 0 ? -1 : 1, speed: 1.1 + Math.random() * 0.5, pause: 0, anim: 'walk', side: 0 });
    }
    // seafront strollers on the boardwalk (see buildCoast in world/city.ts)
    const bz = ROAD_Z[ROAD_Z.length - 1] + ROAD / 2;
    for (let k = 0; k < 8; k++) {
      const x0 = -230 + k * 58, len = 40 + (k % 3) * 15;
      const loop = [
        new THREE.Vector3(x0, 0.15, bz + 3.4), new THREE.Vector3(x0 + len, 0.15, bz + 3.4),
        new THREE.Vector3(x0 + len, 0.15, bz + 5.2), new THREE.Vector3(x0, 0.15, bz + 5.2),
      ];
      const h = new Humanoid(randomLook(5000 + k * 11));
      h.setNameTag('Citizen', 'npc');
      h.showTag(false);
      this.group.add(h.root);
      this.peds.push({ h, loop, seg: k % 2 ? 0 : 2, t: Math.random(), dir: 1, speed: 0.9 + Math.random() * 0.4, pause: 0, anim: 'walk', side: 0 });
    }
  }

  update(dt: number, focus: THREE.Vector3, player: THREE.Vector3, playerCar: { pos: THREE.Vector3; speed: number } | null) {
    for (const p of this.peds) {
      const d = p.h.root.position.distanceTo(focus);
      const visible = d < 110;
      p.h.root.visible = visible;
      if (!visible) continue;
      p.h.showTag(d < 7);
      if ((d < 35) !== p.h.castShadows) p.h.setShadows(d < 35);
      p.h.setAnimStep(d < 25 ? 0 : d < 60 ? 1 / 20 : 1 / 8);
      if (p.pause > 0) {
        p.pause -= dt;
        p.h.update(dt, p.anim === 'walk' ? 'idle' : p.anim);
        if (p.pause <= 0) p.anim = 'walk';
        continue;
      }
      const a = p.loop[p.seg], b = p.loop[(p.seg + (p.dir > 0 ? 1 : 3)) % 4];
      const len = a.distanceTo(b);
      p.t += (p.speed * dt) / len;
      if (p.t >= 1) {
        p.t = 0;
        p.seg = (p.seg + (p.dir > 0 ? 1 : 3)) % 4;
        if (Math.random() < 0.3) { p.pause = 2 + Math.random() * 6; p.anim = Math.random() < 0.5 ? 'phone' : 'idle'; }
      }
      const pos = a.clone().lerp(b, p.t);
      const dir = b.clone().sub(a).normalize();
      // sidestep the player
      const toPlayer = player.clone().sub(pos);
      const lateral = new THREE.Vector3(-dir.z, 0, dir.x);
      if (toPlayer.length() < 1.4) p.side = THREE.MathUtils.clamp(p.side - Math.sign(toPlayer.dot(lateral) || 1) * dt * 3, -1.4, 1.4);
      else p.side *= 1 - dt;
      if (playerCar && playerCar.pos.distanceTo(pos) < 3 && Math.abs(playerCar.speed) > 1) { p.side = p.side > 0 ? 1.6 : -1.6; p.pause = 1.5; p.anim = 'talk'; }
      pos.addScaledVector(lateral, p.side);
      p.h.root.position.copy(pos);
      p.h.root.rotation.y = Math.atan2(dir.x, dir.z);
      p.h.update(dt, 'walk', p.speed);
    }
  }
}
