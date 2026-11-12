/**
 * Occlusion ambiante précalculée par sommet : la part de ciel que chaque point de la surface voit, de 0 (enfoui)
 * à 1 (dégagé). Le moteur s'en sert pour assombrir les creux (aisselles, entrejambe, dessous du casque, jonctions
 * des tubes), ce qui donne du relief aux modèles sans ombre calculée à chaque image.
 *
 * Méthode : les triangles des pièces voisines sont inscrits dans une grille de cellules, puis chaque sommet lance
 * quelques dizaines de rayons courts dans l'hémisphère de sa normale et compte ceux qui rencontrent une cellule
 * occupée, pondérés par la proximité de l'obstacle.
 */
import { Vector3 } from 'three';
import type { MeshBuilder } from './mesh.ts';

export interface Occluder {
  mesh: MeshBuilder;
  /** Position de la pièce dans le repère commun (les roues et le pédalier sont modélisés autour de leur axe). */
  offset?: Vector3;
}

export interface AoOptions {
  /** Taille d'une cellule de la grille, en m. */
  cell?: number;
  /** Portée des rayons, en m : au-delà, un obstacle ne compte plus. */
  radius?: number;
  /** Assombrissement maximal (1 : un sommet entièrement enfoui devient noir). */
  strength?: number;
}

const RAYS = 48;
/** Directions réparties sur l'hémisphère +Z, plus denses vers le pôle (pondération en cosinus). */
const HEMISPHERE: [number, number, number][] = Array.from({ length: RAYS }, (_, i) => {
  const u = (i + 0.5) / RAYS;
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  const r = Math.sqrt(u);
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)];
});

/**
 * Lisse une valeur par sommet le long de la surface : chaque sommet prend en partie la moyenne de ses voisins. Les
 * sommets confondus (dédoublés à une limite de couleur) sont traités comme un seul, pour que le lissage traverse
 * les coutures. Efface le grain que laisse la grille de cellules.
 */
