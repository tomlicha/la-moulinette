/**
 * Tête, cheveux, casque, sangles et lunettes.
 *
 * La tête est une surface implicite, comme le corps, mais extraite plus finement (2 mm) : crâne, masse du visage,
 * mâchoire, menton, pommettes, arcades, orbites, nez, lèvres et oreilles sont des volumes fondus. Les proportions
 * sont celles d'un adulte : 23 cm du menton au sommet, les yeux à mi-hauteur, les oreilles entre la ligne des yeux
 * et le bas du nez.
 *
 * Repère local de la tête : origine au niveau des conduits auditifs, x vers la gauche, y vers le haut de la tête,
 * z vers le visage. Toutes les cotes ci-dessous sont dans ce repère, en mètres.
 */
import { Vector3 } from 'three';
import { REGION } from '../../src/render/asset-contract.ts';
import type { Pose } from '../../src/render/rider-pose.ts';
import { curve, MeshBuilder, oval, polyline, roundEnds, smooth, type Skin } from './mesh.ts';
import { Body, polygonize, simplify, smax, smin, splitRegions, type Shape, type Tube } from './sdf.ts';

const vec = (p: { x: number; y: number; z: number }) => new Vector3(p.x, p.y, p.z);

/** Repère de la tête dans la pose de référence. */
export function headFrame(pose: Pose) {
  const base = vec(pose.joints.headBase);
  const axis = vec(pose.joints.headTop).sub(base).normalize();
  const face = new Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize();
  const left = axis.clone().cross(face).normalize();
  const origin = base.clone().addScaledVector(axis, 0.035);
  return { origin, axis, face, left, base };
}

type Frame = ReturnType<typeof headFrame>;

/* ---------- Primitives de distance (repère local) ---------- */

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

function ellipsoid(x: number, y: number, z: number, c: [number, number, number], r: [number, number, number]) {
  const lx = x - c[0];
  const ly = y - c[1];
  const lz = z - c[2];
  const k0 = len3(lx / r[0], ly / r[1], lz / r[2]);
  const k1 = len3(lx / (r[0] * r[0]), ly / (r[1] * r[1]), lz / (r[2] * r[2]));
  return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}

function sphere(x: number, y: number, z: number, c: [number, number, number], r: number) {
  return len3(x - c[0], y - c[1], z - c[2]) - r;
}

/** Segment arrondi de rayon variable (de `ra` en `a` à `rb` en `b`). */
function capsule(x: number, y: number, z: number, a: [number, number, number], b: [number, number, number], ra: number, rb = ra) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const px = x - a[0];
  const py = y - a[1];
  const pz = z - a[2];
  const t = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return len3(px - bx * t, py - by * t, pz - bz * t) - (ra + (rb - ra) * t);
}

/** Soustraction adoucie : creuse `b` dans `a`. */
const carve = (a: number, b: number, k: number) => smax(a, -b, k);

/* ---------- Visage ---------- */

/** Distance au crâne et au visage, sans cheveux ni cou. */
function face(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = ellipsoid(x, y, z, [0, 0.032, -0.008], [0.074, 0.094, 0.101]); // crâne
  d = smin(d, ellipsoid(x, y, z, [0, -0.022, 0.03], [0.061, 0.07, 0.068]), 0.03); // masse du visage
  d = smin(d, ellipsoid(x, y, z, [0, -0.07, 0.036], [0.05, 0.036, 0.058]), 0.025); // mâchoire
  d = smin(d, ellipsoid(ax, y, z, [0.05, -0.058, -0.004], [0.016, 0.03, 0.026]), 0.02); // angles de la mâchoire
  d = smin(d, ellipsoid(x, y, z, [0, -0.095, 0.071], [0.021, 0.015, 0.017]), 0.012); // menton
  d = smin(d, ellipsoid(ax, y, z, [0.05, -0.002, 0.058], [0.022, 0.015, 0.026]), 0.015); // pommettes
  d = smin(d, capsule(ax, y, z, [0, 0.03, 0.09], [0.046, 0.027, 0.074], 0.011, 0.009), 0.012); // arcades
  d = carve(d, sphere(ax, y, z, [0.032, 0.011, 0.097], 0.017), 0.01); // orbites
  d = smin(d, sphere(ax, y, z, [0.031, 0.011, 0.082], 0.0125), 0.004); // globes oculaires
  d = smin(d, capsule(x, y, z, [0, 0.022, 0.092], [0, -0.031, 0.115], 0.007, 0.0095), 0.01); // nez
  d = smin(d, sphere(ax, y, z, [0.012, -0.036, 0.1], 0.0075), 0.006); // ailes du nez
  d = smin(d, capsule(ax, y, z, [0, -0.06, 0.092], [0.021, -0.062, 0.086], 0.0058, 0.0042), 0.006); // lèvre supérieure
  d = smin(d, capsule(ax, y, z, [0, -0.073, 0.089], [0.018, -0.07, 0.084], 0.0062, 0.0045), 0.006); // lèvre inférieure
  d = carve(d, capsule(ax, y, z, [0, -0.0668, 0.0975], [0.024, -0.0665, 0.089], 0.0014), 0.002); // fente de la bouche
  d = smin(d, ellipsoid(ax, y, z, [0.077, -0.004, -0.012], [0.011, 0.031, 0.02]), 0.006); // oreilles
  d = carve(d, sphere(ax, y, z, [0.088, -0.008, -0.006], 0.0095), 0.004); // conque
  return d;
}

