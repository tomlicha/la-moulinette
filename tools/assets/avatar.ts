/**
 * Avatar de cycliste, posé sur le vélo à l'angle de pédalier de référence puis lié à son squelette.
 *
 * Chaque membre est une seule surface continue (hanche-genou-cheville, épaule-coude-poignet) aux sections
 * anatomiques : quadriceps et mollets galbés, tibia plus plat, deltoïdes, avant-bras effilés. Les vêtements sont
 * des couches à part, un peu plus larges, terminées par un ourlet : leur bord se voit, comme un vrai tissu.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { REGION } from '../../src/render/asset-contract.ts';
import { BIND_CRANK, DEFAULT_BODY, footPitch, SKELETON, solvePose, solveTorsoAngle, type Pose, type V3 } from '../../src/render/rider-pose.ts';
import { BIKE_FIT } from './bike.ts';
import { GlbWriter } from './gltf.ts';
import { angleDiff, bumps, curve, inflate, keys, MeshBuilder, oval, polyline, roundEnds, smooth, type Bump, type SectionPoint, type Skin } from './mesh.ts';

const vec = (p: V3) => new Vector3(p.x, p.y, p.z);
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

function legs(b: MeshBuilder, pose: Pose) {
  const J = pose.joints;
  for (const [s, mirror] of [['l', 1], ['r', -1]] as const) {
    const hip = vec(J[`hip_${s}`]);
    const knee = vec(J[`knee_${s}`]);
    const ankle = vec(J[`ankle_${s}`]);
    const thighDir = knee.clone().sub(hip).normalize();
    const shinDir = ankle.clone().sub(knee).normalize();
    // La jambe commence derrière et sous la hanche : son premier tronçon forme la fesse, posée sur la selle.
    // Les deux fesses se touchent au milieu ; le buste ne descend que jusqu'au bassin.
    const start = hip.clone().addScaledVector(thighDir, -0.1).add(new Vector3(0, -0.085, 0));
    const end = ankle.clone().addScaledVector(shinDir, 0.03);
    const path = polyline([start, hip, knee, ankle, end], 0.06);
    const sh = start.distanceTo(hip); // hanche
    const sk = sh + DEFAULT_BODY.thigh; // genou
    const sa = sk + DEFAULT_BODY.shin; // cheville
    const u = (list: [number, number][]) => keys(list.map(([x, v]) => [x + sh, v] as [number, number]));
    const prof: Profile = {
      front: u([[-0.11, 0.05], [-0.05, 0.066], [0, 0.074], [0.15, 0.072], [0.3, 0.06], [0.4, 0.05], [0.445, 0.05], [0.49, 0.041], [0.64, 0.038], [0.79, 0.029], [0.9, 0.03]]),
      back: u([[-0.11, 0.075], [-0.06, 0.098], [-0.01, 0.092], [0.1, 0.075], [0.3, 0.057], [0.42, 0.045], [0.47, 0.046], [0.54, 0.058], [0.6, 0.06], [0.7, 0.044], [0.8, 0.03], [0.9, 0.03]]),
      outer: u([[-0.11, 0.062], [-0.05, 0.08], [0, 0.081], [0.15, 0.07], [0.32, 0.056], [0.44, 0.047], [0.54, 0.049], [0.64, 0.044], [0.79, 0.031], [0.86, 0.033], [0.9, 0.031]]),
      inner: u([[-0.11, 0.065], [-0.05, 0.088], [0, 0.078], [0.08, 0.063], [0.2, 0.058], [0.36, 0.05], [0.44, 0.046], [0.56, 0.051], [0.66, 0.042], [0.79, 0.03], [0.86, 0.032], [0.9, 0.03]]),
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
    const skin = chainSkin(
      [bone('pelvis'), bone(`thigh_${s}`), bone(`shin_${s}`), bone(`foot_${s}`)],
      [{ s: sh + 0.02, w: 0.07 }, { s: sk, w: 0.05 }, { s: sa, w: 0.025 }],
    );
    const raw = sectionOf(prof);
    const base = (ss: number, th: number): SectionPoint => {
      const k = roundEnds(ss, 0, path.length, 0.05, 0);
      const [a, bb] = raw(ss, th);
      return [a * k, bb * k];
    };
    const front = vec(pose.bases[`thigh_${s}`].z).negate(); // l'avant de la cuisse regarde vers le haut et l'avant
    const common = { path, front, mirror, skin: (ss: number) => skin(ss) } as const;

    // Peau : du bas du cuissard jusque dans la chaussette.
    b.sweep({ ...common, s0: sh + 0.27, s1: sa - 0.11, ds: 0.009, radial: 30, section: base, region: REGION.skin });
    // Cuissard, avec sa bande de maintien.
    const shortsEnd = sh + 0.3;
    const shorts = garment(base, 0.0035, 0, shortsEnd, { end: true });
    b.sweep({
      ...common,
      s0: 0,
      s1: shortsEnd,
      ds: 0.012,
      radial: 30,
      sCuts: [...shorts.cuts, shortsEnd - 0.032],
      section: (ss, th) => {
        const [a, bb] = shorts.section(ss, th);
        const band = ss > shortsEnd - 0.032 && ss < shortsEnd - 0.0006 ? 0.0012 : 0;
        return [a + Math.cos(th) * band, bb + Math.sin(th) * band];
      },
      region: (ss) => (ss > shortsEnd - 0.032 ? REGION.shortsBand : REGION.shorts),
      capStart: 'pole',
    });
    // Chaussette haute, ourlet en haut et un liseré.
    const sockTop = sa - 0.13;
    const sock = garment(base, 0.0025, sockTop, sa + 0.03, { start: true });
    b.sweep({
      ...common,
      s0: sockTop,
      s1: sa + 0.03,
      ds: 0.01,
      radial: 30,
      sCuts: [...sock.cuts, sockTop + 0.018, sockTop + 0.026],
      section: sock.section,
      region: (ss) => (ss > sockTop + 0.018 && ss < sockTop + 0.026 ? REGION.jerseyAccent : REGION.sock),
      capEnd: 'pole',
    });
    shoe(b, pose, s, mirror);
  }
}

function shoe(b: MeshBuilder, pose: Pose, s: 'l' | 'r', mirror: 1 | -1) {
  const a = BIND_CRANK + (s === 'l' ? 0 : Math.PI);
  const pitch = footPitch(a);
  const fwd = new Vector3(0, -Math.sin(pitch), Math.cos(pitch));
  const up = new Vector3(0, Math.cos(pitch), Math.sin(pitch));
  const ball = vec(pose.joints[`ball_${s}`]);
  const heel = ball.clone().addScaledVector(fwd, -0.19).addScaledVector(up, 0.012);
  const toe = ball.clone().addScaledVector(fwd, 0.095).addScaledVector(up, 0.012);
  const path = polyline([heel, toe]);
  const L = path.length;
  const top = keys([[0, 0.05], [0.12, 0.072], [0.32, 0.074], [0.55, 0.045], [0.8, 0.03], [1, 0.022]]);
  const width = keys([[0, 0.03], [0.15, 0.036], [0.6, 0.045], [0.85, 0.04], [1, 0.026]]);
  const solidSole = (th: number) => Math.cos(th) < -0.55;
  b.sweep({
    path,
    ds: 0.008,
    radial: 26,
    front: up,
    mirror,
    sCuts: [0.4 * L, 0.48 * L],
    thetaCuts: [Math.acos(-0.55), -Math.acos(-0.55)],
    section: (ss, th) => {
      const t = ss / L;
      const k = roundEnds(ss, 0, L, 0.025, 0.03);
      const w = width(t);
      return oval(th, top(t) * Math.max(k, 0.25), 0.021 * k, w * k * 1.04, w * k, 2.6);
    },
    region: (ss, th) => {
      const t = ss / L;
      if (solidSole(th)) return REGION.sole;
      if (t > 0.4 && t < 0.48 && Math.cos(th) > -0.3) return REGION.jerseyAccent;
      return REGION.shoe;
    },
    skin: rigid(bone(`foot_${s}`)),
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Molette de serrage sur le côté extérieur.
  const dialC = ball.clone().addScaledVector(fwd, -0.065).addScaledVector(up, 0.06).add(new Vector3(mirror * 0.036, 0, 0));
  const out = new Vector3(mirror, 0, 0);
  b.sweep({
    path: polyline([dialC.clone().addScaledVector(out, -0.004), dialC.clone().addScaledVector(out, 0.008)]),
    ds: 0.02,
    radial: 14,
    front: up,
    section: (_s, th) => oval(th, 0.011, 0.011, 0.011, 0.011),
    region: REGION.eyewear,
    skin: rigid(bone(`foot_${s}`)),
    capEnd: 'flat',
  });
}

function torso(b: MeshBuilder, pose: Pose) {
  const J = pose.joints;
  const root = vec(J.root);
  const lumbar = vec(J.lumbar);
  const thorax = vec(J.thorax);
  const neck = vec(J.neckBase);
  const pelvisDir = lumbar.clone().sub(root).normalize();
  const chestDir = neck.clone().sub(thorax).normalize();
  const bottom = root.clone().addScaledVector(pelvisDir, -0.12);
  const top = neck.clone().addScaledVector(chestDir, 0.02);
  const path = polyline([bottom, root, lumbar, thorax, neck, top], 0.06);
  const sR = 0.12;
  const sL = sR + DEFAULT_BODY.pelvis;
  const sT = sL + DEFAULT_BODY.spine;
  const sN = sT + DEFAULT_BODY.chest;
  const end = sN + 0.02;
  const width = keys([[0, 0.095], [0.05, 0.135], [0.12, 0.15], [0.2, 0.143], [0.28, 0.133], [0.36, 0.142], [0.45, 0.16], [0.55, 0.168], [0.6, 0.152], [0.635, 0.11], [end, 0.06]]);
  const prof: Profile = {
    front: keys([[0, 0.07], [0.06, 0.088], [0.12, 0.098], [0.23, 0.094], [0.32, 0.094], [0.45, 0.104], [0.55, 0.108], [0.615, 0.08], [end, 0.045]]),
    back: keys([[0, 0.07], [0.06, 0.095], [0.14, 0.1], [0.23, 0.086], [0.32, 0.083], [0.45, 0.098], [0.55, 0.104], [0.625, 0.08], [end, 0.045]]),
    outer: width,
    inner: width,
    n: 2.5,
    bumps: [
      { s: 0.1, theta: Math.PI - 0.55, h: 0.008, ws: 0.05, wt: 0.5 }, // fessiers
      { s: 0.1, theta: -Math.PI + 0.55, h: 0.008, ws: 0.05, wt: 0.5 },
      { s: 0.53, theta: 0.5, h: 0.01, ws: 0.05, wt: 0.42 }, // pectoraux
      { s: 0.53, theta: -0.5, h: 0.01, ws: 0.05, wt: 0.42 },
      { s: 0.56, theta: Math.PI - 0.62, h: 0.009, ws: 0.06, wt: 0.4 }, // omoplates
      { s: 0.56, theta: -Math.PI + 0.62, h: 0.009, ws: 0.06, wt: 0.4 },
      { s: 0.47, theta: 1.45, h: 0.007, ws: 0.08, wt: 0.4 }, // dorsaux
      { s: 0.47, theta: -1.45, h: 0.007, ws: 0.08, wt: 0.4 },
      { s: 0.615, theta: Math.PI / 2, h: 0.006, ws: 0.025, wt: 0.6 }, // trapèzes vers l'épaule
      { s: 0.615, theta: -Math.PI / 2, h: 0.006, ws: 0.025, wt: 0.6 },
    ],
  };
  // Poches dorsales : trois bosses sous l'ourlet du maillot.
  const pocketTop = sR + 0.2;
  for (const th of [Math.PI - 0.75, Math.PI, Math.PI + 0.75]) prof.bumps.push({ s: pocketTop - 0.045, theta: th, h: 0.007, ws: 0.03, wt: 0.22 });
  const skin = chainSkin([bone('pelvis'), bone('spine'), bone('chest'), bone('neck')], [{ s: sL, w: 0.06 }, { s: sT, w: 0.07 }, { s: sN, w: 0.02 }]);
  const base = sectionOf(prof);
  const front = vec(pose.bases.pelvis.z); // ventre
  const common = { path, front, skin: (s: number) => skin(s) } as const;

  // Cuissard (bas du buste) : bassin et ventre, arrondi juste sous les hanches ; les fesses viennent des jambes.
  const pelvisBottom = sR - 0.05;
  b.sweep({
    ...common,
    s0: pelvisBottom,
    s1: sR + 0.17,
    ds: 0.012,
    radial: 40,
    section: (s, th) => {
      const k = roundEnds(s, pelvisBottom, 1, 0.06, 0);
      const [a, bb] = base(s, th);
      return [a * k, bb * k];
    },
    region: REGION.shorts,
    capStart: 'pole',
  });
  // Maillot : flancs contrastés, empiècement d'épaules, fermeture éclair, poches.
  const hem = sR + 0.12;
  const jersey = garment(base, 0.004, hem, end, { start: true });
  const side = (th: number) => Math.abs(Math.abs(th) - Math.PI / 2) < 0.42;
  const yoke = sN - 0.07;
  b.sweep({
    ...common,
    s0: hem,
    s1: end,
    ds: 0.011,
    radial: 44,
    sCuts: [...jersey.cuts, yoke, yoke + 0.008, pocketTop, pocketTop + 0.006, sN - 0.12],
    thetaCuts: [Math.PI / 2 - 0.42, Math.PI / 2 + 0.42, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42, 0.025, -0.025, Math.PI - 1.15, Math.PI + 1.15],
    section: jersey.section,
    region: (s, th) => {
      if (s > yoke && s < yoke + 0.008) return REGION.jerseyAccent;
      if (s > yoke) return REGION.jerseyAlt;
      if (Math.abs(th) < 0.025 && s > sN - 0.12) return REGION.jerseyAccent; // fermeture éclair
      if (s > pocketTop && s < pocketTop + 0.006 && Math.abs(angleDiff(th, Math.PI)) < 1.15) return REGION.jerseyAccent;
      return side(th) ? REGION.jerseyAlt : REGION.jersey;
    },
    capEnd: 'pole',
  });
}

function arms(b: MeshBuilder, pose: Pose) {
  const J = pose.joints;
  for (const [s, mirror] of [['l', 1], ['r', -1]] as const) {
    const sh = vec(J[`shoulder_${s}`]);
    const el = vec(J[`elbow_${s}`]);
    const wr = vec(J[`wrist_${s}`]);
    const uaDir = el.clone().sub(sh).normalize();
    const faDir = wr.clone().sub(el).normalize();
    const start = sh.clone().addScaledVector(uaDir, -0.025).add(new Vector3(-mirror * 0.035, -0.02, 0));
    const path = polyline([start, sh, el, wr, wr.clone().addScaledVector(faDir, 0.02)], 0.035);
    const s0 = start.distanceTo(sh);
    const se = s0 + DEFAULT_BODY.upperArm;
    const sw = se + DEFAULT_BODY.forearm;
    const u = (list: [number, number][]) => keys(list.map(([x, v]) => [x + s0, v] as [number, number]));
    const prof: Profile = {
      front: u([[-0.045, 0.044], [0, 0.05], [0.08, 0.048], [0.15, 0.044], [0.27, 0.036], [0.31, 0.037], [0.37, 0.042], [0.5, 0.03], [0.57, 0.026], [0.6, 0.026]]),
      back: u([[-0.045, 0.044], [0, 0.05], [0.1, 0.047], [0.2, 0.044], [0.29, 0.039], [0.32, 0.04], [0.38, 0.038], [0.5, 0.026], [0.57, 0.024], [0.6, 0.024]]),
      outer: u([[-0.045, 0.046], [0.02, 0.052], [0.1, 0.046], [0.2, 0.04], [0.3, 0.038], [0.38, 0.037], [0.5, 0.024], [0.57, 0.018], [0.6, 0.018]]),
      inner: u([[-0.045, 0.04], [0.02, 0.044], [0.1, 0.041], [0.2, 0.037], [0.3, 0.037], [0.38, 0.035], [0.5, 0.022], [0.57, 0.017], [0.6, 0.017]]),
      bumps: [
        { s: s0 + 0.04, theta: 1.0, h: 0.008, ws: 0.05, wt: 0.75 }, // deltoïde
        { s: s0 + 0.15, theta: 0, h: 0.008, ws: 0.05, wt: 0.5 }, // biceps
        { s: s0 + 0.12, theta: Math.PI, h: 0.008, ws: 0.06, wt: 0.6 }, // triceps
        { s: se + 0.005, theta: Math.PI, h: 0.006, ws: 0.02, wt: 0.4 }, // coude
        { s: se + 0.07, theta: 0.6, h: 0.01, ws: 0.05, wt: 0.55 }, // avant-bras
      ],
    };
    const skin = chainSkin([bone('chest'), bone(`upperarm_${s}`), bone(`forearm_${s}`), bone(`hand_${s}`)], [{ s: s0 + 0.01, w: 0.05 }, { s: se, w: 0.045 }, { s: sw, w: 0.02 }]);
    const base = sectionOf(prof);
    const front = new Vector3(0, 1, 0); // dessus du bras
    const common = { path, front, mirror, skin: (ss: number) => skin(ss) } as const;
    // Peau, de sous la manche au gant.
    b.sweep({ ...common, s0: s0 + 0.14, s1: sw + 0.01, ds: 0.009, radial: 24, section: base, region: REGION.skin, capEnd: 'pole' });
    // Manche contrastée avec bande de maintien.
    const sleeveEnd = s0 + 0.165;
    const sleeve = garment(base, 0.0035, 0, sleeveEnd, { end: true });
    b.sweep({
      ...common,
      s0: 0,
      s1: sleeveEnd,
      ds: 0.01,
      radial: 28,
      sCuts: [...sleeve.cuts, sleeveEnd - 0.028],
      section: sleeve.section,
      region: (ss) => (ss > sleeveEnd - 0.028 ? REGION.jerseyAccent : REGION.jerseyAlt),
      capStart: 'pole',
    });
    // Manchette du gant.
    const glove = garment(base, 0.003, sw - 0.035, sw + 0.02, { start: true });
    b.sweep({ ...common, s0: sw - 0.035, s1: sw + 0.02, ds: 0.008, radial: 24, sCuts: glove.cuts, section: glove.section, region: REGION.glove, capEnd: 'pole' });
    hand(b, pose, s, mirror);
  }
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
  const palmPath = polyline([wr.clone().addScaledVector(d, -0.005), kn.clone().addScaledVector(d, 0.012)]);
  const PL = palmPath.length;
  b.sweep({
    path: palmPath,
    ds: 0.008,
    radial: 22,
    front: back,
    mirror,
    section: (ss, th) => {
      const t = ss / PL;
      const k = roundEnds(ss, 0, PL, 0, 0.012);
      return oval(th, 0.013 * Math.max(k, 0.5), 0.017 * Math.max(k, 0.5), lerp(0.03, 0.043, t) * k, lerp(0.028, 0.04, t) * k, 3);
    },
    region: REGION.glove,
    skin,
    capEnd: 'pole',
  });
  // Doigts : un bloc enroulé, rainuré entre les quatre doigts.
  const k0 = kn.clone().addScaledVector(d, 0.004);
  const fingers = curve((t) => {
    const a = t * Math.PI * 0.62;
    return k0.clone().addScaledVector(d, Math.sin(a) * 0.034).addScaledVector(back, (Math.cos(a) - 1) * 0.034);
  }, 16);
  const FL = fingers.length;
  b.sweep({
    path: fingers,
    ds: 0.006,
    radial: 28,
    front: back,
    mirror,
    section: (ss, th) => {
      const k = roundEnds(ss, 0, FL, 0, 0.01);
      const [a, bb] = oval(th, 0.0105, 0.0105, 0.041, 0.039, 4);
      let groove = 0;
      for (const bk of [-0.02, 0, 0.02]) groove += Math.exp(-(((bb - bk) / 0.0035) ** 2));
      return [a * (1 - 0.3 * groove) * Math.max(k, 0.4), bb * k];
    },
    region: REGION.skin,
    skin,
    capEnd: 'pole',
  });
  // Pouce, du côté intérieur.
  const tb = wr.clone().addScaledVector(d, 0.028).addScaledVector(out, -0.03).addScaledVector(back, -0.008);
  const thumb = polyline([tb, tb.clone().addScaledVector(d, 0.03).addScaledVector(back, -0.008), tb.clone().addScaledVector(d, 0.05).addScaledVector(back, -0.022)], 0.012);
  b.sweep({
    path: thumb,
    ds: 0.007,
    radial: 14,
    front: back,
    section: (ss, th) => {
      const r = 0.0105 * roundEnds(ss, 0, thumb.length, 0.008, 0.009);
      return oval(th, r, r, r, r);
    },
    region: (ss) => (ss < 0.022 ? REGION.glove : REGION.skin),
    sCuts: [0.022],
    skin,
    capStart: 'pole',
    capEnd: 'pole',
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Repère de la tête : origine sous le menton, axe le long de l'os de la tête, avant vers le visage. */
function headFrame(pose: Pose) {
  const base = vec(pose.joints.headBase);
  const axis = vec(pose.joints.headTop).sub(base).normalize();
  const face = new Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize();
  const origin = base.clone().addScaledVector(axis, -0.06);
  return { origin, axis, face, side: face.clone().cross(axis) };
}