function smoothOverSurface(mesh: MeshBuilder, values: number[], passes: number): number[] {
  const pos = mesh.positions;
  const count = pos.length / 3;
  const byPlace = new Map<string, number>();
  const group = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(pos[i * 3]! * 2e4)}_${Math.round(pos[i * 3 + 1]! * 2e4)}_${Math.round(pos[i * 3 + 2]! * 2e4)}`;
    let g = byPlace.get(key);
    if (g === undefined) byPlace.set(key, (g = byPlace.size));
    group[i] = g;
  }
  const n = byPlace.size;
  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = group[idx[t]!]!;
    const b = group[idx[t + 1]!]!;
    const c = group[idx[t + 2]!]!;
    neighbours[a]!.add(b).add(c);
    neighbours[b]!.add(a).add(c);
    neighbours[c]!.add(a).add(b);
  }
  let cur = new Float64Array(n);
  const members = new Float64Array(n);
  for (let i = 0; i < count; i++) {
    cur[group[i]!]! += values[i]!;
    members[group[i]!]!++;
  }
  for (let g = 0; g < n; g++) cur[g]! /= members[g]!;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float64Array(n);
    for (let g = 0; g < n; g++) {
      let sum = 0;
      for (const o of neighbours[g]!) sum += cur[o]!;
      const k = neighbours[g]!.size;
      next[g] = k ? 0.5 * cur[g]! + (0.5 * sum) / k : cur[g]!;
    }
    cur = next;
  }
  return Array.from({ length: count }, (_, i) => cur[group[i]!]!);
}

/** Calcule `target.ao` : l'occlusion de chaque sommet de `target` par les pièces `occluders` (elle-même comprise si elle y figure). */
export function bakeAo(target: Occluder, occluders: Occluder[], opts: AoOptions = {}) {
  const cell = opts.cell ?? 0.008;
  const radius = opts.radius ?? 0.13;
  const strength = opts.strength ?? 0.85;

  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  const tOff = target.offset ?? new Vector3();
  const tp = target.mesh.positions;
  for (let i = 0; i < tp.length; i += 3) {
    p.set(tp[i]! + tOff.x, tp[i + 1]! + tOff.y, tp[i + 2]! + tOff.z);
    min.min(p);
    max.max(p);
  }
  min.subScalar(radius + 2 * cell);
  max.addScalar(radius + 2 * cell);
  const nx = Math.ceil((max.x - min.x) / cell);
  const ny = Math.ceil((max.y - min.y) / cell);
  const nz = Math.ceil((max.z - min.z) / cell);
  const grid = new Uint8Array(nx * ny * nz);
  const mark = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min.x) / cell);
    const j = Math.floor((y - min.y) / cell);
    const k = Math.floor((z - min.z) / cell);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) grid[(k * ny + j) * nx + i] = 1;
  };
  const solid = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min.x) / cell);
    const j = Math.floor((y - min.y) / cell);
    const k = Math.floor((z - min.z) / cell);
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && grid[(k * ny + j) * nx + i] === 1;
  };

  // Inscription des triangles : points régulièrement espacés d'une demi-cellule sur chaque triangle.
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (const occ of occluders) {
    const off = occ.offset ?? new Vector3();
    const pos = occ.mesh.positions;
    const idx = occ.mesh.indices;
    const at = (i: number, out: Vector3) => out.set(pos[i * 3]! + off.x, pos[i * 3 + 1]! + off.y, pos[i * 3 + 2]! + off.z);
    for (let t = 0; t < idx.length; t += 3) {
      at(idx[t]!, a);
      at(idx[t + 1]!, b);
      at(idx[t + 2]!, c);
      if (Math.max(a.x, b.x, c.x) < min.x || Math.min(a.x, b.x, c.x) > max.x) continue;
      if (Math.max(a.y, b.y, c.y) < min.y || Math.min(a.y, b.y, c.y) > max.y) continue;
      if (Math.max(a.z, b.z, c.z) < min.z || Math.min(a.z, b.z, c.z) > max.z) continue;
      const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (cell * 0.5)));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          const w = 1 - u - v;
          mark(a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v);
        }
    }
  }

  const tn = target.mesh.normals;
  const count = tp.length / 3;
  const ao = new Array<number>(count);
  const n = new Vector3();
  const t1 = new Vector3();
  const t2 = new Vector3();
  const steps = Math.ceil(radius / cell);
  for (let v = 0; v < count; v++) {
    n.set(tn[v * 3]!, tn[v * 3 + 1]!, tn[v * 3 + 2]!).normalize();
    // Repère tangent stable : l'axe du monde le moins aligné avec la normale.
    t1.set(Math.abs(n.x) < 0.6 ? 1 : 0, Math.abs(n.x) < 0.6 ? 0 : 1, 0);
    t1.addScaledVector(n, -t1.dot(n)).normalize();
    t2.crossVectors(n, t1);
    // Départ deux cellules au-dessus de la surface : elle ne s'occulte pas elle-même.
    const ox = tp[v * 3]! + tOff.x + n.x * cell * 2;
    const oy = tp[v * 3 + 1]! + tOff.y + n.y * cell * 2;
    const oz = tp[v * 3 + 2]! + tOff.z + n.z * cell * 2;
    let hit = 0;
    for (const [hx, hy, hz] of HEMISPHERE) {
      const dx = t1.x * hx + t2.x * hy + n.x * hz;
      const dy = t1.y * hx + t2.y * hy + n.y * hz;
      const dz = t1.z * hx + t2.z * hy + n.z * hz;
      for (let k = 1; k <= steps; k++) {
        if (solid(ox + dx * k * cell, oy + dy * k * cell, oz + dz * k * cell)) {
          hit += 1 - (k - 1) / steps;
          break;
        }
      }
    }
    ao[v] = Math.max(0, 1 - strength * (hit / RAYS));
  }
  target.mesh.ao = smoothOverSurface(target.mesh, ao, 3);
}