/** Ligne des cheveux : haute sur le front, au-dessus des oreilles sur les côtés, basse sur la nuque. */
function hairline(x: number, z: number) {
  const az = Math.abs(Math.atan2(x, z)); // 0 devant, π derrière
  return 0.072 - 0.035 * smooth(0.35, 1.3, az) - 0.085 * smooth(1.6, 2.7, az);
}

/** Cheveux courts lissés vers l'avant : une coque sur le crâne, amincie à la lisière, striée en mèches. */
function hair(x: number, y: number, z: number): number {
  const above = y - hairline(x, z);
  const az = Math.atan2(x, z);
  const strands = 0.0012 * Math.sin(az * 26 + y * 40);
  const thickness = (0.0065 + strands) * smooth(0, 0.018, above);
  const shell = ellipsoid(x, y, z, [0, 0.032, -0.008], [0.074, 0.094, 0.101]) - thickness;
  return smax(shell, -above, 0.003);
}

const eyebrow = (x: number, y: number, z: number) => {
  const ax = Math.abs(x);
  const arch = 0.031 + 0.004 * Math.sin(Math.min(1, Math.max(0, (ax - 0.012) / 0.04)) * Math.PI);
  return ax > 0.012 && ax < 0.052 && Math.abs(y - arch) < 0.0045 && z > 0.06;
};

/* ---------- Casque ---------- */

const HELMET_C: [number, number, number] = [0, 0.044, -0.012];
const HELMET_R: [number, number, number] = [0.097, 0.107, 0.126];
/** Bord du casque : plan incliné, au-dessus des sourcils devant, sur l'occiput derrière. */
const rimCut = (y: number, z: number) => 0.052 + 0.36 * (z - 0.1) - y;

function onHelmet(dx: number, dy: number, dz: number): [number, number, number] {
  const n = len3(dx / HELMET_R[0], dy / HELMET_R[1], dz / HELMET_R[2]);
  return [HELMET_C[0] + dx / n, HELMET_C[1] + dy / n, HELMET_C[2] + dz / n];
}

/** Évents : des fentes creusées le long de la coque, d'avant en arrière. */
const VENTS: [[number, number, number], [number, number, number]][] = [];
for (const s of [1, -1]) {
  VENTS.push([onHelmet(s * 0.22, 0.25, 1), onHelmet(s * 0.2, 0.75, 0.75)]);
  VENTS.push([onHelmet(s * 0.5, 0.75, 0.45), onHelmet(s * 0.5, 0.85, -0.3)]);
  VENTS.push([onHelmet(s * 0.3, 0.6, -0.75), onHelmet(s * 0.26, 0.22, -1)]);
  VENTS.push([onHelmet(s * 0.75, 0.3, 0.55), onHelmet(s * 0.8, 0.45, -0.1)]);
}

function vents(x: number, y: number, z: number) {
  let d = Infinity;
  for (const [a, b] of VENTS) d = Math.min(d, capsule(x, y, z, a, b, 0.0078));
  return d;
}

function helmet(x: number, y: number, z: number): number {
  let d = ellipsoid(x, y, z, HELMET_C, HELMET_R);
  d = smin(d, ellipsoid(x, y, z, [0, 0.03, -0.1], [0.06, 0.05, 0.06]), 0.04); // queue profilée
  d = smax(d, rimCut(y, z), 0.006);
  return carve(d, vents(x, y, z), 0.003);
}

