/**
 * Tête, cheveux, casque, sangles et lunettes.
 *
 * La tête est une surface implicite, comme le corps, mais extraite finement (0,9 mm) : crâne, masses du visage,
 * mâchoire, menton, pommettes, arcades, nez, lèvres et oreilles sont des volumes fondus. Les proportions sont
 * celles d'un adulte : 23 cm du menton au sommet, les yeux à mi-hauteur, les oreilles entre la ligne des yeux et
 * le bas du nez.
 *
 * Le nez n'est pas un assemblage de boules : c'est un coin à arête arrondie (le dos du nez), qui s'élargit vers
 * la base, coupé dessous par le plan de la columelle ; la pointe, les ailes et les narines s'y ajoutent. Les
 * lèvres suivent l'arcade dentaire, à section ovale, et ont leur propre zone de couleur.
 *
 * Repère local de la tête : origine au niveau des conduits auditifs, x vers la gauche, y vers le haut de la tête,
 * z vers le visage. Toutes les cotes ci-dessous sont dans ce repère, en mètres.
 */
import { Vector3 } from 'three';
import { REGION } from '../../src/render/asset-contract.ts';
import type { Pose } from '../../src/render/rider-pose.ts';
import { curve, keys, MeshBuilder, oval, polyline, roundEnds, smooth, type Skin } from './mesh.ts';
import { Body, polygonize, simplify, smax, smin, splitRegions, Tube, type Shape } from './sdf.ts';

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
type V3 = [number, number, number];

/* ---------- Primitives de distance (repère local) ---------- */

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function ellipsoid(x: number, y: number, z: number, c: V3, r: V3) {
  const lx = x - c[0];
  const ly = y - c[1];
  const lz = z - c[2];
  const k0 = len3(lx / r[0], ly / r[1], lz / r[2]);
  const k1 = len3(lx / (r[0] * r[0]), ly / (r[1] * r[1]), lz / (r[2] * r[2]));
  return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}

function sphere(x: number, y: number, z: number, c: V3, r: number) {
  return len3(x - c[0], y - c[1], z - c[2]) - r;
}

/** Segment arrondi de rayon variable (de `ra` en `a` à `rb` en `b`). */
function capsule(x: number, y: number, z: number, a: V3, b: V3, ra: number, rb = ra) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const px = x - a[0];
  const py = y - a[1];
  const pz = z - a[2];
  const t = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  return len3(px - bx * t, py - by * t, pz - bz * t) - (ra + (rb - ra) * t);
}

/** Distance signée à un plan passant par `p`, de normale unitaire `n` (positive du côté de `n`). */
const plane = (x: number, y: number, z: number, p: V3, n: V3) => (x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2];

/** Valeur absolue adoucie : nulle en 0, arête arrondie sur environ `r`. */
const sabs = (v: number, r: number) => Math.sqrt(v * v + r * r) - r;

/**
 * |x| arrondi sur l'axe du visage : les volumes symétriques se rejoignent au milieu sans cassure de pente (une
 * valeur absolue franche y dessinerait une couture verticale, du front au menton).
 */
const mid = (x: number, r = 0.004) => {
  const a = Math.abs(x);
  return a < r ? (a * a) / (2 * r) + r / 2 : a;
};

/** Soustraction adoucie : creuse `b` dans `a`. */
const carve = (a: number, b: number, k: number) => smax(a, -b, k);

