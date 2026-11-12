/**
 * Avatar de cycliste, posé sur le vélo à l'angle de pédalier de référence puis lié à son squelette.
 *
 * Chaque membre est une seule surface continue (hanche-genou-cheville, épaule-coude-poignet) aux sections
 * anatomiques : quadriceps et mollets galbés, tibia plus plat, deltoïdes, avant-bras effilés. Les vêtements sont
 * des couches à part, un peu plus larges, terminées par un ourlet : leur bord se voit, comme un vrai tissu.
 *
 * Style arcade : les cotes anatomiques sont grossies par les facteurs `CHUNK` (membres plus épais, mains et
 * chaussures plus grandes), la tête par `HEAD_SCALE` ; la silhouette se lit ainsi de dos, à cinq mètres.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { REGION } from '../../src/render/asset-contract.ts';
import { BIND_CRANK, DEFAULT_BODY, footPitch, SKELETON, solvePose, solveTorsoAngle, type Pose, type V3 } from '../../src/render/rider-pose.ts';
import { bakeAo } from './ao.ts';
import { BIKE_FIT } from './bike.ts';
import { GlbWriter } from './gltf.ts';
import { angleDiff, bumps, curve, inflate, keys, loop, MeshBuilder, oval, polyline, roundEnds, smooth, type Bump, type SectionPoint, type Skin } from './mesh.ts';
import { buildHead, headFrame, type HeadOptions } from './head.ts';
import { Body, Ellipsoid, ovalRadius, polygonize, simplify, smax, smin, splitRegions, Tube, type Shape, type TubeSpec } from './sdf.ts';

const vec = (p: V3) => new Vector3(p.x, p.y, p.z);

/** Grossissement des volumes par rapport à l'anatomie réelle. */
const CHUNK = { leg: 1.13, arm: 1.17, torso: 1.04, neck: 1.12, hand: 1.24, shoe: 1.18 };
const BONE_INDEX = Object.fromEntries(SKELETON.map((b, i) => [b.bone, i])) as Record<string, number>;
const bone = (name: string) => BONE_INDEX[name]!;

/** Poids le long d'une chaîne : un os par tronçon, mélange lissé de `±w` mètres autour de chaque articulation. */
function chainSkin(bones: number[], joints: { s: number; w: number }[]): (s: number) => Skin {
  return (s) => {
    for (let k = 0; k < joints.length; k++) {
      const j = joints[k]!;
      if (s < j.s - j.w) return { joints: [bones[k]!], weights: [1] };
      if (s <= j.s + j.w) {
        const t = smooth(j.s - j.w, j.s + j.w, s);
        return { joints: [bones[k]!, bones[k + 1]!], weights: [1 - t, t] };
      }
    }
    return { joints: [bones[bones.length - 1]!], weights: [1] };
  };
}

const rigid = (b: number) => () => ({ joints: [b], weights: [1] });

/** Quatre demi-axes (avant, arrière, extérieur, intérieur) le long d'une chaîne. */
interface Profile {
  front: (s: number) => number;
  back: (s: number) => number;
  outer: (s: number) => number;
  inner: (s: number) => number;
  bumps: Bump[];
  n?: number;
}

function sectionOf(p: Profile, extra = 0): (s: number, th: number) => SectionPoint {
  return (s, th) => inflate(oval(th, p.front(s), p.back(s), p.outer(s), p.inner(s), p.n ?? 2.15), th, bumps(p.bumps, s, th) + extra);
}

/**
 * Couche de vêtement de `s0` à `s1` : section gonflée de `thickness`, avec un ourlet rentrant à chaque bout libre
 * (une section rabattue sous la peau sur 0,5 mm) pour que l'épaisseur du tissu se voie.
 */
function garment(base: (s: number, th: number) => SectionPoint, thickness: number, s0: number, s1: number, hem: { start?: boolean; end?: boolean }) {
  const lip = 0.0006;
  return {
    cuts: [hem.start ? s0 + lip : undefined, hem.end ? s1 - lip : undefined].filter((v): v is number => v !== undefined),
    section: (s: number, th: number): SectionPoint => {
      const inward = (hem.start && s < s0 + lip) || (hem.end && s > s1 - lip);
      const [a, b] = base(s, th);
      const t = inward ? -0.0015 : thickness;
      return [a + Math.cos(th) * t, b + Math.sin(th) * t];
    },
  };
}

/** Rayon polaire d'un profil, bosses comprises. */
function profileRadius(p: Profile): (s: number, th: number) => number {
  return (s, th) => ovalRadius(th, p.front(s), p.back(s), p.outer(s), p.inner(s), p.n ?? 2.15) + bumps(p.bumps, s, th);
}

/** Léger bourrelet le long d'un ourlet : le bord du tissu se lit sans couche séparée. */
const ridge = (s: number, at: number, h = 0.0018, w = 0.0035) => h * Math.exp(-(((s - at) / w) ** 2));
/** Plateau surélevé (bande de maintien), aux bords adoucis. */
const plateau = (s: number, a: number, b: number, h: number) => h * smooth(a - 0.002, a + 0.002, s) * (1 - smooth(b - 0.002, b + 0.002, s));