/* ---------- Assemblage ---------- */

/** Forme exprimée dans le repère de la tête. */
function localShape(F: Frame, sdf: (x: number, y: number, z: number) => number, region: (x: number, y: number, z: number) => number, skin: Skin): Shape {
  const local = (px: number, py: number, pz: number): [number, number, number] => {
    const dx = px - F.origin.x;
    const dy = py - F.origin.y;
    const dz = pz - F.origin.z;
    return [dx * F.left.x + dy * F.left.y + dz * F.left.z, dx * F.axis.x + dy * F.axis.y + dz * F.axis.z, dx * F.face.x + dy * F.face.y + dz * F.face.z];
  };
  return {
    sdf: (px, py, pz) => sdf(...local(px, py, pz)),
    regionAt: (p) => region(...local(p.x, p.y, p.z)),
    skinAt: () => skin,
  };
}

const toWorld = (F: Frame, l: [number, number, number]) =>
  F.origin.clone().addScaledVector(F.left, l[0]).addScaledVector(F.axis, l[1]).addScaledVector(F.face, l[2]);

/** Boîte englobante (monde) d'une boîte du repère local. */
function worldBox(F: Frame, lo: [number, number, number], hi: [number, number, number]) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
    const p = toWorld(F, [x, y, z]);
    min.min(p);
    max.max(p);
  }
  return { min, max };
}

async function extract(body: Body, F: Frame, lo: [number, number, number], hi: [number, number, number], h: number, target: number, b: MeshBuilder, skin: (p: Vector3) => Skin) {
  const { min, max } = worldBox(F, lo, hi);
  const dense = polygonize(body, min, max, h);
  const split = splitRegions(body, dense.positions, dense.indices);
  const simple = await simplify(split.points, split.indices, target, 0.0015);
  const g = new Vector3();
  b.addMesh(
    simple.points.map(({ p, r }) => ({ p, n: body.gradient(p, g).clone(), region: r, skin: skin(p) })),
    simple.indices,
  );
  return simple.indices.length / 3;
}

/**
 * Tête (avec le haut du cou, fondu sous la mâchoire), casque, sangles et lunettes. `neck` est le tube du cou du
 * corps sans le col : le corps s'arrête au col du maillot, la tête porte tout le cou, fondu sous la mâchoire.
 */
export async function buildHead(b: MeshBuilder, pose: Pose, neck: Tube, headBone: number) {
  const F = headFrame(pose);
  const headSkin: Skin = { joints: [headBone], weights: [1] };
  const headShape = localShape(
    F,
    (x, y, z) => smin(face(x, y, z), hair(x, y, z), 0.003),
    (x, y, z) => (hair(x, y, z) < face(x, y, z) - 0.0004 || eyebrow(x, y, z) ? REGION.hair : REGION.skin),
    headSkin,
  );
  const neckShape: Shape = {
    sdf: (x, y, z) => neck.sdf(x, y, z),
    regionAt: () => REGION.skin,
    skinAt: (p) => neck.skinAt(p),
  };
  const head = new Body([headShape, neckShape], ([dh, dn]) => smin(dh!, dn!, 0.028));
  const skinOf = (p: Vector3): Skin => {
    const dh = headShape.sdf(p.x, p.y, p.z);
    const dn = neckShape.sdf(p.x, p.y, p.z);
    return dh <= dn ? headSkin : neck.skinAt(p);
  };
  const headTris = await extract(head, F, [-0.11, -0.17, -0.15], [0.11, 0.15, 0.15], 0.002, 9500, b, skinOf);

  const helmetShape = localShape(
    F,
    helmet,
    (x, y, z) => {
      if (vents(x, y, z) < 0.0025 || rimCut(y, z) > -0.004) return REGION.liner;
      if (Math.abs(x) < 0.013 && y > 0.06) return REGION.helmetAlt;
      return REGION.helmet;
    },
    headSkin,
  );
  const helmetBody = new Body([helmetShape], ([d]) => d!);
  const helmetTris = await extract(helmetBody, F, [-0.12, -0.06, -0.2], [0.12, 0.17, 0.16], 0.0025, 6000, b, () => headSkin);

  straps(b, F, head, headBone);
  glasses(b, F, (x, y, z) => face(x, y, z), headBone);
  return { headTris, helmetTris };
}

