// Scripted getting in and out of vehicles: walk to the driver's door, open it,
// climb in, close it (and the reverse, after bringing the car to a stop).

import * as THREE from 'three';
import type { Car } from '../entities/vehicle.js';
import type { PlayerController } from './controller.js';

type Phase = 'approach' | 'open' | 'in' | 'close' | 'brake' | 'xopen' | 'out' | 'xclose';
interface Seq { car: Car; phase: Phase; t: number; done: () => void; from: THREE.Vector3; fromH: number; side: 'L' | 'R' }

const UP = new THREE.Vector3(0, 1, 0);
const ease = (t: number) => t * t * (3 - 2 * t);

export class CarEntry {
  private seq: Seq | null = null;
  constructor(private player: PlayerController, private sfx: (n: 'door') => void) {}

  get busy() { return !!this.seq; }
  get car() { return this.seq?.car ?? null; }

  /** World position of a point given in the car's local frame. */
  private local(c: Car, x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyAxisAngle(UP, c.heading).add(c.pos);
  }
  private side: 'L' | 'R' = 'L';
  private seatOf(c: Car) { return this.side === 'R' && c.visual.seatR ? c.visual.seatR : c.visual.seat; }
  private doorPoint(c: Car) {
    const d = c.visual.dims;
    if (c.visual.isMoto) return this.local(c, 0.85, 0, 0);
    const s = this.seatOf(c);
    return this.local(c, (this.side === 'L' ? 1 : -1) * (d.W / 2 + 0.45), 0, s.z - 0.1);
  }
  private seatPoint(c: Car) { const s = this.seatOf(c); return this.local(c, s.x, s.y, s.z); }

  /** Walk to the driver's (L) or passenger's (R) door, open it, sit down, close it. */
  enter(car: Car, done: () => void, side: 'L' | 'R' = 'L') {
    const p = this.player;
    this.side = side;
    this.seq = { car, phase: 'approach', t: 0, done, from: p.pos.clone(), fromH: p.heading, side };
    p.mode = 'script';
    p.script.pos.copy(p.pos);
    p.script.heading = p.heading;
    p.script.camDist = 0;
  }

  exit(car: Car, done: () => void, side: 'L' | 'R' = 'L') {
    const p = this.player;
    this.side = side;
    this.seq = { car, phase: Math.abs(car.speed) > 0.6 && side === 'L' ? 'brake' : 'xopen', t: 0, done, from: this.seatPoint(car), fromH: car.heading, side };
    p.mode = 'script';
    p.script.pos.copy(this.seatPoint(car));
    p.script.heading = car.heading;
    p.script.anim = car.visual.isMoto ? 'ride' : side === 'R' ? 'sit' : 'drive';
    p.script.camDist = Math.max(p.camDist, car.visual.dims.L * 1.35);
  }

  private setDoor(c: Car, v: number) { if (c.visual.doors) c.visual.doors[this.side] = THREE.MathUtils.clamp(v, 0, 1); }
  private seatedAnim(moto: boolean) { return moto ? 'ride' : this.side === 'R' ? 'sit' : 'drive'; }

  update(dt: number) {
    const s = this.seq;
    if (!s) return;
    const p = this.player, sc = p.script, c = s.car;
    const moto = c.visual.isMoto;
    s.t += dt;
    const faceSide = c.heading + (s.side === 'L' ? -Math.PI / 2 : Math.PI / 2); // facing the door from outside
    switch (s.phase) {
      case 'approach': {
        const target = this.doorPoint(c);
        const to = target.clone().sub(sc.pos).setY(0);
        const d = to.length();
        if (d < 0.06 || s.t > 3) { sc.pos.copy(target); this.next(moto ? 'in' : 'open'); break; }
        const step = Math.min(d, 2.4 * dt);
        sc.pos.addScaledVector(to.normalize(), step);
        sc.heading = Math.atan2(to.x, to.z);
        sc.anim = 'walk'; sc.speed = 2.4;
        break;
      }
      case 'open': {
        sc.anim = 'idle'; sc.speed = 0;
        sc.heading = faceSide;
        this.setDoor(c, s.t / 0.45);
        if (s.t === dt) this.sfx('door');
        if (s.t >= 0.45) this.next('in');
        break;
      }
      case 'in': {
        const k = ease(Math.min(1, s.t / (moto ? 0.45 : 0.75)));
        sc.pos.copy(this.doorPoint(c)).lerp(this.seatPoint(c), k);
        sc.heading = faceSide + (c.heading - faceSide) * k;
        sc.anim = this.seatedAnim(moto); sc.speed = 0;
        sc.camDist = THREE.MathUtils.lerp(p.camDist, Math.max(p.camDist, c.visual.dims.L * 1.35), k);
        if (k >= 1) this.next(moto ? null : 'close');
        break;
      }
      case 'close': {
        sc.pos.copy(this.seatPoint(c));
        sc.heading = c.heading;
        this.setDoor(c, 1 - s.t / 0.4);
        if (s.t >= 0.4) { this.sfx('door'); this.next(null); }
        break;
      }
      case 'brake': {
        // bring the car to a stop before getting out
        c.speed *= Math.exp(-dt * 3.5);
        if (Math.abs(c.speed) < 0.4) { c.speed = 0; this.next('xopen'); }
        c.pos.x += Math.sin(c.heading) * c.speed * dt;
        c.pos.z += Math.cos(c.heading) * c.speed * dt;
        c.sync();
        sc.pos.copy(this.seatPoint(c));
        sc.heading = c.heading;
        break;
      }
      case 'xopen': {
        sc.pos.copy(this.seatPoint(c));
        if (moto) { this.next('out'); break; }
        this.setDoor(c, s.t / 0.45);
        if (s.t === dt) this.sfx('door');
        if (s.t >= 0.45) this.next('out');
        break;
      }
      case 'out': {
        const k = ease(Math.min(1, s.t / (moto ? 0.45 : 0.75)));
        sc.pos.copy(this.seatPoint(c)).lerp(this.doorPoint(c), k);
        sc.heading = c.heading + (faceSide + Math.PI - c.heading) * k;
        sc.anim = k < 0.5 ? this.seatedAnim(moto) : 'idle';
        sc.camDist = THREE.MathUtils.lerp(sc.camDist, p.camDist, Math.min(1, dt * 3));
        if (k >= 1) this.next(moto ? null : 'xclose');
        break;
      }
      case 'xclose': {
        sc.pos.copy(this.doorPoint(c));
        sc.anim = 'idle';
        this.setDoor(c, 1 - s.t / 0.4);
        if (s.t >= 0.4) { this.sfx('door'); this.next(null); }
        break;
      }
    }
  }

  private next(phase: Phase | null) {
    const s = this.seq!;
    if (!phase) {
      this.seq = null;
      if (s.car.visual.doors) s.car.visual.doors[s.side] = 0;
      s.done();
      return;
    }
    s.phase = phase;
    s.t = 0;
  }

  /** Where the player stands after getting out. */
  exitPoint(c: Car) { return this.doorPoint(c); }
}