function legTube(pose: Pose, s: 'l' | 'r', mirror: 1 | -1): TubeSpec {
  const J = pose.joints;
  const hip = vec(J[`hip_${s}`]);
  const knee = vec(J[`knee_${s}`]);
  const ankle = vec(J[`ankle_${s}`]);
  const thighDir = knee.clone().sub(hip).normalize();
  const shinDir = ankle.clone().sub(knee).normalize();
  // La jambe part de l'intérieur du bassin, juste derrière la hanche : la masse du bassin fait les fesses.
  const start = hip.clone().addScaledVector(thighDir, -0.04);
  const end = ankle.clone().addScaledVector(shinDir, 0.03);
  const sh = start.distanceTo(hip); // hanche
  const sk = sh + DEFAULT_BODY.thigh; // genou
  const sa = sk + DEFAULT_BODY.shin; // cheville
  const u = (list: [number, number][]) => keys(list.map(([x, v]) => [x + sh, v] as [number, number]));
  const prof: Profile = {
    front: u([[-0.04, 0.066], [0, 0.072], [0.15, 0.072], [0.3, 0.06], [0.4, 0.05], [0.445, 0.05], [0.49, 0.041], [0.64, 0.038], [0.79, 0.029], [0.9, 0.03]]),
    back: u([[-0.04, 0.075], [0, 0.08], [0.1, 0.074], [0.3, 0.057], [0.42, 0.045], [0.47, 0.046], [0.54, 0.058], [0.6, 0.06], [0.7, 0.044], [0.8, 0.03], [0.9, 0.03]]),
    outer: u([[-0.04, 0.072], [0, 0.078], [0.15, 0.07], [0.32, 0.056], [0.44, 0.047], [0.54, 0.049], [0.64, 0.044], [0.79, 0.031], [0.86, 0.033], [0.9, 0.031]]),
    inner: u([[-0.04, 0.06], [0, 0.066], [0.08, 0.062], [0.2, 0.058], [0.36, 0.05], [0.44, 0.046], [0.56, 0.051], [0.66, 0.042], [0.79, 0.03], [0.86, 0.032], [0.9, 0.03]]),
    bumps: [
      { s: sh + 0.34, theta: -0.75, h: 0.011, ws: 0.05, wt: 0.5 }, // vaste interne
      { s: sh + 0.2, theta: 1.0, h: 0.008, ws: 0.1, wt: 0.6 }, // vaste externe
      { s: sh + 0.18, theta: 0, h: 0.006, ws: 0.1, wt: 0.5 }, // droit fémoral
      { s: sh + 0.18, theta: Math.PI, h: 0.005, ws: 0.1, wt: 0.6 }, // ischio-jambiers
      { s: sk + 0.005, theta: 0, h: 0.008, ws: 0.022, wt: 0.42 }, // rotule
      { s: sk - 0.02, theta: 0.9, h: -0.004, ws: 0.02, wt: 0.25 }, // creux latéral du genou
      { s: sk + 0.13, theta: -2.45, h: 0.011, ws: 0.06, wt: 0.5 }, // jumeau interne
      { s: sk + 0.11, theta: 2.4, h: 0.007, ws: 0.055, wt: 0.45 }, // jumeau externe
      { s: sk + 0.12, theta: 0.35, h: 0.003, ws: 0.12, wt: 0.2 }, // crête du tibia
      { s: sa - 0.015, theta: Math.PI / 2, h: 0.006, ws: 0.014, wt: 0.4 }, // malléole externe
      { s: sa - 0.008, theta: -Math.PI / 2, h: 0.006, ws: 0.014, wt: 0.4 }, // malléole interne
    ],
  };
  const shortsEnd = sh + 0.3;
  const band = shortsEnd - 0.032;
  const sockTop = sa - 0.15;
  const r = profileRadius(prof);
  const total = start.distanceTo(hip) + DEFAULT_BODY.thigh + DEFAULT_BODY.shin + 0.03;
  const skin = chainSkin(
    [bone('pelvis'), bone(`thigh_${s}`), bone(`shin_${s}`), bone(`foot_${s}`)],
    [{ s: sh + 0.02, w: 0.07 }, { s: sk, w: 0.05 }, { s: sa, w: 0.025 }],
  );
  return {
    points: [start, hip, knee, ankle, end],
    blend: 0.06,
    front: vec(pose.bases[`thigh_${s}`].z).negate(), // l'avant de la cuisse regarde vers le haut et l'avant
    mirror,
    radius: (ss, th) =>
      (r(ss, th) * lerp(1.03, CHUNK.leg, smooth(sh, sh + 0.14, ss)) + plateau(ss, band, shortsEnd, 0.0012) + ridge(ss, shortsEnd - 0.002) + ridge(ss, sockTop + 0.002, 0.0015)) *
      roundEnds(ss, 0, total, 0.035, 0),
    region: (ss, th) => {
      // Bande latérale de la couleur du maillot sur le cuissard, côté extérieur.
      if (ss > sh + 0.1 && ss < band && Math.abs(angleDiff(th, Math.PI / 2)) < 0.34) return REGION.jersey;
      if (ss < band) return REGION.shorts;
      if (ss < shortsEnd) return REGION.shortsBand;
      if (ss < sockTop) return REGION.skin;
      if (ss > sockTop + 0.018 && ss < sockTop + 0.026) return REGION.jerseyAccent;
      return REGION.sock;
    },
    skin,
  };
}

