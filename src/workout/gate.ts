import { zoneOf, type Zone } from './profile';
import type { WorkoutState } from './runner';

/** La porte du prochain palier apparaît sur la route ce nombre de secondes avant son début. */
export const GATE_LEAD_S = 30;
/** Vitesse plancher de l'estimation, en m/s : à l'arrêt, la porte reste devant au lieu de coller au cycliste. */
const MIN_SPEED_MS = 2;
/** Au-delà, la porte serait perdue dans le paysage. */
const MAX_AHEAD_M = 400;

export interface IntervalGate {
  /** Numéro du palier que la porte ouvre : une nouvelle valeur, c'est une nouvelle porte. */
  key: number;
  /** Zone d'effort du palier qui commence, qui donne la couleur de la porte. */
  zone: Zone;
  /** Distance restant à parcourir jusqu'à la porte, estimée à la vitesse du moment, en m. */
  aheadM: number;
}

/**
 * Porte à poser sur la route devant le début du palier suivant. La séance avance au temps : la porte est placée là où
 * le cycliste sera, à sa vitesse actuelle, quand le palier commencera, et se rapproche à mesure que le temps file.
 * Rien à montrer sur le dernier palier, en pause, ou tant que le changement est à plus de `GATE_LEAD_S`.
 */
export function nextIntervalGate(s: WorkoutState, ftpW: number, speedKmh: number, paused = false): IntervalGate | undefined {
  if (paused || s.done || !s.next || s.stepRemainingS > GATE_LEAD_S) return undefined;
  const speedMs = Math.max(MIN_SPEED_MS, speedKmh / 3.6);
  return {
    key: s.stepIndex + 1,
    zone: s.nextTargetW === undefined || ftpW <= 0 ? 'free' : zoneOf(s.nextTargetW / ftpW),
    aheadM: Math.min(MAX_AHEAD_M, Math.max(0, s.stepRemainingS) * speedMs),
  };
}
