import * as THREE from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, mulberry32, smoothstep, valueNoise } from './noise';
import { ROAD_HALF, TERRAIN_HALF, type WorldPath } from './world-path';

/**
 * Monde « Col des Érables » d'après la planche de style : prairie verte, sapins à étages et feuillus en bulles,
 * rochers et nuages arrondis, clôture en bois, montagnes enneigées à l'horizon, route grise à ligne jaune.
 */
const PALETTE = {
  sky: new THREE.Color(0x3f86d0),
  horizon: new THREE.Color(0xd6e9f6),
  grassDark: new THREE.Color(0x5e9842),
  grassLight: new THREE.Color(0x8cc456),
  sand: new THREE.Color(0xd9cb98),
  fir: new THREE.Color(0x3c8f5f),
  leaf: new THREE.Color(0x5fae3e),
  trunk: new THREE.Color(0x6b4a2e),
  rock: new THREE.Color(0xb7bcc4),
  road: new THREE.Color(0x4c505b),
  centerLine: new THREE.Color(0xf2cf3a),
  edgeLine: new THREE.Color(0xf4f4f0),
  wood: new THREE.Color(0xb3864e),
  gantry: new THREE.Color(0x0e1726),
  accent: '#5BE3C9',
  mountainGrass: new THREE.Color(0x77ad55),
  mountainRock: new THREE.Color(0x9aa69a),
  snow: new THREE.Color(0xf3f6f9),
};

export interface World {
  group: THREE.Group;
  sky: THREE.Mesh;
  sun: SunLight;
}

export interface WorldOptions {
  /** Nombre d'arbres instanciés (sapins et feuillus). */
  trees: number;
  /** Nombre de rochers. */
  rocks: number;
  /** Nombre de nuages. */
  clouds: number;
  /** Découpage de l'anneau de montagnes autour de la boucle. */
  mountainSegments: number;
  /** Définition de chaque cascade d'ombre. */
  shadowMapSize: number;
}

export const WORLD_HIGH: WorldOptions = { trees: 2200, rocks: 520, clouds: 60, mountainSegments: 256, shadowMapSize: 2048 };
export const WORLD_LOW: WorldOptions = { trees: 700, rocks: 160, clouds: 30, mountainSegments: 128, shadowMapSize: 1024 };

/* ---------- Outils de géométrie ---------- */

/** Bruit déterministe d'un sommet : les sommets confondus d'un maillage non indexé bougent ensemble. */
function vertexNoise(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(Math.round(x * 1000), 374761393) ^ Math.imul(Math.round(y * 1000), 668265263);
  h = (h ^ Math.imul(Math.round(z * 1000), 2246822519) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

/** Bosselle une forme autour de son centre (`amount` : écart relatif du rayon), facettes nettes. */
function lumpy(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + amount * vertexNoise(x, y, z, seed);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Facettes nettes (style des maquettes) : sommets non partagés, normales de face. */
function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    return g;
  });
  return mergeGeometries(clean)!;
}

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

/** Instances de `geo`, ombres portées et reçues, couleur par instance. */
function instanced(geo: THREE.BufferGeometry, count: number, opts: { color?: THREE.Color; roughness?: number; shadows?: boolean } = {}) {
  const m = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardNodeMaterial({ color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 0.9 }),
    count,
  );
  m.castShadow = opts.shadows ?? true;
  m.receiveShadow = true;
  m.frustumCulled = false; // les instances couvrent toute la boucle : la sphère englobante de base ne vaut rien
  return m;
}

/* ---------- Sol et route ---------- */