/** Ourlet du maillot, le long de l'axe du buste (depuis le bas du bassin). */
const TORSO_HEM = 0.24;

function torsoTube(pose: Pose): TubeSpec {
  const J = pose.joints;
  const root = vec(J.root);
  const lumbar = vec(J.lumbar);
  const thorax = vec(J.thorax);
  const neck = vec(J.neckBase);
  const pelvisDir = lumbar.clone().sub(root).normalize();
  const chestDir = neck.clone().sub(thorax).normalize();
  const bottom = root.clone().addScaledVector(pelvisDir, -0.12);
  const top = neck.clone().addScaledVector(chestDir, 0.02);
  const sR = 0.12;
  const sL = sR + DEFAULT_BODY.pelvis;
  const sT = sL + DEFAULT_BODY.spine;
  const sN = sT + DEFAULT_BODY.chest;
  const end = sN + 0.02;
  const width = keys([[0, 0.095], [0.05, 0.135], [0.12, 0.15], [0.2, 0.145], [0.28, 0.14], [0.36, 0.143], [0.45, 0.148], [0.55, 0.149], [0.6, 0.136], [0.635, 0.103], [end, 0.06]]);
  const prof: Profile = {
    front: keys([[0, 0.07], [0.06, 0.088], [0.12, 0.098], [0.23, 0.094], [0.32, 0.094], [0.45, 0.104], [0.55, 0.108], [0.615, 0.08], [end, 0.045]]),
    back: keys([[0, 0.07], [0.06, 0.09], [0.14, 0.095], [0.23, 0.092], [0.32, 0.09], [0.45, 0.098], [0.55, 0.104], [0.625, 0.08], [end, 0.045]]),
    outer: width,
    inner: width,
    n: 2.5,
    bumps: [
      { s: 0.53, theta: 0.5, h: 0.01, ws: 0.05, wt: 0.42 }, // pectoraux
      { s: 0.53, theta: -0.5, h: 0.01, ws: 0.05, wt: 0.42 },
    ],
  };
  // Poches dorsales : trois bosses sous l'ourlet du maillot.
  const pocketTop = sR + 0.2;
  for (const th of [Math.PI - 0.75, Math.PI, Math.PI + 0.75]) prof.bumps.push({ s: pocketTop - 0.045, theta: th, h: 0.007, ws: 0.03, wt: 0.22 });
  const r = profileRadius(prof);
  // Les épaules et les fessiers, fondus dans le buste, le dépassent de chaque côté de la colonne : sans cet apport
  // au milieu du dos, ils y laissent une gouttière, très visible de dos sur la bande claire du maillot.
  const spineFill = (s: number, th: number) => 0.013 * Math.exp(-((angleDiff(th, Math.PI) / 0.6) ** 2)) * smooth(0.05, 0.16, s) * (1 - smooth(0.57, 0.65, s));
  const hem = TORSO_HEM;
  const yoke = sN - 0.07;
  const hoop = sT - 0.062;
  const skin = chainSkin([bone('pelvis'), bone('spine'), bone('chest'), bone('neck')], [{ s: sL, w: 0.06 }, { s: sT, w: 0.07 }, { s: sN, w: 0.02 }]);
  return {
    points: [bottom, root, lumbar, thorax, neck, top],
    blend: 0.06,
    front: vec(pose.bases.pelvis.z), // ventre
    // Le bas du buste s'arrondit sous les hanches : les fesses viennent des jambes, fondues dans le bassin.
    radius: (s, th) => (r(s, th) * CHUNK.torso + spineFill(s, th) + ridge(s, hem + 0.003, 0.0012)) * roundEnds(s, 0.05, end, 0.07, 0.025),
    region: (s, th) => {
      if (s < hem) return REGION.shorts;
      // Bande claire bordée de deux filets sombres, sous les aisselles : elle fait le tour du buste et barre le dos,
      // là où la caméra de poursuite regarde.
      if (s > hoop && s < hoop + 0.058) return s < hoop + 0.009 || s > hoop + 0.049 ? REGION.jerseyAlt : REGION.jerseyAccent;
      if (s > yoke) return REGION.jersey;
      if (Math.abs(th) < 0.025 && s > sN - 0.12) return REGION.jerseyAccent; // fermeture éclair
      if (s > pocketTop && s < pocketTop + 0.006 && Math.abs(angleDiff(th, Math.PI)) < 1.15) return REGION.jerseyAccent;
      return REGION.jersey;
    },
    skin,
  };
}

