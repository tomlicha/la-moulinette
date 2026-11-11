import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BIKE_NODE } from './asset-contract';
import type { RiderAssets } from './assets';
import { RegionMaterial, type Kit } from './region-material';
import { footPitch, SKELETON, solvePose, solveTorsoAngle, type Basis, type BikeFit } from './rider-pose';

/** Poses précalculées par tour de pédale : 5° d'écart, interpolées entre deux échantillons. */
const SAMPLES = 72;
const TAU = Math.PI * 2;

/**
 * Table de poses d'un couple vélo et avatar : rotation locale de chaque os et position du bassin, pour chaque angle
 * échantillonné. Calculée une fois, partagée par tous les coureurs qui roulent sur ce couple ; l'animation par image
 * se réduit à une interpolation, sans calcul de cinématique inverse ni allocation.
 */
interface PoseTable {
  quats: Float32Array;
  roots: Float32Array;
}

const tables = new WeakMap<RiderAssets, PoseTable>();

function nodePos(root: THREE.Object3D, name: string): THREE.Vector3 {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`modèle de vélo incomplet : nœud ${name} absent`);
  root.updateMatrixWorld(true);
  return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
}

/** Points d'appui lus dans le modèle de vélo (contrat de `asset-contract.ts`). */
export function readBikeFit(bike: THREE.Object3D): BikeFit {
  const bb = nodePos(bike, BIKE_NODE.crankset);
  const pedal = nodePos(bike, BIKE_NODE.pedalL);
  return {
    saddle: nodePos(bike, BIKE_NODE.saddle),
    hoodL: nodePos(bike, BIKE_NODE.hoodL),
    hoodR: nodePos(bike, BIKE_NODE.hoodR),
    bb,
    crankLength: Math.hypot(pedal.y - bb.y, pedal.z - bb.z),
    pedalHalfWidth: Math.abs(pedal.x - bb.x),
  };
}

function buildTable(fit: BikeFit): PoseTable {
  const n = SKELETON.length;
  const quats = new Float32Array(SAMPLES * n * 4);
  const roots = new Float32Array(SAMPLES * 3);
  const torso = solveTorsoAngle(fit);
  const m = new THREE.Matrix4();
  const world = SKELETON.map(() => new THREE.Quaternion());
  const local = new THREE.Quaternion();
  const toQuat = (b: Basis, out: THREE.Quaternion) =>
    out.setFromRotationMatrix(m.makeBasis(new THREE.Vector3(b.x.x, b.x.y, b.x.z), new THREE.Vector3(b.y.x, b.y.y, b.y.z), new THREE.Vector3(b.z.x, b.z.y, b.z.z)));
  const index = Object.fromEntries(SKELETON.map((b, i) => [b.bone, i]));
  for (let k = 0; k < SAMPLES; k++) {
    const pose = solvePose(fit, (k / SAMPLES) * TAU, torso);
    SKELETON.forEach((def, i) => {
      toQuat(pose.bases[def.bone], world[i]!);
      if (def.parent) local.copy(world[index[def.parent]!]!).invert().multiply(world[i]!);
      else local.copy(world[i]!);
      local.toArray(quats, (k * n + i) * 4);
    });
    const r = pose.joints.root;
    roots.set([r.x, r.y, r.z], k * 3);
  }
  return { quats, roots };
}

/**
 * Coureur : vélo et avatar à squelette, pédalage à la cadence réelle. Origine au sol sous le pédalier, l'avant
 * vers +Z. Toute la géométrie est partagée avec les autres coureurs ; seule la matière (les couleurs) est propre.
 */
export class Rider {
  readonly group = new THREE.Group();
  readonly material: RegionMaterial;
  private crank = Math.PI / 2;
  private readonly frontWheel: THREE.Object3D;
  private readonly rearWheel: THREE.Object3D;
  private readonly crankset: THREE.Object3D;
  private readonly pedalL: THREE.Object3D;
  private readonly pedalR: THREE.Object3D;
  private readonly bones: THREE.Object3D[];
  private readonly table: PoseTable;
  private readonly wheelRadius: number;
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  constructor(assets: RiderAssets, kit?: Kit) {
    const bike = assets.bike.clone(true);
    const avatar = cloneSkinned(assets.avatar) as THREE.Group;
    this.material = new RegionMaterial(kit);
    for (const root of [bike, avatar]) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = this.material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
    }
    this.group.add(bike, avatar);

    const find = (root: THREE.Object3D, name: string) => {
      const o = root.getObjectByName(name);
      if (!o) throw new Error(`modèle incomplet : ${name} absent`);
      return o;
    };
    this.frontWheel = find(bike, BIKE_NODE.frontWheel);
    this.rearWheel = find(bike, BIKE_NODE.rearWheel);
    this.crankset = find(bike, BIKE_NODE.crankset);
    this.pedalL = find(bike, BIKE_NODE.pedalL);
    this.pedalR = find(bike, BIKE_NODE.pedalR);
    this.bones = SKELETON.map((b) => find(avatar, b.bone));
    this.wheelRadius = this.frontWheel.position.y;

    let table = tables.get(assets);
    if (!table) tables.set(assets, (table = buildTable(readBikeFit(assets.bike))));
    this.table = table;
    this.pose();
  }

  /** Fait tourner pédalier et roues : `cadenceRpm` en tours par minute, `speedMs` en m/s. */
  animate(dtS: number, cadenceRpm: number, speedMs: number) {
    this.crank = (this.crank + (cadenceRpm / 60) * TAU * dtS) % TAU;
    const spin = (speedMs / this.wheelRadius) * dtS;
    this.frontWheel.rotation.x += spin;
    this.rearWheel.rotation.x += spin;
    this.pose();
  }

  /** Angle du pédalier imposé (aperçus, captures). */
  setCrank(angle: number) {
    this.crank = ((angle % TAU) + TAU) % TAU;
    this.pose();
  }

  private pose() {
    const a = this.crank;
    this.crankset.rotation.x = a;
    // Les pédales suivent l'inclinaison du pied ; elles sont portées par le pédalier, d'où la soustraction.
    this.pedalL.rotation.x = footPitch(a) - a;
    this.pedalR.rotation.x = footPitch(a + Math.PI) - a;

    const f = (a / TAU) * SAMPLES;
    const k0 = Math.floor(f) % SAMPLES;
    const k1 = (k0 + 1) % SAMPLES;
    const t = f - Math.floor(f);
    const n = this.bones.length;
    const { quats, roots } = this.table;
    for (let i = 0; i < n; i++) {
      this.qa.fromArray(quats, (k0 * n + i) * 4);
      this.qb.fromArray(quats, (k1 * n + i) * 4);
      this.bones[i]!.quaternion.slerpQuaternions(this.qa, this.qb, t);
    }
    const r0 = k0 * 3;
    const r1 = k1 * 3;
    this.bones[0]!.position.set(
      roots[r0]! + (roots[r1]! - roots[r0]!) * t,
      roots[r0 + 1]! + (roots[r1 + 1]! - roots[r0 + 1]!) * t,
      roots[r0 + 2]! + (roots[r1 + 2]! - roots[r0 + 2]!) * t,
    );
  }
}