const HEAD_LEN = 0.24;
const headWidth = keys([[0, 0.032], [0.02, 0.047], [0.05, 0.06], [0.09, 0.069], [0.12, 0.073], [0.16, 0.074], [0.2, 0.066], [0.225, 0.045], [HEAD_LEN, 0.004]]);
const HEAD: Profile = {
  front: keys([[0, 0.03], [0.02, 0.05], [0.05, 0.072], [0.08, 0.082], [0.12, 0.086], [0.16, 0.083], [0.2, 0.068], [0.225, 0.044], [HEAD_LEN, 0.004]]),
  back: keys([[0, 0.03], [0.02, 0.044], [0.05, 0.058], [0.09, 0.084], [0.13, 0.097], [0.17, 0.094], [0.2, 0.08], [0.225, 0.05], [HEAD_LEN, 0.004]]),
  outer: headWidth,
  inner: headWidth,
  n: 2.2,
  bumps: [
    { s: 0.104, theta: 0, h: 0.02, ws: 0.017, wt: 0.15 }, // nez
    { s: 0.092, theta: 0, h: 0.006, ws: 0.008, wt: 0.12 }, // bout du nez
    { s: 0.136, theta: 0.36, h: 0.007, ws: 0.011, wt: 0.3 }, // arcades
    { s: 0.136, theta: -0.36, h: 0.007, ws: 0.011, wt: 0.3 },
    { s: 0.12, theta: 0.4, h: -0.008, ws: 0.011, wt: 0.17 }, // orbites
    { s: 0.12, theta: -0.4, h: -0.008, ws: 0.011, wt: 0.17 },
    { s: 0.103, theta: 0.85, h: 0.006, ws: 0.015, wt: 0.3 }, // pommettes
    { s: 0.103, theta: -0.85, h: 0.006, ws: 0.015, wt: 0.3 },
    { s: 0.068, theta: 0, h: -0.0035, ws: 0.0028, wt: 0.3 }, // bouche
    { s: 0.074, theta: 0, h: 0.003, ws: 0.005, wt: 0.27 }, // lèvres
    { s: 0.061, theta: 0, h: 0.003, ws: 0.005, wt: 0.24 },
    { s: 0.033, theta: 0, h: 0.008, ws: 0.014, wt: 0.38 }, // menton
    { s: 0.045, theta: 1.3, h: 0.006, ws: 0.02, wt: 0.3 }, // angle de la mâchoire
    { s: 0.045, theta: -1.3, h: 0.006, ws: 0.02, wt: 0.3 },
    { s: 0.12, theta: Math.PI, h: 0.006, ws: 0.03, wt: 0.6 }, // occiput
  ],
};
const headSection = sectionOf(HEAD);
/** La tête est décalée vers l'avant de l'axe du cou, surtout au menton. */
const headCenter = keys([[0, 0.034], [0.05, 0.025], [0.1, 0.01], [0.2, 0]]);

