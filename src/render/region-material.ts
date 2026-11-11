import * as THREE from 'three/webgpu';
import { attribute, int, uniformArray } from 'three/tsl';
import { DEFAULT_FINISH, REGION_NAMES, type Finish, type RegionName } from './asset-contract';

export type Kit = Partial<Record<RegionName, Partial<Finish>>>;

/**
 * Matière à zones : chaque sommet porte le numéro de sa zone (`_region`), la matière y lit couleur, rugosité et
 * métal dans trois tableaux. Un coureur entier (corps, vêtements, vélo) se dessine ainsi avec une seule matière
 * et se recolore en changeant les tableaux, sans dupliquer le modèle.
 */
export class RegionMaterial extends THREE.MeshStandardNodeMaterial {
  private readonly colors: THREE.Color[];
  private readonly roughness: number[];
  private readonly metalness: number[];

  constructor(kit: Kit = {}) {
    super();
    const finishes = REGION_NAMES.map((name) => ({ ...DEFAULT_FINISH[name], ...kit[name] }));
    this.colors = finishes.map((f) => new THREE.Color(f.color));
    this.roughness = finishes.map((f) => f.roughness);
    this.metalness = finishes.map((f) => f.metalness);
    const region = int(attribute('_region', 'float').add(0.5));
    this.colorNode = uniformArray(this.colors, 'color').element(region);
    this.roughnessNode = uniformArray(this.roughness, 'float').element(region);
    this.metalnessNode = uniformArray(this.metalness, 'float').element(region);
  }
}
