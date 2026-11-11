/**
 * Vélo de route aéro, taille M : géométrie réelle (angles, empattement, boîtier de pédalier), cadre en tubes
 * profilés, roues hautes à bandeau, freins à disque, transmission complète, cintre route avec cocottes.
 */
import { Vector3 } from 'three';
import { BIKE_NODE, REGION } from '../../src/render/asset-contract.ts';
import type { BikeFit } from '../../src/render/rider-pose.ts';
import { GlbWriter } from './gltf.ts';
import { circle, curve, keys, loop, MeshBuilder, oval, polyline, roundEnds, smooth, type SectionPoint } from './mesh.ts';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const X = V(1, 0, 0);
const Y = V(0, 1, 0);
const Z = V(0, 0, 1);

/* ---------- Géométrie (m) ---------- */

const TIRE_R = 0.34; // rayon extérieur du pneu
const BB = V(0, 0.27, 0);
const REAR_AXLE = V(0, TIRE_R, -0.405);
const FRONT_AXLE = V(0, TIRE_R, 0.585);
const SEAT_DIR = V(0, Math.sin((73.5 * Math.PI) / 180), -Math.cos((73.5 * Math.PI) / 180));
const STEER_UP = V(0, Math.sin((73 * Math.PI) / 180), -Math.cos((73 * Math.PI) / 180));
/** Perpendiculaire au tube de direction, vers l'avant. */
const STEER_FWD = V(0, -STEER_UP.z, STEER_UP.y);
const HEAD_TOP = V(0, 0.82, 0.385);
const HEAD_BOTTOM = HEAD_TOP.clone().addScaledVector(STEER_UP, -0.15);
const SEAT_CLUSTER = BB.clone().addScaledVector(SEAT_DIR, 0.5);
const SADDLE_CLAMP = BB.clone().addScaledVector(SEAT_DIR, 0.69);
const CRANK = 0.1725;
const PEDAL_X = 0.1;
const STEM_BASE = HEAD_TOP.clone().addScaledVector(STEER_UP, 0.04);
const BAR_CENTER = STEM_BASE.clone().add(V(0, -0.01, 0.11));
const HOOD_X = 0.205;

export const BIKE_FIT: BikeFit = {
  saddle: { x: 0, y: SADDLE_CLAMP.y + 0.035, z: SADDLE_CLAMP.z - 0.07 },
  hoodL: { x: HOOD_X, y: 0.892, z: 0.588 },
  hoodR: { x: -HOOD_X, y: 0.892, z: 0.588 },
  bb: { x: BB.x, y: BB.y, z: BB.z },
  crankLength: CRANK,
  pedalHalfWidth: PEDAL_X,
};

/* ---------- Profils ---------- */

/** Profil d'aile tronqué (Kamm) : bord d'attaque rond devant, queue coupée derrière. */
function airfoil(th: number, front: number, back: number, half: number): SectionPoint {
  const [a, b] = oval(th, front, back, half, half, 2.2);
  return [Math.max(a, -back * 0.8), b];
}

/** Perpendiculaire à `dir` dans le plan du vélo, orientée vers l'avant. */
function forwardPerp(dir: Vector3): Vector3 {
  const p = V(0, dir.z, -dir.y).normalize();
  return p.z < 0 ? p.negate() : p;
}

interface TubeOpts {
  front?: Vector3;
  region: number | ((s: number, th: number) => number);
  section: (t: number, th: number) => SectionPoint;
  ds?: number;
  radial?: number;
  caps?: 'pole' | 'flat' | 'open';
  sCuts?: number[];
  thetaCuts?: number[];
  mirror?: 1 | -1;
}

