// Minimal typings for the vendored ez-tree sources (MIT, see LICENSE).
import * as THREE from 'three';
export class Tree extends THREE.Group {
  branchesMesh: THREE.Mesh;
  leavesMesh: THREE.Mesh;
  options: any;
  loadPreset(name: string): void;
  loadFromJson(json: any): void;
  generate(): void;
  update(elapsedTime: number): void;
}
export const TreePreset: Record<string, any>;
export const BarkType: Record<string, string>;
export const LeafType: Record<string, string>;
export const TreeType: Record<string, string>;
export const Billboard: Record<string, string>;
