import * as THREE from 'three/webgpu';

export interface SectorOptions {
  /** Nombre de secteurs angulaires autour de l'origine (le centre de la boucle). */
  sectors?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Secteurs par défaut. Mesuré sur « Col des Érables » (Chrome, WebGPU, 11 novembre 2026) : sans découpage
 * 2 395 k triangles et 49 i/s ; 8 secteurs 1 190 k triangles et 60 i/s stables ; 16 secteurs moins de triangles
 * mais plus d'appels de dessin, dont le coût processeur reprend le dessus (54 à 60 i/s).
 */
const DEFAULT_SECTORS = 8;

const _pos = new THREE.Vector3();

/**
 * Instances réparties par secteur angulaire autour de la boucle : un `InstancedMesh` par secteur, avec sa propre
 * sphère englobante. Un seul `InstancedMesh` pour toute la boucle a une sphère qui couvre tout le monde : rien
 * n'est jamais écarté, ni par la caméra ni par les passes d'ombre. Découpé, seuls les secteurs visibles sont
 * dessinés. Géométrie et matière sont partagées : un pipeline de rendu, quelques appels de dessin de plus.
 */
export class SectorInstances {
  private readonly buckets: { matrices: THREE.Matrix4[]; colors: THREE.Color[] }[];
  private hasColors = false;

  constructor(
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly opts: SectorOptions = {},
  ) {
    const n = opts.sectors ?? DEFAULT_SECTORS;
    this.buckets = Array.from({ length: n }, () => ({ matrices: [], colors: [] }));
  }

  /** Ajoute une instance ; son secteur se déduit de sa position (translation de `matrix`). */
  add(matrix: THREE.Matrix4, color?: THREE.Color) {
    _pos.setFromMatrixPosition(matrix);
    const n = this.buckets.length;
    const a = Math.atan2(_pos.z, _pos.x); // -π..π
    const i = Math.min(n - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * n));
    const b = this.buckets[i]!;
    b.matrices.push(matrix.clone());
    b.colors.push(color ? color.clone() : new THREE.Color(1, 1, 1));
    if (color) this.hasColors = true;
  }

  /** Un groupe d'`InstancedMesh`, un par secteur non vide. */
  build(): THREE.Group {
    const g = new THREE.Group();
    for (const b of this.buckets) {
      if (!b.matrices.length) continue;
      const m = new THREE.InstancedMesh(this.geometry, this.material, b.matrices.length);
      b.matrices.forEach((mat, k) => m.setMatrixAt(k, mat));
      if (this.hasColors) b.colors.forEach((c, k) => m.setColorAt(k, c));
      m.castShadow = this.opts.castShadow ?? true;
      m.receiveShadow = this.opts.receiveShadow ?? true;
      m.computeBoundingSphere();
      g.add(m);
    }
    return g;
  }
}
