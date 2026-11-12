import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SectorInstances } from './sector-instances';

describe('SectorInstances', () => {
  it('répartit les instances par secteur, chacun avec une sphère englobante locale', () => {
    const si = new SectorInstances(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicNodeMaterial(), { sectors: 4 });
    const m = new THREE.Matrix4();
    // Quatre arbres sur un cercle de 1000 m, un par quadrant.
    for (const a of [0.3, 1.9, 3.5, 5.1]) si.add(m.makeTranslation(1000 * Math.cos(a), 0, 1000 * Math.sin(a)));
    si.add(m.makeTranslation(1000 * Math.cos(0.4), 0, 1000 * Math.sin(0.4)));

    const meshes = si.build().children as THREE.InstancedMesh[];
    expect(meshes.map((x) => x.count).sort()).toEqual([1, 1, 1, 2]);
    for (const x of meshes) {
      expect(x.frustumCulled).toBe(true);
      expect(x.boundingSphere!.radius).toBeLessThan(200); // pas toute la boucle
    }
  });
});
