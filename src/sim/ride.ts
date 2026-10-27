import { DEFAULT_RIDER, step, type RiderParams } from './physics';
import type { Route } from './route';

/**
 * Pas de simulation fixe : le résultat ne dépend pas de la cadence d'appel de `advance`.
 * Le temps est compté en millisecondes entières pour qu'aucune erreur d'arrondi flottant ne change le nombre de pas.
 */
export const STEP_MS = 50;
const STEP_S = STEP_MS / 1000;
/** Plafond de rattrapage après un onglet en veille : au-delà, le temps écoulé est abandonné. */
const MAX_CATCHUP_MS = 1000;

/**
 * Sur un home trainer le vélo est à l'arrêt : quand le cycliste cesse de pédaler, la roue libre de la route
 * (plus de 30 s pour s'arrêter à 36 km/h) paraît fausse. Passé `IDLE_DELAY_S` sans puissance, il freine.
 * Pas de freinage en descente, où la gravité le fait réellement avancer.
 */
const IDLE_POWER_W = 5;
const IDLE_DELAY_S = 1.5;
const IDLE_BRAKE_MS2 = 2.5;
const DESCENT_GRADE_PCT = -2;

export interface RideSnapshot {
  speedKmh: number;
  distanceM: number;
  gradePct: number;
  altitudeM: number;
  elapsedS: number;
}

/** Sortie virtuelle : intègre la puissance mesurée le long d'un parcours. */
export class Ride {
  private v = 0;
  private dist = 0;
  private steps = 0;
  private idleSteps = 0;
  private accMs = 0;

  constructor(
    readonly route: Route,
    readonly rider: RiderParams = DEFAULT_RIDER,
  ) {}

  /** Fait avancer la simulation de `dtS` secondes réelles avec la puissance maintenue `powerW`. */
  advance(dtS: number, powerW: number): RideSnapshot {
    this.accMs += Math.min(Math.max(0, Math.round(dtS * 1000)), MAX_CATCHUP_MS);
    while (this.accMs >= STEP_MS) {
      const grade = this.route.gradeAt(this.dist);
      this.idleSteps = powerW <= IDLE_POWER_W ? this.idleSteps + 1 : 0;
      const idle = this.idleSteps * STEP_S >= IDLE_DELAY_S && grade > DESCENT_GRADE_PCT;
      const r = step(this.v, powerW, grade, STEP_S, this.rider, 0, idle ? IDLE_BRAKE_MS2 : 0);
      this.v = r.v;
      this.dist += r.dist;
      this.steps++;
      this.accMs -= STEP_MS;
    }
    return this.snapshot();
  }

  snapshot(): RideSnapshot {
    return {
      speedKmh: this.v * 3.6,
      distanceM: this.dist,
      gradePct: this.route.gradeAt(this.dist),
      altitudeM: this.route.altitudeAt(this.dist),
      elapsedS: this.steps * STEP_S,
    };
  }
}
