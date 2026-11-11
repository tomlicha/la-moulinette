import { targetWatts, totalDurationS, WorkoutParseError, type Workout, type WorkoutStep } from './model';
import { parseErgMrc } from './parse-erg';
import { parseZwo } from './parse-zwo';

/** Choisit le lecteur d'après l'extension, à défaut d'après le contenu. */
export function parseWorkout(fileName: string, text: string): Workout {
  const ext = fileName.toLowerCase().match(/\.(zwo|erg|mrc)$/)?.[1];
  if (ext === 'zwo' || (!ext && /<workout_file|<workout\b/i.test(text))) return parseZwo(text);
  if (ext === 'erg' || ext === 'mrc' || /\[COURSE HEADER\]/i.test(text)) return parseErgMrc(text, fileName);
  throw new WorkoutParseError('Format non reconnu : .zwo, .erg ou .mrc attendu');
}

export interface WorkoutState {
  done: boolean;
  stepIndex: number;
  step: WorkoutStep;
  stepElapsedS: number;
  stepRemainingS: number;
  /** Consigne du moment, `undefined` sur un palier libre. */
  targetW?: number;
  next?: WorkoutStep;
  nextTargetW?: number;
  elapsedS: number;
  totalS: number;
  message?: string;
}

/**
 * Déroule une séance dans le temps. Aucun accès au trainer : l'appelant lit `targetW` et décide de l'envoyer.
 * L'avance se fait en temps réel écoulé ; mettre en pause, c'est ne plus appeler `advance`.
 */
export class WorkoutRunner {
  private elapsed = 0;
  private readonly starts: number[] = [];
  readonly totalS: number;

  constructor(
    readonly workout: Workout,
    public ftpW: number,
    /** Multiplicateur des consignes (1 = séance telle quelle), réglable en cours de route. */
    public intensity = 1,
  ) {
    let t = 0;
    for (const s of workout.steps) {
      this.starts.push(t);
      t += s.durationS;
    }
    this.totalS = totalDurationS(workout);
  }

  advance(dtS: number): WorkoutState {
    this.elapsed = Math.min(this.totalS, this.elapsed + Math.max(0, dtS));
    return this.state();
  }

  /** Passe au début du palier suivant (ou termine la séance sur le dernier). */
  skip(): WorkoutState {
    const i = this.indexAt(this.elapsed);
    this.elapsed = i + 1 < this.starts.length ? this.starts[i + 1]! : this.totalS;
    return this.state();
  }

  state(): WorkoutState {
    const done = this.elapsed >= this.totalS;
    const i = done ? this.workout.steps.length - 1 : this.indexAt(this.elapsed);
    const step = this.workout.steps[i]!;
    const stepElapsedS = done ? step.durationS : this.elapsed - this.starts[i]!;
    const next = this.workout.steps[i + 1];
    const message = this.workout.messages.find((m) => this.elapsed >= m.atS && this.elapsed < m.atS + m.durationS)?.text;
    return {
      done,
      stepIndex: i,
      step,
      stepElapsedS,
      stepRemainingS: step.durationS - stepElapsedS,
      targetW: done ? undefined : targetWatts(step, stepElapsedS, this.ftpW, this.intensity),
      next,
      nextTargetW: next ? targetWatts(next, 0, this.ftpW, this.intensity) : undefined,
      elapsedS: this.elapsed,
      totalS: this.totalS,
      message,
    };
  }

  private indexAt(t: number): number {
    let i = 0;
    while (i + 1 < this.starts.length && this.starts[i + 1]! <= t) i++;
    return i;
  }
}
