/**
 * Construction de maillages par balayage : une section fermée parcourt un chemin. Toutes les pièces (membres,
 * tête, casque, tubes du cadre, jantes, plateaux) en sont faites. Les sections ne sont pas des cercles : la
 * fonction de section reçoit la position le long du chemin et l'angle autour de lui, et rend le point du contour,
 * ce qui permet galbes, méplats et profils d'aile.
 */
import { Quaternion, Vector3 } from 'three';

/** Poids de squelette d'un sommet : jusqu'à 4 os. */
export interface Skin {
  joints: number[];
  weights: number[];
}

/** Point de contour dans le plan de la section : `a` vers l'avant du repère, `b` sur le côté, `c` le long du chemin. */
export type SectionPoint = [a: number, b: number, c?: number];

export interface Path {
  readonly length: number;
  readonly closed: boolean;
  at(s: number, pos: Vector3, tangent: Vector3): void;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Ligne brisée. Près de chaque angle, la tangente tourne progressivement sur `±blend` mètres : les sections
 * pivotent autour de l'articulation, ce qui arrondit l'extérieur du pli (genou, coude).
 */
export function polyline(points: Vector3[], blend = 0.04): Path {
  const cum = [0];
  const dirs: Vector3[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i]!.clone().sub(points[i - 1]!);
    cum.push(cum[i - 1]! + d.length());
    dirs.push(d.normalize());
  }
  const length = cum[cum.length - 1]!;
  return {
    length,
    closed: false,
    at(s, pos, tangent) {
      let k = 0;
      while (k < dirs.length - 1 && s > cum[k + 1]!) k++;
      const t = (s - cum[k]!) / (cum[k + 1]! - cum[k]! || 1);
      pos.copy(points[k]!).lerp(points[k + 1]!, t);
      tangent.copy(dirs[k]!);
      // angle le plus proche : celui qui ouvre ou ferme ce segment
      for (const c of [k, k + 1]) {
        if (c <= 0 || c >= dirs.length) continue;
        const sc = cum[c]!;
        if (Math.abs(s - sc) < blend) {
          const w = smooth(sc - blend, sc + blend, s);
          tangent.copy(dirs[c - 1]!).lerp(dirs[c]!, w).normalize();
        }
      }
    },
  };
}

/** Boucle fermée passant par `points` (chaîne), angles adoucis sur `±blend` mètres. */
export function loop(points: Vector3[], blend = 0.01): Path {
  const pts = [...points, points[0]!];
  const cum = [0];
  const dirs: Vector3[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i]!.clone().sub(pts[i - 1]!);
    cum.push(cum[i - 1]! + d.length());
    dirs.push(d.normalize());
  }
  const length = cum[cum.length - 1]!;
  const n = dirs.length;
  return {
    length,
    closed: true,
    at(s, pos, tangent) {
      s = ((s % length) + length) % length;
      let k = 0;
      while (k < n - 1 && s > cum[k + 1]!) k++;
      const t = (s - cum[k]!) / (cum[k + 1]! - cum[k]! || 1);
      pos.copy(pts[k]!).lerp(pts[k + 1]!, t);
      tangent.copy(dirs[k]!);
      for (const c of [k, k + 1]) {
        const sc = cum[c]!;
        if (Math.abs(s - sc) < blend) {
          const w = smooth(sc - blend, sc + blend, s);
          tangent.copy(dirs[(c - 1 + n) % n]!).lerp(dirs[c % n]!, w).normalize();
        }
      }
    },
  };
}

/** Cercle de rayon `r` centré en `center`, dans le plan normal à `axis`, parcouru à partir de `start`. */
export function circle(center: Vector3, axis: Vector3, start: Vector3, r: number): Path {
  const u = start.clone().normalize();
  const w = axis.clone().normalize().cross(u);
  return {
    length: 2 * Math.PI * r,
    closed: true,
    at(s, pos, tangent) {
      const a = s / r;
      pos.copy(center).addScaledVector(u, r * Math.cos(a)).addScaledVector(w, r * Math.sin(a));
      tangent.copy(u).multiplyScalar(-Math.sin(a)).addScaledVector(w, Math.cos(a));
    },
  };
}

/** Courbe quelconque donnée par une fonction de position ; la tangente est estimée par différence. */
export function curve(fn: (t: number) => Vector3, samples = 200): Path {
  const pts: Vector3[] = [];
  for (let i = 0; i <= samples; i++) pts.push(fn(i / samples));
  return polyline(pts, 0);
}