/** Point de la surface de la tête, décalé de `off` vers l'extérieur. */
function onSkin(head: Body, F: Frame, l: [number, number, number], off: number): Vector3 {
  const p = head.project(toWorld(F, l), 0.004, 8);
  const g = head.gradient(p, new Vector3());
  return p.addScaledVector(g, off);
}

function straps(b: MeshBuilder, F: Frame, head: Body, headBone: number) {
  const skin = () => ({ joints: [headBone], weights: [1] });
  for (const s of [1, -1]) {
    const junction = onSkin(head, F, [s * 0.064, -0.045, -0.004], 0.0025);
    const branches = [
      [onSkin(head, F, [s * 0.075, 0.03, 0.035], 0.003), onSkin(head, F, [s * 0.07, -0.01, 0.02], 0.0025), junction],
      [onSkin(head, F, [s * 0.07, 0.012, -0.06], 0.003), onSkin(head, F, [s * 0.068, -0.02, -0.03], 0.0025), junction],
      [junction, onSkin(head, F, [s * 0.05, -0.08, 0.02], 0.0025), onSkin(head, F, [s * 0.022, -0.105, 0.05], 0.0025), onSkin(head, F, [0, -0.11, 0.06], 0.0025)],
    ];
    for (const pts of branches) {
      b.sweep({
        path: polyline(pts, 0.008),
        ds: 0.008,
        radial: 6,
        front: F.face,
        section: (_s, th) => oval(th, 0.0013, 0.0013, 0.0052, 0.0052, 6),
        region: REGION.liner,
        skin,
      });
    }
  }
}

/** Lunettes enveloppantes : un écran courbe posé devant les yeux, monture en haut, branches vers les oreilles. */
function glasses(b: MeshBuilder, F: Frame, faceSdf: (x: number, y: number, z: number) => number, headBone: number) {
  const skin = () => ({ joints: [headBone], weights: [1] });
  const Y = 0.012;
  const span = 1.32;
  // Distance du centre de la tête au visage dans la direction `phi`, par marche sur la surface.
  const reach = (phi: number) => {
    const dx = Math.sin(phi);
    const dz = Math.cos(phi);
    let t = 0.2;
    for (let i = 0; i < 60; i++) {
      const d = faceSdf(dx * t, Y, dz * t);
      if (Math.abs(d) < 1e-5) break;
      t -= d;
    }
    return t;
  };
  const standoff = (phi: number) => 0.008 + 0.003 * Math.exp(-((phi / 0.2) ** 2));
  const at = (phi: number, extra = 0) => {
    const r = reach(phi) + standoff(phi) + extra;
    return toWorld(F, [Math.sin(phi) * r, Y, Math.cos(phi) * r]);
  };
  const lens = curve((t) => at(-span + 2 * span * t), 60);
  const L = lens.length;
  const height = (t: number) => {
    const phi = -span + 2 * span * t;
    const nose = Math.exp(-((phi / 0.16) ** 2));
    return { top: 0.016 + 0.002 * Math.cos(phi), bottom: -0.019 + 0.011 * nose + 0.007 * smooth(0.8, 1.3, Math.abs(phi)) };
  };
  const start = at(-span);
  const radial = start.clone().sub(toWorld(F, [0, Y, 0])).normalize();
  b.sweep({
    path: lens,
    ds: L / 56,
    radial: 12,
    front: radial,
    thetaCuts: [Math.asin(0.82), Math.PI - Math.asin(0.82)],
    // Le long d'un arc autour de la tête, le côté de la section (avant × tangente) pointe vers le haut de la tête.
    section: (s, th) => {
      const h = height(s / L);
      const k = roundEnds(s, 0, L, 0.006);
      const mid = (h.top + h.bottom) / 2;
      const half = ((h.top - h.bottom) / 2) * Math.max(k, 0.3);
      const [a, bb] = oval(th, 0.0016, 0.0016, half, half, 6);
      return [a, mid + bb];
    },
    region: (_s, th) => (Math.sin(th) > 0.82 ? REGION.eyewear : REGION.lens),
    skin,
    capStart: 'pole',
    capEnd: 'pole',
  });
  for (const s of [1, -1]) {
    const a = at(s * span, -0.002);
    const z = toWorld(F, [s * 0.082, 0.014, -0.025]);
    b.sweep({
      path: polyline([a, z]),
      ds: 0.03,
      radial: 6,
      front: F.axis,
      section: (_s, th) => oval(th, 0.004, 0.004, 0.0016, 0.0016, 4),
      region: REGION.eyewear,
      skin,
      capEnd: 'pole',
    });
  }
}
