import * as THREE from 'three/webgpu';
import type { Route } from '../sim/route';
import { fbm, smoothstep } from './noise';

/** Demi-largeur de la chaussée, en m. */
export const ROAD_HALF = 3.5;
/** Largeur du relief tracé de part et d'autre de la route, en m. */
export const TERRAIN_HALF = 420;

/**
 * Le parcours (altitude en fonction de la distance) est posé sur un cercle de même longueur :
 * la boucle se referme sans couture. Toute la géométrie du monde se déduit de cette classe.
 */
export class WorldPath {
  readonly radius: number;

  constructor(readonly route: Route) {
    this.radius = route.lengthM / (2 * Math.PI);
  }

  private angle(d: number) {
    return d / this.radius;
  }

  /** Point de la route à la distance `d` (m). */
  point(d: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.angle(d);
    return out.set(this.radius * Math.cos(a), this.route.altitudeAt(d), this.radius * Math.sin(a));
  }

  /** Direction de marche, horizontale et unitaire. */
  forward(d: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.angle(d);
    return out.set(-Math.sin(a), 0, Math.cos(a));
  }

  /** Axe latéral horizontal, positif vers l'extérieur de la boucle. */
  side(d: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.angle(d);
    return out.set(Math.cos(a), 0, Math.sin(a));
  }

  /** Altitude du sol à `lat` mètres de l'axe de la route : plat sous la route, collines au loin, retour à 0 aux bords. */
  groundHeight(d: number, lat: number): number {
    const roadAlt = this.route.altitudeAt(d);
    const s = smoothstep(ROAD_HALF + 2, TERRAIN_HALF, Math.abs(lat));
    const p = this.point(d);
    const s2 = this.side(d);
    const x = p.x + s2.x * lat;
    const z = p.z + s2.z * lat;
    const hills = fbm(x * 0.004, z * 0.004) * 16 + fbm(x * 0.02, z * 0.02, 2) * 1.5;
    return roadAlt * (1 - s) + hills * s * (1 - s) * 4;
  }
}
