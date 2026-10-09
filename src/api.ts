// Late-bound game API used by world/UI modules (avoids circular imports).

import type * as THREE from 'three';
import type { Anim } from './entities/humanoid.js';
import type { Interactions } from './systems/interact.js';

export interface GameAPI {
  interact: Interactions;
  sit(pos: THREE.Vector3, rot: number, anim?: Anim, seatH?: number): void;
  lie(pos: THREE.Vector3, rot: number): void;
  stand(): void;
  emote(anim: Anim | null, secs?: number): void;
  isSeated(): boolean;
  playerPos(): THREE.Vector3;
  panel(name: string, data?: any): void;
  closePanel(): void;
  toast(text: string, kind?: string): void;
  fade<T>(fn: () => T | Promise<T>): Promise<T>;
  exitBuilding(): void;
  enterZone(zone: string): Promise<void>;
  hold(model: string | null): void;
  holding(): string | null;
  sleep(): void;
  setSpeakerMusic(pos: THREE.Vector3 | null): void;
  zone(): string;
  waypoint(x: number, z: number, label: string): void;
  previewLook(look: import('../shared/types.js').Look | null): void;
  callVehicle(uid: string): void;
  testDrive(model: string): void;
  setQuality(q: 'low' | 'medium' | 'high'): void;
  teleportLocal(x: number, z: number, y?: number): void;
  placeAt(pos: THREE.Vector3, heading: number): void;
}

export const api = {} as GameAPI;
