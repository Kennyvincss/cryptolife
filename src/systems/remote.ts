// Rendering of other real players (from server presence), clearly tagged PLAYER.

import * as THREE from 'three';
import type { PresenceEntry } from '../../shared/types.js';
import { Humanoid, type Anim } from '../entities/humanoid.js';
import { buildVehicle, type VehicleVisual } from '../entities/vehicle.js';

interface Remote { h: Humanoid; lookKey: string; target: THREE.Vector3; rot: number; anim: Anim; veh: VehicleVisual | null; vehKey: string; entry: PresenceEntry; seen: number }

const ANIMS = new Set(['idle', 'walk', 'run', 'sit', 'sleep', 'dance', 'drive', 'phone', 'eat', 'talk', 'wave', 'workout', 'type', 'ride']);

export class RemotePlayers {
  group = new THREE.Group();
  map = new Map<string, Remote>();

  sync(list: PresenceEntry[]) {
    const now = performance.now();
    for (const e of list) {
      let r = this.map.get(e.id);
      const lk = JSON.stringify(e.look);
      if (!r) {
        const h = new Humanoid(e.look);
        h.bake();
        h.setNameTag('@' + e.name, 'player');
        this.group.add(h.root);
        h.root.position.set(e.p[0], e.p[1], e.p[2]);
        r = { h, lookKey: lk, target: new THREE.Vector3(...e.p), rot: e.r, anim: 'idle', veh: null, vehKey: '', entry: e, seen: now };
        this.map.set(e.id, r);
      }
      if (r.lookKey !== lk) { r.h.setLook(e.look); r.h.bake(); r.h.setNameTag('@' + e.name, 'player'); r.lookKey = lk; }
      r.target.set(e.p[0], e.p[1], e.p[2]);
      r.rot = e.r;
      r.anim = (ANIMS.has(e.a) ? e.a : 'idle') as Anim;
      r.entry = e;
      r.seen = now;
      const vk = e.veh ? `${e.veh.model}|${e.veh.color}|${e.veh.rims}` : '';
      if (vk !== r.vehKey) {
        r.veh?.root.removeFromParent();
        r.veh = e.veh ? buildVehicle(e.veh.model, e.veh.color, e.veh.rims) : null;
        if (r.veh) this.group.add(r.veh.root);
        r.vehKey = vk;
      }
    }
    for (const [id, r] of this.map) if (now - r.seen > 3000) { r.h.dispose(); r.veh?.root.removeFromParent(); this.map.delete(id); }
  }

  update(dt: number, zone: string) {
    for (const r of this.map.values()) {
      const visible = r.entry.z === zone;
      r.h.root.visible = visible;
      if (r.veh) r.veh.root.visible = visible;
      if (!visible) continue;
      const k = 1 - Math.exp(-dt * 10);
      if (r.veh) {
        const cur = r.veh.root.position;
        if (cur.distanceTo(r.target) > 20) cur.copy(r.target); else cur.lerp(r.target, k);
        let d = r.rot - r.veh.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        r.veh.root.rotation.y += d * k;
        const seat = r.veh.seat.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), r.veh.root.rotation.y);
        r.h.root.position.copy(cur).add(seat);
        r.h.root.rotation.y = r.veh.root.rotation.y;
        r.h.update(dt, r.veh.isMoto ? 'ride' : 'drive');
      } else {
        const cur = r.h.root.position;
        const dist = cur.distanceTo(r.target);
        if (dist > 8) cur.copy(r.target); else cur.lerp(r.target, k);
        let d = r.rot - r.h.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        r.h.root.rotation.y += d * k;
        r.h.update(dt, r.anim, r.anim === 'run' ? 5.5 : 2.2);
      }
    }
  }

  get(id: string) { return this.map.get(id); }
  /** Positions of other players' cars (for passenger rides). */
  vehicleOf(name: string) {
    for (const r of this.map.values()) if (r.entry.name === name && r.veh) return r.veh.root;
    return null;
  }
  nearest(pos: THREE.Vector3, zone: string, maxD = 3) {
    let best: Remote | null = null, bd = maxD;
    for (const r of this.map.values()) {
      if (r.entry.z !== zone) continue;
      const d = r.h.root.position.distanceTo(pos);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
}
