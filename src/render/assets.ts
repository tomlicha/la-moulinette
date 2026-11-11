import type * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Modèles partagés par tous les coureurs ; chaque coureur en clone la scène. */
export interface RiderAssets {
  bike: THREE.Group;
  avatar: THREE.Group;
}

const url = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`;

async function load(name: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url(name));
  return gltf.scene as unknown as THREE.Group;
}

let cache: Promise<RiderAssets> | undefined;

export function loadRiderAssets(): Promise<RiderAssets> {
  cache ??= Promise.all([load('bike.glb'), load('avatar.glb')]).then(([bike, avatar]) => ({ bike, avatar }));
  return cache;
}