function buildTerrain(path: WorldPath): THREE.Mesh {
  const stepM = 6;
  const cols = Math.round(path.route.lengthM / stepM);
  // Rangées serrées près de la route : le bas-côté sableux a un bord net.
  const lats = [-TERRAIN_HALF, -300, -200, -120, -70, -40, -22, -12, -6.8, -4.7, 0, 4.7, 6.8, 12, 22, 40, 70, 120, 200, 300, TERRAIN_HALF];
  const rows = lats.length;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
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
      c.copy(PALETTE.grassDark).lerp(PALETTE.grassLight, 0.5 + 0.5 * fbm(x * 0.008, z * 0.008));
      c.lerp(PALETTE.sand, 1 - smoothstep(4.7, 6.8, Math.abs(lat)));
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
    new THREE.MeshStandardNodeMaterial({ color: PALETTE.road, roughness: 0.92 }),
  );
  asphalt.receiveShadow = true;
  out.add(asphalt);

  // Ligne centrale jaune en tirets (3 m peints, 6 m de vide), bords blancs continus.
  const yellow = new THREE.MeshStandardNodeMaterial({ color: PALETTE.centerLine, roughness: 0.7 });
  const white = new THREE.MeshStandardNodeMaterial({ color: PALETTE.edgeLine, roughness: 0.75 });
  const dashes = new THREE.Mesh(ribbon(path, -0.08, 0.08, 0.06, 3, (i) => i % 3 === 0), yellow);
  const edgeL = new THREE.Mesh(ribbon(path, -ROAD_HALF + 0.25, -ROAD_HALF + 0.4, 0.06, 4), white);
  const edgeR = new THREE.Mesh(ribbon(path, ROAD_HALF - 0.4, ROAD_HALF - 0.25, 0.06, 4), white);
  for (const m of [dashes, edgeL, edgeR]) {
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

/* ---------- Arbres ---------- */

/** Sapin à étages : trois cônes empilés sur un tronc court (environ 6,5 m à l'échelle 1). */
function firGeometry() {
  const tiers: [number, number, number][] = [
    [1.75, 2.5, 0.75], // rayon, hauteur, base
    [1.35, 2.2, 2.05],
    [0.95, 2.0, 3.35],
  ];
  const crown = merge(tiers.map(([r, h, y]) => new THREE.ConeGeometry(r, h, 10, 1).translate(0, y + h / 2, 0)));
  const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1.0, 7).translate(0, 0.45, 0);
  return { crown: faceted(crown), trunk: faceted(trunk) };
}

/** Feuillu en bulles : une grosse boule et trois plus petites, bosselées, sur un tronc fin (environ 6 m). */
function leafyGeometry() {
  const blobs: [number, number, number, number][] = [
    [0, 3.9, 0, 1.95],
    [1.15, 3.35, 0.55, 1.25],
    [-0.9, 3.45, -0.75, 1.2],
    [0.2, 4.95, -0.5, 1.15],
  ];
  const crown = merge(blobs.map(([x, y, z, r], i) => lumpy(new THREE.IcosahedronGeometry(r, 1), 0.08, 11 + i).translate(x, y, z)));
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.6, 7).translate(0, 1.3, 0);
  return { crown, trunk: faceted(trunk) };
}

