import type { Route } from '../sim/route';
import { targetWatts, type Target, type WorkoutStep } from '../workout/model';
import { zoneOf, type Zone } from '../workout/profile';
import { ZONES } from '../workout/zones';

/** Un palier tel que la liste « À suivre » l'affiche. */
export interface UpcomingStep {
  /** Watts au début et à la fin du palier (égaux hors rampe), absents sur un palier libre. */
  fromW?: number;
  toW?: number;
  durationS: number;
  /** Zone au début et à la fin du palier, `free` sur un palier libre. */
  zoneFrom: Zone;
  zoneTo: Zone;
}

export type UpcomingItem =
  | { kind: 'step'; step: UpcomingStep }
  | {
      kind: 'series';
      /** Les deux paliers qui alternent, dans l'ordre de la séance (l'effort d'abord, en général). */
      steps: [UpcomingStep, UpcomingStep];
      /** Lequel des deux arrive, quand la série est en tête de liste. */
      nextIs?: 0 | 1;
      /** Répétition en cours ou sur le point de commencer, et nombre total de répétitions. */
      rep: number;
      reps: number;
    };

/** Série d'intervalles : paliers `start` à `end` (inclus), deux paliers A et B qui alternent, A répété `reps` fois. */
export interface Series {
  start: number;
  end: number;
  reps: number;
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'free' || (b.kind !== 'free' && a.from === b.from && a.to === b.to));
const sameStep = (a: WorkoutStep, b: WorkoutStep) =>
  a.kind === b.kind && a.durationS === b.durationS && a.cadenceRpm === b.cadenceRpm && sameTarget(a.target, b.target);

/** Séries d'une séance : A, B, A… avec A et B différents et A au moins deux fois. Un palier qui rompt l'alternance clôt la série. */
export function findSeries(steps: readonly WorkoutStep[]): Series[] {
  const out: Series[] = [];
  let i = 0;
  while (i + 2 < steps.length) {
    const a = steps[i]!;
    const b = steps[i + 1]!;
    if (!sameStep(a, b) && sameStep(steps[i + 2]!, a)) {
      let end = i + 2;
      while (end + 1 < steps.length && sameStep(steps[end + 1]!, (end + 1 - i) % 2 === 0 ? a : b)) end++;
      out.push({ start: i, end, reps: Math.floor((end - i) / 2) + 1 });
      i = end + 1;
    } else i++;
  }
  return out;
}

/** Répétition à laquelle appartient le palier `i` (A ou B), si ce palier fait partie d'une série. */
export function repetitionAt(series: readonly Series[], i: number): { rep: number; reps: number } | undefined {
  const s = series.find((x) => x.start <= i && i <= x.end);
  return s && { rep: Math.floor((i - s.start) / 2) + 1, reps: s.reps };
}

function upcomingStep(step: WorkoutStep, ftpW: number, intensity: number): UpcomingStep {
  const fromW = targetWatts(step, 0, ftpW, intensity);
  const toW = targetWatts(step, step.durationS, ftpW, intensity);
  const zone = (w: number | undefined): Zone => (w === undefined ? 'free' : zoneOf(w / ftpW));
  return { fromW, toW, durationS: step.durationS, zoneFrom: zone(fromW), zoneTo: zone(toW) };
}

/**
 * Liste « À suivre » du HUD : au plus `max` éléments après le palier `stepIndex`, une série d'intervalles comptant pour un
 * (ses deux paliers une seule fois, avec le numéro de répétition). Un dernier palier isolé d'une série s'affiche seul.
 * `rest` : paliers de la séance qui viennent après la liste.
 */
export function upcoming(
  steps: readonly WorkoutStep[],
  series: readonly Series[],
  stepIndex: number,
  ftpW: number,
  intensity = 1,
  max = 4,
): { items: UpcomingItem[]; rest: number } {
  const items: UpcomingItem[] = [];
  let j = stepIndex + 1;
  while (j < steps.length && items.length < max) {
    const s = series.find((x) => x.start <= j && j <= x.end);
    if (s && s.end > j) {
      const onA = (j - s.start) % 2 === 0;
      items.push({
        kind: 'series',
        steps: [upcomingStep(steps[s.start]!, ftpW, intensity), upcomingStep(steps[s.start + 1]!, ftpW, intensity)],
        nextIs: items.length === 0 ? (onA ? 0 : 1) : undefined,
        rep: Math.floor((j - s.start - (onA ? 0 : 1)) / 2) + 1,
        reps: s.reps,
      });
      j = s.end + 1;
    } else {
      items.push({ kind: 'step', step: upcomingStep(steps[j]!, ftpW, intensity) });
      j++;
    }
  }
  return { items, rest: steps.length - j };
}

