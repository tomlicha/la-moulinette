/**
 * Corps en surface implicite : chaque partie (buste, jambes, bras, cou) est un « tube » aux sections anatomiques
 * dont on sait mesurer la distance ; les parties sont fondues par une union lissée, puis la surface est extraite
 * d'une grille (surface nets), simplifiée, et découpée net le long des limites de vêtements.
 *
 * Contrairement à des tubes balayés qui se croisent, il n'y a ni arête ni couture aux jonctions (fesses, aine,
 * aisselles, base du cou) : la surface est continue, et les poids du squelette s'y mélangent d'eux-mêmes.
 */
import { Vector3 } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { oval, polyline, type Path, type Skin } from './mesh.ts';

export interface TubeSpec {
  /** Ligne brisée de l'axe (articulations). */
  points: Vector3[];
  /** Arrondi de la tangente aux articulations, en m. */
  blend: number;
  /** Direction « avant » au départ de l'axe ; transportée le long du chemin comme pour un balayage. */
  front: Vector3;
  mirror?: 1 | -1;
  /** Rayon de la section dans la direction `theta` (π/2 : côté extérieur), bosses comprises. */
  radius: (s: number, theta: number) => number;
  region: (s: number, theta: number) => number;
  skin: (s: number) => Skin;
}

/** Rayon polaire d'une section ovale à quatre demi-axes. */
export function ovalRadius(th: number, front: number, back: number, outer: number, inner: number, n = 2.15): number {
  const [a, b] = oval(th, front, back, outer, inner, n);
  return Math.hypot(a, b);
}

const FRAME_STEP = 0.002;

/** Un tube prêt à être interrogé : repères échantillonnés le long de l'axe, projection sur la ligne brisée. */
export class Tube {
  readonly path: Path;
  private readonly cum: number[] = [0];
  private readonly frames: Float64Array; // avant (3) puis côté (3), tous les FRAME_STEP mètres
  readonly spec: TubeSpec;

  constructor(spec: TubeSpec) {
    this.spec = spec;
    const pts = spec.points;
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    this.path = polyline(pts, spec.blend);
    const n = Math.ceil(this.path.length / FRAME_STEP) + 1;
    this.frames = new Float64Array(n * 6);
    const pos = new Vector3();
    const tan = new Vector3();
    const prev = new Vector3();
    const front = new Vector3();
    const side = new Vector3();
    this.path.at(0, pos, prev);
    front.copy(spec.front).addScaledVector(prev, -spec.front.dot(prev)).normalize();
    for (let i = 0; i < n; i++) {
      this.path.at(Math.min(i * FRAME_STEP, this.path.length), pos, tan);
      const axis = new Vector3().crossVectors(prev, tan);
      const sin = axis.length();
      if (sin > 1e-9) front.applyAxisAngle(axis.divideScalar(sin), Math.asin(Math.min(1, sin)));
      front.addScaledVector(tan, -front.dot(tan)).normalize();
      prev.copy(tan);
      side.crossVectors(front, tan);
      this.frames.set([front.x, front.y, front.z, side.x, side.y, side.z], i * 6);
    }
  }

  get length() {
    return this.path.length;
  }

  /** Point de l'axe le plus proche, angle canonique autour de lui et distance à l'axe. */
  locate(x: number, y: number, z: number): { s: number; theta: number; dist: number } {
    const pts = this.spec.points;
    let best = Infinity;
    let bs = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / len2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const pz = a.z + dz * t;
      const d2 = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
      if (d2 < best) {
        best = d2;
        bs = this.cum[i - 1]! + t * Math.sqrt(len2);
        cx = px;
        cy = py;
        cz = pz;
      }
    }
    const k = Math.min(this.frames.length / 6 - 1, Math.round(bs / FRAME_STEP)) * 6;
    const f = this.frames;
    const qx = x - cx;
    const qy = y - cy;
    const qz = z - cz;
    const a = qx * f[k]! + qy * f[k + 1]! + qz * f[k + 2]!;
    const b = qx * f[k + 3]! + qy * f[k + 4]! + qz * f[k + 5]!;
    const mirror = this.spec.mirror ?? 1;
    return { s: bs, theta: Math.atan2(mirror * b, a), dist: Math.sqrt(best) };
  }

  sdf(x: number, y: number, z: number): number {
    const l = this.locate(x, y, z);
    return l.dist - this.spec.radius(l.s, l.theta);
  }
}

