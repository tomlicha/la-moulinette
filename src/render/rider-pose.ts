/**
 * Pose du cycliste sur son vélo : positions des articulations pour un angle de pédalier donné.
 *
 * Le même calcul sert deux fois : le script de génération pose l'avatar dans cette position avant de le lier
 * à son squelette, et le moteur le refait à chaque image pour animer le pédalage. À l'angle de référence, l'avatar
 * animé coïncide donc exactement avec le modèle, et les déformations restent faibles sur tout le tour de pédale.
 *
 * Aucun import : le script de génération (Node) charge ce fichier directement.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: V3, k: number): V3 => v3(a.x * k, a.y * k, a.z * k);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3) => length(sub(a, b));
export const normalize = (a: V3): V3 => scale(a, 1 / (length(a) || 1));
/** Somme pondérée : `o + Σ dirs[i] * ks[i]`. */
export const offset = (o: V3, ...terms: [V3, number][]): V3 =>
  terms.reduce((p, [d, k]) => add(p, scale(d, k)), o);

/** Repère orthonormé d'un os : `y` le long de l'os, `x` au plus près de `hint` (le côté gauche), `z = x × y`. */
export interface Basis {
  x: V3;
  y: V3;
  z: V3;
}

export function aimBasis(dir: V3, hint: V3 = v3(1, 0, 0)): Basis {
  const y = normalize(dir);
  let x = sub(hint, scale(y, dot(hint, y)));
  if (length(x) < 1e-6) x = sub(v3(0, 0, 1), scale(y, y.z));
  x = normalize(x);
  return { x, y, z: cross(x, y) };
}

/**
 * Cinématique inverse à deux segments en 3D : position de l'articulation intermédiaire (genou, coude) entre
 * `root` et `target`, pliée du côté de `pole`. Hors de portée, le membre se tend vers la cible.
 */
