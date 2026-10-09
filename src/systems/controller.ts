// Third-person character controller + camera rig (on foot, seated, driving, passenger).

import * as THREE from 'three';
import type { Input } from '../engine/input.js';
import type { Anim } from '../entities/humanoid.js';
import { Humanoid } from '../entities/humanoid.js';
import type { Car } from '../entities/vehicle.js';
import type { Colliders } from '../world/colliders.js';

export type Mode = 'walk' | 'seated' | 'drive' | 'passenger' | 'lying';

export class PlayerController {
  pos = new THREE.Vector3();
  heading = 0;
  vy = 0;
  mode: Mode = 'walk';
  anim: Anim = 'idle';
  speed = 0;
  car: Car | null = null;
  camYaw = 0;
  camPitch = 0.28;
  camDist = 5.5;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private emote: { anim: Anim; until: number } | null = null;
  private lastMouse = 0;
  private seatH = 0.45;
  onStand?: () => void;
  firstPerson = false;
  camBounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number } | null = null;

  constructor(public body: Humanoid, public camera: THREE.PerspectiveCamera) {}

  teleport(p: THREE.Vector3, heading: number) {
    this.pos.copy(p);
    this.heading = heading;
    this.camYaw = heading + Math.PI;
    this.vy = 0;
    this.body.root.position.copy(p);
    this.body.root.rotation.set(0, heading, 0);
    this.snapCamera();
  }

  setEmote(anim: Anim | null, secs = 5) {
    this.emote = anim ? { anim, until: performance.now() + secs * 1000 } : null;
  }
  emoteAnim() { return this.emote && this.emote.until > performance.now() ? this.emote.anim : null; }

  sit(p: THREE.Vector3, rot: number, anim: Anim = 'sit', seatH = 0.45) {
    this.mode = 'seated';
    this.pos.copy(p);
    this.heading = rot;
    this.anim = anim;
    this.seatH = seatH;
    this.emote = null;
  }
  lie(p: THREE.Vector3, rot: number) {
    this.mode = 'lying';
    this.pos.copy(p);
    this.heading = rot;
    this.anim = 'sleep';
  }
  stand() {
    if (this.mode === 'seated' || this.mode === 'lying') {
      this.mode = 'walk';
      this.pos.addScaledVector(new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)), 0.55);
      this.pos.y = 0;
      this.onStand?.();
    }
  }

  update(dt: number, input: Input, colliders: Colliders, groundAt: (x: number, z: number) => number, uiBlocked: boolean) {
    // camera orbit
    const sens = 0.0026;
    if (input.mouseDX || input.mouseDY) {
      this.camYaw -= input.mouseDX * sens;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + input.mouseDY * sens, -0.35, 1.2);
      this.lastMouse = performance.now();
    }
    if (input.wheel) this.camDist = THREE.MathUtils.clamp(this.camDist + input.wheel * 0.6, 1.8, 14);

    const fwd = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const strafe = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const moving = !uiBlocked && (fwd !== 0 || strafe !== 0);

    if (this.mode === 'seated' || this.mode === 'lying') {
      if (moving || input.pressed('Space')) this.stand();
      this.body.root.position.set(this.pos.x, this.pos.y + (this.mode === 'seated' ? this.seatH - 0.45 : 0), this.pos.z);
      this.body.root.rotation.y = this.heading;
      this.body.update(dt, this.mode === 'lying' ? 'sleep' : (this.emoteAnim() === 'eat' ? 'eat' : this.anim));
      this.updateCamera(dt, colliders, 1.1);
      return;
    }

    if (this.mode === 'drive' && this.car) {
      const c = this.car;
      c.update(dt, {
        throttle: uiBlocked ? 0 : (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0),
        brake: uiBlocked ? 0 : (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0),
        steer: uiBlocked ? 0 : strafe * -1,
        handbrake: !uiBlocked && input.down('Space'),
      }, colliders);
      this.pos.copy(c.pos);
      this.heading = c.heading;
      const seat = c.visual.seat;
      const off = new THREE.Vector3(seat.x, seat.y, seat.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.heading);
      this.body.root.position.copy(c.pos).add(off);
      this.body.root.rotation.set(0, c.heading, c.visual.isMoto ? c.lean : 0);
      this.body.update(dt, c.visual.isMoto ? 'ride' : 'drive');
      // chase camera unless the player is orbiting manually
      if (performance.now() - this.lastMouse > 1500) {
        const target = c.heading + Math.PI + (c.speed < -1 ? Math.PI : 0);
        let d = target - this.camYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.camYaw += d * Math.min(1, dt * 2.5);
        this.camPitch += (0.22 - this.camPitch) * Math.min(1, dt * 2);
      }
      this.updateCamera(dt, colliders, 1.4, Math.max(this.camDist, c.visual.dims.L * 1.35));
      return;
    }

    if (this.mode === 'passenger') {
      this.updateCamera(dt, colliders, 1.4, Math.max(this.camDist, 7));
      return;
    }

    // walking
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    const target = moving ? (run ? 5.6 : 2.3) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 8);
    if (moving) {
      const camF = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const camR = new THREE.Vector3(-camF.z, 0, camF.x);
      const dir = camF.multiplyScalar(fwd).add(camR.multiplyScalar(strafe)).normalize();
      const want = Math.atan2(dir.x, dir.z);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 12);
      this.pos.x += dir.x * this.speed * dt;
      this.pos.z += dir.z * this.speed * dt;
      this.emote = this.emote && this.emote.anim === 'phone' ? this.emote : null;
    } else if (this.speed > 0.05) {
      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;
    }
    const hit = colliders.resolveCircle(this.pos.x, this.pos.z, 0.35);
    if (hit) { this.pos.x += hit.dx; this.pos.z += hit.dz; }
    // vertical
    const gy = groundAt(this.pos.x, this.pos.z);
    if (!uiBlocked && input.pressed('Space') && this.pos.y <= gy + 0.01) this.vy = 4.6;
    this.vy -= 14 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= gy) {
      // step up curbs smoothly
      this.pos.y = gy - this.pos.y > 0.3 ? gy : THREE.MathUtils.lerp(this.pos.y, gy, Math.min(1, dt * 20));
      if (this.pos.y > gy - 0.01) this.pos.y = gy;
      this.vy = 0;
    }

    const em = this.emoteAnim();
    this.anim = this.speed > 3.6 ? 'run' : this.speed > 0.25 ? 'walk' : em ?? 'idle';
    if (em === 'phone' && this.speed > 0.25 && this.speed < 3.6) this.anim = 'walk';
    this.body.root.position.copy(this.pos);
    this.body.root.rotation.set(0, this.heading, 0);
    this.body.update(dt, this.anim, this.speed);
    if (em === 'phone') this.body.phone.visible = true;
    this.updateCamera(dt, colliders, 1.55);
  }

  snapCamera() { this.updateCamera(1, null, 1.55); }

  private updateCamera(dt: number, colliders: Colliders | null, height: number, dist = this.camDist) {
    const look = new THREE.Vector3(this.body.root.position.x, this.body.root.position.y + height, this.body.root.position.z);
    if (this.mode === 'drive' && this.car) look.set(this.car.pos.x, this.car.pos.y + height, this.car.pos.z);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    let d = dist;
    if (colliders) {
      const hd = Math.hypot(dir.x, dir.z) || 1;
      const hit = colliders.raycast(look.x, look.z, dir.x / hd, dir.z / hd, d * hd + 0.4, look.y + dir.y * d - 0.5);
      d = Math.min(d, Math.max(1.0, hit / hd - 0.3));
    }
    const want = look.clone().addScaledVector(dir, d);
    if (want.y < 0.3) want.y = 0.3;
    const b = this.camBounds;
    if (b) {
      // keep the camera inside the room: shorten the boom until it fits
      for (let i = 0; i < 12 && (want.x < b.minX || want.x > b.maxX || want.z < b.minZ || want.z > b.maxZ || want.y > b.maxY); i++) {
        d *= 0.8;
        want.copy(look).addScaledVector(dir, d);
      }
      want.x = THREE.MathUtils.clamp(want.x, b.minX, b.maxX);
      want.z = THREE.MathUtils.clamp(want.z, b.minZ, b.maxZ);
      want.y = Math.min(want.y, b.maxY);
    }
    const k = dt >= 1 ? 1 : 1 - Math.exp(-dt * 14);
    this.camPos.lerp(want, k);
    if (dt >= 1) this.camPos.copy(want);
    this.camLook.lerp(look, dt >= 1 ? 1 : 1 - Math.exp(-dt * 20));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }
}