function armTube(pose: Pose, s: 'l' | 'r', mirror: 1 | -1): TubeSpec {
  const J = pose.joints;
  const sh = vec(J[`shoulder_${s}`]);
  const el = vec(J[`elbow_${s}`]);
  const wr = vec(J[`wrist_${s}`]);
  const uaDir = el.clone().sub(sh).normalize();
  const faDir = wr.clone().sub(el).normalize();
  // Le bras part de l'intérieur du buste : la fusion dessine l'épaule et l'aisselle.
  const start = sh.clone().addScaledVector(uaDir, -0.03).add(new Vector3(-mirror * 0.05, -0.015, 0));
  const s0 = start.distanceTo(sh);
  const se = s0 + DEFAULT_BODY.upperArm;
  const sw = se + DEFAULT_BODY.forearm;
  const end = sw + 0.02;
  const u = (list: [number, number][]) => keys(list.map(([x, v]) => [x + s0, v] as [number, number]));
  const prof: Profile = {
    front: u([[-0.06, 0.042], [0, 0.05], [0.08, 0.048], [0.15, 0.044], [0.27, 0.036], [0.31, 0.037], [0.37, 0.042], [0.5, 0.03], [0.57, 0.026], [0.6, 0.026]]),
    back: u([[-0.06, 0.042], [0, 0.05], [0.1, 0.047], [0.2, 0.044], [0.29, 0.039], [0.32, 0.04], [0.38, 0.038], [0.5, 0.026], [0.57, 0.024], [0.6, 0.024]]),
    outer: u([[-0.06, 0.044], [0.02, 0.052], [0.1, 0.046], [0.2, 0.04], [0.3, 0.038], [0.38, 0.037], [0.5, 0.024], [0.57, 0.018], [0.6, 0.018]]),
    inner: u([[-0.06, 0.04], [0.02, 0.044], [0.1, 0.041], [0.2, 0.037], [0.3, 0.037], [0.38, 0.035], [0.5, 0.022], [0.57, 0.017], [0.6, 0.017]]),
    bumps: [
      { s: s0 + 0.04, theta: 1.0, h: 0.008, ws: 0.05, wt: 0.75 }, // deltoïde
      { s: s0 + 0.15, theta: 0, h: 0.008, ws: 0.05, wt: 0.5 }, // biceps
      { s: s0 + 0.12, theta: Math.PI, h: 0.008, ws: 0.06, wt: 0.6 }, // triceps
      { s: se + 0.005, theta: Math.PI, h: 0.006, ws: 0.02, wt: 0.4 }, // coude
      { s: se + 0.07, theta: 0.6, h: 0.01, ws: 0.05, wt: 0.55 }, // avant-bras
    ],
  };
  const r = profileRadius(prof);
  const sleeveEnd = s0 + 0.165;
  const cuff = sw - 0.035;
  const skin = chainSkin([bone('chest'), bone(`upperarm_${s}`), bone(`forearm_${s}`), bone(`hand_${s}`)], [{ s: s0 + 0.01, w: 0.05 }, { s: se, w: 0.045 }, { s: sw, w: 0.02 }]);
  return {
    points: [start, sh, el, wr, wr.clone().addScaledVector(faDir, 0.02)],
    blend: 0.035,
    front: new Vector3(0, 1, 0), // dessus du bras
    mirror,
    radius: (ss, th) =>
      (r(ss, th) * lerp(1, CHUNK.arm, smooth(s0 + 0.03, s0 + 0.15, ss)) + plateau(ss, sleeveEnd - 0.028, sleeveEnd, 0.001) + ridge(ss, sleeveEnd - 0.002) + ridge(ss, cuff + 0.002, 0.0015)) *
      roundEnds(ss, 0, end, 0.03, 0.012),
    region: (ss) => {
      if (ss < sleeveEnd - 0.028) return REGION.jersey;
      if (ss < sleeveEnd) return REGION.jerseyAlt;
      if (ss < cuff) return REGION.skin;
      return REGION.glove;
    },
    skin,
  };
}

/** Reliefs du cou, en abscisse depuis la base du cou `sn`. */
const NECK_RELIEF = (sn: number): Bump[] => {
  const list: Bump[] = [{ s: sn + 0.045, theta: 0, h: 0.0035, ws: 0.012, wt: 0.16 }]; // pomme d'Adam
  for (const side of [1, -1])
    for (const [ds, th] of [[0.0, 0.42], [0.025, 0.75], [0.05, 1.1]] as const)
      list.push({ s: sn + ds, theta: side * th, h: 0.0032, ws: 0.022, wt: 0.24 }); // sterno-cléido-mastoïdiens
  return list;
};

/**
 * Cou. Le corps n'en garde que le bas, sous le col du maillot (`collar`) ; la tête en reprend la totalité, sans
 * col, fondue dans la mâchoire : le seul raccord entre les deux maillages passe à l'intérieur du col.
 */