export function twoBone(root: V3, target: V3, l1: number, l2: number, pole: V3): V3 {
  const axis = sub(target, root);
  const d = Math.min(Math.max(length(axis), Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const u = normalize(axis);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = normalize(sub(pole, scale(u, dot(pole, u))));
  return offset(root, [u, l1 * cosA], [bend, l1 * sinA]);
}

/** Points d'appui fournis par le vélo, dans son repère. */
export interface BikeFit {
  saddle: V3;
  hoodL: V3;
  hoodR: V3;
  /** Axe du pédalier. */
  bb: V3;
  crankLength: number;
  /** Demi-écartement des pédales (distance de l'axe du vélo au centre de chaque pédale). */
  pedalHalfWidth: number;
}

/** Mesures du corps, en m. Les longueurs d'os de l'avatar en sont tirées. */
export interface Body {
  thigh: number;
  shin: number;
  /** De la cheville à l'avant-pied (point d'appui sur la pédale), le long du pied. */
  foot: number;
  /** Hauteur de la cheville au-dessus de la semelle. */
  ankleHeight: number;
  /** Épaisseur semelle et pédale entre l'axe de la pédale et l'avant-pied. */
  pedalStack: number;
  pelvis: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  upperArm: number;
  forearm: number;
  hand: number;
  hipHalfWidth: number;
  shoulderHalfWidth: number;
  /** Les épaules sont un peu sous la base du cou, le long du buste. */
  shoulderDrop: number;
  /** Centre des hanches par rapport au point d'assise. */
  hipAboveSaddle: number;
  hipAheadOfSaddle: number;
}

export const DEFAULT_BODY: Body = {
  thigh: 0.44,
  shin: 0.43,
  foot: 0.13,
  ankleHeight: 0.075,
  pedalStack: 0.03,
  pelvis: 0.11,
  spine: 0.2,
  chest: 0.22,
  neck: 0.09,
  head: 0.17,
  upperArm: 0.3,
  forearm: 0.27,
  hand: 0.105,
  hipHalfWidth: 0.088,
  shoulderHalfWidth: 0.164,
  shoulderDrop: 0.045,
  hipAboveSaddle: 0.078,
  hipAheadOfSaddle: 0.025,
};

export type Joint =
  | 'root' | 'lumbar' | 'thorax' | 'neckBase' | 'headBase' | 'headTop'
  | 'hip_l' | 'knee_l' | 'ankle_l' | 'ball_l'
  | 'hip_r' | 'knee_r' | 'ankle_r' | 'ball_r'
  | 'shoulder_l' | 'elbow_l' | 'wrist_l' | 'knuckle_l'
  | 'shoulder_r' | 'elbow_r' | 'wrist_r' | 'knuckle_r';

/** Os du squelette : de l'articulation `from` vers `to`, rattaché à `parent`. Ordre : parents d'abord. */
export const SKELETON = [
  { bone: 'pelvis', from: 'root', to: 'lumbar', parent: null },
  { bone: 'spine', from: 'lumbar', to: 'thorax', parent: 'pelvis' },
  { bone: 'chest', from: 'thorax', to: 'neckBase', parent: 'spine' },
  { bone: 'neck', from: 'neckBase', to: 'headBase', parent: 'chest' },
  { bone: 'head', from: 'headBase', to: 'headTop', parent: 'neck' },
  { bone: 'thigh_l', from: 'hip_l', to: 'knee_l', parent: 'pelvis' },
  { bone: 'shin_l', from: 'knee_l', to: 'ankle_l', parent: 'thigh_l' },
  { bone: 'foot_l', from: 'ankle_l', to: 'ball_l', parent: 'shin_l' },
  { bone: 'thigh_r', from: 'hip_r', to: 'knee_r', parent: 'pelvis' },
  { bone: 'shin_r', from: 'knee_r', to: 'ankle_r', parent: 'thigh_r' },
  { bone: 'foot_r', from: 'ankle_r', to: 'ball_r', parent: 'shin_r' },
  { bone: 'upperarm_l', from: 'shoulder_l', to: 'elbow_l', parent: 'chest' },
  { bone: 'forearm_l', from: 'elbow_l', to: 'wrist_l', parent: 'upperarm_l' },
  { bone: 'hand_l', from: 'wrist_l', to: 'knuckle_l', parent: 'forearm_l' },
  { bone: 'upperarm_r', from: 'shoulder_r', to: 'elbow_r', parent: 'chest' },
  { bone: 'forearm_r', from: 'elbow_r', to: 'wrist_r', parent: 'upperarm_r' },
  { bone: 'hand_r', from: 'wrist_r', to: 'knuckle_r', parent: 'forearm_r' },
] as const satisfies readonly { bone: string; from: Joint; to: Joint; parent: string | null }[];

export type BoneName = (typeof SKELETON)[number]['bone'];

export interface Pose {
  joints: Record<Joint, V3>;
  /** Repère de chaque os (y le long de l'os, x vers la gauche). */
  bases: Record<BoneName, Basis>;
  /** Angle du buste au-dessus de l'horizontale, en radians. */
  torsoAngle: number;
}

/** Inclinaison du pied (pointe vers le bas, en radians) selon l'angle du pédalier : talon bas en poussée, pointe basse en remontée. */
export const footPitch = (crank: number) => 0.26 - 0.2 * Math.sin(crank);

const DEG = Math.PI / 180;
/** Le buste s'arrondit : le bassin bascule plus que le haut du dos. */
const PELVIS_EXTRA = 22 * DEG;
const SPINE_EXTRA = 6 * DEG;
const CHEST_EXTRA = -9 * DEG;
/** Cou tendu vers l'avant et tête presque droite : le regard reste sur la route. */
const NECK_ANGLE = 38 * DEG;
const HEAD_ANGLE = 74 * DEG;
/** Coudes nettement fléchis : 90 % de la longueur des bras entre épaule et poignet, le buste plus couché. */
const REACH = 0.9;

/**
 * Déhanchement : le bassin bascule vers la jambe qui pousse, les épaules compensent un peu en sens inverse, la
 * tête reste droite. Nul à l'angle de référence (manivelles à l'horizontale), où le modèle est lié au squelette.
 */
const PELVIS_ROCK = 4 * DEG;
const CHEST_ROCK = -2.2 * DEG;

const dirAt = (angle: number) => v3(0, Math.sin(angle), Math.cos(angle));
const LEFT = v3(1, 0, 0);
/** Axe « gauche » incliné de `roll` radians autour de l'axe du vélo (positif : le côté gauche monte). */
const leftRolled = (roll: number) => v3(Math.cos(roll), Math.sin(roll), 0);

/** Prise des mains : poignet un peu en arrière et au-dessus du point d'appui, phalanges juste devant. */
function handTargets(hood: V3): { wrist: V3; knuckle: V3 } {
  return { wrist: offset(hood, [v3(0, 1, 0), 0.03], [v3(0, 0, 1), -0.085]), knuckle: offset(hood, [v3(0, 0, 1), 0.012]) };
}

interface Torso {
  root: V3;
  lumbar: V3;
  thorax: V3;
  neckBase: V3;
  pelvis: Basis;
  spine: Basis;
  chest: Basis;
}

function torso(fit: BikeFit, body: Body, angle: number, rock = 0): Torso {
  const root = offset(fit.saddle, [v3(0, 1, 0), body.hipAboveSaddle], [v3(0, 0, 1), body.hipAheadOfSaddle]);
  const lumbar = offset(root, [dirAt(angle + PELVIS_EXTRA), body.pelvis]);
  const thorax = offset(lumbar, [dirAt(angle + SPINE_EXTRA), body.spine]);
  const neckBase = offset(thorax, [dirAt(angle + CHEST_EXTRA), body.chest]);
  return {
    root,
    lumbar,
    thorax,
    neckBase,
    pelvis: aimBasis(sub(lumbar, root), leftRolled(PELVIS_ROCK * rock)),
    spine: aimBasis(sub(thorax, lumbar), LEFT),
    chest: aimBasis(sub(neckBase, thorax), leftRolled(CHEST_ROCK * rock)),
  };
}

function shoulder(t: Torso, body: Body, side: 1 | -1): V3 {
  return offset(t.neckBase, [t.chest.x, side * body.shoulderHalfWidth], [t.chest.y, -body.shoulderDrop]);
}

/**
 * Angle du buste pour que les bras atteignent les cocottes un peu fléchis. Le buste qui se couche rapproche les
 * épaules des mains : la distance croît avec l'angle, une dichotomie suffit.
 */
export function solveTorsoAngle(fit: BikeFit, body: Body = DEFAULT_BODY): number {
  const wrist = handTargets(fit.hoodL).wrist;
  const want = REACH * (body.upperArm + body.forearm);
  let lo = 5 * DEG;
  let hi = 85 * DEG;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (dist(shoulder(torso(fit, body, mid), body, 1), wrist) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Pose complète pour un angle de pédalier `crank` (radians ; 0 : pédale gauche en haut, croissant vers l'avant).
 * `torsoAngle` vient de {@link solveTorsoAngle}, calculé une fois par couple vélo et avatar.
 */
export function solvePose(fit: BikeFit, crank: number, torsoAngle: number, body: Body = DEFAULT_BODY): Pose {
  // La jambe gauche est en haut à 0 : la hanche gauche est alors levée, elle retombe pendant la poussée.
  const t = torso(fit, body, torsoAngle, Math.cos(crank));
  const neckDir = dirAt(NECK_ANGLE);
  const headBase = offset(t.neckBase, [neckDir, body.neck]);
  const headTop = offset(headBase, [dirAt(HEAD_ANGLE), body.head]);

  const joints = { root: t.root, lumbar: t.lumbar, thorax: t.thorax, neckBase: t.neckBase, headBase, headTop } as Record<Joint, V3>;
  const bases = { pelvis: t.pelvis, spine: t.spine, chest: t.chest } as Record<BoneName, Basis>;
  bases.neck = aimBasis(neckDir, LEFT);
  bases.head = aimBasis(sub(headTop, headBase), LEFT);

  for (const [s, side, phase] of [['l', 1, 0], ['r', -1, Math.PI]] as const) {
    // Jambe : pédale, avant-pied, cheville, puis genou par cinématique inverse, plié vers l'avant.
    const a = crank + phase;
    const pitch = footPitch(a);
    const fwd = v3(0, -Math.sin(pitch), Math.cos(pitch));
    const up = v3(0, Math.cos(pitch), Math.sin(pitch));
    const pedal = offset(fit.bb, [LEFT, side * fit.pedalHalfWidth], [v3(0, 1, 0), fit.crankLength * Math.cos(a)], [v3(0, 0, 1), fit.crankLength * Math.sin(a)]);
    const ball = offset(pedal, [up, body.pedalStack]);
    const ankle = offset(ball, [fwd, -body.foot], [up, body.ankleHeight]);
    const hip = offset(t.root, [t.pelvis.x, side * body.hipHalfWidth]);
    const knee = twoBone(hip, ankle, body.thigh, body.shin, v3(side * 0.08, 0.35, 1));
    joints[`hip_${s}`] = hip;
    joints[`knee_${s}`] = knee;
    joints[`ankle_${s}`] = ankle;
    joints[`ball_${s}`] = ball;
    bases[`thigh_${s}`] = aimBasis(sub(knee, hip), LEFT);
    bases[`shin_${s}`] = aimBasis(sub(ankle, knee), LEFT);
    bases[`foot_${s}`] = aimBasis(sub(ball, ankle), LEFT);

    // Bras : épaule, coude ouvert vers l'extérieur et l'arrière, poignet sur la cocotte.
    const hand = handTargets(side === 1 ? fit.hoodL : fit.hoodR);
    const sh = shoulder(t, body, side);
    const elbow = twoBone(sh, hand.wrist, body.upperArm, body.forearm, v3(side * 0.55, -0.15, -0.8));
    const knuckle = offset(hand.wrist, [normalize(sub(hand.knuckle, hand.wrist)), body.hand]);
    joints[`shoulder_${s}`] = sh;
    joints[`elbow_${s}`] = elbow;
    joints[`wrist_${s}`] = hand.wrist;
    joints[`knuckle_${s}`] = knuckle;
    bases[`upperarm_${s}`] = aimBasis(sub(elbow, sh), LEFT);
    bases[`forearm_${s}`] = aimBasis(sub(hand.wrist, elbow), LEFT);
    bases[`hand_${s}`] = aimBasis(sub(knuckle, hand.wrist), LEFT);
  }
  return { joints, bases, torsoAngle };
}

/** Angle de pédalier de la pose de référence : jambes à l'horizontale, à mi-chemin des extrêmes de flexion. */
export const BIND_CRANK = Math.PI / 2;
