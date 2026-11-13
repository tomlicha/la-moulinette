import * as THREE from 'three/webgpu';
import { float, mix, uniform, uv } from 'three/tsl';
import type { IntervalGate } from '../workout/gate';
import type { Zone } from '../workout/profile';
import { ROAD_HALF, type WorldPath } from './world-path';

/** Couleurs des zones, les mêmes que celles du HUD (`--hz1` à `--hz6` dans ui/hud.css) ; palier libre en blanc. */
const ZONE_COLOR: Record<Zone, number> = {
  z1: 0xc4cdd8,
  z2: 0x2e9bff,
  z3: 0x1fe07f,
  z4: 0xffd60a,
  z5: 0xff7a1a,
  z6: 0xff2d55,
  free: 0xe8edf2,
};

/** Rayon de l'arche : elle enjambe toute la chaussée. */
const RADIUS = ROAD_HALF + 1;
const FADE_IN_S = 0.6;
const FADE_OUT_S = 0.9;
/** Raideur du recalage de la porte sur sa position estimée, en 1/s : assez lent pour lisser les à-coups de vitesse. */
const FOLLOW_RATE = 2.5;

type OpacityNode = NonNullable<THREE.MeshBasicNodeMaterial['opacityNode']>;

/** Une porte : un arc lumineux et un voile translucide, plus dense vers le bord, de la couleur de la zone. */
class GateMesh {
  readonly group = new THREE.Group();
  private readonly color = new THREE.Color();
  private readonly fade = uniform(0);
  private readonly rim: THREE.MeshBasicNodeMaterial;
  private readonly veil: THREE.MeshBasicNodeMaterial;

  constructor() {
    this.rim = new THREE.MeshBasicNodeMaterial({ color: this.color, transparent: true });
    this.rim.opacityNode = this.fade as unknown as OpacityNode;
    this.rim.toneMapped = false; // couleur franche, comme un néon

    this.veil = new THREE.MeshBasicNodeMaterial({
      color: this.color,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const r = uv().sub(0.5).length().mul(2); // 0 au centre, 1 sur l'arc
    this.veil.opacityNode = mix(float(0.1), float(0.4), r.mul(r)).mul(this.fade) as unknown as OpacityNode;
    this.veil.toneMapped = false;

    const rim = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 0.08, 8, 72, Math.PI), this.rim);
    const veil = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 72, 0, Math.PI), this.veil);
    rim.position.y = veil.position.y = 0.04; // au ras de la chaussée
    veil.renderOrder = 1;
    this.group.add(rim, veil);
    this.group.visible = false;
  }

  setZone(zone: Zone) {
    this.color.setHex(ZONE_COLOR[zone]);
    this.rim.color.copy(this.color);
    this.veil.color.copy(this.color);
  }

  setFade(a: number) {
    this.fade.value = a;
    this.group.visible = a > 0.001;
  }

  /** Pose la porte en travers de la route à la distance `d`, face au sens de la marche. */
  place(path: WorldPath, d: number, p: THREE.Vector3, f: THREE.Vector3) {
    path.point(d, p);
    path.forward(d, f);
    this.group.position.copy(p);
    this.group.lookAt(p.x + f.x, p.y, p.z + f.z);
  }
}

interface Slot {
  mesh: GateMesh;
  /** Palier ouvert par la porte, -1 si l'emplacement est libre. */
  key: number;
  zone?: Zone;
  dist: number;
  alpha: number;
  leaving: boolean;
}

/**
 * Portes de séance sur la route. La porte du palier suivant avance avec l'estimation de `IntervalGate` ; une fois
 * franchie (ou retirée : pause, palier sauté), elle reste où elle est et s'efface pendant que la suivante apparaît.
 */
export class IntervalGates {
  readonly group = new THREE.Group();
  private readonly slots: Slot[];
  private target?: IntervalGate;
  private readonly p = new THREE.Vector3();
  private readonly f = new THREE.Vector3();

  constructor(private readonly path: WorldPath) {
    this.slots = [0, 1].map(() => ({ mesh: new GateMesh(), key: -1, dist: 0, alpha: 0, leaving: false }));
    for (const s of this.slots) this.group.add(s.mesh.group);
  }

  set(gate: IntervalGate | undefined) {
    this.target = gate;
  }

  /** Avance les fondus et recale la porte, `riderDist` étant la distance affichée du cycliste. */
  update(dtS: number, riderDist: number) {
    const t = this.target;
    let cur = this.slots.find((s) => s.key >= 0 && !s.leaving);
    if (cur && cur.key !== t?.key) {
      cur.leaving = true;
      cur = undefined;
    }
    if (t && !cur) {
      // Emplacement libre, sinon la porte qui s'efface depuis le plus longtemps.
      cur = this.slots.find((s) => s.key < 0) ?? this.slots.reduce((a, b) => (a.alpha <= b.alpha ? a : b));
      Object.assign(cur, { key: t.key, zone: undefined, dist: riderDist + t.aheadM, alpha: 0, leaving: false });
    }
    if (t && cur) {
      if (cur.zone !== t.zone) cur.mesh.setZone((cur.zone = t.zone)); // l'intensité peut changer la zone en route
      cur.dist += (riderDist + t.aheadM - cur.dist) * Math.min(1, dtS * FOLLOW_RATE);
      cur.alpha = Math.min(1, cur.alpha + dtS / FADE_IN_S);
    }
    for (const s of this.slots) {
      if (s.leaving) {
        s.alpha = Math.max(0, s.alpha - dtS / FADE_OUT_S);
        if (s.alpha === 0) s.key = -1;
      }
      s.mesh.setFade(s.key < 0 ? 0 : s.alpha);
      if (s.key >= 0) s.mesh.place(this.path, s.dist, this.p, this.f);
    }
  }
}
