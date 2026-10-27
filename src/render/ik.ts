export interface Point2 {
  y: number;
  z: number;
}

/**
 * Cinématique inverse à deux segments dans un plan (y, z) : position du genou ou du coude
 * entre `root` et `target`, plié vers +z (`bend` = 1) ou vers -z (`bend` = -1).
 * Hors de portée, le membre se tend en ligne droite vers la cible.
 */
export function twoBoneJoint(root: Point2, target: Point2, l1: number, l2: number, bend: 1 | -1): Point2 {
  const dy = target.y - root.y;
  const dz = target.z - root.z;
  const dist = Math.hypot(dy, dz) || 1e-9;
  const uy = dy / dist;
  const uz = dz / dist;
  const d = Math.min(dist, l1 + l2 - 1e-6);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // perpendiculaire à l'axe racine-cible, orientée du côté du pli
  let ny = -uz;
  let nz = uy;
  if (nz * bend < 0) {
    ny = -ny;
    nz = -nz;
  }
  return { y: root.y + uy * a + ny * h, z: root.z + uz * a + nz * h };
}