const unit = (v: V3): V3 => {
  const l = len3(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/* ---------- Mâchoire ---------- */

/** Bord inférieur de la mandibule : de l'angle de la mâchoire (gonion) au bas du menton. */
const GONION: V3 = [0, -0.071, -0.006];
const MENTON: V3 = [0, -0.108, 0.07];
const JAW_PLANE = unit([0, -(MENTON[2] - GONION[2]), MENTON[1] - GONION[1]]);

/* ---------- Nez ---------- */

const RADIX: V3 = [0, 0.017, 0.0905]; // racine du nez, entre les yeux
const TIP: V3 = [0, -0.027, 0.1205]; // pointe
const SUBNASALE: V3 = [0, -0.043, 0.1005]; // base de la columelle, au-dessus de la lèvre
const DORSUM = unit([0, TIP[1] - RADIX[1], TIP[2] - RADIX[2]]);
const DORSUM_LEN = len3(0, TIP[1] - RADIX[1], TIP[2] - RADIX[2]);
const DORSUM_OUT: V3 = [0, DORSUM[2], -DORSUM[1]]; // normale au dos du nez, vers l'avant et le haut
const COLUMELLA_OUT = unit([0, SUBNASALE[2] - TIP[2], -(SUBNASALE[1] - TIP[1])]); // sous le nez, vers le bas et l'avant

/**
 * Nez : un coin dont l'arête (le dos) va de la racine à la pointe. Ses flancs s'écartent avec la profondeur,
 * plus raides en haut (os propres du nez) qu'en bas ; l'arête s'arrondit vers la pointe. Coupé dessous par le
 * plan de la columelle, et arrêté à la racine.
 */
function noseWedge(x: number, y: number, z: number) {
  const py = y - RADIX[1];
  const pz = z - RADIX[2];
  const along = py * DORSUM[1] + pz * DORSUM[2];
  const t = clamp(along / DORSUM_LEN, 0, 1.2);
  // Profondeur sous le dos (négative dans le nez), avec une très légère bosse osseuse au tiers supérieur.
  const w = py * DORSUM_OUT[1] + pz * DORSUM_OUT[2] - 0.0012 * Math.sin(Math.PI * clamp(t / 0.75, 0, 1)) ** 2;
  const slope = 2.9 - 1.1 * smooth(0.35, 1, t); // pente des flancs : |x| par mètre de profondeur
  const ridge = 0.0022 + 0.005 * smooth(0.55, 1.05, t); // arrondi de l'arête, plus large à la pointe
  const sides = (w + slope * sabs(x, ridge)) / Math.sqrt(1 + slope * slope);
  // Dessous du nez : remonte vers les côtés (jusqu'aux ailes) au lieu d'être un plan.
  const under = plane(x, y, z, TIP, COLUMELLA_OUT) + 12 * x * x;
  const width = Math.abs(x) - (0.0068 + 0.0055 * smooth(0.2, 1, t) + 0.0012 * smooth(0.75, 1, t));
  // Arrêté juste au-dessus de la racine : sinon l'arête filerait droit dans le front.
  const top = -along - 0.003;
  return smax(smax(smax(smax(sides, under, 0.0075), 0.079 - z, 0.006), width, 0.005), top, 0.006);
}

function nose(x: number, y: number, z: number) {
  // Pointe : un volume allongé dans l'axe du nez, largement fondu : elle donne du relief sans faire de boule.
  let d = smin(noseWedge(x, y, z), ellipsoid(x, y, z, [0, -0.0278, 0.1122], [0.0078, 0.0076, 0.0082]), 0.009);
  // Columelle : une arête étroite sous le nez, de la pointe à la lèvre, entre les narines.
  d = smin(d, capsule(x, y, z, [0, -0.0345, 0.1125], [0, -0.0418, 0.1012], 0.0026, 0.0031), 0.003);
  return d;
}

/** Ailes du nez : posées sur la joue, avec un sillon net autour. */
const alae = (ax: number, y: number, z: number) => ellipsoid(ax, y, z, [0.0116, -0.0362, 0.0972], [0.0059, 0.0066, 0.0096]);

/* ---------- Lèvres ---------- */

const MOUTH_HALF = 0.0245;

/**
 * Lèvres : comme l'oreille, quelques volumes lisses fondus entre eux. La lèvre supérieure a un tubercule au centre
 * et deux ailes qui suivent l'arcade vers les coins ; l'inférieure, deux lobes charnus et deux coins plus fins.
 */
function lips(x: number, y: number, z: number) {
  if (Math.abs(x) > MOUTH_HALF + 0.01 || y > -0.045 || y < -0.09 || z < 0.06) return 1;
  const ax = mid(x);
  let up = ellipsoid(x, y, z, [0, -0.0612, 0.0918], [0.0095, 0.0055, 0.0055]);
  up = smin(up, ellipsoid(ax, y, z, [0.0125, -0.0628, 0.0874], [0.0108, 0.0045, 0.0048]), 0.004);
  let low = ellipsoid(ax, y, z, [0.0065, -0.0698, 0.0888], [0.0105, 0.0058, 0.006]);
  low = smin(low, ellipsoid(ax, y, z, [0.016, -0.0674, 0.0845], [0.0092, 0.0042, 0.0045]), 0.004);
  return smin(up, low, 0.0015);
}

/** Ligne de contact des lèvres (milieu du sillon), `u` de 0 (centre) à 1 (coin). */
const mouthY = (u: number) => -0.0655 + 0.0008 * u * u;
const gauss = (v: number, w: number) => Math.exp(-((v / w) ** 2));

/** Repère des narines : en long vers l'arrière et l'extérieur, en large dans le plan du dessous, en profondeur dans le nez. */
const NOSTRIL_DEPTH: V3 = [0, -COLUMELLA_OUT[1], -COLUMELLA_OUT[2]];
const UNDER_BACK = unit([0, SUBNASALE[1] - TIP[1], SUBNASALE[2] - TIP[2]]);
const NOSTRIL_LONG = unit([0.62, 0.78 * UNDER_BACK[1], 0.78 * UNDER_BACK[2]]);
const NOSTRIL_WIDE: V3 = (() => {
  const [a, b] = [NOSTRIL_LONG, NOSTRIL_DEPTH];
  return unit([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
})();
/** Point du dessous du nez, à la fraction `f` de la pointe vers la base de la columelle, à `x` du milieu. */
const underAt = (x: number, f: number): V3 => [x, TIP[1] + (SUBNASALE[1] - TIP[1]) * f + 0.0004, TIP[2] + (SUBNASALE[2] - TIP[2]) * f];

/**
 * Narines : deux ouvertures en goutte sous le nez, de part et d'autre de la columelle : fines près de la pointe,
 * plus larges vers l'aile, en biais vers l'arrière et l'extérieur, comme sur un vrai nez vu de dessous.
 */
function nostrils(ax: number, y: number, z: number) {
  // Repère de la narine : `l` en long, `q` en large, `p` en profondeur (aplatie : 2,4 mm de creux au plus).
  const c = underAt(0.0064, 0.68);
  const dx = ax - c[0];
  const dy = y - c[1];
  const dz = z - c[2];
  const l = dx * NOSTRIL_LONG[0] + dy * NOSTRIL_LONG[1] + dz * NOSTRIL_LONG[2];
  const q = dx * NOSTRIL_WIDE[0] + dy * NOSTRIL_WIDE[1] + dz * NOSTRIL_WIDE[2];
  const p = (dx * NOSTRIL_DEPTH[0] + dy * NOSTRIL_DEPTH[1] + dz * NOSTRIL_DEPTH[2]) * 0.9;
  // Une goutte d'un seul tenant : fine vers la pointe (l < 0), ronde vers l'aile.
  return capsule(l, q, p, [-0.0038, 0, 0], [0.0024, 0, 0], 0.001, 0.0021);
}

/**
 * Reliefs doux de la bouche, ajoutés à la distance (positif : creux). Ce sont des déplacements doux de
 * la surface, pas des entailles : ils se dessinent sans arête, quelle que soit la finesse du maillage.
 */
function relief(ax: number, y: number, z: number) {
  let r = 0;
  const u = ax / MOUTH_HALF;
  if (y < -0.04 && y > -0.095) {
    const inMouth = smooth(1.12, 0.92, u);
    // Sillon entre les lèvres, plus marqué au centre, qui se perd dans les commissures.
    r += 0.0008 * gauss(y - mouthY(Math.min(u, 1)), 0.0018) * inMouth * (1 - 0.35 * u * u);
    // Commissures : un petit creux au coin, prolongé vers le bas.
    r += 0.0008 * gauss(ax - MOUTH_HALF * 1.02, 0.003) * gauss(y - mouthY(1) + 0.0008, 0.003);
    // Philtrum : gouttière centrale, du nez à la lèvre.
    const ph = smooth(-0.0605, -0.0575, y) * smooth(-0.0425, -0.0465, y);
    r += 0.0004 * gauss(ax, 0.0035) * ph;
    // Ombre sous la lèvre inférieure.
    r += 0.0006 * gauss(y + 0.0775, 0.0035) * smooth(0.75, 0.4, u);
  }
  return r;
}

/* ---------- Sourcils ---------- */

/** Distance (dans le plan du front) au sourcil : épais et bas côté nez, arqué aux deux tiers, effilé vers la tempe. */
function brow(ax: number, y: number) {
  const t = (ax - 0.0125) / 0.042;
  const tc = clamp(t, 0, 1);
  const yc = 0.0254 + 0.0056 * Math.sin((Math.min(1, tc / 0.68) * Math.PI) / 2) - 0.0048 * smooth(0.68, 1, tc) ** 1.5;
  // Demi-épaisseur : 3 mm côté nez, 1 mm à la queue ; les deux bouts s'arrondissent au lieu d'être coupés net.
  const ends = Math.sqrt(clamp(t / 0.08, 0, 1) * clamp((1 - t) / 0.06, 0, 1));
  const half = (0.003 * (1 - tc) + 0.0011 * tc) * ends;
  const beyond = (Math.max(0, -t) + Math.max(0, t - 1)) * 0.042;
  // Hors des extrémités seulement : dedans, `beyond` vaut 0 et ne doit pas masquer la distance négative.
  return beyond > 0 ? Math.max(Math.abs(y - yc) - half, beyond) : Math.abs(y - yc) - half;
}

/* ---------- Yeux ---------- */

/** Globe oculaire, au ras du plan de l'arcade et de la pommette (pas plus saillant). */
const EYE_C: V3 = [0.0315, 0.0112, 0.0845];
const EYE_R = 0.012;
/** Paupières : une coque à peine plus grande que le globe. */
const LID_R = 0.0133;
/** Direction du regard (repère de la tête), fixée selon la pose : vers la route, devant le vélo. */
let GAZE: V3 = [0, 0, 1];

/** Ouverture des paupières, vue de face : une amande, coin extérieur un peu plus haut (négatif dedans). */
function eyeAperture(ax: number, y: number) {
  const half = 0.0118;
  const t = (ax - EYE_C[0]) / half;
  const tc = clamp(t, -1, 1);
  const tilt = 0.0008 * tc;
  const up = EYE_C[1] + tilt + 0.0052 * Math.pow(1 - tc * tc, 0.75) * (1 - 0.15 * tc);
  const lo = EYE_C[1] + tilt - 0.0033 * Math.pow(1 - tc * tc, 0.9);
  return Math.max(y - up, lo - y, Math.abs(ax - EYE_C[0]) - half);
}

/** Zone de l'œil en un point du globe : blanc, iris ou pupille, selon l'écart au regard. */
function eyeRegion(ax: number, y: number, z: number) {
  const dx = ax - EYE_C[0];
  const dy = y - EYE_C[1];
  const dz = z - EYE_C[2];
  const c = (dx * GAZE[0] + dy * GAZE[1] + dz * GAZE[2]) / len3(dx, dy, dz);
  if (c > Math.cos(0.2)) return REGION.pupil;
  if (c > Math.cos(0.45)) return REGION.iris;
  return REGION.eyeWhite;
}

/* ---------- Visage ---------- */

/**
 * Crâne : 14,8 cm de large aux oreilles. Vu de dessus, l'avant est plus carré qu'une ellipse (front large, tempes
 * droites) ; il ne se resserre (jusqu'à 13,8 cm) qu'au niveau des yeux, pas sur le front. Vu de face, le sommet est
 * large et plat plutôt qu'en œuf.
 */
function cranium(x: number, y: number, z: number) {
  const sx = 1 + 0.072 * smooth(0, 0.05, z) * (1 - smooth(0.018, 0.045, y));
  const ly = (y - 0.032) / 0.094;
  // Vu de face, le haut du crâne reste large au lieu de monter en dôme : la largeur seule est gonflée vers le
  // sommet (jusqu'à 18 %), le profil (en x = 0) ne change pas.
  const lx = (Math.abs(x * sx) / 0.074) * (1 - 0.18 * smooth(0.25, 0.85, ly));
  const lz = (z + 0.008) / 0.101;
  const n = 2 + 0.7 * smooth(0, 0.5, lz); // super-ellipse vers l'avant ; ellipse aux oreilles et derrière
  const h = Math.pow(Math.pow(lx, n) + Math.pow(Math.abs(lz), n), 1 / n);
  return (Math.hypot(h, ly) - 1) * 0.074;
}

/** Crâne et visage, sans lèvres ni nez : peu de volumes, de larges fusions, des plans calmes. */
function faceBase(x: number, y: number, z: number): number {
  const ax = mid(x, 0.012); // grandes masses : axe arrondi large
  let d = cranium(x, y, z); // crâne
  d = smin(d, ellipsoid(x, y, z, [0, -0.026, 0.034], [0.051, 0.064, 0.062]), 0.045); // masse du visage
  // Mâchoire : une masse coupée le long du bord de la mandibule, de l'angle au menton.
  let jaw = ellipsoid(x, y, z, [0, -0.062, 0.027], [0.052, 0.05, 0.062]);
  jaw = smin(jaw, ellipsoid(ax, y, z, [0.0505, -0.062, -0.002], [0.0155, 0.024, 0.022]), 0.016); // angles, marqués
  jaw = smax(jaw, plane(x, y, z, GONION, JAW_PLANE), 0.01);
  d = smin(d, jaw, 0.028);
  d = smin(d, ellipsoid(x, y, z, [0, -0.0952, 0.0735], [0.023, 0.0135, 0.015]), 0.018); // menton, large
  d = smin(d, ellipsoid(x, y, z, [0, -0.06, 0.052], [0.033, 0.036, 0.0375]), 0.026); // museau (arcade dentaire)
  d = smin(d, ellipsoid(ax, y, z, [0.035, -0.036, 0.042], [0.021, 0.03, 0.034]), 0.03); // joues pleines, sans creux sous la pommette
  d = smin(d, ellipsoid(ax, y, z, [0.043, -0.002, 0.056], [0.017, 0.014, 0.025]), 0.04); // pommettes
  d = smin(d, capsule(ax, y, z, [0, 0.026, 0.0882], [0.044, 0.024, 0.0755], 0.0065, 0.005), 0.036); // arcades sourcilières, d'un seul tenant
  // Yeux : les paupières sont une coque autour du globe, fondue dans le visage, ouverte en amande ; le globe
  // affleure dans l'ouverture, juste en retrait du bord des paupières.
  d = smin(d, sphere(ax, y, z, EYE_C, LID_R), 0.008);
  d = carve(d, Math.max(eyeAperture(ax, y), EYE_C[2] - z), 0.0014);
  return Math.min(d, sphere(ax, y, z, EYE_C, EYE_R));
}

/** Visage complet. */
function face(x: number, y: number, z: number): number {
  const ax = mid(x);
  let d = faceBase(x, y, z);
  d = smin(d, lips(x, y, z), 0.0065);
  d = smin(d, nose(x, y, z), 0.012);
  d = smin(d, alae(ax, y, z), 0.0045); // pli de l'aile : la fusion, plus serrée que celle du nez
  d = carve(d, nostrils(ax, y, z), 0.0026); // bord adouci : une ouverture, pas un trou percé
  if (z > 0.07) d += relief(ax, y, z);
  return smin(d, ear(ax, y, z), 0.008);
}

/* ---------- Oreilles ---------- */

const EAR_C: V3 = [0.071, -0.004, -0.011];
const EAR_FLARE = 0.24; // le bord arrière s'écarte du crâne

/**
 * Oreille : un pavillon mince (repère u vers l'avant, v vers le haut, w vers l'extérieur), bordé de l'hélix,
 * avec l'anthélix à l'intérieur, la conque creusée sur une masse qui la relie au crâne, le tragus devant, et le lobe.
 */
function ear(ax: number, y: number, z: number) {
  const dx = ax - EAR_C[0];
  const dz = z - EAR_C[2];
  const v = y - EAR_C[1];
  const sa = Math.sin(EAR_FLARE);
  const ca = Math.cos(EAR_FLARE);
  const u = -dx * sa + dz * ca + 0.2 * v; // le haut de l'oreille part un peu en arrière
  const w = dx * ca + dz * sa;
  if (Math.abs(u) > 0.04 || Math.abs(v) > 0.05 || Math.abs(w) > 0.03) return 1;
  // Contour : ovale plus large en haut qu'au lobe.
  const ru = 0.0145 * (0.74 + 0.26 * smooth(-0.026, 0.004, v));
  const rv = 0.0275;
  const cu = u + 0.004;
  const k = Math.hypot(cu / ru, v / rv);
  const edge = (k - 1) * Math.min(ru, rv); // distance (approchée) au contour, négative dedans
  let d = smax(edge, Math.abs(w) - 0.0022, 0.0012); // pavillon
  // Hélix : bourrelet le long du contour, sauf devant en bas, où il plonge dans la conque.
  const helixOn = 1 - smooth(-0.004, 0.006, cu) * smooth(0.012, 0.002, v);
  const rh = 0.0024 * helixOn + 0.0006;
  d = smin(d, Math.hypot(edge + rh, w - 0.0008) - rh, 0.0015);
  // Anthélix : crête intérieure, parallèle à l'hélix, sur l'arrière et le haut.
  const antiOn = smooth(0.004, -0.004, cu) * smooth(-0.02, -0.012, v) * smooth(0.026, 0.016, v);
  if (antiOn > 0.01) d = smin(d, Math.hypot(edge + 0.0088, w - 0.0002) - 0.0018 * antiOn, 0.0025);
  // Masse de la conque, reliée au crâne, puis la conque creusée dedans.
  d = smin(d, ellipsoid(u, v, w, [0.003, -0.006, -0.004], [0.011, 0.012, 0.0065]), 0.004);
  d = carve(d, ellipsoid(u, v, w, [0.0015, -0.006, 0.0052], [0.0066, 0.0078, 0.0058]), 0.003);
  d = smin(d, ellipsoid(u, v, w, [0.0105, -0.007, 0.0012], [0.0032, 0.0048, 0.0028]), 0.002); // tragus
  d = smin(d, ellipsoid(u, v, w, [-0.0045, -0.0155, 0.0016], [0.0032, 0.0028, 0.0024]), 0.002); // antitragus
  d = smin(d, ellipsoid(u, v, w, [-0.0035, -0.0225, 0.0002], [0.0075, 0.0068, 0.0032]), 0.003); // lobe
  return d;
}

/** Ligne des cheveux : droite sur le front, pattes devant les oreilles, contour au-dessus, nuque derrière. */
const HAIRLINE = keys([
  [0, 0.074], // front : une lisière presque droite
  [0.45, 0.073],
  [0.72, 0.066], // léger recul aux tempes
  [0.98, 0.04],
  [1.16, 0.012],
  [1.26, 0.006], // pattes, devant les oreilles
  [1.37, 0.009],
  [1.5, 0.028], // contour au-dessus de l'oreille
  [1.9, 0.031],
  [2.35, -0.018],
  [2.8, -0.044], // nuque
  [Math.PI, -0.047],
]);

function hairline(x: number, z: number) {
  return HAIRLINE(Math.abs(Math.atan2(x, z))); // 0 devant, π derrière
}

/** Cheveux courts : une coque mince et lisse sur le crâne, qui s'amincit jusqu'à la lisière (tracée en couleur). */
function hair(x: number, y: number, z: number): number {
  const above = y - hairline(x, z);
  const thickness = 0.0035 * smooth(0, 0.045, above);
  return cranium(x, y, z) - thickness;
}

/* ---------- Casque ---------- */

const HELMET_C: V3 = [0, 0.044, -0.012];
const HELMET_R: V3 = [0.097, 0.107, 0.126];
/** Bord du casque : plan incliné, au-dessus des sourcils devant, sur l'occiput derrière. */
const rimCut = (y: number, z: number) => 0.052 + 0.36 * (z - 0.1) - y;

function onHelmet(dx: number, dy: number, dz: number): V3 {
  const n = len3(dx / HELMET_R[0], dy / HELMET_R[1], dz / HELMET_R[2]);
  return [HELMET_C[0] + dx / n, HELMET_C[1] + dy / n, HELMET_C[2] + dz / n];
}

/** Évents : des fentes creusées le long de la coque, d'avant en arrière. */
const VENTS: [V3, V3][] = [];
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

const toLocal = (F: Frame, px: number, py: number, pz: number): V3 => {
  const dx = px - F.origin.x;
  const dy = py - F.origin.y;
  const dz = pz - F.origin.z;
  return [dx * F.left.x + dy * F.left.y + dz * F.left.z, dx * F.axis.x + dy * F.axis.y + dz * F.axis.z, dx * F.face.x + dy * F.face.y + dz * F.face.z];
};

/** Forme exprimée dans le repère de la tête. */
function localShape(F: Frame, sdf: (x: number, y: number, z: number) => number, region: (x: number, y: number, z: number) => number, skin: Skin): Shape {
  return {
    sdf: (px, py, pz) => sdf(...toLocal(F, px, py, pz)),
    regionAt: (p) => region(...toLocal(F, p.x, p.y, p.z)),
    skinAt: () => skin,
  };
}

const toWorld = (F: Frame, l: V3) => F.origin.clone().addScaledVector(F.left, l[0]).addScaledVector(F.axis, l[1]).addScaledVector(F.face, l[2]);

/** Boîte englobante (monde) d'une boîte du repère local. */
function worldBox(F: Frame, lo: V3, hi: V3) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
    const p = toWorld(F, [x, y, z]);
    min.min(p);
    max.max(p);
  }
  return { min, max };
}

async function extract(body: Body, F: Frame, lo: V3, hi: V3, h: number, target: number, maxError: number, b: MeshBuilder, skin: (p: Vector3) => Skin) {
  const { min, max } = worldBox(F, lo, hi);
  const dense = polygonize(body, min, max, h);
  const split = splitRegions(body, dense.positions, dense.indices);
  const simple = await simplify(split.points, split.indices, target, maxError);
  const g = new Vector3();
  b.addMesh(
    // Normales prises sur le pas de la grille : un pli plus fin que le maillage ne fait pas de stries.
    simple.points.map(({ p, r }) => ({ p, n: body.gradient(p, g, h).clone(), region: r, skin: skin(p) })),
    simple.indices,
  );
  return simple.indices.length / 3;
}

/** Zone de couleur d'un point de la tête. */
function headRegion(x: number, y: number, z: number) {
  if (y > hairline(x, z) && z < 0.085) return REGION.hair;
  const ax = Math.abs(x);
  if (z > 0.06 && brow(ax, y) < 0) return REGION.hair;
  if (z > 0.06 && sphere(ax, y, z, EYE_C, EYE_R) < 0.0004 && eyeAperture(ax, y) < 0.0008) return eyeRegion(ax, y, z);
  if (z > 0.095 && y < -0.03 && y > -0.046 && ax < 0.012 && nostrils(ax, y, z) < 0.0002) return REGION.hair; // fond des narines, dans l'ombre
  return REGION.skin;
}

export interface HeadOptions {
  /** Sans casque, sangles ni lunettes : pour juger le visage. */
  bare?: boolean;
}

/**
 * Tête (avec le cou, fondu sous la mâchoire), casque, sangles et lunettes. `neck` est le tube du cou du corps
 * sans le col : la tête porte le cou depuis l'intérieur du buste ; le col du maillot couvre le raccord.
 */
export async function buildHead(b: MeshBuilder, pose: Pose, neck: Tube, headBone: number, opts: HeadOptions = {}) {
  const F = headFrame(pose);
  // Regard : droit devant, un peu vers le bas (la route à quelques mètres), exprimé dans le repère de la tête.
  const look = new Vector3(0, -0.12, 1).normalize();
  GAZE = [0, look.dot(F.axis), look.dot(F.face)];
  const headSkin: Skin = { joints: [headBone], weights: [1] };
  const headShape = localShape(F, (x, y, z) => smin(face(x, y, z), hair(x, y, z), 0.003), headRegion, headSkin);

  // Le cou de la tête s'arrête dans le buste, sous le col du maillot.
  const neckBase = neck.spec.points[1]!;
  const neckDir = vec(pose.joints.headBase).sub(neckBase).normalize();
  const cut = neckBase.clone().addScaledVector(neckDir, -0.015);
  // Le cou entre droit dans le crâne : un coude à la base de la tête ferait sauter la distance d'un tronçon à
  // l'autre, d'où une couture derrière les oreilles.
  const straight = new Tube({ ...neck.spec, points: [neck.spec.points[0]!, neckBase, neckBase.clone().addScaledVector(neckDir, 0.14)] });
  const neckShape: Shape = {
    sdf: (x, y, z) => smax(straight.sdf(x, y, z), -((x - cut.x) * neckDir.x + (y - cut.y) * neckDir.y + (z - cut.z) * neckDir.z), 0.003),
    regionAt: () => REGION.skin,
    skinAt: (p) => neck.skinAt(p),
  };
  // Fusion tête-cou : large à la nuque, serrée sous le menton pour garder l'angle entre la gorge et la mâchoire.
  const head = new Body([headShape, neckShape], ([dh, dn], x, y, z) => {
    const lz = (x - F.origin.x) * F.face.x + (y - F.origin.y) * F.face.y + (z - F.origin.z) * F.face.z;
    return smin(dh!, dn!, 0.03 - 0.021 * smooth(-0.025, 0.035, lz));
  });
  const skinOf = (p: Vector3): Skin => {
    const dh = headShape.sdf(p.x, p.y, p.z);
    const dn = neckShape.sdf(p.x, p.y, p.z);
    return dh <= dn ? headSkin : neck.skinAt(p);
  };
  const headTris = await extract(head, F, [-0.11, -0.19, -0.15], [0.11, 0.15, 0.15], 0.0009, 28000, 0.00015, b, skinOf);

  if (opts.bare) return { headTris, helmetTris: 0, head };

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
  const helmetTris = await extract(helmetBody, F, [-0.12, -0.06, -0.2], [0.12, 0.17, 0.16], 0.0025, 6000, 0.0015, b, () => headSkin);

  straps(b, F, head, headBone);
  glasses(b, F, face, headBone);
  return { headTris, helmetTris, head };
}

/** Point de la surface de la tête, décalé de `off` vers l'extérieur. */
function onSkin(head: Body, F: Frame, l: V3, off: number): Vector3 {
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
      [onSkin(head, F, [s * 0.068, 0.012, -0.068], 0.003), onSkin(head, F, [s * 0.066, -0.022, -0.045], 0.0025), junction],
      // Sous la mâchoire, le long de son bord, jusqu'à la boucle sous le menton.
      [junction, ...([[0.046, -0.077, 0.01], [0.03, -0.088, 0.035], [0.013, -0.097, 0.055]] as const).map(([px, py, pz]) => onSkin(head, F, [s * px, py, pz], 0.0025)), onSkin(head, F, [0, -0.1, 0.06], 0.0025)],
    ];
    for (const ctrl of branches) {
      // Points intermédiaires ramenés sur la peau : la sangle épouse les creux (sous la mâchoire).
      const pts: Vector3[] = [ctrl[0]!];
      for (let i = 1; i < ctrl.length; i++)
        for (let k = 1; k <= 6; k++) {
          const q = ctrl[i - 1]!.clone().lerp(ctrl[i]!, k / 6);
          if (k < 6) {
            head.project(q, 0.004, 8);
            q.addScaledVector(head.gradient(q, new Vector3()), 0.0025);
          }
          pts.push(q);
        }
      b.sweep({
        path: polyline(pts, 0.004),
        ds: 0.006,
        radial: 6,
        front: F.face,
        section: (_s, th) => oval(th, 0.0012, 0.0012, 0.0052, 0.0052, 6),
        region: REGION.liner,
        skin,
      });
    }
  }
}