function buildTrees(path: WorldPath, count: number): THREE.Group {
  const rand = mulberry32(1234);
  const fir = firGeometry();
  const leafy = leafyGeometry();
  const nFir = Math.round(count * 0.55);
  const nLeafy = count - nFir;
  const firCrowns = instanced(fir.crown, nFir, { roughness: 0.85 });
  const firTrunks = instanced(fir.trunk, nFir, { color: PALETTE.trunk, roughness: 1 });
  const leafCrowns = instanced(leafy.crown, nLeafy, { roughness: 0.85 });
  const leafTrunks = instanced(leafy.trunk, nLeafy, { color: PALETTE.trunk, roughness: 1 });

  const dummy = new THREE.Object3D();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  let iFir = 0;
  let iLeafy = 0;
  for (let i = 0; i < count; i++) {
    const d = rand() * path.route.lengthM;
    const sign = rand() < 0.5 ? -1 : 1;
    const lat = sign * (ROAD_HALF + 7 + rand() * rand() * (TERRAIN_HALF - 40));
    path.point(d, p);
    path.side(d, s);
    const scale = 0.75 + rand() * 0.8;
    dummy.position.set(p.x + s.x * lat, path.groundHeight(d, lat) - 0.1, p.z + s.z * lat);
    dummy.rotation.y = rand() * Math.PI * 2;
    // Les sapins dominent en altitude et loin de la route, les feuillus près d'elle.
    const isFir = (iFir < nFir && rand() < 0.35 + 0.4 * smoothstep(15, 160, Math.abs(lat))) || iLeafy >= nLeafy;
    if (isFir) {
      dummy.scale.set(scale, scale * (0.9 + rand() * 0.35), scale);
      dummy.updateMatrix();
      firCrowns.setMatrixAt(iFir, dummy.matrix);
      firTrunks.setMatrixAt(iFir, dummy.matrix);
      color.copy(PALETTE.fir).offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.12, (rand() - 0.4) * 0.1);
      firCrowns.setColorAt(iFir++, color);
    } else {
      dummy.scale.set(scale, scale * (0.85 + rand() * 0.3), scale);
      dummy.updateMatrix();
      leafCrowns.setMatrixAt(iLeafy, dummy.matrix);
      leafTrunks.setMatrixAt(iLeafy, dummy.matrix);
      color.copy(PALETTE.leaf).offsetHSL((rand() - 0.5) * 0.05, (rand() - 0.5) * 0.15, (rand() - 0.45) * 0.14);
      leafCrowns.setColorAt(iLeafy++, color);
    }
  }
  firCrowns.count = firTrunks.count = iFir;
  leafCrowns.count = leafTrunks.count = iLeafy;
  const g = new THREE.Group();
  g.add(firTrunks, firCrowns, leafTrunks, leafCrowns);
  return g;
}

/* ---------- Rochers ---------- */

/** Rochers arrondis, souvent par deux ou trois, surtout près de la route. */
function buildRocks(path: WorldPath, count: number): THREE.InstancedMesh {
  const rand = mulberry32(777);
  const geo = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.16, 5);
  const rocks = instanced(geo, count, { roughness: 0.95 });
  const dummy = new THREE.Object3D();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  let i = 0;
  while (i < count) {
    const d = rand() * path.route.lengthM;
    const sign = rand() < 0.5 ? -1 : 1;
    const lat0 = sign * (ROAD_HALF + 4 + rand() * rand() * 140);
    const group = 1 + Math.floor(rand() * 3);
    const big = 0.4 + rand() * rand() * 1.4;
    for (let k = 0; k < group && i < count; k++) {
      const dd = d + (k ? (rand() - 0.5) * 2.5 * big : 0);
      const lat = lat0 + (k ? (rand() - 0.5) * 2.5 * big : 0);
      path.point(dd, p);
      path.side(dd, s);
      const r = big * (k ? 0.45 + rand() * 0.35 : 1);
      dummy.position.set(p.x + s.x * lat, path.groundHeight(dd, lat) - r * 0.25, p.z + s.z * lat);
      dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
      dummy.scale.set(r * (1.1 + rand() * 0.4), r * (0.55 + rand() * 0.25), r * (0.9 + rand() * 0.3));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      color.copy(PALETTE.rock).offsetHSL(0, 0, (rand() - 0.5) * 0.1);
      rocks.setColorAt(i++, color);
    }
  }
  return rocks;
}

/* ---------- Clôture ---------- */

