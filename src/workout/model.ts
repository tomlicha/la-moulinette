/** Cible d'un palier : fraction de FTP ou watts absolus, constante (`from` = `to`) ou en rampe linéaire ; `free` = pas de consigne. */
export type Target =
  | { kind: 'ftp'; from: number; to: number }
  | { kind: 'watts'; from: number; to: number }
  | { kind: 'free' };

export type StepKind = 'warmup' | 'steady' | 'ramp' | 'on' | 'off' | 'cooldown' | 'free' | 'max';

export interface WorkoutStep {
  kind: StepKind;
  durationS: number;
  target: Target;
  cadenceRpm?: number;
}

export interface WorkoutMessage {
  /** Instant d'apparition depuis le début de la séance, en s. */
  atS: number;
  text: string;
  durationS: number;
}

export interface Workout {
  name: string;
  description?: string;
  steps: WorkoutStep[];
  messages: WorkoutMessage[];
  /** Avertissements de lecture (blocs inconnus ignorés, valeurs corrigées) : à montrer, pas bloquants. */
  warnings: string[];
}

export class WorkoutParseError extends Error {}

export const totalDurationS = (w: Workout) => w.steps.reduce((s, x) => s + x.durationS, 0);

/**
 * Watts visés à `t` secondes dans le palier, `undefined` si le palier est libre.
 * `intensity` multiplie la consigne (1 = séance telle quelle).
 */
export function targetWatts(step: WorkoutStep, t: number, ftpW: number, intensity = 1): number | undefined {
  const tg = step.target;
  if (tg.kind === 'free') return undefined;
  const k = step.durationS > 0 ? Math.min(1, Math.max(0, t / step.durationS)) : 0;
  const v = tg.from + (tg.to - tg.from) * k;
  return Math.round((tg.kind === 'ftp' ? v * ftpW : v) * intensity);
}

export const STEP_LABEL: Record<StepKind, string> = {
  warmup: 'Échauffement',
  steady: 'Palier',
  ramp: 'Rampe',
  on: 'Effort',
  off: 'Récupération',
  cooldown: 'Retour au calme',
  free: 'Libre',
  max: 'Effort maximal',
};
