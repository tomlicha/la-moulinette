/**
 * Modèle physique vélo : équilibre entre la puissance mesurée et les résistances (roulement, gravité, air, inertie).
 *
 *   η P = v (m g Crr cosθ + m g sinθ + ½ ρ CdA (v + vw)²) + m v dv/dt
 *
 * Aucune dépendance au DOM ni à l'horloge : mêmes entrées, mêmes sorties, côté client comme côté serveur.
 * Pas inclus à ce stade : aspiration, inertie des roues, limite d'adhérence.
 */
export interface RiderParams {
  /** Masse cycliste + vélo, en kg. */
  massKg: number;
  /** Coefficient de roulement. */
  crr: number;
  /** Surface de traînée Cd·A, en m². */
  cdA: number;
  /** Rendement de transmission. */
  efficiency: number;
  /** Densité de l'air, en kg/m³. */
  airDensity: number;
}

export const DEFAULT_RIDER: RiderParams = {
  massKg: 80,
  crr: 0.004,
  cdA: 0.32,
  efficiency: 0.97,
  airDensity: 1.2,
};

export const G = 9.80665;

/** Sous cette vitesse, la force de traction est bornée : évite la division par zéro au départ arrêté. */
const V_MIN = 1;

/** Résistance à l'avancement (N) à la vitesse v, pente en %, vent de face positif en m/s. */
export function resistanceForce(v: number, gradePct: number, p: RiderParams, headwindMs = 0): number {
  const theta = Math.atan(gradePct / 100);
  const vr = v + headwindMs;
  return p.massKg * G * (p.crr * Math.cos(theta) + Math.sin(theta)) + 0.5 * p.airDensity * p.cdA * vr * Math.abs(vr);
}

/** Avance d'un pas de `dt` secondes avec une puissance maintenue ; renvoie la nouvelle vitesse (m/s) et la distance parcourue (m). */
export function step(
  v: number,
  powerW: number,
  gradePct: number,
  dt: number,
  p: RiderParams,
  headwindMs = 0,
): { v: number; dist: number } {
  const drive = (p.efficiency * Math.max(0, powerW)) / Math.max(v, V_MIN);
  const a = (drive - resistanceForce(v, gradePct, p, headwindMs)) / p.massKg;
  const next = Math.max(0, v + a * dt);
  return { v: next, dist: 0.5 * (v + next) * dt };
}

/** Vitesse d'équilibre (m/s) pour une puissance et une pente constantes, sans vent. */
export function steadySpeed(powerW: number, gradePct: number, p: RiderParams): number {
  const theta = Math.atan(gradePct / 100);
  const a = p.massKg * G * (p.crr * Math.cos(theta) + Math.sin(theta));
  const b = 0.5 * p.airDensity * p.cdA;
  const target = p.efficiency * Math.max(0, powerW);
  // v·(a + b v²) croît à partir de la vitesse où la résistance s'annule (descente), d'où cette borne basse.
  let lo = a < 0 ? Math.sqrt(-a / b) : 0;
  let hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid * (a + b * mid * mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
