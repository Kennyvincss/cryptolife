// Scripted walking through real doors: step up to the door, push it open,
// walk through, then hand over (zone change) — and the reverse when arriving.

import * as THREE from 'three';
import type { PlayerController } from './controller.js';

export type DoorStep =
  | { walk: THREE.Vector3; speed?: number }           // walk to a point
  | { face: number; t?: number }                      // turn on the spot
  | { door: (v: number) => void; from: number; to: number; t?: number; sfx?: boolean } // animate a door 0..1
  | { call: () => void | Promise<void> }              // run something (fade, zone change)
  | { wait: number };

export class DoorWalk {
  private steps: DoorStep[] = [];
  private t = 0;
  private waiting = false;
  private onDone: (() => void) | null = null;
  constructor(private player: PlayerController, private sfx: () => void) {}

  get busy() { return this.steps.length > 0 || this.waiting; }

  /** Run a door sequence starting from `from` (defaults to where the player stands). */
  run(steps: DoorStep[], opts: { from?: THREE.Vector3; heading?: number; done?: () => void } = {}) {
    const p = this.player;
    p.mode = 'script';
    p.script.pos.copy(opts.from ?? p.pos);
    p.script.pos.y = opts.from ? opts.from.y : p.pos.y;
    p.script.heading = opts.heading ?? p.heading;
    p.script.anim = 'idle'; p.script.speed = 0; p.script.camDist = 0; p.script.follow = true;
    if (opts.heading !== undefined) p.camYaw = opts.heading + Math.PI;
    this.steps = steps.slice();
    this.t = 0;
    this.onDone = opts.done ?? null;
  }

  cancel() { this.steps = []; this.waiting = false; }

  update(dt: number) {
    if (this.waiting || !this.steps.length) return;
    const sc = this.player.script;
    const s = this.steps[0];
    this.t += dt;
    let fin = false;
    if ('walk' in s) {
      const to = s.walk.clone().sub(sc.pos).setY(0);
      const d = to.length(), v = s.speed ?? 1.5;
      if (d < 0.04 || this.t > 6) { sc.pos.x = s.walk.x; sc.pos.z = s.walk.z; fin = true; }
      else {
        sc.pos.addScaledVector(to.normalize(), Math.min(d, v * dt));
        const want = Math.atan2(to.x, to.z);
        sc.heading += Math.atan2(Math.sin(want - sc.heading), Math.cos(want - sc.heading)) * Math.min(1, dt * 10);
        sc.anim = 'walk'; sc.speed = v;
      }
    } else if ('face' in s) {
      const dur = s.t ?? 0.25;
      sc.heading += Math.atan2(Math.sin(s.face - sc.heading), Math.cos(s.face - sc.heading)) * Math.min(1, dt / Math.max(0.01, dur - this.t + dt));
      sc.anim = 'idle'; sc.speed = 0;
      fin = this.t >= dur;
      if (fin) sc.heading = s.face;
    } else if ('door' in s) {
      const dur = s.t ?? 0.55;
      if (s.sfx !== false && this.t === dt) this.sfx();
      const k = Math.min(1, this.t / dur), e = k * k * (3 - 2 * k);
      s.door(s.from + (s.to - s.from) * e);
      fin = k >= 1;
    } else if ('wait' in s) {
      fin = this.t >= s.wait;
    } else if ('call' in s) {
      const r = s.call();
      if (r instanceof Promise) {
        this.waiting = true;
        this.steps.shift(); this.t = 0;
        r.finally(() => { this.waiting = false; if (!this.steps.length) this.finish(); });
        return;
      }
      fin = true;
    }
    if (fin) {
      this.steps.shift();
      this.t = 0;
      if (!this.steps.length) this.finish();
    }
  }

  private finish() {
    const p = this.player;
    p.script.follow = false;
    if (p.mode === 'script') {
      p.mode = 'walk';
      p.pos.copy(p.script.pos);
      p.pos.y = p.script.pos.y;
      p.heading = p.script.heading;
    }
    const cb = this.onDone; this.onDone = null;
    cb?.();
  }
}