function neckTube(pose: Pose, collar: boolean): TubeSpec {
  const F = headFrame(pose);
  const neckBase = vec(pose.joints.neckBase);
  const chestDir = neckBase.clone().sub(vec(pose.joints.thorax)).normalize();
  const headBase = vec(pose.joints.headBase);
  const neckStart = neckBase.clone().addScaledVector(chestDir, -0.05);
  const sn = neckStart.distanceTo(neckBase);
  const collarTop = sn + 0.022;
  const skin = chainSkin([bone('chest'), bone('neck'), bone('head')], [{ s: sn, w: 0.03 }, { s: sn + DEFAULT_BODY.neck, w: 0.03 }]);
  return {
    points: [neckStart, neckBase, headBase, headBase.clone().addScaledVector(F.axis, 0.03)],
    blend: 0.03,
    front: vec(pose.bases.neck.z),
    radius: (s, th) => {
      const t = (s - sn) / DEFAULT_BODY.neck;
      // Cou de sportif sec : 11 cm de large, plus profond vers la nuque ; pomme d'Adam devant, et les deux
      // sterno-cléido-mastoïdiens qui montent en biais du creux du sternum vers l'arrière des oreilles.
      const side = lerp(0.054, 0.05, t);
      const bare = CHUNK.neck * ovalRadius(th, lerp(0.05, 0.045, t), lerp(0.062, 0.055, t), side, side) + bumps(NECK_RELIEF(sn), s, th);
      if (!collar) return bare;
      return bare + (s < collarTop ? 0.004 * smooth(collarTop, collarTop - 0.004, s) : 0) + ridge(s, collarTop - 0.002, 0.0015);
    },
    region: (s) => (collar && s < collarTop ? REGION.jersey : REGION.skin),
    skin,
  };
}

/**
 * Col du maillot : un bourrelet posé sur la ligne où le maillot rencontre le cou. Le corps et le cou de la tête
 * sont deux maillages qui se croisent ; sans lui, leur intersection dessinerait une ligne en dents de scie.
 */
function collarRim(b: MeshBuilder, body: Body, head: Body, neck: Tube) {
  const pts = neck.spec.points;
  const sn = pts[0]!.distanceTo(pts[1]!);
  const pos = new Vector3();
  const tan = new Vector3();
  const surface = (s: number, th: number) => {
    neck.path.at(s, pos, tan);
    const front = neck.spec.front.clone().addScaledVector(tan, -neck.spec.front.dot(tan)).normalize();
    const side = new Vector3().crossVectors(front, tan);
    const dir = front.multiplyScalar(Math.cos(th)).addScaledVector(side, Math.sin(th));
    // Surface réelle du cou de la tête (élargi par la fusion avec la mâchoire), depuis l'axe.
    let r = neck.spec.radius(s, th) * 0.8;
    const p = pos.clone().addScaledVector(dir, r);
    for (let k = 0; k < 40 && head.sdf(p.x, p.y, p.z) < 0; k++) {
      r += 0.001;
      p.copy(pos).addScaledVector(dir, r);
    }
    return { p, dir };
  };
  const ring: Vector3[] = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    // Du haut du cou vers le bas, jusqu'à entrer dans le maillot, puis dichotomie.
    let hi = sn + 0.09;
    let lo = hi;
    while (lo > sn - 0.04) {
      lo -= 0.002;
      const { p } = surface(lo, th);
      if (body.sdf(p.x, p.y, p.z) < 0) break;
      hi = lo;
    }
    for (let it = 0; it < 14; it++) {
      const m = (lo + hi) / 2;
      const { p } = surface(m, th);
      if (body.sdf(p.x, p.y, p.z) < 0) lo = m;
      else hi = m;
    }
    const { p, dir } = surface(hi, th);
    ring.push(p.addScaledVector(dir, 0.0008));
  }
  const path = loop(ring, 0.004);
  neck.path.at(sn, pos, tan);
  b.sweep({
    path,
    ds: path.length / 64,
    radial: 8,
    front: ring[0]!.clone().sub(pos).normalize(),
    section: (_s, th) => oval(th, 0.0042, 0.0042, 0.0042, 0.0042),
    region: REGION.jerseyAlt,
    skin: (_s, p) => neck.skinAt(p),
  });
}

/**
 * Bassin assis : une seule masse large, aplatie contre la selle, avec un sillon au milieu de l'arrière et un léger
 * galbe de chaque fessier. Les cuisses en sortent par l'avant ; le buste s'y pose par le haut.
 */
function pelvisMass(pose: Pose): Shape {
  const B = pose.bases.pelvis;
  const x = vec(B.x);
  const y = vec(B.y);
  const z = vec(B.z); // vers le ventre
  const center = vec(pose.joints.root).addScaledVector(y, -0.02);
  return new Ellipsoid({
    center,
    axes: [x, y, z],
    radii: [0.12, 0.1, 0.1],
    shape: (lx, _ly, lz, d) => {
      const back = smooth(-0.02, -0.09, lz); // 0 devant, 1 à l'arrière
      const cleft = 0.0012 * Math.exp(-((lx / 0.02) ** 2)) * back;
      return d + cleft;
    },
    region: () => REGION.shorts,
    skin: { joints: [bone('pelvis')], weights: [1] },
  });
}

