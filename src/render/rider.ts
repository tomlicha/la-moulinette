import * as THREE from 'three/webgpu';
import { twoBoneJoint } from './ik';

const WHEEL_R = 0.335;
const CRANK = 0.17;
const THIGH = 0.44;
const SHIN = 0.44;
const ARM = 0.3;

const BB = { y: 0.28, z: -0.1 };
const HIP = { y: 0.96, z: -0.3 };
const SHOULDER = { y: 1.38, z: 0.2 };
const HANDS = { y: 0.88, z: 0.43 };

const UP = new THREE.Vector3(0, 1, 0);

/** Segment arrondi tendu entre deux points : jambes, bras, tubes du cadre. */
class Limb {
  readonly mesh: THREE.Mesh;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(material: THREE.Material, radius: number, lengthHint: number) {
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, lengthHint - 2 * radius), 4, 8), material);
    this.mesh.castShadow = true;
    this.mesh.userData.base = lengthHint;
  }

  set(ay: number, az: number, by: number, bz: number, x: number) {
    this.a.set(x, ay, az);
    this.b.set(x, by, bz);
    this.dir.subVectors(this.b, this.a);
    const len = this.dir.length();
    this.mesh.position.addVectors(this.a, this.b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir.divideScalar(len || 1));
    this.mesh.scale.y = len / (this.mesh.userData.base as number);
  }
}

function wheel(): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.TorusGeometry(WHEEL_R, 0.021, 10, 40).rotateY(Math.PI / 2),
    new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.8 }),
  );
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(WHEEL_R - 0.03, 0.008, 6, 40).rotateY(Math.PI / 2),
    new THREE.MeshStandardNodeMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35 }),
  );
  g.add(tire, rim);
  const spokeMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.006, (WHEEL_R - 0.03) * 2, 0.006), spokeMat);
    spoke.rotation.x = (i * Math.PI) / 4;
    g.add(spoke);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/**
 * Cycliste stylisé : vélo et corps en formes arrondies, jambes animées par cinématique inverse
 * autour du pédalier. Orientation locale : l'avant est +Z, le haut +Y, l'origine au sol sous le pédalier.
 */
export class Rider {
  readonly group = new THREE.Group();
  private crankAngle = 0;
  private readonly frontWheel = wheel();
  private readonly rearWheel = wheel();
  private readonly legs: { thigh: Limb; shin: Limb; crank: Limb; phase: number; x: number }[] = [];
  private readonly arms: { upper: Limb; fore: Limb; x: number }[] = [];

  constructor(kit = 0xe8590c) {
    const frameMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b1d21, roughness: 0.4, metalness: 0.3 });
    const kitMat = new THREE.MeshStandardNodeMaterial({ color: kit, roughness: 0.7 });
    const shortsMat = new THREE.MeshStandardNodeMaterial({ color: 0x20232a, roughness: 0.8 });
    const skinMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9a47e, roughness: 0.75 });
    const helmetMat = new THREE.MeshStandardNodeMaterial({ color: 0xf4f4f0, roughness: 0.45 });

    this.frontWheel.position.set(0, WHEEL_R, 0.52);
    this.rearWheel.position.set(0, WHEEL_R, -0.52);
    this.group.add(this.frontWheel, this.rearWheel);

    const tube = (ay: number, az: number, by: number, bz: number, r = 0.016) => {
      const l = new Limb(frameMat, r, Math.hypot(by - ay, bz - az));
      l.set(ay, az, by, bz, 0);
      this.group.add(l.mesh);
    };
    const seat = { y: 0.9, z: -0.26 };
    const headTop = { y: 0.8, z: 0.42 };
    const headBottom = { y: 0.6, z: 0.46 };
    tube(BB.y, BB.z, seat.y, seat.z);
    tube(BB.y, BB.z, headBottom.y, headBottom.z, 0.02);
    tube(seat.y, seat.z, headTop.y, headTop.z);
    tube(WHEEL_R, -0.52, BB.y, BB.z, 0.012);
    tube(WHEEL_R, -0.52, seat.y, seat.z, 0.01);
    tube(headBottom.y, headBottom.z, WHEEL_R, 0.52, 0.014);
    tube(headTop.y, headTop.z, HANDS.y, HANDS.z - 0.02, 0.014);
    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8).rotateX(Math.PI / 2), shortsMat);
    saddle.position.set(0, seat.y + 0.03, seat.z);
    saddle.castShadow = true;
    this.group.add(saddle);

    const torso = new Limb(kitMat, 0.115, Math.hypot(SHOULDER.y - HIP.y, SHOULDER.z - HIP.z) + 0.1);
    torso.set(HIP.y, HIP.z, SHOULDER.y, SHOULDER.z, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skinMat);
    head.position.set(0, 1.52, 0.33);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    helmet.position.set(0, 1.545, 0.31);
    helmet.scale.set(1, 0.9, 1.25);
    for (const m of [torso.mesh, head, helmet]) {
      (m as THREE.Mesh).castShadow = true;
      this.group.add(m);
    }

    for (const [x, phase] of [[-0.11, 0], [0.11, Math.PI]] as const) {
      const thigh = new Limb(shortsMat, 0.065, THIGH + 0.08);
      const shin = new Limb(skinMat, 0.045, SHIN + 0.06);
      const crank = new Limb(frameMat, 0.012, CRANK);
      this.group.add(thigh.mesh, shin.mesh, crank.mesh);
      this.legs.push({ thigh, shin, crank, phase, x });
    }
    for (const x of [-0.2, 0.2]) {
      const upper = new Limb(kitMat, 0.045, ARM + 0.06);
      const fore = new Limb(skinMat, 0.036, ARM + 0.05);
      this.group.add(upper.mesh, fore.mesh);
      this.arms.push({ upper, fore, x });
    }
    this.pose();
  }

  /** Fait tourner pédalier et roues : `cadenceRpm` en tours par minute, `speedMs` en m/s. */
  animate(dtS: number, cadenceRpm: number, speedMs: number) {
    this.crankAngle = (this.crankAngle + (cadenceRpm / 60) * Math.PI * 2 * dtS) % (Math.PI * 2);
    const spin = (speedMs / WHEEL_R) * dtS;
    this.frontWheel.rotation.x += spin;
    this.rearWheel.rotation.x += spin;
    this.pose();
  }

  private pose() {
    for (const leg of this.legs) {
      const a = this.crankAngle + leg.phase;
      const pedal = { y: BB.y + CRANK * Math.cos(a), z: BB.z + CRANK * Math.sin(a) };
      const knee = twoBoneJoint(HIP, pedal, THIGH, SHIN, 1);
      leg.thigh.set(HIP.y, HIP.z, knee.y, knee.z, leg.x * 0.7);
      leg.shin.set(knee.y, knee.z, pedal.y, pedal.z, leg.x);
      leg.crank.set(BB.y, BB.z, pedal.y, pedal.z, leg.x * 1.1);
    }
    for (const arm of this.arms) {
      const elbow = twoBoneJoint(SHOULDER, HANDS, ARM, ARM, -1);
      arm.upper.set(SHOULDER.y, SHOULDER.z, elbow.y, elbow.z, arm.x);
      arm.fore.set(elbow.y, elbow.z, HANDS.y, HANDS.z, arm.x);
    }
  }
}