/** Moyenne glissante de la puissance (3 s par défaut, la convention des compteurs). `undefined` quand le capteur se tait. */
export class PowerAverage {
  private samples: { at: number; w: number }[] = [];

  constructor(private readonly windowMs = 3000) {}

  push(w: number, at: number) {
    this.samples.push({ at, w });
    this.trim(at);
  }

  value(now: number): number | undefined {
    this.trim(now);
    if (!this.samples.length) return undefined;
    return Math.round(this.samples.reduce((s, x) => s + x.w, 0) / this.samples.length);
  }

  reset() {
    this.samples = [];
  }

  private trim(now: number) {
    while (this.samples.length && now - this.samples[0]!.at > this.windowMs) this.samples.shift();
  }
}

/** Dénivelé positif cumulé à partir des altitudes successives de la sortie. */
export class ClimbCounter {
  private last: number | undefined;
  total = 0;

  add(altitudeM: number) {
    if (this.last !== undefined && altitudeM > this.last) this.total += altitudeM - this.last;
    this.last = altitudeM;
  }

  reset() {
    this.last = undefined;
    this.total = 0;
  }
}

/** Sommets d'un parcours bouclé : fin d'un segment qui monte suivi d'un segment plat ou descendant, en m depuis le départ. */
export function summitsOf(route: Route): number[] {
  const out: number[] = [];
  const segs = route.segments;
  let d = 0;
  segs.forEach((s, i) => {
    d += s.lengthM;
    const next = segs[(i + 1) % segs.length]!;
    if (s.gradePct > 0 && next.gradePct <= 0) out.push(d % route.lengthM);
  });
  return out.sort((a, b) => a - b);
}

/** Distance jusqu'au prochain sommet, tours suivants compris ; `undefined` sur un parcours sans montée. */
export function nextSummitM(route: Route, distanceM: number): number | undefined {
  const summits = summitsOf(route);
  if (!summits.length) return undefined;
  const pos = ((distanceM % route.lengthM) + route.lengthM) % route.lengthM;
  const ahead = summits.find((s) => s > pos);
  return (ahead ?? summits[0]! + route.lengthM) - pos;
}

/** Profil d'altitude d'un tour, dans un repère `width` × `height` (y vers le bas, 3 px de marge en haut et en bas). */
export function routeProfile(route: Route, width: number, height: number, stepM = 20) {
  const pts: [number, number][] = [];
  for (let d = 0; d <= route.lengthM; d += stepM) pts.push([d, route.altitudeAt(Math.min(d, route.lengthM - 0.01))]);
  const alts = pts.map((p) => p[1]);
  const min = Math.min(...alts);
  const span = Math.max(...alts) - min || 1;
  const x = (d: number) => (d / route.lengthM) * width;
  const y = (alt: number) => height - 3 - ((alt - min) / span) * (height - 6);
  const line = pts.map(([d, a], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(a).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, x, y };
}

/** « Z3 · Tempo » pour une puissance et une FTP données. */
export function zoneLabel(powerW: number, ftpW: number): { id: string; label: string } {
  const id = zoneOf(powerW / ftpW);
  const n = id.slice(1);
  return { id, label: `Z${n} · ${ZONES.find((z) => z.id === id)!.name}` };
}

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Un chiffre après la virgule, à la française : 18,4. */
export const fmt1 = (v: number) => nf1.format(v);
/** Signe toujours affiché, vrai signe moins : +4,2 ou −3. */
export const signed = (v: number, digits: 0 | 1 = 0) => {
  const abs = digits ? nf1.format(Math.abs(v)) : String(Math.round(Math.abs(v)));
  const zero = abs === '0' || abs === '0,0';
  return `${v < 0 && !zero ? '−' : '+'}${abs}`;
};
