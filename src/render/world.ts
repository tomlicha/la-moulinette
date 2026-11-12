import * as THREE from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { fbm, mulberry32 } from './noise';
import { SectorInstances } from './sector-instances';
import { ROAD_HALF, TERRAIN_HALF, type WorldPath } from './world-path';

const HORIZON = new THREE.Color(0.74, 0.86, 0.96);
const ZENITH = new THREE.Color(0.22, 0.46, 0.86);

export interface World {
  group: THREE.Group;
  sky: THREE.Mesh;
  sun: SunLight;
}

export interface WorldOptions {
  /** Nombre d'arbres instanciés. */
  trees: number;
  /** Définition de chaque cascade d'ombre. */
  shadowMapSize: number;
}

export const WORLD_HIGH: WorldOptions = { trees: 2200, shadowMapSize: 2048 };
export const WORLD_LOW: WorldOptions = { trees: 700, shadowMapSize: 1024 };

/** Bande de largeur variable le long de la route, de `latA` à `latB`, découpée en pas de `stepM`. */
function ribbon(
  path: WorldPath,
  latA: number,
  latB: number,
  lift: number,
  stepM: number,
  keep: (i: number) => boolean = () => true,
): THREE.BufferGeometry {
  const n = Math.round(path.route.lengthM / stepM);
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue;
    const base = pos.length / 3;
    for (const d of [i * stepM, (i + 1) * stepM]) {
      path.point(d, p);
      path.side(d, s);
      pos.push(p.x + s.x * latA, p.y + lift, p.z + s.z * latA, p.x + s.x * latB, p.y + lift, p.z + s.z * latB);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildTerrain(path: WorldPath): THREE.Mesh {
  const stepM = 6;
  const cols = Math.round(path.route.lengthM / stepM);
  const lats = [-TERRAIN_HALF, -300, -200, -120, -70, -40, -22, -12, -6, 0, 6, 12, 22, 40, 70, 120, 200, 300, TERRAIN_HALF];
  const rows = lats.length;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const grassDark = new THREE.Color(0.17, 0.34, 0.11);
  const grassLight = new THREE.Color(0.36, 0.52, 0.16);
  const verge = new THREE.Color(0.42, 0.4, 0.26);
  for (let i = 0; i < cols; i++) {
    const d = i * stepM;
    path.point(d, p);
    path.side(d, s);
    for (let j = 0; j < rows; j++) {
      const lat = lats[j]!;
      const k = (i * rows + j) * 3;
      const x = p.x + s.x * lat;
      const z = p.z + s.z * lat;
      pos[k] = x;
      pos[k + 1] = path.groundHeight(d, lat);
      pos[k + 2] = z;
      c.copy(grassDark).lerp(grassLight, 0.5 + 0.5 * fbm(x * 0.01, z * 0.01));
      c.lerp(verge, Math.max(0, 1 - Math.abs(lat) / 14) * 0.7);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  for (let i = 0; i < cols; i++) {
    const i2 = (i + 1) % cols;
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = i2 * rows + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

function buildRoad(path: WorldPath): THREE.Group {
  const out = new THREE.Group();
  const asphalt = new THREE.Mesh(
    ribbon(path, -ROAD_HALF, ROAD_HALF, 0.04, 4),
    new THREE.MeshStandardNodeMaterial({ color: 0x3b3e44, roughness: 0.92 }),
  );
  asphalt.receiveShadow = true;
  out.add(asphalt);

  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xf2f0e6, roughness: 0.8 });
  const dashes = new THREE.Mesh(ribbon(path, -0.08, 0.08, 0.06, 3, (i) => i % 2 === 0), paint);
  const edgeL = new THREE.Mesh(ribbon(path, -ROAD_HALF + 0.3, -ROAD_HALF + 0.42, 0.06, 4), paint);
  const edgeR = new THREE.Mesh(ribbon(path, ROAD_HALF - 0.42, ROAD_HALF - 0.3, 0.06, 4), paint);
  for (const m of [dashes, edgeL, edgeR]) {
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

function buildTrees(path: WorldPath, count: number): THREE.Group {
  const rand = mulberry32(1234);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 2.4, 8);
  trunkGeo.translate(0, 1.2, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 2);
  crownGeo.scale(2.1, 2.7, 2.1);
  crownGeo.translate(0, 4.0, 0);

  const trunks = new SectorInstances(trunkGeo, new THREE.MeshStandardNodeMaterial({ color: 0x5a3f2a, roughness: 1 }));
  const crowns = new SectorInstances(crownGeo, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.85 }));
  const dummy = new THREE.Object3D();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const d = rand() * path.route.lengthM;
    const sign = rand() < 0.5 ? -1 : 1;
    const lat = sign * (ROAD_HALF + 6 + rand() * rand() * (TERRAIN_HALF - 40));
    path.point(d, p);
    path.side(d, s);
    const scale = 0.7 + rand() * 0.9;
    dummy.position.set(p.x + s.x * lat, path.groundHeight(d, lat) - 0.1, p.z + s.z * lat);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.scale.set(scale, scale * (0.9 + rand() * 0.4), scale);
    dummy.updateMatrix();
    trunks.add(dummy.matrix);
    color.setRGB(0.12 + rand() * 0.1, 0.3 + rand() * 0.18, 0.1 + rand() * 0.08);
    crowns.add(dummy.matrix, color);
  }
  // Par secteurs autour de la boucle : caméra et cascades d'ombre n'ont à dessiner que les arbres de leur champ.
  const g = new THREE.Group();
  g.add(trunks.build(), crowns.build());
  return g;
}

function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(6000, 24, 16);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.pow(Math.max(0, pos.getY(i) / 6000), 0.6);
    c.copy(HORIZON).lerp(ZENITH, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  m.renderOrder = -1;
  return m;
}

export function buildWorld(path: WorldPath, scene: THREE.Scene, opts: WorldOptions = WORLD_HIGH): World {
  const group = new THREE.Group();
  group.add(buildTerrain(path), buildRoad(path), buildTrees(path, opts.trees));

  // Sol de fond : une grille de cellules de 100 m. Un plan de deux grands triangles perd en précision de profondeur
  // et finit par masquer la route posée 19 cm au-dessus.
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 60, 60).rotateX(-Math.PI / 2),
    new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.17, 0.34, 0.11), roughness: 1 }),
  );
  plane.position.y = -0.15;
  plane.receiveShadow = true;
  group.add(plane);

  const sun = new SunLight(0xfff1dc, 3.2);
  sun.position.set(0.55, 0.85, 0.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
  sun.shadow.camera.far = 140; // ombres nettes près de la caméra, rien à payer au loin
  const fill = new THREE.HemisphereLight(0xbfd9ff, 0x6b8f4e, 1.1);

  const sky = buildSky();
  scene.background = HORIZON.clone();
  scene.fog = new THREE.Fog(HORIZON.getHex(), 250, 1800);
  scene.add(group, sky, sun, fill);
  return { group, sky, sun };
}