function head(b: MeshBuilder, pose: Pose) {
  const F = headFrame(pose);
  const headBone = bone('head');
  const path = polyline([F.origin, F.origin.clone().addScaledVector(F.axis, HEAD_LEN)]);
  const centered = (s: number, th: number): SectionPoint => {
    const [a, bb] = headSection(s, th);
    return [a + headCenter(s), bb];
  };
  // Cheveux sous le casque : nuque et tempes ; la peau partout ailleurs.
  const hairline = (th: number) => lerp(0.16, 0.085, Math.abs(angleDiff(th, 0)) / Math.PI);
  b.sweep({
    path,
    ds: 0.006,
    radial: 48,
    front: F.face,
    section: centered,
    region: (s, th) => (s > hairline(th) && Math.abs(th) > 1.05 ? REGION.hair : REGION.skin),
    skin: rigid(headBone),
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Oreilles.
  for (const side of [1, -1]) {
    const c = F.origin.clone().addScaledVector(F.axis, 0.115).addScaledVector(F.side, side * 0.07).addScaledVector(F.face, -0.006);
    const ear = polyline([c.clone().addScaledVector(F.axis, -0.028), c.clone().addScaledVector(F.axis, 0.03)]);
    b.sweep({
      path: ear,
      ds: 0.007,
      radial: 14,
      front: F.face,
      section: (s, th) => {
        const k = roundEnds(s, 0, ear.length, 0.02, 0.025);
        return oval(th, 0.016 * k, 0.012 * k, 0.007 * k, 0.003 * k, 2.4);
      },
      region: REGION.skin,
      skin: rigid(headBone),
      capStart: 'pole',
      capEnd: 'pole',
    });
  }
  // Cou : de l'intérieur du buste à l'intérieur de la tête.
  const neckBase = vec(pose.joints.neckBase);
  const chestDir = neckBase.clone().sub(vec(pose.joints.thorax)).normalize();
  const headBase = vec(pose.joints.headBase);
  const neckStart = neckBase.clone().addScaledVector(chestDir, -0.05);
  const neckPath = polyline([neckStart, neckBase, headBase, headBase.clone().addScaledVector(F.axis, 0.03)], 0.03);
  const sn = neckStart.distanceTo(neckBase);
  const neckSkin = chainSkin([bone('chest'), bone('neck'), headBone], [{ s: sn, w: 0.03 }, { s: sn + DEFAULT_BODY.neck, w: 0.03 }]);
  const neckFront = vec(pose.bases.neck.z);
  const neckSection = (s: number, th: number): SectionPoint => {
    const t = (s - sn) / DEFAULT_BODY.neck;
    return inflate(oval(th, lerp(0.06, 0.05, t), lerp(0.066, 0.056, t), 0.054, 0.054), th, bumps([{ s: sn + 0.02, theta: 0, h: 0.006, ws: 0.02, wt: 0.25 }], s, th));
  };
  b.sweep({ path: neckPath, ds: 0.01, radial: 28, front: neckFront, section: neckSection, region: REGION.skin, skin: (s) => neckSkin(s) });
  // Col du maillot.
  const collar = garment(neckSection, 0.005, sn - 0.02, sn + 0.022, { end: true });
  b.sweep({
    path: neckPath,
    s0: sn - 0.02,
    s1: sn + 0.022,
    ds: 0.008,
    radial: 28,
    front: neckFront,
    sCuts: collar.cuts,
    section: collar.section,
    region: REGION.jerseyAlt,
    skin: (s) => neckSkin(s),
  });
  helmet(b, F, headBone);
  glasses(b, F, headBone);
}

function helmet(b: MeshBuilder, F: ReturnType<typeof headFrame>, headBone: number) {
  const S0 = 0.075;
  const S1 = HEAD_LEN + 0.022;
  // Bord du casque : haut sur le front, bas sur la nuque.
  const rim = (th: number) => {
    const back = Math.abs(angleDiff(th, 0)) / Math.PI;
    return lerp(0.148, 0.082, smooth(0.15, 1, back));
  };
  const clearance = (th: number, t: number) => {
    const back = Math.abs(angleDiff(th, 0)) / Math.PI;
    return lerp(0.015, 0.032, smooth(0.55, 1, back) * (1 - t) ** 0.6) + 0.004;
  };
  const vents: { t0: number; t1: number; th: number; w: number }[] = [
    { t0: 0.2, t1: 0.62, th: 0.24, w: 0.1 },
    { t0: 0.2, t1: 0.62, th: -0.24, w: 0.1 },
    { t0: 0.18, t1: 0.55, th: 0.72, w: 0.13 },
    { t0: 0.18, t1: 0.55, th: -0.72, w: 0.13 },
    { t0: 0.22, t1: 0.6, th: Math.PI - 0.32, w: 0.14 },
    { t0: 0.22, t1: 0.6, th: -Math.PI + 0.32, w: 0.14 },
  ];
  const inVent = (t: number, th: number) => vents.some((v) => t > v.t0 && t < v.t1 && Math.abs(angleDiff(th, v.th)) < v.w);
  const LIP = 0.006;
  const path = polyline([F.origin.clone().addScaledVector(F.axis, S0 - LIP), F.origin.clone().addScaledVector(F.axis, S1)]);
  const sToT = (s: number) => (s - S0) / (S1 - S0);
  b.sweep({
    path,
    ds: 0.007,
    radial: 52,
    front: F.face,
    sCuts: [LIP, ...vents.flatMap((v) => [v.t0, v.t1]).map((t) => LIP + t * (S1 - S0))],
    thetaCuts: vents.flatMap((v) => [v.th - v.w, v.th + v.w]),
    section: (s, th) => {
      const t = sToT(s + S0 - LIP);
      const lip = t < 0;
      const tt = Math.max(0, t);
      // Coque = surface de la tête décalée : vers l'extérieur sur les flancs, vers le haut au sommet.
      const axial = lerp(rim(th), HEAD_LEN, tt ** 1.1);
      const [a, bb] = headSection(axial, th);
      const off = (lip ? 0.003 : clearance(th, tt) - (inVent(tt, th) ? 0.005 : 0)) * (1 - tt ** 6);
      const lift = 0.022 * tt ** 2;
      return [a + headCenter(axial) + Math.cos(th) * off, bb + Math.sin(th) * off, axial + lift - (s + S0 - LIP)];
    },
    region: (s, th) => {
      const t = sToT(s + S0 - LIP);
      if (t < 0 || inVent(t, th)) return REGION.liner;
      if (Math.abs(th) < 0.11 && t > 0.05) return REGION.helmetAlt;
      return REGION.helmet;
    },
    skin: rigid(headBone),
    capEnd: 'pole',
  });
  // Sangles : du bord du casque, devant l'oreille, jusque sous le menton.
  for (const side of [1, -1]) {
    const p = (s: number, th: number, extra: number) => {
      const [a, bb] = headSection(s, th);
      return F.origin.clone().addScaledVector(F.face, a + headCenter(s) + Math.cos(th) * extra).addScaledVector(F.side, bb + Math.sin(th) * extra).addScaledVector(F.axis, s);
    };
    // Sangle en Y : une branche devant l'oreille, une derrière, réunies sous l'oreille, puis le long de la mâchoire.
    const junction = p(0.068, side * 1.5, 0.007);
    const branches = [
      [p(0.132, side * 1.22, 0.014), p(0.1, side * 1.32, 0.008), junction],
      [p(0.1, side * 1.95, 0.016), p(0.085, side * 1.75, 0.009), junction],
      [junction, p(0.035, side * 1.15, 0.007), p(0.008, side * 0.5, 0.006), p(0.002, 0, 0.006)],
    ];
    for (const pts of branches) {
      b.sweep({
        path: polyline(pts, 0.01),
        ds: 0.012,
        radial: 6,
        front: F.face,
        section: (_s, th) => oval(th, 0.0015, 0.0015, 0.0055, 0.0055, 6),
        region: REGION.liner,
        skin: rigid(headBone),
      });
    }
  }
}

function glasses(b: MeshBuilder, F: ReturnType<typeof headFrame>, headBone: number) {
  const S = 0.123;
  const span = 1.3;
  const at = (th: number, extra: number) => {
    const [a, bb] = headSection(S, th);
    return F.origin.clone().addScaledVector(F.face, a + headCenter(S) + Math.cos(th) * extra).addScaledVector(F.side, bb + Math.sin(th) * extra).addScaledVector(F.axis, S);
  };
  const standoff = (th: number) => 0.009 + 0.008 * Math.exp(-((th / 0.12) ** 2)); // plus loin devant le nez
  const lens = curve((t) => {
    const th = -span + 2 * span * t;
    return at(th, standoff(th));
  }, 60);
  const L = lens.length;
  const start = at(-span, standoff(-span));
  const radial = start.clone().sub(F.origin.clone().addScaledVector(F.axis, S)).normalize();
  // Le long d'un arc autour de la tête, le côté de la section (avant × tangente) pointe vers le bas de la tête :
  // `upSign` remet la hauteur dans le bon sens.
  const upSign = -1;
  const height = (t: number) => {
    const th = -span + 2 * span * t;
    const nose = Math.exp(-((th / 0.16) ** 2));
    return { top: 0.018 + 0.003 * Math.cos(th), bottom: -0.021 + 0.012 * nose + 0.006 * smooth(0.9, 1.3, Math.abs(th)) };
  };
  b.sweep({
    path: lens,
    ds: L / 56,
    radial: 12,
    front: radial,
    thetaCuts: [Math.asin(0.82), Math.PI - Math.asin(0.82)],
    section: (s, th) => {
      const t = s / L;
      const h = height(t);
      const k = roundEnds(s, 0, L, 0.006);
      const mid = (h.top + h.bottom) / 2;
      const half = ((h.top - h.bottom) / 2) * Math.max(k, 0.3);
      const [a, bb] = oval(th, 0.0016, 0.0016, half, half, 6);
      return [a, upSign * (mid + bb)];
    },
    region: (_s, th) => (Math.sin(th) > 0.82 ? REGION.eyewear : REGION.lens),
    skin: rigid(headBone),
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Branches vers les oreilles.
  for (const side of [1, -1]) {
    const th0 = side * span;
    const a = at(th0, standoff(th0) - 0.002).addScaledVector(F.axis, 0.012);
    const z = at(side * 1.95, 0.004).addScaledVector(F.axis, 0.008);
    b.sweep({
      path: polyline([a, z]),
      ds: 0.03,
      radial: 6,
      front: F.axis,
      section: (_s, th) => oval(th, 0.004, 0.004, 0.0016, 0.0016, 4),
      region: REGION.eyewear,
      skin: rigid(headBone),
      capEnd: 'pole',
    });
  }
}

/* ---------- Squelette et écriture ---------- */

export async function buildAvatar(out: string) {
  const torsoAngle = solveTorsoAngle(BIKE_FIT);
  const pose = solvePose(BIKE_FIT, BIND_CRANK, torsoAngle);
  const b = new MeshBuilder();
  torso(b, pose);
  legs(b, pose);
  arms(b, pose);
  head(b, pose);

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
  return { triangles: b.triangleCount, bytes: glb.byteLength, torsoAngleDeg: (torsoAngle * 180) / Math.PI, pose };
}
