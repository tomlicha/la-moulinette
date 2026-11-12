import * as THREE from 'three/webgpu';
import { attribute, float, int, mix, normalView, normalWorld, positionViewDirection, smoothstep, uniform, uniformArray, vec3 } from 'three/tsl';
import { DEFAULT_FINISH, REGION_NAMES, type Finish, type RegionName } from './asset-contract';

export type Kit = Partial<Record<RegionName, Partial<Finish>>>;

/** Part de la lumière directe que garde un creux entièrement occulté : le relief se lit même en plein soleil. */
const AO_DIRECT_FLOOR = 0.55;
/** Force du liseré de contre-jour. */
const RIM_STRENGTH = 0.55;

/**
 * Matière à zones : chaque sommet porte le numéro de sa zone (`_region`), la matière y lit couleur, rugosité et
 * métal dans trois tableaux. Un coureur entier (corps, vêtements, vélo) se dessine ainsi avec une seule matière
 * et se recolore en changeant les tableaux, sans dupliquer le modèle.
 *
 * Deux touches donnent le rendu arcade, sans passe de rendu supplémentaire :
 * - l'occlusion ambiante précalculée (`_ao`) assombrit les creux, sur la lumière ambiante et un peu sur la directe ;
 * - un liseré de contre-jour, teinté par le ciel, éclaire les bords de la silhouette tournés vers le haut : le
 *   coureur se détache de la route et du décor.
 */
export class RegionMaterial extends THREE.MeshStandardNodeMaterial {
  /** Couleurs des zones, modifiables en place (maillot d'équipe, couleur du vélo). */
  readonly regionColors: THREE.Color[];
  /** Teinte du liseré : la couleur du ciel de la scène. */
  readonly rimColor = uniform(new THREE.Color(0xcfe4ff));
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
    // L'élément d'un tableau d'uniformes n'a pas de type de nœud précis : on le déclare comme un vecteur de couleur.
    const base = uniformArray(this.regionColors, 'color').element(region) as unknown as ReturnType<typeof vec3>;
    const ao = attribute('_ao', 'float');
    this.colorNode = base.mul(mix(float(AO_DIRECT_FLOOR), float(1), ao)) as unknown as ColorNode;
    this.aoNode = ao as unknown as FloatNode;
    this.roughnessNode = uniformArray(this.regionRoughness, 'float').element(region) as unknown as FloatNode;
    this.metalnessNode = uniformArray(this.regionMetalness, 'float').element(region) as unknown as FloatNode;

    // Liseré : fort là où la surface fuit le regard, et seulement sur les faces tournées vers le ciel.
    const grazing = float(1).sub(normalView.dot(positionViewDirection).saturate()).pow(3);
    const skyward = smoothstep(-0.35, 0.55, normalWorld.y);
    const tint = mix(base, this.rimColor, 0.55);
    this.emissiveNode = tint.mul(grazing.mul(skyward).mul(ao).mul(RIM_STRENGTH)) as unknown as ColorNode;
  }
}
