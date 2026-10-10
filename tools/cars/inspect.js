import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
export const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/'));
export async function load(file) { const g = await loader.loadAsync('/__cars/' + file); g.scene.updateMatrixWorld(true); return g.scene; }