/** Clôture en bois sur le bord droit, par tronçons : piquets tous les 2,6 m et deux lisses. */
function buildFence(path: WorldPath): THREE.Group {
  const lengthM = path.route.lengthM;
  const stretches = [
    [0.03 * lengthM, 0.27 * lengthM],
    [0.55 * lengthM, 0.72 * lengthM],
  ] as const;
  const lat = -(ROAD_HALF + 2.3); // côté négatif : à droite dans le sens de la marche
  const step = 2.6;
  const posts: THREE.Vector3[][] = stretches.map(([a, b]) => {
    const out: THREE.Vector3[] = [];
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let d = a; d <= b; d += step) {
      path.point(d, p);
      path.side(d, s);
      out.push(new THREE.Vector3(p.x + s.x * lat, path.groundHeight(d, lat), p.z + s.z * lat));
    }
    return out;
  });
  const nPosts = posts.reduce((n, l) => n + l.length, 0);
  const nRails = posts.reduce((n, l) => n + 2 * (l.length - 1), 0);
  const postGeo = faceted(new THREE.CylinderGeometry(0.075, 0.085, 1.25, 7).translate(0, 0.55, 0));
  const railGeo = new THREE.BoxGeometry(0.07, 0.11, 1); // le long de z, longueur 1 (étirée par instance)
  const postMesh = instanced(postGeo, nPosts, { color: PALETTE.wood, roughness: 0.9 });
  const railMesh = instanced(railGeo, nRails, { color: PALETTE.wood, roughness: 0.9 });
  const dummy = new THREE.Object3D();
  const mid = new THREE.Vector3();
  let ip = 0;
  let ir = 0;
  for (const line of posts) {
    line.forEach((q, k) => {
      dummy.position.copy(q);
      dummy.rotation.set(0, k * 1.7, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postMesh.setMatrixAt(ip++, dummy.matrix);
      const next = line[k + 1];
      if (!next) return;
      for (const h of [0.5, 0.95]) {
        mid.copy(q).add(next).multiplyScalar(0.5);
        dummy.position.set(mid.x, mid.y + h, mid.z);
        dummy.scale.set(1, 1, q.distanceTo(next) + 0.12);
        dummy.lookAt(next.x, next.y + h, next.z);
        dummy.updateMatrix();
        railMesh.setMatrixAt(ir++, dummy.matrix);
      }
    });
  }
  const g = new THREE.Group();
  g.add(postMesh, railMesh);
  return g;
}

/* ---------- Arches ---------- */

function bannerTexture(text: string): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${PALETTE.gantry.getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = PALETTE.accent;
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Barlow Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 4, canvas.width - 60);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Portique au-dessus de la route à la distance `d`, avec une banderole lisible des deux côtés. */
function buildArch(path: WorldPath, d: number, text: string): THREE.Group {
  const g = new THREE.Group();
  const navy = new THREE.MeshStandardNodeMaterial({ color: PALETTE.gantry, roughness: 0.6 });
  const span = ROAD_HALF + 0.9;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.6, 0.4).translate(0, 2.8, 0), navy);
    post.position.x = side * span;
    post.castShadow = true;
    g.add(post);
  }
  const tex = bannerTexture(text);
  const face = tex ? new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.7 }) : navy;
  const width = 2 * span + 0.6;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(width, width / 8, 0.25), [navy, navy, navy, navy, face, face]);
  banner.position.y = 5.6 - width / 16;
  banner.castShadow = true;
  g.add(banner);

  const p = path.point(d);
  const f = path.forward(d);
  g.position.set(p.x, p.y, p.z);
  g.lookAt(p.x + f.x, p.y, p.z + f.z);
  return g;
}

