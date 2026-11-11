import type { WorkoutState } from './runner';

/**
 * Décide quand renvoyer la consigne ERG pendant une séance : tout de suite à chaque changement de palier,
 * et pendant une rampe au plus une fois par `minIntervalMs`, seulement si la consigne a bougé de `minDeltaW`.
 * Une écriture BLE par seconde suffit au trainer ; il en faut une immédiate quand le palier change.
 */
export class ErgFollower {
  private last?: { w: number; at: number; step: number };

  constructor(
    private readonly minIntervalMs = 1000,
    private readonly minDeltaW = 2,
  ) {}

  /** Watts à envoyer maintenant, ou `undefined` s'il n'y a rien à renvoyer. */
  next(s: WorkoutState, nowMs: number): number | undefined {
    if (s.done || s.targetW === undefined) return undefined;
    const l = this.last;
    const due =
      !l ||
      l.step !== s.stepIndex ||
      (nowMs - l.at >= this.minIntervalMs && Math.abs(s.targetW - l.w) >= this.minDeltaW);
    if (!due) return undefined;
    this.last = { w: s.targetW, at: nowMs, step: s.stepIndex };
    return s.targetW;
  }

  /** À appeler après un saut de palier, une reconnexion ou un ERG réengagé : la consigne suivante part aussitôt. */
  reset() {
    this.last = undefined;
  }
}
