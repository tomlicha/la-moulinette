/**
 * Aperçu des modèles, pour les comparer à la planche de style.
 *
 * Paramètres d'URL :
 * - `shot=lineup` (défaut) : trois coureurs, trois quarts avant, profil, trois quarts arrière ;
 *   `shot=close` : un coureur en gros plan ; `shot=chase` : vue de poursuite comme en jeu.
 * - `yaw` (degrés) et `zoom` pour `shot=close`, `crank` (degrés) pour figer le pédalier, `spin=1` pour animer.
 * - `webgl` pour forcer le repli WebGL2 ; `shadows=0` pour couper les ombres (juger le modelé sans auto-ombrage).
 */
import * as THREE from 'three/webgpu';
import { loadRiderAssets } from '../../src/render/assets';
import type { Kit } from '../../src/render/region-material';
import { createRenderer } from '../../src/render/renderer';
import { Rider } from '../../src/render/rider';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const shot = params.get('shot') ?? 'lineup';

const KITS: Kit[] = [
  {},
  {
    jersey: { color: 0xf2c230 }, jerseyAlt: { color: 0x15171c }, jerseyAccent: { color: 0xf2c230 }, sock: { color: 0xf2c230 },
    frame: { color: 0xf08a3c }, frameAlt: { color: 0x15171c }, helmet: { color: 0x15171c }, helmetAlt: { color: 0xf2c230 },
    lens: { color: 0x4cc9f0 }, skin: { color: 0xb07a55 },
  },
  {
    jersey: { color: 0x3b82d6 }, jerseyAlt: { color: 0xf4f4f0 }, jerseyAccent: { color: 0x0e1726 }, sock: { color: 0x3b82d6 },
    frame: { color: 0xf2c230 }, frameAlt: { color: 0x0e1726 }, helmet: { color: 0x0e1726 }, helmetAlt: { color: 0x3b82d6 },
    skin: { color: 0x8d5a3b },
  },
];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const { renderer, backend } = await createRenderer(canvas, params.has('webgl'));
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4e6ea);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0xf1f2f4, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.HemisphereLight(0xeef4ff, 0x9a9488, 1.6));
const sun = new THREE.DirectionalLight(0xfff3e2, 2.6);
sun.position.set(3, 6, 4);
sun.castShadow = params.get('shadows') !== '0';
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const assets = await loadRiderAssets();
const crank = params.has('crank') ? (num('crank', 0) * Math.PI) / 180 : undefined;
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 100);
const riders: Rider[] = [];
const place = (kit: Kit, x: number, z: number, yawDeg: number) => {
  const r = new Rider(assets, kit);
  r.group.position.set(x, 0, z);
  r.group.rotation.y = (yawDeg * Math.PI) / 180;
  if (crank !== undefined) r.setCrank(crank);
  scene.add(r.group);
  riders.push(r);
  return r;
};

if (shot === 'lineup') {
  place(KITS[0]!, -1.75, 0, 35); // trois quarts avant
  place(KITS[2]!, 0, 0, 90); // profil, avant vers la droite
  place(KITS[1]!, 1.75, 0, 145); // trois quarts arrière
  camera.fov = 26;
  camera.position.set(0, 1.25, 7.6);
  camera.lookAt(0, 0.72, 0);
} else if (shot === 'chase') {
  place(KITS[0]!, 0, 0, 0);
  place(KITS[1]!, 0.9, 3.2, 0);
  place(KITS[2]!, -0.8, 5.5, 0);
  camera.fov = 58;
  camera.position.set(0, 2.0, -5.2);
  camera.lookAt(0, 0.95, 7);
} else {
  place(KITS[Number(params.get('kit') ?? 0)] ?? {}, 0, 0, num('yaw', 60));
  const zoom = num('zoom', 1);
  camera.fov = 24 / zoom;
  camera.position.set(0, num('camy', 1.1), 4.2);
  camera.lookAt(0, num('looky', 0.8), 0);
}

// `focus=<os>` (par exemple `head`) : cadre la caméra sur cet os, à `dist` mètres, vu de face après `yaw`.
if (params.has('focus')) {
  scene.updateMatrixWorld(true);
  const bone = riders[0]!.group.getObjectByName(params.get('focus')!);
  if (bone) {
    const target = bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, num('dy', 0.05), 0));
    camera.fov = 30;
    camera.position.copy(target).add(new THREE.Vector3(0, num('up', 0.03), num('dist', 0.7)));
    camera.lookAt(target);
  }
}

const resize = () => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
resize();
addEventListener('resize', resize);

let last = performance.now();
const info = document.getElementById('info')!;
void renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (params.get('spin') === '1') for (const r of riders) r.animate(dt, 90, 9);
  renderer.render(scene, camera);
  info.textContent = `${backend} · ${renderer.info.render.triangles.toLocaleString('fr-FR')} triangles · ${renderer.info.render.drawCalls} appels de dessin`;
});
await renderer.renderAsync(scene, camera);
document.title = 'ready';
