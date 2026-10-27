/** Un échantillon par seconde ; un champ absent signifie « pas de donnée fiable à cet instant ». */
export interface Sample {
  /** Instant en ms epoch, arrondi à la seconde. */
  t: number;
  powerW?: number;
  cadenceRpm?: number;
  heartRateBpm?: number;
  speedMs?: number;
  distanceM?: number;
  altitudeM?: number;
}

export type SampleValues = Partial<Omit<Sample, 't'>>;

export interface Pause {
  fromMs: number;
  toMs: number;
}

/** Sortie terminée, prête à être encodée. `elapsedS` inclut les pauses, `timerS` non. */
export interface Recording {
  startMs: number;
  endMs: number;
  elapsedS: number;
  timerS: number;
  samples: Sample[];
  pauses: Pause[];
}

export type RecorderState = 'idle' | 'recording' | 'paused';

/** Au-delà de ce délai sans nouvelle valeur, un champ est jugé périmé et omis de l'échantillon. */
const STALE_MS = 3000;

const FIELDS = ['powerW', 'cadenceRpm', 'heartRateBpm', 'speedMs', 'distanceM', 'altitudeM'] as const;

/**
 * Enregistre la sortie à 1 Hz. Pur : l'appelant fournit l'horloge, les valeurs et le rythme des `tick`.
 * L'enregistrement démarre au premier tick qui dispose d'une donnée fraîche.
 */
export class RideRecorder {
  private latest: { [K in (typeof FIELDS)[number]]?: { v: number; at: number } } = {};
  private samples: Sample[] = [];
  private pauses: Pause[] = [];
  private pausedAt?: number;

  constructor(private readonly staleMs = STALE_MS) {}

  get state(): RecorderState {
    if (this.pausedAt !== undefined) return 'paused';
    return this.samples.length ? 'recording' : 'idle';
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  update(values: SampleValues, nowMs: number) {
    for (const k of FIELDS) {
      const v = values[k];
      if (v !== undefined && Number.isFinite(v)) this.latest[k] = { v, at: nowMs };
    }
  }

  /** Ajoute un échantillon si l'enregistrement est actif et qu'une seconde nouvelle est écoulée. */
  tick(nowMs: number): Sample | undefined {
    if (this.pausedAt !== undefined) return undefined;
    const t = Math.round(nowMs / 1000) * 1000;
    const last = this.samples.at(-1);
    if (last && t <= last.t) return undefined;

    const sample: Sample = { t };
    let fresh = false;
    for (const k of FIELDS) {
      const entry = this.latest[k];
      if (entry && nowMs - entry.at <= this.staleMs) {
        sample[k] = entry.v;
        fresh = true;
      }
    }
    if (!fresh && !last) return undefined; // rien à enregistrer tant que le trainer n'a rien envoyé
    this.samples.push(sample);
    return sample;
  }

  pause(nowMs: number) {
    if (this.state === 'recording') this.pausedAt = nowMs;
  }

  resume(nowMs: number) {
    if (this.pausedAt === undefined) return;
    this.pauses.push({ fromMs: this.pausedAt, toMs: nowMs });
    this.pausedAt = undefined;
  }

  /** Termine l'enregistrement et le remet à zéro ; `undefined` si aucun échantillon n'a été pris. */
  finish(nowMs: number): Recording | undefined {
    if (this.pausedAt !== undefined) this.resume(nowMs);
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last) {
      this.reset();
      return undefined;
    }
    const startMs = first.t;
    const endMs = last.t + 1000; // chaque échantillon couvre la seconde qu'il ouvre
    const pauses = this.pauses
      .map((p) => ({ fromMs: Math.max(p.fromMs, startMs), toMs: Math.min(p.toMs, endMs) }))
      .filter((p) => p.toMs > p.fromMs);
    const pausedMs = pauses.reduce((sum, p) => sum + (p.toMs - p.fromMs), 0);
    const recording: Recording = {
      startMs,
      endMs,
      elapsedS: (endMs - startMs) / 1000,
      timerS: Math.max(0, (endMs - startMs - pausedMs) / 1000),
      samples: this.samples,
      pauses,
    };
    this.reset();
    return recording;
  }

  reset() {
    this.samples = [];
    this.pauses = [];
    this.pausedAt = undefined;
    this.latest = {};
  }
}