export interface SweepSpec {
  path: Path;
  s0?: number;
  s1?: number;
  /** Pas entre deux sections, en m. */
  ds: number;
  /** Positions où placer une section exacte (limites de couleur, ourlets). */
  sCuts?: number[];
  /** Points par section. */
  radial: number;
  /** Angles où placer un sommet exact (limites de couleur sur le pourtour). */
  thetaCuts?: number[];
  /** Direction « avant » de la section au départ ; elle suit ensuite le chemin par transport parallèle. */
  front: Vector3;
  /** -1 pour un membre droit : la fonction de section reçoit alors l'angle miroir (π/2 = côté extérieur). */
  mirror?: 1 | -1;
  section: (s: number, theta: number) => SectionPoint;
  region: number | ((s: number, theta: number) => number);
  skin?: (s: number, p: Vector3) => Skin;
  /** Fermeture des extrémités : un sommet central (la section doit s'y réduire), un disque plat, ou rien. */
  capStart?: 'pole' | 'flat' | 'open';
  capEnd?: 'pole' | 'flat' | 'open';
}

const TAU = Math.PI * 2;

function samples(a: number, b: number, step: number, cuts: number[] = [], closed = false): number[] {
  const n = Math.max(1, Math.ceil((b - a) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  for (const c of cuts) if (c > a && c < b) out.push(c);
  out.sort((x, y) => x - y);
  const dedup = out.filter((v, i) => i === 0 || v - out[i - 1]! > 1e-6);
  if (closed) dedup.pop(); // la dernière section rejoint la première
  return dedup;
}

/**
 * Accumule les pièces d'un même maillage. Chaque triangle prend la zone de couleur de son centre ; les sommets
 * sont dédoublés à la frontière de deux zones pour que la couleur change net, tandis que les normales restent
 * celles de la surface continue (pas d'arête d'ombrage le long d'une couture de couleur).
 */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly regions: number[] = [];
  readonly joints: number[] = [];
  readonly weights: number[] = [];
  readonly indices: number[] = [];
  /** Occlusion ambiante par sommet (voir `ao.ts`) ; vide tant qu'elle n'est pas calculée : la pièce est alors dégagée. */
  ao: number[] = [];

  get triangleCount() {
    return this.indices.length / 3;
  }

  /** Ajoute un maillage déjà construit (surface implicite extraite, par exemple). */
  addMesh(vertices: { p: Vector3; n: Vector3; region: number; skin: Skin }[], indices: ArrayLike<number>): this {
    const base = this.positions.length / 3;
    for (const v of vertices) {
      this.positions.push(v.p.x, v.p.y, v.p.z);
      this.normals.push(v.n.x, v.n.y, v.n.z);
      this.regions.push(v.region);
      for (let m = 0; m < 4; m++) {
        this.joints.push(v.skin.joints[m] ?? 0);
        this.weights.push(v.skin.weights[m] ?? 0);
      }
    }
    for (let i = 0; i < indices.length; i++) this.indices.push(base + indices[i]!);
    return this;
  }

  sweep(spec: SweepSpec): this {
    const path = spec.path;
    const s0 = spec.s0 ?? 0;
    const s1 = spec.s1 ?? path.length;
    const mirror = spec.mirror ?? 1;
    const ss = samples(s0, s1, spec.ds, spec.sCuts, path.closed);
    const ths = samples(0, TAU, TAU / spec.radial, (spec.thetaCuts ?? []).map((t) => ((t % TAU) + TAU) % TAU), true);
    const rows = ss.length;
    const cols = ths.length;

    // Repères le long du chemin par transport parallèle.
    const pos = new Vector3();
    const tan = new Vector3();
    const prevTan = new Vector3();
    const front = new Vector3();
    const side = new Vector3();
    const q = new Quaternion();
    const grid: Vector3[] = [];
    // Le repère part toujours du début du chemin : deux couches posées sur le même chemin (peau et vêtement)
    // ont ainsi la même orientation de section, quel que soit l'endroit où chacune commence.
    path.at(0, pos, prevTan);
    front.copy(spec.front).addScaledVector(prevTan, -spec.front.dot(prevTan)).normalize();
    for (let k = 1, n = Math.ceil(ss[0]! / 0.002); k <= n; k++) {
      path.at((ss[0]! * k) / n, pos, tan);
      q.setFromUnitVectors(prevTan, tan);
      front.applyQuaternion(q).addScaledVector(tan, -front.dot(tan)).normalize();
      prevTan.copy(tan);
    }
    for (let i = 0; i < rows; i++) {
      const s = ss[i]!;
      path.at(s, pos, tan);
      q.setFromUnitVectors(prevTan, tan);
      front.applyQuaternion(q).addScaledVector(tan, -front.dot(tan)).normalize();
      prevTan.copy(tan);
      side.crossVectors(front, tan);
      for (let j = 0; j < cols; j++) {
        const th = ths[j]!;
        const [a, b, c = 0] = spec.section(s, mirror * th);
        grid.push(pos.clone().addScaledVector(front, a).addScaledVector(side, mirror * b).addScaledVector(tan, c));
      }
    }

    // Topologie sur la grille soudée (fermée autour de l'axe, et le long du chemin s'il boucle).
    const tris: [number, number, number, number][] = []; // trois sommets de grille + zone
    const regionAt = typeof spec.region === 'number' ? () => spec.region as number : spec.region;
    const extra: Vector3[] = [];
    const extraS: number[] = [];
    const extraIndex = (v: Vector3, s: number) => {
      extraS.push(s);
      return grid.length + extra.push(v) - 1;
    };
    const rowEnd = path.closed ? rows : rows - 1;
    for (let i = 0; i < rowEnd; i++) {
      const i2 = (i + 1) % rows;
      const sm = path.closed && i2 === 0 ? (ss[i]! + s1) / 2 : (ss[i]! + ss[i2]!) / 2;
      for (let j = 0; j < cols; j++) {
        const j2 = (j + 1) % cols;
        const thm = j2 === 0 ? (ths[j]! + TAU) / 2 : (ths[j]! + ths[j2]!) / 2;
        const r = regionAt(sm, mirror * thm);
        const a = i * cols + j;
        const b = i2 * cols + j;
        const c = i2 * cols + j2;
        const d = i * cols + j2;
        tris.push([a, b, c, r], [a, c, d, r]);
      }
    }
    const capRegion = (s: number) => regionAt(s, 0);
    if (!path.closed) {
      for (const [end, mode] of [[0, spec.capStart ?? 'open'], [rows - 1, spec.capEnd ?? 'open']] as const) {
        if (mode !== 'pole') continue;
        const center = new Vector3();
        for (let j = 0; j < cols; j++) center.add(grid[end * cols + j]!);
        const ci = extraIndex(center.divideScalar(cols), ss[end]!);
        const r = capRegion(ss[end]!);
        for (let j = 0; j < cols; j++) {
          const j2 = (j + 1) % cols;
          const a = end * cols + j;
          const b = end * cols + j2;
          tris.push(end === 0 ? [ci, a, b, r] : [ci, b, a, r]);
        }
      }
    }
    const all = grid.concat(extra);

    // Normales lissées, pondérées par l'aire.
    const nrm = all.map(() => new Vector3());
    const e1 = new Vector3();
    const e2 = new Vector3();
    const fn = new Vector3();
    for (const [a, b, c] of tris) {
      e1.subVectors(all[b]!, all[a]!);
      e2.subVectors(all[c]!, all[a]!);
      fn.crossVectors(e1, e2);
      nrm[a]!.add(fn);
      nrm[b]!.add(fn);
      nrm[c]!.add(fn);
    }
    for (const n of nrm) n.normalize();

    const sOf = (k: number) => (k < grid.length ? ss[Math.floor(k / cols)]! : extraS[k - grid.length]!);
    const remap = new Map<string, number>();
    const emit = (k: number, region: number) => {
      const key = `${k}:${region}`;
      let out = remap.get(key);
      if (out === undefined) {
        out = this.positions.length / 3;
        const p = all[k]!;
        const n = nrm[k]!;
        this.positions.push(p.x, p.y, p.z);
        this.normals.push(n.x, n.y, n.z);
        this.regions.push(region);
        const sk = spec.skin?.(sOf(k), p) ?? { joints: [0], weights: [1] };
        for (let m = 0; m < 4; m++) {
          this.joints.push(sk.joints[m] ?? 0);
          this.weights.push(sk.weights[m] ?? 0);
        }
        remap.set(key, out);
      }
      return out;
    };
    for (const [a, b, c, r] of tris) this.indices.push(emit(a, r), emit(b, r), emit(c, r));

    // Disques plats : sommets à part, normale le long du chemin, pour garder l'arête nette.
    if (!path.closed) {
      for (const [end, mode, sign] of [[0, spec.capStart, -1], [rows - 1, spec.capEnd, 1]] as const) {
        if (mode !== 'flat') continue;
        path.at(ss[end]!, pos, tan);
        const n = tan.clone().multiplyScalar(sign);
        const r = capRegion(ss[end]!);
        const base = this.positions.length / 3;
        const center = new Vector3();
        for (let j = 0; j < cols; j++) center.add(grid[end * cols + j]!);
        center.divideScalar(cols);
        const ring = [center, ...Array.from({ length: cols }, (_, j) => grid[end * cols + j]!)];
        for (const p of ring) {
          this.positions.push(p.x, p.y, p.z);
          this.normals.push(n.x, n.y, n.z);
          this.regions.push(r);
          const sk = spec.skin?.(ss[end]!, p) ?? { joints: [0], weights: [1] };
          for (let m = 0; m < 4; m++) {
            this.joints.push(sk.joints[m] ?? 0);
            this.weights.push(sk.weights[m] ?? 0);
          }
        }
        for (let j = 0; j < cols; j++) {
          const a = base + 1 + j;
          const b = base + 1 + ((j + 1) % cols);
          if (sign < 0) this.indices.push(base, b, a);
          else this.indices.push(base, a, b);
        }
      }
    }
    return this;
  }
}

/* ---------- Outils de forme ---------- */

/** Écart angulaire signé ramené dans [-π, π]. */
export const angleDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/** Bosse gaussienne centrée en (`s`, `theta`) : `h` mètres, largeurs `ws` (m) et `wt` (rad). */
export interface Bump {
  s: number;
  theta: number;
  h: number;
  ws: number;
  wt: number;
}

export const bumps = (list: Bump[], s: number, th: number) => {
  let sum = 0;
  for (const b of list) {
    const ds = (s - b.s) / b.ws;
    const dt = angleDiff(th, b.theta) / b.wt;
    sum += b.h * Math.exp(-ds * ds - dt * dt);
  }
  return sum;
};

/** Interpolation lissée d'une suite de clés `[s, valeur]` (dérivée nulle aux clés : pas de cassure). */
export function keys(list: [number, number][]): (s: number) => number {
  return (s) => {
    if (s <= list[0]![0]) return list[0]![1];
    for (let i = 1; i < list.length; i++) {
      const [s1, v1] = list[i]!;
      if (s <= s1) {
        const [s0, v0] = list[i - 1]!;
        return v0 + (v1 - v0) * smooth(s0, s1, s);
      }
    }
    return list[list.length - 1]![1];
  };
}

/**
 * Section ovale à quatre demi-axes (avant, arrière, extérieur, intérieur), arrondie en super-ellipse d'exposant
 * `n` (2 : ellipse ; plus grand : plus carré). Rend le point et la direction de la normale approchée.
 */
export function oval(th: number, front: number, back: number, outer: number, inner: number, n = 2): [number, number] {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const e = 2 / n;
  const a = Math.sign(c) * Math.pow(Math.abs(c), e) * (c >= 0 ? front : back);
  const b = Math.sign(s) * Math.pow(Math.abs(s), e) * (s >= 0 ? outer : inner);
  return [a, b];
}

/** Section `oval` gonflée de `extra` mètres le long de sa direction (bosses, épaisseur de tissu). */
export function inflate([a, b]: [number, number], th: number, extra: number): SectionPoint {
  return [a + Math.cos(th) * extra, b + Math.sin(th) * extra];
}

/** Facteur d'arrondi d'une extrémité : 1 au milieu, descend en quart d'ellipse sur `len` mètres jusqu'à 0 au bout. */
export function roundEnds(s: number, s0: number, s1: number, len0: number, len1 = len0): number {
  let k = 1;
  if (len0 > 0 && s < s0 + len0) k = Math.min(k, Math.sqrt(Math.max(0, 1 - ((s0 + len0 - s) / len0) ** 2)));
  if (len1 > 0 && s > s1 - len1) k = Math.min(k, Math.sqrt(Math.max(0, 1 - ((s - (s1 - len1)) / len1) ** 2)));
  return k;
}

export { smooth };