/** Tube droit ou coudé ; la section reçoit la position relative `t` ∈ [0, 1]. */
function tube(b: MeshBuilder, points: Vector3[], o: TubeOpts) {
  const path = polyline(points, 0.03);
  const len = path.length;
  const dir = points[points.length - 1]!.clone().sub(points[0]!).normalize();
  b.sweep({
    path,
    ds: o.ds ?? 0.02,
    radial: o.radial ?? 16,
    front: o.front ?? forwardPerp(dir),
    mirror: o.mirror,
    sCuts: o.sCuts?.map((t) => t * len),
    thetaCuts: o.thetaCuts,
    section: (s, th) => o.section(s / len, th),
    region: typeof o.region === 'number' ? o.region : (s, th) => (o.region as (s: number, th: number) => number)(s / len, th),
    capStart: o.caps ?? 'flat',
    capEnd: o.caps ?? 'flat',
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------- Cadre, fourche, poste de pilotage, selle ---------- */

function frame(): MeshBuilder {
  const b = new MeshBuilder();

  // Tube de direction : gros profil, couleur d'accent.
  tube(b, [HEAD_TOP.clone().addScaledVector(STEER_UP, 0.012), HEAD_BOTTOM.clone().addScaledVector(STEER_UP, -0.012)], {
    front: STEER_FWD,
    region: REGION.frameAlt,
    section: (_t, th) => airfoil(th, 0.024, 0.042, 0.021),
    ds: 0.02,
    radial: 22,
  });
  // Tube horizontal, légèrement plongeant, avec une bande d'accent vers l'arrière.
  tube(b, [V(0, 0.797, 0.39), SEAT_CLUSTER.clone().add(V(0, 0.006, 0))], {
    front: Y,
    region: (t) => (t > 0.78 && t < 0.86 ? REGION.frameAlt : REGION.frame),
    sCuts: [0.78, 0.86],
    section: (t, th) => oval(th, lerp(0.02, 0.016, t), lerp(0.018, 0.015, t), lerp(0.017, 0.014, t), lerp(0.017, 0.014, t), 2.4),
    ds: 0.03,
    radial: 18,
    caps: 'open',
  });
  // Tube diagonal : profil d'aile large, bande décor au milieu.
  const dtA = HEAD_BOTTOM.clone().add(V(0, 0.03, -0.012));
  const dtB = BB.clone().add(V(0, 0.012, 0.012));
  tube(b, [dtA, dtB], {
    region: (t, th) => (t > 0.3 && t < 0.62 && Math.abs(Math.abs(th) - Math.PI / 2) < 0.75 ? REGION.decal : REGION.frame),
    sCuts: [0.3, 0.62],
    thetaCuts: [Math.PI / 2 - 0.75, Math.PI / 2 + 0.75, -Math.PI / 2 - 0.75, -Math.PI / 2 + 0.75],
    section: (t, th) => airfoil(th, lerp(0.022, 0.026, t), lerp(0.03, 0.03, t), lerp(0.021, 0.027, t)),
    ds: 0.03,
    radial: 22,
    caps: 'open',
  });
  // Tube de selle profilé, puis tige de selle en carbone.
  tube(b, [BB.clone().addScaledVector(SEAT_DIR, 0.02), SEAT_CLUSTER.clone().addScaledVector(SEAT_DIR, 0.015)], {
    region: REGION.frame,
    section: (_t, th) => airfoil(th, 0.019, 0.026, 0.017),
    ds: 0.03,
    radial: 18,
    caps: 'open',
  });
  tube(b, [SEAT_CLUSTER, SADDLE_CLAMP.clone().addScaledVector(SEAT_DIR, -0.01)], {
    region: (t) => (t < 0.08 ? REGION.frameAlt : REGION.carbon),
    sCuts: [0.08],
    section: (_t, th) => airfoil(th, 0.014, 0.022, 0.0125),
    ds: 0.03,
    radial: 16,
    caps: 'flat',
  });
  // Boîtier de pédalier.
  tube(b, [V(0.044, BB.y, BB.z), V(-0.044, BB.y, BB.z)], {
    front: Z,
    region: REGION.frame,
    section: (t, th) => oval(th, 0.026, 0.026, 0.026, 0.026, 2).map((v) => v * roundEnds(t, 0, 1, 0.1)) as SectionPoint,
    ds: 0.02,
    radial: 20,
    caps: 'pole',
  });

  // Haubans et bases, par paires.
  for (const side of [1, -1]) {
    const cs0 = V(side * 0.03, BB.y + 0.005, BB.z - 0.035);
    const cs1 = V(side * 0.062, REAR_AXLE.y, REAR_AXLE.z + 0.012);
    tube(b, [cs0, cs1], {
      front: Y,
      region: REGION.frame,
      section: (t, th) => oval(th, lerp(0.016, 0.009, t), lerp(0.013, 0.008, t), lerp(0.01, 0.007, t), lerp(0.01, 0.007, t), 2.3),
      ds: 0.04,
      radial: 14,
      caps: 'open',
    });
    const ss0 = BB.clone().addScaledVector(SEAT_DIR, 0.43).add(V(side * 0.012, 0, 0));
    const ss1 = V(side * 0.062, REAR_AXLE.y + 0.012, REAR_AXLE.z + 0.008);
    tube(b, [ss0, ss1], {
      region: REGION.frame,
      section: (t, th) => airfoil(th, lerp(0.009, 0.007, t), lerp(0.013, 0.009, t), lerp(0.0085, 0.0065, t)),
      ds: 0.04,
      radial: 14,
      caps: 'open',
    });
    // Pattes arrière.
    tube(b, [V(side * 0.064, REAR_AXLE.y + 0.02, REAR_AXLE.z + 0.02), V(side * 0.064, REAR_AXLE.y - 0.008, REAR_AXLE.z - 0.004)], {
      front: Z,
      region: REGION.frameAlt,
      section: (t, th) => oval(th, 0.016, 0.016, 0.005, 0.005, 3).map((v) => v * roundEnds(t, 0, 1, 0.25)) as SectionPoint,
      ds: 0.01,
      radial: 12,
      caps: 'pole',
    });
  }

  // Fourche : tête large, fourreaux profilés et cintrés vers l'avant (déport).
  tube(b, [HEAD_BOTTOM.clone().add(V(0.058, -0.012, 0.004)), HEAD_BOTTOM.clone().add(V(-0.058, -0.012, 0.004))], {
    front: STEER_FWD,
    region: REGION.carbon,
    section: (t, th) => airfoil(th, 0.024, 0.04, 0.026).map((v) => v * roundEnds(t, 0, 1, 0.12)) as SectionPoint,
    ds: 0.012,
    radial: 18,
    caps: 'pole',
  });
  for (const side of [1, -1]) {
    const top = HEAD_BOTTOM.clone().add(V(side * 0.048, -0.02, 0.006));
    const bladePath = curve((t) => {
      const p = top.clone().lerp(V(side * 0.05, FRONT_AXLE.y + 0.004, FRONT_AXLE.z), t);
      p.z += Math.sin(t * Math.PI) * 0.006 + t * t * 0.0; // léger galbe
      return p;
    }, 24);
    b.sweep({
      path: bladePath,
      ds: 0.03,
      radial: 14,
      front: STEER_FWD,
      section: (s, th) => {
        const t = s / bladePath.length;
        return airfoil(th, lerp(0.013, 0.008, t), lerp(0.022, 0.012, t), lerp(0.011, 0.0065, t));
      },
      region: REGION.carbon,
      capStart: 'open',
      capEnd: 'pole',
    });
  }

  // Bidon et porte-bidon sur le tube diagonal.
  const dt = dtB.clone().sub(dtA).normalize();
  const dtUp = forwardPerp(dt).negate();
  const bottleA = dtA.clone().lerp(dtB, 0.3).addScaledVector(dtUp, 0.052);
  const bottleB = bottleA.clone().addScaledVector(dt, 0.2);
  tube(b, [bottleA, bottleB], {
    front: dtUp,
    region: (t) => (t < 0.12 ? REGION.frame : t > 0.55 && t < 0.62 ? REGION.frameAlt : REGION.decal),
    sCuts: [0.12, 0.55, 0.62],
    section: (t, th) => {
      const r = keys([[0, 0.012], [0.08, 0.016], [0.12, 0.033], [0.9, 0.034], [1, 0.031]])(t);
      return oval(th, r, r, r, r, 2).map((v) => v * roundEnds(t, 0, 1, 0.0, 0.03)) as SectionPoint;
    },
    ds: 0.02,
    radial: 18,
    caps: 'pole',
  });

  // Potence, entretoises, cintre.
  tube(b, [HEAD_TOP.clone().addScaledVector(STEER_UP, 0.01), STEM_BASE.clone().addScaledVector(STEER_UP, 0.012)], {
    front: STEER_FWD,
    region: REGION.carbon,
    section: (_t, th) => airfoil(th, 0.02, 0.03, 0.018),
    ds: 0.01,
    radial: 18,
  });
  tube(b, [STEM_BASE.clone().add(V(0, 0, -0.015)), BAR_CENTER.clone().add(V(0, 0, 0.012))], {
    front: Y,
    region: REGION.carbon,
    section: (_t, th) => oval(th, 0.019, 0.017, 0.016, 0.016, 3.2),
    ds: 0.02,
    radial: 18,
  });
  bar(b);
  for (const side of [1, -1] as const) hood(b, side);
  saddle(b);
  derailleurs(b);
  chain(b);
  return b;
}

/** Cintre complet d'une extrémité de cintre à l'autre : dessus aplati en carbone, cocottes et cintre guidoliné. */
function bar(b: MeshBuilder) {
  const drop = (side: number) =>
    [
      V(side * 0.199, 0.728, 0.47),
      V(side * 0.203, 0.727, 0.53),
      V(side * 0.205, 0.735, 0.578),
      V(side * 0.206, 0.76, 0.61),
      V(side * 0.206, 0.798, 0.622),
      V(side * 0.205, 0.835, 0.603),
      V(side * 0.203, 0.85, 0.565),
      V(side * 0.198, 0.85, 0.52),
      V(side * 0.18, BAR_CENTER.y, BAR_CENTER.z + 0.006),
    ];
  const left = drop(1);
  const right = drop(-1).reverse();
  const pts = [...left, ...right];
  const path = polyline(pts, 0.02);
  // Abscisses des deux coins du dessus de cintre.
  let acc = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((acc += pts[i]!.distanceTo(pts[i - 1]!)));
  const topA = cum[left.length - 1]!;
  const topB = cum[left.length]!;
  const flat = (s: number) => smooth(topA - 0.03, topA + 0.01, s) * (1 - smooth(topB - 0.01, topB + 0.03, s));
  b.sweep({
    path,
    ds: 0.012,
    radial: 14,
    front: Y,
    sCuts: [topA - 0.035, topB + 0.035],
    section: (s, th) => {
      const k = flat(s);
      // Sur le dessus, la section s'aplatit en aile (corde le long du vélo, épaisseur verticale).
      return oval(th, lerp(0.0118, 0.0075, k), lerp(0.0118, 0.0075, k), lerp(0.0118, 0.02, k), lerp(0.0118, 0.016, k), lerp(2, 2.4, k));
    },
    region: (s) => (s > topA - 0.035 && s < topB + 0.035 ? REGION.carbon : REGION.tape),
    capStart: 'flat',
    capEnd: 'flat',
  });
}

function hood(b: MeshBuilder, side: 1 | -1) {
  const x = side * HOOD_X;
  const body = polyline([V(x, 0.858, 0.55), V(x, 0.874, 0.592), V(x, 0.879, 0.625), V(x, 0.872, 0.643)], 0.015);
  const L = body.length;
  b.sweep({
    path: body,
    ds: 0.006,
    radial: 16,
    front: Y,
    section: (s, th) => {
      const t = s / L;
      const k = roundEnds(s, 0, L, 0.008, 0.012);
      const up = keys([[0, 0.016], [0.5, 0.02], [0.82, 0.026], [1, 0.02]])(t);
      const half = keys([[0, 0.0145], [0.6, 0.0135], [1, 0.011]])(t);
      return oval(th, up * k, 0.018 * k, half * k, half * k, 2.6);
    },
    region: REGION.rubber,
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Levier de frein et de vitesses.
  const lever = polyline([V(x, 0.862, 0.632), V(x, 0.84, 0.646), V(x, 0.79, 0.641), V(x * 1.01, 0.748, 0.618)], 0.02);
  b.sweep({
    path: lever,
    ds: 0.01,
    radial: 10,
    front: Z,
    section: (s, th) => oval(th, 0.0045, 0.0045, 0.008, 0.008, 2.4).map((v) => v * roundEnds(s, 0, lever.length, 0, 0.006)) as SectionPoint,
    region: REGION.carbon,
    capStart: 'open',
    capEnd: 'pole',
  });
}

function saddle(b: MeshBuilder) {
  const top = SADDLE_CLAMP.y + 0.035;
  const path = polyline([V(0, top - 0.004, -0.06), V(0, top - 0.012, -0.335)]);
  const L = path.length;
  const width = keys([[0, 0.012], [0.25, 0.022], [0.55, 0.06], [0.78, 0.072], [1, 0.06]]);
  b.sweep({
    path,
    ds: 0.008,
    radial: 20,
    front: Y,
    sCuts: [0.84 * L],
    section: (s, th) => {
      const t = s / L;
      const k = roundEnds(s, 0, L, 0.012, 0.02);
      const w = width(t);
      return oval(th, 0.012 * k, 0.013 * k, w * k, w * k, 3.2);
    },
    region: (s, th) => (s / L > 0.84 && Math.cos(th) > -0.2 ? REGION.frame : REGION.saddle),
    thetaCuts: [Math.acos(-0.2), -Math.acos(-0.2)],
    capStart: 'pole',
    capEnd: 'pole',
  });
  // Rails et chariot de serrage.
  for (const side of [1, -1]) {
    tube(b, [V(side * 0.004, top - 0.012, -0.085), V(side * 0.022, top - 0.03, -0.17), V(side * 0.03, top - 0.028, -0.29)], {
      front: Y,
      region: REGION.alloy,
      section: (_t, th) => oval(th, 0.0035, 0.0035, 0.0035, 0.0035),
      ds: 0.03,
      radial: 8,
      caps: 'open',
    });
  }
  tube(b, [SADDLE_CLAMP.clone().add(V(0.034, 0.002, 0)), SADDLE_CLAMP.clone().add(V(-0.034, 0.002, 0))], {
    front: Y,
    region: REGION.carbon,
    section: (t, th) => oval(th, 0.012, 0.012, 0.016, 0.016, 3).map((v) => v * roundEnds(t, 0, 1, 0.12)) as SectionPoint,
    ds: 0.01,
    radial: 14,
    caps: 'pole',
  });
}

function derailleurs(b: MeshBuilder) {
  // Dérailleur avant, côté droit, sur le tube de selle.
  const fd = BB.clone().addScaledVector(SEAT_DIR, 0.155);
  tube(b, [fd.clone().add(V(-0.012, 0, 0.02)), fd.clone().add(V(-0.078, -0.012, 0.035))], {
    front: Z,
    region: REGION.carbon,
    section: (t, th) => oval(th, 0.03, 0.03, 0.009, 0.009, 4).map((v) => v * roundEnds(t, 0, 1, 0.12)) as SectionPoint,
    ds: 0.012,
    radial: 14,
    caps: 'pole',
  });
  // Dérailleur arrière : corps, chape et galets.
  const x = -0.074;
  const hanger = V(-0.066, REAR_AXLE.y - 0.025, REAR_AXLE.z - 0.005);
  tube(b, [hanger, V(x, REAR_AXLE.y - 0.06, REAR_AXLE.z - 0.035), V(x, REAR_AXLE.y - 0.075, REAR_AXLE.z - 0.012)], {
    front: X,
    region: REGION.carbon,
    section: (t, th) => oval(th, 0.009, 0.009, 0.013, 0.013, 3).map((v) => v * roundEnds(t, 0, 1, 0.06)) as SectionPoint,
    ds: 0.012,
    radial: 12,
    caps: 'pole',
  });
  for (const [y, z] of PULLEYS) {
    tube(b, [V(x - 0.004, y, z), V(x + 0.004, y, z)], {
      front: Z,
      region: REGION.alloy,
      section: (_t, th) => oval(th, 0.016, 0.016, 0.016, 0.016),
      ds: 0.01,
      radial: 18,
    });
  }
  const [[ya, za], [yb, zb]] = PULLEYS;
  tube(b, [V(x - 0.008, ya + 0.004, za), V(x - 0.008, yb - 0.004, zb)], {
    front: X,
    region: REGION.carbon,
    section: (t, th) => oval(th, 0.002, 0.002, 0.016, 0.016, 4).map((v) => v * roundEnds(t, 0, 1, 0.15)) as SectionPoint,
    ds: 0.01,
    radial: 12,
    caps: 'pole',
  });
}

const PULLEYS: [number, number][] = [
  [REAR_AXLE.y - 0.072, REAR_AXLE.z - 0.012],
  [REAR_AXLE.y - 0.14, REAR_AXLE.z + 0.002],
];
const RING_OUTER_R = 0.104;
const COG_R = 0.034;
const CHAIN_X = -0.072;

/** Chaîne : boucle plateau, pignon, galets ; maillons en alternance de couleur, au pas d'un demi-pouce. */
function chain(b: MeshBuilder) {
  const arc = (c: Vector3, r: number, a0: number, a1: number, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return V(CHAIN_X, c.y + r * Math.cos(a), c.z + r * Math.sin(a));
    });
  const [[ya, za], [yb, zb]] = PULLEYS;
  const pts = [
    ...arc(BB, RING_OUTER_R, 0, Math.PI * 0.95, 14), // demi-tour avant du plateau, de haut en bas
    V(CHAIN_X, yb - 0.018, zb + 0.004), // vers le galet inférieur
    ...arc(V(0, yb, zb), 0.018, Math.PI, Math.PI * 1.5, 4),
    ...arc(V(0, ya, za), 0.018, Math.PI * 0.5, 0, 4).slice(1), // remonte vers le galet supérieur
    ...arc(REAR_AXLE, COG_R, Math.PI * 1.15, Math.PI * 2, 8), // enroule le pignon par l'arrière
  ];
  const path = loop(pts, 0.006);
  const pitch = 0.0127 / 2;
  const cuts: number[] = [];
  for (let s = pitch; s < path.length; s += pitch) cuts.push(s);
  b.sweep({
    path,
    ds: pitch,
    sCuts: cuts,
    radial: 6,
    front: Y,
    section: (_s, th) => oval(th, 0.0042, 0.0042, 0.0036, 0.0036, 5),
    region: (s) => (Math.floor(s / pitch) % 2 === 0 ? REGION.chain : REGION.steel),
  });
}

/* ---------- Roues (repère local : moyeu à l'origine, axe X) ---------- */

function wheel(rear: boolean): MeshBuilder {
  const b = new MeshBuilder();
  const O = V(0, 0, 0);
  // Pneu.
  const tireC = TIRE_R - 0.0135;
  b.sweep({
    path: circle(O, X, Y, tireC),
    ds: (2 * Math.PI * tireC) / 88,
    radial: 12,
    front: Y,
    section: (_s, th) => oval(th, 0.0135, 0.012, 0.0125, 0.0125, 2.2),
    region: REGION.rubber,
  });
  // Jante haute (50 mm) : profil en U arrondi, bandeau clair et marquage en blocs sur les flancs.
  const rimC = 0.29;
  const L = 2 * Math.PI * rimC;
  const halfW = keys([[-0.025, 0.006], [-0.012, 0.011], [0.008, 0.0138], [0.025, 0.0108]]);
  const band = (c: number) => c > 0.4 && c < 0.56;
  const blocks: [number, number][] = [];
  for (const start of [0.08, 0.58]) for (let k = 0; k < 5; k++) blocks.push([(start + k * 0.033) * L, (start + k * 0.033 + 0.027) * L]);
  const logo = (s: number, c: number) => c > -0.42 && c < 0.24 && blocks.some(([a, z]) => s >= a && s <= z);
  const thetaFor = (c: number) => Math.acos(c);
  b.sweep({
    path: circle(O, X, Y, rimC),
    ds: L / 120,
    sCuts: blocks.flat(),
    radial: 16,
    thetaCuts: [0.4, 0.56, -0.42, 0.24].flatMap((c) => [thetaFor(c), -thetaFor(c)]),
    front: Y,
    section: (_s, th) => {
      const c = Math.cos(th);
      const a = 0.025 * c;
      return [a, halfW(a) * Math.sign(Math.sin(th)) * Math.pow(Math.abs(Math.sin(th)), 0.7)];
    },
    region: (s, th) => {
      const c = Math.cos(th);
      return band(c) || logo(s, c) ? REGION.decal : REGION.carbon;
    },
  });
  // Moyeu.
  const hubLen = rear ? 0.072 : 0.05;
  const hub = keys([[0, 0.009], [0.08, 0.016], [0.16, 0.024], [0.22, 0.016], [0.78, 0.016], [0.84, 0.024], [0.92, 0.016], [1, 0.009]]);
  tube(b, [V(hubLen, 0, 0), V(-hubLen, 0, 0)], {
    front: Y,
    region: REGION.carbon,
    section: (t, th) => {
      const r = hub(t);
      return oval(th, r, r, r, r);
    },
    ds: 0.006,
    radial: 16,
  });
  // Rayons droits, alternés d'un flasque à l'autre.
  const n = rear ? 24 : 20;
  const flange = hubLen * 0.68;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const side = i % 2 === 0 ? 1 : -1;
    const dir = V(0, Math.cos(a), Math.sin(a));
    const tangentialOffset = V(0, -Math.sin(a), Math.cos(a)).multiplyScalar(side * 0.008);
    tube(b, [dir.clone().multiplyScalar(0.022).add(V(side * flange, 0, 0)).add(tangentialOffset), dir.clone().multiplyScalar(0.266).add(V(side * 0.002, 0, 0))], {
      front: X,
      region: REGION.carbon,
      section: (_t, th) => oval(th, 0.0011, 0.0011, 0.0026, 0.0026),
      ds: 1,
      radial: 6,
      caps: 'open',
    });
  }
  // Disque de frein côté gauche, et son araignée.
  const rotorX = 0.052;
  const rotorC = 0.0775;
  const RL = 2 * Math.PI * rotorC;
  const holes: number[] = [];
  for (let k = 0; k < 18; k++) holes.push(((k + 0.25) / 18) * RL, ((k + 0.62) / 18) * RL);
  b.sweep({
    path: circle(V(rotorX, 0, 0), X, Y, rotorC),
    ds: RL / 72,
    sCuts: holes,
    radial: 8,
    thetaCuts: [Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5],
    front: Y,
    section: (_s, th) => oval(th, 0.0075, 0.0075, 0.001, 0.001, 8),
    region: (s, th) => {
      const k = ((s / RL) * 18) % 1;
      return k > 0.25 && k < 0.62 && Math.abs(Math.cos(th)) < Math.cos(0.5 + 0.0001) ? REGION.carbon : REGION.steel;
    },
  });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const d = V(0, Math.cos(a), Math.sin(a));
    tube(b, [d.clone().multiplyScalar(0.018).add(V(rotorX - 0.002, 0, 0)), d.clone().multiplyScalar(0.072).add(V(rotorX, 0, 0))], {
      front: X,
      region: REGION.alloy,
      section: (t, th) => oval(th, 0.0018, 0.0018, lerp(0.006, 0.004, t), lerp(0.006, 0.004, t), 3),
      ds: 1,
      radial: 8,
      caps: 'open',
    });
  }
  if (rear) cassette(b);
  return b;
}

/** Cassette 11 pignons, côté droit, solidaire de la roue arrière. */
function cassette(b: MeshBuilder) {
  const radii = [0.05, 0.046, 0.042, 0.038, 0.034, 0.031, 0.028, 0.026, 0.024, 0.022, 0.02];
  const x0 = -0.034;
  const step = 0.0034;
  const thick = 0.0018;
  const len = radii.length * step;
  const cuts: number[] = [];
  radii.forEach((_, k) => cuts.push(k * step, k * step + 0.0002, k * step + thick, k * step + thick + 0.0002));
  tube(b, [V(x0, 0, 0), V(x0 - len, 0, 0)], {
    front: Y,
    region: REGION.steel,
    sCuts: cuts.map((c) => c / len),
    section: (t, th) => {
      const s = t * len;
      const k = Math.min(radii.length - 1, Math.floor(s / step));
      const inCog = s - k * step >= 0.0001 && s - k * step <= thick + 0.0001;
      const r = inCog ? radii[k]! : radii[k]! - 0.008;
      return oval(th, r, r, r, r);
    },
    ds: 0.01,
    radial: 28,
  });
}

/* ---------- Pédalier (repère local : axe du pédalier, manivelle gauche vers le haut) ---------- */

function crankset(): MeshBuilder {
  const b = new MeshBuilder();
  const O = V(0, 0, 0);
  // Plateaux 52 et 36 dents : faces noires, denture claire.
  for (const [x, rMid, w, teeth] of [[-0.071, 0.094, 0.022, 52], [-0.064, 0.064, 0.016, 36]] as const) {
    const L = 2 * Math.PI * rMid;
    b.sweep({
      path: circle(V(x, 0, 0), X, Y, rMid),
      ds: L / (teeth * 3),
      radial: 8,
      front: Y,
      thetaCuts: [0.55, -0.55],
      section: (s, th) => {
        const t = ((s / L) * teeth) % 1;
        const tooth = Math.max(0, 1 - Math.abs(t - 0.5) * 2.6);
        const [a, bb] = oval(th, w / 2, w / 2, 0.0019, 0.0019, 8);
        return [a + (Math.cos(th) > 0.5 ? 0.0045 * tooth : 0), bb];
      },
      region: (_s, th) => (Math.abs(th) < 0.55 ? REGION.alloy : REGION.carbon),
    });
  }
  // Araignée à quatre branches.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
    const d = V(0, Math.cos(a), Math.sin(a));
    tube(b, [d.clone().multiplyScalar(0.012).add(V(-0.07, 0, 0)), d.clone().multiplyScalar(0.088).add(V(-0.068, 0, 0))], {
      front: X,
      region: REGION.carbon,
      section: (t, th) => oval(th, 0.004, 0.004, lerp(0.012, 0.007, t), lerp(0.012, 0.007, t), 3),
      ds: 0.03,
      radial: 10,
      caps: 'pole',
    });
  }
  // Axe et manivelles profilées, gauche vers le haut, droite vers le bas.
  tube(b, [V(0.082, 0, 0), V(-0.082, 0, 0)], { front: Y, region: REGION.alloy, section: (_t, th) => oval(th, 0.011, 0.011, 0.011, 0.011), ds: 0.05, radial: 14 });
  for (const side of [1, -1]) {
    const a = V(side * 0.084, 0, 0);
    const z = V(side * 0.09, side * CRANK, 0);
    const arm = polyline([a.clone().add(V(0, -side * 0.012, 0)), z.clone().add(V(0, side * 0.012, 0))]);
    const L = arm.length;
    b.sweep({
      path: arm,
      ds: 0.015,
      radial: 14,
      front: Z,
      section: (s, th) => {
        const t = s / L;
        const k = roundEnds(s, 0, L, 0.014, 0.012);
        return oval(th, lerp(0.02, 0.013, t) * k, lerp(0.02, 0.013, t) * k, lerp(0.011, 0.008, t) * k, lerp(0.011, 0.008, t) * k, 2.4);
      },
      region: REGION.carbon,
      capStart: 'pole',
      capEnd: 'pole',
    });
  }
  return b;
}

/** Pédale automatique (repère local : centre de la pédale ; `side` = 1 à gauche). */
function pedal(side: 1 | -1): MeshBuilder {
  const b = new MeshBuilder();
  tube(b, [V(-side * 0.018, 0, 0), V(side * 0.004, 0, 0)], { front: Y, region: REGION.alloy, section: (_t, th) => oval(th, 0.0065, 0.0065, 0.0065, 0.0065), ds: 0.05, radial: 10 });
  const body = polyline([V(side * 0.004, 0.002, -0.042), V(side * 0.004, 0.004, 0.045)]);
  b.sweep({
    path: body,
    ds: 0.008,
    radial: 14,
    front: Y,
    section: (s, th) => {
      const k = roundEnds(s, 0, body.length, 0.01, 0.012);
      return oval(th, 0.009 * k, 0.007 * k, 0.034 * k, 0.034 * k, 3.5);
    },
    region: (s) => (s > body.length * 0.7 ? REGION.alloy : REGION.carbon),
    sCuts: [body.length * 0.7],
    capStart: 'pole',
    capEnd: 'pole',
  });
  return b;
}

/* ---------- Assemblage ---------- */

export async function buildBike(out: string) {
  const w = new GlbWriter();
  const doc = w.doc;
  const scene = doc.createScene('bike');
  const root = doc.createNode('bike');
  scene.addChild(root);
  const parts: Record<string, number> = {};
  const add = (name: string, mesh: MeshBuilder, translation: Vector3, parent = root) => {
    parts[name] = mesh.triangleCount;
    const node = doc.createNode(name).setMesh(w.mesh(name, mesh)).setTranslation([translation.x, translation.y, translation.z]);
    parent.addChild(node);
    return node;
  };
  add('frame', frame(), V(0, 0, 0));
  add(BIKE_NODE.frontWheel, wheel(false), FRONT_AXLE);
  add(BIKE_NODE.rearWheel, wheel(true), REAR_AXLE);
  const cs = add(BIKE_NODE.crankset, crankset(), BB);
  add(BIKE_NODE.pedalL, pedal(1), V(PEDAL_X, CRANK, 0), cs);
  add(BIKE_NODE.pedalR, pedal(-1), V(-PEDAL_X, -CRANK, 0), cs);
  for (const [name, p] of [[BIKE_NODE.saddle, BIKE_FIT.saddle], [BIKE_NODE.hoodL, BIKE_FIT.hoodL], [BIKE_NODE.hoodR, BIKE_FIT.hoodR]] as const) {
    root.addChild(doc.createNode(name).setTranslation([p.x, p.y, p.z]));
  }
  const glb = await w.write(out);
  return { parts, bytes: glb.byteLength };
}