/** Arches du parcours : le départ, puis le pied de chaque montée, avec sa longueur et sa pente. */
function buildArches(path: WorldPath): THREE.Group {
  const g = new THREE.Group();
  g.add(buildArch(path, 12, 'COL DES ÉRABLES'));
  let start = 0;
  for (const seg of path.route.segments) {
    if (seg.gradePct >= 3) {
      const km = (seg.lengthM / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      g.add(buildArch(path, start + 8, `MONTÉE · ${km} km à ${seg.gradePct.toLocaleString('fr-FR')} %`));
    }
    start += seg.lengthM;
  }
  return g;
}

/* ---------- Horizon : montagnes et nuages ---------- */

/**
 * Anneau de collines puis de montagnes enneigées autour de la boucle, à facettes nettes. Il ferme l'horizon que
 * le relief proche (limité à `TERRAIN_HALF` de la route) laisserait plat.
 */
function buildMountains(path: WorldPath, segments: number): THREE.Mesh {
  // Les montagnes commencent bien au-delà du relief proche : vues de la route, elles ferment l'horizon sans écraser la vue.
  const r0 = path.radius + TERRAIN_HALF + 280;
  const r1 = r0 + 2300;
  const rings = 22;
  const pos = new Float32Array(segments * (rings + 1) * 3);
  const col = new Float32Array(segments * (rings + 1) * 3);
  const c = new THREE.Color();
  const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.pow(Math.sin((Math.PI * (t - a)) / (b - a)), 1.4));
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const peak = 400 + 520 * smoothstep(-0.6, 0.35, fbm(ca * 2.2 + 7, sa * 2.2 + 3, 4));
    const foot = 70 + 60 * fbm(ca * 5 + 1, sa * 5 + 9, 3);
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = r0 + (r1 - r0) * t;
      const x = r * ca;
      const z = r * sa;
      const detail = 0.85 + 0.3 * fbm(x * 0.006, z * 0.006, 3);
      const h = (foot * bump(t, -0.05, 0.42) + peak * bump(t, 0.22, 1)) * detail;
      const k = (i * (rings + 1) + j) * 3;
      pos[k] = x;
      pos[k + 1] = h - 2;
      pos[k + 2] = z;
      const snowLine = 300 + 45 * valueNoise(x * 0.01, z * 0.01);
      c.copy(PALETTE.mountainGrass).lerp(PALETTE.mountainRock, smoothstep(0.45 * snowLine, 0.85 * snowLine, h));
      c.lerp(PALETTE.snow, smoothstep(snowLine - 20, snowLine + 20, h));
      col.set([c.r, c.g, c.b], k);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % segments;
    for (let j = 0; j < rings; j++) {
      const a = i * (rings + 1) + j;
      const b = i2 * (rings + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1); // normales vers le haut
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(faceted(g), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = false;
  return m;
}

/** Nuages : grappes de boules lisses aplaties, blanches, au-dessus de l'horizon. */
function buildClouds(path: WorldPath, count: number): THREE.InstancedMesh {
  const rand = mulberry32(99);
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [1.15, -0.15, 0.2, 0.8],
    [-1.1, -0.2, -0.1, 0.75],
    [0.4, 0.45, -0.3, 0.7],
    [-0.45, 0.3, 0.45, 0.6],
  ];
  const geo = merge(puffs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 3).translate(x, y, z)));
  geo.scale(1, 0.62, 0.8);
  const clouds = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 1, emissive: new THREE.Color(0xc8d8e8), emissiveIntensity: 0.55 }),
    count,
  );
  clouds.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = path.radius * (0.2 + rand() * 2.3);
    const size = 40 + rand() * 50;
    dummy.position.set(r * Math.cos(a), 150 + rand() * 160, r * Math.sin(a));
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(size, size * (0.8 + rand() * 0.4), size);
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
  }
  return clouds;
}

function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(6000, 24, 16);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.pow(Math.max(0, pos.getY(i) / 6000), 0.3);
    c.copy(PALETTE.horizon).lerp(PALETTE.sky, t);
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
  group.add(
    buildTerrain(path),
    buildRoad(path),
    buildTrees(path, opts.trees),
    buildRocks(path, opts.rocks),
    buildFence(path),
    buildArches(path),
    buildMountains(path, opts.mountainSegments),
    buildClouds(path, opts.clouds),
  );

  // Sol de fond : une grille de cellules de 100 m. Un plan de deux grands triangles perd en précision de profondeur
  // et finit par masquer la route posée 19 cm au-dessus.
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 90, 90).rotateX(-Math.PI / 2),
    new THREE.MeshStandardNodeMaterial({ color: PALETTE.grassDark, roughness: 1 }),
  );
  plane.position.y = -0.15;
  plane.receiveShadow = true;
  group.add(plane);

  const sun = new SunLight(0xfff3e0, 3.2);
  sun.position.set(0.55, 0.85, 0.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
  sun.shadow.camera.far = 140; // ombres nettes près de la caméra, rien à payer au loin
  const fill = new THREE.HemisphereLight(0xcfe4ff, 0x7aa35a, 1.2);

  const sky = buildSky();
  scene.background = PALETTE.horizon.clone();
  // Brume légère : elle bleuit les montagnes sans les effacer.
  scene.fog = new THREE.Fog(PALETTE.horizon.getHex(), 1500, 11000);
  scene.add(group, sky, sun, fill);
  return { group, sky, sun };
}