/** Union lissée polynomiale : les deux formes se fondent sur une largeur `k`. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Corps : des tubes et des groupes de fusion. Chaque groupe fond ses tubes entre eux ; les groupes sont ensuite
 * réunis sans fusion, pour qu'un coude ne se soude pas à un genou qui passe près de lui.
 */
export class Body {
  readonly tubes: Tube[];
  readonly groups: { members: number[]; k: number }[];

  constructor(tubes: Tube[], groups: { members: number[]; k: number }[]) {
    this.tubes = tubes;
    this.groups = groups;
  }

  private readonly d: number[] = [];

  sdf(x: number, y: number, z: number): number {
    for (let i = 0; i < this.tubes.length; i++) this.d[i] = this.tubes[i]!.sdf(x, y, z);
    let out = Infinity;
    for (const g of this.groups) {
      let v = this.d[g.members[0]!]!;
      for (let m = 1; m < g.members.length; m++) v = smin(v, this.d[g.members[m]!]!, g.k);
      out = Math.min(out, v);
    }
    return out;
  }

  gradient(p: Vector3, out: Vector3, h = 0.0005): Vector3 {
    const { x, y, z } = p;
    return out
      .set(
        this.sdf(x + h, y, z) - this.sdf(x - h, y, z),
        this.sdf(x, y + h, z) - this.sdf(x, y - h, z),
        this.sdf(x, y, z + h) - this.sdf(x, y, z - h),
      )
      .normalize();
  }

  /** Tube dominant en un point de la surface : celui dont la surface propre est la plus proche. */
  dominant(p: Vector3): { tube: Tube; s: number; theta: number } {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < this.tubes.length; i++) {
      const d = Math.abs(this.tubes[i]!.sdf(p.x, p.y, p.z));
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    const tube = this.tubes[bi]!;
    const l = tube.locate(p.x, p.y, p.z);
    return { tube, s: l.s, theta: l.theta };
  }

  /**
   * Arbitrage facultatif de la zone de couleur, quand le tube dominant n'est pas le bon juge (un vêtement qui
   * couvre plusieurs tubes, comme le maillot qui descend sur le haut des fesses).
   */
  resolveRegion?: (p: Vector3, dominant: { tube: Tube; s: number; theta: number }) => number;

  region(p: Vector3): number {
    const d = this.dominant(p);
    return this.resolveRegion ? this.resolveRegion(p, d) : d.tube.spec.region(d.s, d.theta);
  }

  /** Ramène un point sur la surface par pas de Newton bornés (la distance approchée peut surestimer). */
  project(p: Vector3, maxStep: number, iterations = 3): Vector3 {
    const g = new Vector3();
    for (let it = 0; it < iterations; it++) {
      const d = this.sdf(p.x, p.y, p.z);
      if (Math.abs(d) < 1e-5) break;
      this.gradient(p, g);
      p.addScaledVector(g, -Math.max(-maxStep, Math.min(maxStep, d)));
    }
    return p;
  }

  /**
   * Poids du squelette : chaque tube proche de la surface contribue selon sa proximité (sur la largeur de fusion),
   * avec les poids de sa propre chaîne d'os à cet endroit.
   */
  skin(p: Vector3, k: number): Skin {
    const acc = new Map<number, number>();
    const ds = this.tubes.map((t) => t.sdf(p.x, p.y, p.z));
    const dmin = Math.min(...ds);
    this.tubes.forEach((t, i) => {
      const w = Math.max(0, 1 - (ds[i]! - dmin) / k) ** 2;
      if (w <= 0) return;
      const l = t.locate(p.x, p.y, p.z);
      const sk = t.spec.skin(l.s);
      sk.joints.forEach((j, m) => acc.set(j, (acc.get(j) ?? 0) + w * sk.weights[m]!));
    });
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, [, w]) => a + w, 0);
    return { joints: top.map(([j]) => j), weights: top.map(([, w]) => w / sum) };
  }
}