/** Deltoïde : enveloppe le haut du bras ; le bras part sous cette masse au lieu de sortir du buste comme un tube. */
function deltoid(pose: Pose, s: 'l' | 'r', mirror: 1 | -1): Shape {
  const sh = vec(pose.joints[`shoulder_${s}`]);
  const el = vec(pose.joints[`elbow_${s}`]);
  const chestUp = vec(pose.bases.chest.y);
  const ua = el.clone().sub(sh).normalize();
  const out = new Vector3(mirror, 0, 0).addScaledVector(ua, -mirror * ua.x).normalize();
  return new Ellipsoid({
    center: sh.clone().addScaledVector(ua, 0.028).addScaledVector(chestUp, 0.004),
    axes: [out, ua, out.clone().cross(ua).normalize()],
    radii: [0.041, 0.07, 0.053],
    region: () => REGION.jersey,
    skin: { joints: [bone(`upperarm_${s}`), bone('chest')], weights: [0.65, 0.35] },
  });
}

/**
 * Trapèze : une seule masse d'une épaule à l'autre, posée sur le haut du buste autour de la base du cou. D'un seul
 * tenant, elle ne creuse pas de gouttière le long de la colonne.
 */
function trapezius(pose: Pose): Shape {
  const C = pose.bases.chest;
  const x = vec(C.x);
  const up = vec(C.y);
  const front = vec(C.z);
  return new Ellipsoid({
    center: vec(pose.joints.neckBase).addScaledVector(up, -0.045).addScaledVector(front, -0.012),
    axes: [x, up, front],
    radii: [DEFAULT_BODY.shoulderHalfWidth * 0.92, 0.05, 0.07],
    region: () => REGION.jersey,
    skin: { joints: [bone('chest')], weights: [1] },
  });
}

/**
 * Corps continu : buste, bassin, jambes, épaules, bras et cou fondus en une seule surface, extraite d'une grille
 * de 5 mm puis simplifiée.
 *
 * Les fusions se font par paliers : très larges entre buste, bassin, trapèze, cou et épaules (le tronc doit se lire
 * d'un seul volume), plus serrées pour les cuisses et les bras (qui gardent leur forme). Jambes et bras restent dans
 * des branches distinctes, réunies sans fusion.
 */
async function body(b: MeshBuilder, pose: Pose) {
  const torso = new Tube(torsoTube(pose));
  const pelvis = pelvisMass(pose);
  const legL = new Tube(legTube(pose, 'l', 1));
  const legR = new Tube(legTube(pose, 'r', -1));
  const armL = new Tube(armTube(pose, 'l', 1));
  const armR = new Tube(armTube(pose, 'r', -1));
  // Bas du cou avec le col, coupé juste sous le haut du col ; le reste du cou appartient à la tête.
  const collared = new Tube(neckTube(pose, true));
  const neckBase = vec(pose.joints.neckBase);
  const neckDir = vec(pose.joints.headBase).sub(neckBase).normalize();
  const cut = neckBase.clone().addScaledVector(neckDir, 0.014);
  const neckStub: Shape = {
    sdf: (x, y, z) => smax(collared.sdf(x, y, z), (x - cut.x) * neckDir.x + (y - cut.y) * neckDir.y + (z - cut.z) * neckDir.z, 0.004),
    // Tout ce que le corps garde du cou est du maillot : la peau du cou appartient à la tête.
    regionAt: () => REGION.jersey,
    skinAt: (p) => collared.skinAt(p),
  };
  const neck = new Tube(neckTube(pose, false));
  const trap = trapezius(pose);
  const deltL = deltoid(pose, 'l', 1);
  const deltR = deltoid(pose, 'r', -1);
  const shapes: Shape[] = [torso, pelvis, legL, legR, armL, armR, neckStub, trap, deltL, deltR];
  const implicit = new Body(shapes, (d) => {
    const [dT, dP, dLL, dLR, dAL, dAR, dN, dTr, dDL, dDR] = d as [number, number, number, number, number, number, number, number, number, number];
    let trunk = smin(dT, dP, 0.11);
    trunk = smin(trunk, dTr, 0.09);
    trunk = smin(trunk, dN, 0.06);
    trunk = smin(trunk, dDL, 0.08);
    trunk = smin(trunk, dDR, 0.08);
    const lower = smin(smin(trunk, dLL, 0.07), dLR, 0.07);
    return Math.min(lower, smin(trunk, dAL, 0.05), smin(trunk, dAR, 0.05));
  });
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const t of [torso, legL, legR, armL, armR, neck]) for (const p of t.spec.points) (min.min(p), max.max(p));
  min.subScalar(0.15);
  max.addScalar(0.15);
  // Au-dessus de l'ourlet du maillot, c'est le maillot qui décide, même là où bassin ou cuisse dominent.
  implicit.resolveRegion = (p, d) => {
    if (d === legL || d === legR || d === pelvis) {
      const t = torso.locate(p.x, p.y, p.z);
      // Seulement contre le buste : la cuisse levée passe devant le ventre sans être couverte par le maillot.
      if (t.s > TORSO_HEM && torso.sdf(p.x, p.y, p.z) < 0.015) return torso.spec.region(t.s, t.theta);
    }
    return d.regionAt(p);
  };
  const dense = polygonize(implicit, min, max, 0.005);
  // Couleurs découpées sur le maillage dense (liserés fins compris), puis simplification à limites figées.
  const split = splitRegions(implicit, dense.positions, dense.indices);
  const simple = await simplify(split.points, split.indices, 18000, 0.0012);
  const g = new Vector3();
  b.addMesh(
    simple.points.map(({ p, r }) => ({ p, n: implicit.gradient(p, g).clone(), region: r, skin: implicit.skin(p, 0.045) })),
    simple.indices,
  );
  return { dense: dense.indices.length / 3, simplified: simple.indices.length / 3, neck, implicit };
}