/**
 * Lunettes de sport enveloppantes : un écran mince et régulier (une ellipse autour de la tête, sans suivre les
 * bosses du visage), échancré pour le nez ; une monture le long du bord supérieur et deux branches vers les
 * oreilles.
 */
function glasses(b: MeshBuilder, F: Frame, faceSdf: (x: number, y: number, z: number) => number, headBone: number) {
  const skin = () => ({ joints: [headBone], weights: [1] });
  const Y = 0.006;
  const span = 1.22;
  const Z0 = 0.02;
  const top = (phi: number) => 0.015 - 0.0035 * smooth(0.85, span, Math.abs(phi));
  const bottom = (phi: number) => -0.017 + 0.023 * Math.exp(-((phi / 0.15) ** 2)) + 0.009 * smooth(0.8, span, Math.abs(phi));
  // Profondeur de l'ellipse : la plus petite qui laisse partout un jour avec le visage.
  let A = 0.09;
  const at = (B: number, phi: number, v: number): V3 => [A * Math.sin(phi), Y + v, Z0 + B * Math.cos(phi)];
  const fits = (B: number) => {
    for (let i = 0; i <= 48; i++) {
      const phi = -span + (2 * span * i) / 48;
      for (let k = 0; k <= 8; k++) {
        const v = bottom(phi) + ((top(phi) - bottom(phi)) * k) / 8;
        // L'échancrure repose sur le nez ; ailleurs, un jour de 4 mm avec le visage.
        if (faceSdf(...at(B, phi, v)) < (Math.abs(phi) < 0.3 ? 0.0015 : 0.004)) return false;
      }
    }
    return true;
  };
  // Largeur et profondeur : l'ellipse la moins saillante qui passe partout (les pommettes bornent la largeur).
  let best = { A, B: Infinity };
  for (let a = 0.084; a <= 0.1001; a += 0.002) {
    A = a;
    let B = 0.07;
    while (!fits(B) && B < 0.13) B += 0.0005;
    if (B < best.B) best = { A: a, B };
  }
  A = best.A;
  const B = best.B;

  const arc = (v: (phi: number) => number) =>
    curve((t) => {
      const phi = -span + 2 * span * t;
      return toWorld(F, at(B, phi, v(phi)));
    }, 120);
  const radialAt = (phi: number) => toWorld(F, at(B, phi, 0)).sub(toWorld(F, [0, Y, Z0])).normalize();

  // Écran.
  const mid = arc(() => 0);
  const L = mid.length;
  const phiAt = (s: number) => -span + (2 * span * s) / L;
  b.sweep({
    path: mid,
    ds: L / 90,
    radial: 16,
    front: radialAt(-span),
    // Le long d'un arc autour de la tête, le côté de la section (avant × tangente) pointe vers le haut de la tête.
    section: (s, th) => {
      const phi = phiAt(s);
      const k = roundEnds(s, 0, L, 0.008);
      const t = top(phi);
      const bo = bottom(phi);
      const c = (t + bo) / 2;
      const half = ((t - bo) / 2) * Math.max(k, 0.25);
      const [a, bb] = oval(th, 0.0009, 0.0009, half, half, 10);
      return [a, c + bb];
    },
    region: REGION.lens,
    skin,
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Monture : un jonc le long du bord supérieur.
  const rim = arc((phi) => top(phi) - 0.0012);
  b.sweep({
    path: rim,
    ds: rim.length / 90,
    radial: 10,
    front: radialAt(-span),
    section: (s, th) => {
      const k = roundEnds(s, 0, rim.length, 0.004);
      return oval(th, 0.0022 * k, 0.0018 * k, 0.0027 * k, 0.0022 * k, 3);
    },
    region: REGION.eyewear,
    skin,
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Plaquettes de nez.
  for (const s of [1, -1]) {
    const p = toWorld(F, [s * 0.0105, Y - 0.006, 0.0975]);
    b.sweep({
      path: polyline([p, p.clone().addScaledVector(F.axis, 0.009).addScaledVector(F.face, 0.004)]),
      ds: 0.003,
      radial: 8,
      front: F.left.clone().multiplyScalar(s),
      section: (ss, th) => {
        const k = roundEnds(ss, 0, 0.0098, 0.003);
        return oval(th, 0.0016 * k, 0.0016 * k, 0.003 * k, 0.003 * k);
      },
      region: REGION.eyewear,
      skin,
      capStart: 'pole',
      capEnd: 'pole',
    });
  }
  // Branches : du bout de la monture au-dessus de l'oreille, puis derrière elle.
  for (const s of [1, -1]) {
    const phi = s * (span - 0.03);
    const p0 = at(B, phi, top(phi) - 0.003);
    // Elles filent sous le bord du casque, devant l'oreille.
    const pts = [toWorld(F, [p0[0] * 0.995, p0[1], p0[2] - 0.002]), toWorld(F, [s * 0.08, Y + 0.012, 0.012]), toWorld(F, [s * 0.078, Y + 0.014, -0.004])];
    const path = polyline(pts, 0.012);
    b.sweep({
      path,
      ds: 0.004,
      radial: 8,
      front: F.axis,
      section: (ss, th) => {
        const k = roundEnds(ss, 0, path.length, 0, 0.004);
        return oval(th, 0.0036 * Math.max(k, 0.4), 0.0036 * Math.max(k, 0.4), 0.0014, 0.0014, 4);
      },
      region: REGION.eyewear,
      skin,
      capEnd: 'pole',
    });
  }
}