/**
 * Extraction de la surface sur une grille de pas `h` (surface nets) : un sommet par cellule traversée, placé à la
 * moyenne des croisements d'arêtes puis ramené sur la surface ; une face par arête de grille traversée.
 * Les blocs de 8³ cellules loin de la surface ne sont pas évalués en détail.
 */
export function polygonize(body: Body, min: Vector3, max: Vector3, h: number): { positions: Float32Array; indices: Uint32Array } {
  const nx = Math.ceil((max.x - min.x) / h);
  const ny = Math.ceil((max.y - min.y) / h);
  const nz = Math.ceil((max.z - min.z) / h);
  const sx = 1;
  const sy = nx + 1;
  const sz = (nx + 1) * (ny + 1);
  const values = new Float32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(Number.NaN);
  const B = 8;
  for (let bk = 0; bk < nz; bk += B)
    for (let bj = 0; bj < ny; bj += B)
      for (let bi = 0; bi < nx; bi += B) {
        const ie = Math.min(bi + B, nx);
        const je = Math.min(bj + B, ny);
        const ke = Math.min(bk + B, nz);
        const c = body.sdf(min.x + ((bi + ie) / 2) * h, min.y + ((bj + je) / 2) * h, min.z + ((bk + ke) / 2) * h);
        const far = Math.abs(c) > B * h * 1.6;
        for (let k = bk; k <= ke; k++)
          for (let j = bj; j <= je; j++)
            for (let i = bi; i <= ie; i++) {
              const idx = i * sx + j * sy + k * sz;
              if (!Number.isNaN(values[idx]!)) continue;
              values[idx] = far ? c : body.sdf(min.x + i * h, min.y + j * h, min.z + k * h);
            }
      }

  const cellIndex = new Int32Array(nx * ny * nz).fill(-1);
  const cid = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  const pos: number[] = [];
  const p = new Vector3();
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const v = new Float32Array(8);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = corners[c]!;
          v[c] = values[(i + di) * sx + (j + dj) * sy + (k + dk) * sz]!;
          if (v[c]! < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let n = 0;
        for (const [a, b] of edges) {
          if ((v[a]! < 0) === (v[b]! < 0)) continue;
          const t = v[a]! / (v[a]! - v[b]!);
          const [ai, aj, ak] = corners[a]!;
          const [bi, bj, bk] = corners[b]!;
          ax += ai + (bi - ai) * t;
          ay += aj + (bj - aj) * t;
          az += ak + (bk - ak) * t;
          n++;
        }
        p.set(min.x + (i + ax / n) * h, min.y + (j + ay / n) * h, min.z + (k + az / n) * h);
        // Ramène le sommet sur la surface, sans le laisser sortir de sa cellule.
        body.project(p, h * 0.5);
        cellIndex[cid(i, j, k)] = pos.length / 3;
        pos.push(p.x, p.y, p.z);
      }

  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = values[i * sx + j * sy + k * sz]!;
        const v1 = values[(i + 1) * sx + j * sy + k * sz]!;
        if ((v0 < 0) !== (v1 < 0)) quad(cellIndex[cid(i, j - 1, k - 1)]!, cellIndex[cid(i, j, k - 1)]!, cellIndex[cid(i, j, k)]!, cellIndex[cid(i, j - 1, k)]!, v0 >= 0);
      }
  for (let k = 1; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const v0 = values[i * sx + j * sy + k * sz]!;
        const v1 = values[i * sx + (j + 1) * sy + k * sz]!;
        if ((v0 < 0) !== (v1 < 0)) quad(cellIndex[cid(i - 1, j, k - 1)]!, cellIndex[cid(i - 1, j, k)]!, cellIndex[cid(i, j, k)]!, cellIndex[cid(i, j, k - 1)]!, v0 >= 0);
      }
  for (let k = 0; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const v0 = values[i * sx + j * sy + k * sz]!;
        const v1 = values[i * sx + j * sy + (k + 1) * sz]!;
        if ((v0 < 0) !== (v1 < 0)) quad(cellIndex[cid(i - 1, j - 1, k)]!, cellIndex[cid(i, j - 1, k)]!, cellIndex[cid(i, j, k)]!, cellIndex[cid(i - 1, j, k)]!, v0 >= 0);
      }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/**
 * Simplifie le maillage découpé jusqu'à `targetTriangles`. Les limites de zones sont des bords (sommets
 * dédoublés) : elles restent figées, si bien que les liserés fins gardent leur tracé du maillage dense.
 */
