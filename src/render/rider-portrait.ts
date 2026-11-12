import * as THREE from 'three/webgpu';
import { createRenderer } from './renderer';
import { loadRiderAssets } from './assets';
import { Rider } from './rider';

/** Fond du médaillon (identique à `.radar-core` dans home.css), pour qu'on ne voie pas de raccord pendant le chargement. */
const BACKDROP = 0xe2e4e7;
/** Angle du pédalier au moment de la prise : une jambe en haut, l'autre en bas, comme sur la vue de sortie. */
const CRANK = Math.PI / 2;

let cache: Promise<string> | undefined;

/**
 * Portrait du coureur pour les écrans Appareils et Accueil, rendu d'après les modèles 3D réels (`avatar.glb`,
 * `bike.glb`) avec la même classe `Rider` que la vue de sortie : il reflète donc toujours la dernière version de
 * l'avatar, sans image à régénérer à la main. Une seule image est produite par chargement de la page ; le moteur
 * de rendu est libéré aussitôt, la vue de sortie garde le sien.
 *
 * Résout l'URL d'une image (objet blob) ; rejette si le rendu est impossible, l'appelant garde alors son image de repli.
 */
export function riderPortrait(size = 512): Promise<string> {
  cache ??= render(size).catch((e) => {
    cache = undefined; // une nouvelle tentative reste possible
    throw e;
  });
  return cache;
}

async function render(size: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const [{ renderer }, assets] = await Promise.all([createRenderer(canvas), loadRiderAssets()]);
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(BACKDROP, 1);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    key.position.set(1.6, 2.4, 2.2);
    scene.add(key);

    const rider = new Rider(assets);
    rider.setCrank(CRANK);
    scene.add(rider.group);
    rider.group.updateMatrixWorld(true);

    // Cadrage sur la tête et les épaules, à partir de la position réelle de la tête dans la pose.
    const head = new THREE.Vector3();
    rider.group.getObjectByName('head')?.getWorldPosition(head);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(head.x + 0.45, head.y + 0.1, head.z + 1.15);
    camera.lookAt(head.x, head.y - 0.07, head.z);

    renderer.render(scene, camera);
    // Copie immédiate : le contenu d'un canevas WebGPU n'est garanti qu'avant la fin de la tâche en cours.
    const copy = document.createElement('canvas');
    copy.width = copy.height = size;
    copy.getContext('2d')!.drawImage(canvas, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => copy.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('portrait du coureur : encodage impossible');
    return URL.createObjectURL(blob);
  } finally {
    renderer.dispose();
  }
}