function shoe(b: MeshBuilder, pose: Pose, s: 'l' | 'r', mirror: 1 | -1) {
  const a = BIND_CRANK + (s === 'l' ? 0 : Math.PI);
  const pitch = footPitch(a);
  const fwd = new Vector3(0, -Math.sin(pitch), Math.cos(pitch));
  const up = new Vector3(0, Math.cos(pitch), Math.sin(pitch));
  const ball = vec(pose.joints[`ball_${s}`]);
  const S = CHUNK.shoe;
  const heel = ball.clone().addScaledVector(fwd, -0.19 * S).addScaledVector(up, 0.012 * S);
  const toe = ball.clone().addScaledVector(fwd, 0.095 * S).addScaledVector(up, 0.012 * S);
  const path = polyline([heel, toe]);
  const L = path.length;
  const top = keys([[0, 0.05], [0.12, 0.072], [0.32, 0.074], [0.55, 0.045], [0.8, 0.03], [1, 0.022]]);
  const width = keys([[0, 0.03], [0.15, 0.036], [0.6, 0.045], [0.85, 0.04], [1, 0.026]]);
  const solidSole = (th: number) => Math.cos(th) < -0.55;
  b.sweep({
    path,
    ds: 0.014,
    radial: 20,
    front: up,
    mirror,
    sCuts: [0.4 * L, 0.48 * L],
    thetaCuts: [Math.acos(-0.55), -Math.acos(-0.55)],
    section: (ss, th) => {
      const t = ss / L;
      const k = roundEnds(ss, 0, L, 0.025 * S, 0.03 * S);
      const w = width(t) * S;
      return oval(th, top(t) * S * Math.max(k, 0.25), 0.021 * S * k, w * k * 1.04, w * k, 2.6);
    },
    region: (ss, th) => {
      const t = ss / L;
      if (solidSole(th)) return REGION.sole;
      if (t > 0.4 && t < 0.48 && Math.cos(th) > -0.3) return REGION.jersey; // sangle de la couleur du maillot
      return REGION.shoe;
    },
    skin: rigid(bone(`foot_${s}`)),
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Molette de serrage sur le côté extérieur.
  const dialC = ball.clone().addScaledVector(fwd, -0.065 * S).addScaledVector(up, 0.06 * S).add(new Vector3(mirror * 0.036 * S, 0, 0));
  const out = new Vector3(mirror, 0, 0);
  b.sweep({
    path: polyline([dialC.clone().addScaledVector(out, -0.004), dialC.clone().addScaledVector(out, 0.008)]),
    ds: 0.02,
    radial: 14,
    front: up,
    section: (_s, th) => oval(th, 0.013, 0.013, 0.013, 0.013),
    region: REGION.eyewear,
    skin: rigid(bone(`foot_${s}`)),
    capEnd: 'flat',
  });
}


/** Main posée sur la cocotte : paume gantée, doigts nus enroulés vers l'avant et le bas, pouce à l'intérieur. */
function hand(b: MeshBuilder, pose: Pose, s: 'l' | 'r', mirror: 1 | -1) {
  const wr = vec(pose.joints[`wrist_${s}`]);
  const kn = vec(pose.joints[`knuckle_${s}`]);
  const d = kn.clone().sub(wr).normalize();
  const out = new Vector3(mirror, 0, 0);
  // Dos de la main : vers le haut et un peu vers l'extérieur.
  const back = new Vector3(0, 1, 0).addScaledVector(out, 0.35).addScaledVector(d, -new Vector3(0, 1, 0).addScaledVector(out, 0.35).dot(d)).normalize();
  const skin = rigid(bone(`hand_${s}`));
  const H = CHUNK.hand;
  const palmPath = polyline([wr.clone().addScaledVector(d, -0.005), kn.clone().addScaledVector(d, 0.012)]);
  const PL = palmPath.length;
  b.sweep({
    path: palmPath,
    ds: 0.012,
    radial: 18,
    front: back,
    mirror,
    section: (ss, th) => {
      const t = ss / PL;
      const k = roundEnds(ss, 0, PL, 0, 0.012);
      return oval(th, 0.013 * H * Math.max(k, 0.5), 0.017 * H * Math.max(k, 0.5), lerp(0.03, 0.043, t) * H * k, lerp(0.028, 0.04, t) * H * k, 3);
    },
    region: REGION.glove,
    skin,
    capEnd: 'pole',
  });
  // Doigts : un bloc enroulé, rainuré entre les quatre doigts.
  const k0 = kn.clone().addScaledVector(d, 0.004);
  const fingers = curve((t) => {
    const a = t * Math.PI * 0.62;
    return k0.clone().addScaledVector(d, Math.sin(a) * 0.034 * H).addScaledVector(back, (Math.cos(a) - 1) * 0.034 * H);
  }, 16);
  const FL = fingers.length;
  b.sweep({
    path: fingers,
    ds: 0.009,
    radial: 22,
    front: back,
    mirror,
    section: (ss, th) => {
      const k = roundEnds(ss, 0, FL, 0, 0.01);
      const [a, bb] = oval(th, 0.0105 * H, 0.0105 * H, 0.041 * H, 0.039 * H, 4);
      let groove = 0;
      for (const bk of [-0.02 * H, 0, 0.02 * H]) groove += Math.exp(-(((bb - bk) / (0.0035 * H)) ** 2));
      return [a * (1 - 0.3 * groove) * Math.max(k, 0.4), bb * k];
    },
    region: REGION.skin,
    skin,
    capEnd: 'pole',
  });
  // Pouce, du côté intérieur.
  const tb = wr.clone().addScaledVector(d, 0.028 * H).addScaledVector(out, -0.03 * H).addScaledVector(back, -0.008 * H);
  const thumb = polyline([tb, tb.clone().addScaledVector(d, 0.03 * H).addScaledVector(back, -0.008 * H), tb.clone().addScaledVector(d, 0.05 * H).addScaledVector(back, -0.022 * H)], 0.012);
  b.sweep({
    path: thumb,
    ds: 0.007,
    radial: 14,
    front: back,
    section: (ss, th) => {
      const r = 0.0105 * H * roundEnds(ss, 0, thumb.length, 0.008, 0.009);
      return oval(th, r, r, r, r);
    },
    region: (ss) => (ss < 0.022 * H ? REGION.glove : REGION.skin),
    sCuts: [0.022 * H],
    skin,
    capStart: 'pole',
    capEnd: 'pole',
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;


/* ---------- Squelette et écriture ---------- */

export async function buildAvatar(out: string, opts: HeadOptions = {}) {
  const torsoAngle = solveTorsoAngle(BIKE_FIT);
  const pose = solvePose(BIKE_FIT, BIND_CRANK, torsoAngle);
  const b = new MeshBuilder();
  const implicit = await body(b, pose);
  for (const [s, mirror] of [['l', 1], ['r', -1]] as const) {
    shoe(b, pose, s, mirror);
    hand(b, pose, s, mirror);
  }
  const headStats = await buildHead(b, pose, implicit.neck, bone('head'), opts);
  collarRim(b, implicit.implicit, headStats.head, implicit.neck);
  // Occlusion ambiante dans la pose de référence, du corps par lui-même. Le vélo n'y entre pas : la selle traverse
  // le cuissard et y laisserait des taches.
  bakeAo({ mesh: b }, [{ mesh: b }], { radius: 0.11 });

  const w = new GlbWriter();
  const doc = w.doc;
  const scene = doc.createScene('avatar');
  const root = doc.createNode('avatar');
  scene.addChild(root);

  const worlds: Matrix4[] = [];
  const nodes = SKELETON.map((def, i) => {
    const B = pose.bases[def.bone];
    const p = pose.joints[def.from];
    const world = new Matrix4().makeBasis(vec(B.x), vec(B.y), vec(B.z)).setPosition(p.x, p.y, p.z);
    worlds.push(world);
    const parentWorld = def.parent ? worlds[BONE_INDEX[def.parent]!]! : new Matrix4();
    const local = parentWorld.clone().invert().multiply(world);
    const t = new Vector3();
    const q = new Quaternion();
    const sc = new Vector3();
    local.decompose(t, q, sc);
    const node = doc.createNode(def.bone).setTranslation([t.x, t.y, t.z]).setRotation([q.x, q.y, q.z, q.w]);
    void i;
    return node;
  });
  SKELETON.forEach((def, i) => (def.parent ? nodes[BONE_INDEX[def.parent]!]! : root).addChild(nodes[i]!));

  const ibm = new Float32Array(SKELETON.length * 16);
  worlds.forEach((m, i) => ibm.set(m.clone().invert().elements, i * 16));
  const skin = doc.createSkin('avatar').setSkeleton(nodes[0]!).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(w.buffer));
  for (const n of nodes) skin.addJoint(n);
  root.addChild(doc.createNode('body').setMesh(w.mesh('body', b, true)).setSkin(skin));

  const glb = await w.write(out);
  return { triangles: b.triangleCount, bytes: glb.byteLength, torsoAngleDeg: (torsoAngle * 180) / Math.PI, pose, implicit };
}
