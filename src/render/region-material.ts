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
  /** Couleurs des zones, modifiables en place (maillot d'équipe, couleur du vélo). */
  readonly regionColors: THREE.Color[];
  private readonly regionRoughness: number[];
  private readonly regionMetalness: number[];

  constructor(kit: Kit = {}) {
    super();
    const finishes = REGION_NAMES.map((name) => ({ ...DEFAULT_FINISH[name], ...kit[name] }));
    this.regionColors = finishes.map((f) => new THREE.Color(f.color));
    this.regionRoughness = finishes.map((f) => f.roughness);
    this.regionMetalness = finishes.map((f) => f.metalness);
    const region = int(attribute('_region', 'float').add(0.5));
    type ColorNode = NonNullable<THREE.MeshStandardNodeMaterial['colorNode']>;
    type FloatNode = NonNullable<THREE.MeshStandardNodeMaterial['roughnessNode']>;
    this.colorNode = uniformArray(this.regionColors, 'color').element(region) as unknown as ColorNode;
    this.roughnessNode = uniformArray(this.regionRoughness, 'float').element(region) as unknown as FloatNode;
    this.metalnessNode = uniformArray(this.regionMetalness, 'float').element(region) as unknown as FloatNode;
  }
}
