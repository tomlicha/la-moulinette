import * as THREE from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';

export type Backend = 'webgpu' | 'webgl2';

export interface RendererHandle {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
}

export function webGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * WebGPU d'abord, repli WebGL2 : détection de capacité, jamais de navigateur.
 * `forceWebGL` sert aux comparaisons et aux appareils exclus.
 */
export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL = false): Promise<RendererHandle> {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: forceWebGL || !webGpuAvailable(),
  });
  await renderer.init();
  renderer.library.addLight(SunLightNode, SunLight); // ombres en cascades
  // Courbe « neutre » : elle garde les couleurs franches du décor et des maillots, là où une courbe de cinéma les ternit.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