export async function simplify(points: { p: Vector3; r: number }[], indices: ArrayLike<number>, targetTriangles: number, maxError: number) {
  await MeshoptSimplifier.ready;
  const positions = new Float32Array(points.length * 3);
  points.forEach(({ p }, i) => positions.set([p.x, p.y, p.z], i * 3));
  const [out] = MeshoptSimplifier.simplify(Uint32Array.from(indices), positions, 3, targetTriangles * 3, maxError, ['LockBorder']);
  const remap = new Map<number, number>();
  const kept: { p: Vector3; r: number }[] = [];
  const idx = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const o = out[i]!;
    let n = remap.get(o);
    if (n === undefined) {
      n = kept.push(points[o]!) - 1;
      remap.set(o, n);
    }
    idx[i] = n;
  }
  return { points: kept, indices: idx };
}

/**
 * Découpe nette des zones de couleur : un triangle à cheval sur deux zones est coupé le long de la limite, trouvée
 * par dichotomie sur ses arêtes puis ramenée sur la surface. Les sommets de la limite sont dédoublés, un par zone.
 */
export function splitRegions(body: Body, positions: Float32Array, indices: Uint32Array) {
  const P = (i: number) => new Vector3(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
  const verts: Vector3[] = [];
  for (let i = 0; i < positions.length / 3; i++) verts.push(P(i));
  const label = verts.map((v) => body.region(v));
  const project = (p: Vector3) => body.project(p, 0.002);
  const cross = new Map<string, Vector3>();
  const crossing = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let c = cross.get(key);
    if (!c) {
      const la = label[a]!;
      let lo = 0;
      let hi = 1;
      const m = new Vector3();
      for (let it = 0; it < 12; it++) {
        const t = (lo + hi) / 2;
        m.lerpVectors(verts[a]!, verts[b]!, a < b ? t : t);
        if (body.region(m) === la) lo = t;
        else hi = t;
      }
      c = project(new Vector3().lerpVectors(verts[a]!, verts[b]!, (lo + hi) / 2));
      cross.set(key, c);
    }
    return c;
  };

  const out: { p: Vector3; r: number }[] = [];
  const key = new Map<string, number>();
  const emit = (p: Vector3, r: number, id: string) => {
    const k = `${id}:${r}`;
    let i = key.get(k);
    if (i === undefined) {
      i = out.push({ p, r }) - 1;
      key.set(k, i);
    }
    return i;
  };
  const tris: number[] = [];
  const V = (i: number) => emit(verts[i]!, label[i]!, `v${i}`);
  const C = (a: number, b: number, r: number) => emit(crossing(a, b), r, `e${Math.min(a, b)}_${Math.max(a, b)}`);
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const l = tri.map((i) => label[i]!);
    if (l[0] === l[1] && l[1] === l[2]) {
      tris.push(V(tri[0]!), V(tri[1]!), V(tri[2]!));
      continue;
    }
    if (l[0] !== l[1] && l[1] !== l[2] && l[0] !== l[2]) {
      // Trois zones dans un triangle : rare ; on garde la zone majoritaire de l'ensemble (celle du premier sommet).
      const r = l[0]!;
      tris.push(emit(verts[tri[0]!]!, r, `v${tri[0]}`), emit(verts[tri[1]!]!, r, `v${tri[1]}`), emit(verts[tri[2]!]!, r, `v${tri[2]}`));
      continue;
    }
    // Tourne le triangle pour que le sommet isolé soit `c`, en gardant l'ordre (et donc l'orientation).
    let r = 0;
    while (!(l[(r + 0) % 3] === l[(r + 1) % 3] && l[(r + 2) % 3] !== l[r % 3])) r++;
    const a = tri[r % 3]!;
    const b = tri[(r + 1) % 3]!;
    const c = tri[(r + 2) % 3]!;
    const A = label[a]!;
    const Cc = label[c]!;
    tris.push(V(a), V(b), C(b, c, A), V(a), C(b, c, A), C(a, c, A), C(a, c, Cc), C(b, c, Cc), V(c));
  }
  return { points: out, indices: tris };
}
