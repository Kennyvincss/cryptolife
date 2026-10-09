// Contextual interaction registry ("E — Sit", "F — Drive", ...).

import * as THREE from 'three';

export interface Interactable {
  id: number;
  pos: THREE.Vector3;
  radius: number;
  zone: string; // zone id, or '*' for any
  label: string | (() => string);
  key: 'E' | 'R' | 'F' | 'G';
  action: () => void;
  enabled?: () => boolean;
  tag?: string;
}

let nextId = 1;

export class Interactions {
  items: Interactable[] = [];

  add(it: Omit<Interactable, 'id' | 'key' | 'radius'> & { key?: Interactable['key']; radius?: number }) {
    const full: Interactable = { id: nextId++, key: 'E', radius: 1.6, ...it };
    this.items.push(full);
    return () => this.remove(full.id);
  }
  remove(id: number) { this.items = this.items.filter((i) => i.id !== id); }
  clearZone(zone: string) { this.items = this.items.filter((i) => i.zone !== zone); }
  clearTag(tag: string) { this.items = this.items.filter((i) => i.tag !== tag); }

  /** Up to one option per key, closest first. */
  available(pos: THREE.Vector3, zone: string): Interactable[] {
    const byKey = new Map<string, { it: Interactable; d: number }>();
    for (const it of this.items) {
      if (it.zone !== '*' && it.zone !== zone) continue;
      const d = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z);
      if (d > it.radius || Math.abs(it.pos.y - pos.y) > 3) continue;
      if (it.enabled && !it.enabled()) continue;
      const cur = byKey.get(it.key);
      if (!cur || d < cur.d) byKey.set(it.key, { it, d });
    }
    return [...byKey.values()].sort((a, b) => a.d - b.d).map((x) => x.it);
  }
}

export function labelOf(it: Interactable) { return typeof it.label === 'function' ? it.label() : it.label; }
