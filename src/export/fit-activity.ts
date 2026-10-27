import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import type { Recording, Sample } from './recorder';

/** Numéros de message du profil FIT ; le typage du SDK est un `Record<string, number>`. */
const MESG = Profile.MesgNum as { [name: string]: number };
const num = (name: string): number => {
  const n = MESG[name];
  if (n === undefined) throw new Error(`Message FIT inconnu : ${name}`);
  return n;
};

/** Le SDK type chaque message par son interface ; on passe par le type de base `Mesg` pour des champs en camelCase du profil. */
const write = (enc: Encoder, name: string, fields: object) => void enc.onMesg(num(name), fields as Mesg);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));

interface Summary {
  avgPower?: number;
  maxPower?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  maxCadence?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  totalDistance?: number;
  totalAscent?: number;
  /** Travail mécanique en joules. */
  totalWork?: number;
}

function stats(values: number[]): { avg: number; max: number } | undefined {
  if (!values.length) return undefined;
  return { avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) };
}

const defined = (xs: (number | undefined)[]) => xs.filter((x): x is number => x !== undefined);

function summarize(samples: Sample[], timerS: number): Summary {
  const power = stats(defined(samples.map((s) => s.powerW)));
  const hr = stats(defined(samples.map((s) => s.heartRateBpm)));
  const cadence = stats(defined(samples.map((s) => s.cadenceRpm)));
  const speed = stats(defined(samples.map((s) => s.speedMs)));
  const distances = defined(samples.map((s) => s.distanceM));
  const alts = defined(samples.map((s) => s.altitudeM));

  let ascent = 0;
  for (let i = 1; i < alts.length; i++) ascent += Math.max(0, alts[i]! - alts[i - 1]!);

  const totalDistance = distances.length ? Math.max(...distances) - Math.min(...distances) : undefined;
  return {
    avgPower: power?.avg,
    maxPower: power?.max,
    avgHeartRate: hr?.avg,
    maxHeartRate: hr?.max,
    avgCadence: cadence?.avg,
    maxCadence: cadence?.max,
    // Vitesse moyenne sur le temps de pédalage, plus fiable que la moyenne des échantillons après des pauses.
    avgSpeed: totalDistance !== undefined && timerS > 0 ? totalDistance / timerS : speed?.avg,
    maxSpeed: speed?.max,
    totalDistance,
    totalAscent: alts.length ? ascent : undefined,
    totalWork: power ? defined(samples.map((s) => s.powerW)).reduce((a, b) => a + b, 0) : undefined, // 1 échantillon = 1 s
  };
}

/** Champs communs au tour et à la session, sans les clés absentes (le SDK n'aime pas `undefined`). */
function summaryFields(sum: Summary) {
  const f: Record<string, number> = {};
  const set = (k: string, v: number | undefined, lo: number, hi: number) => {
    if (v !== undefined) f[k] = clamp(v, lo, hi);
  };
  set('avgPower', sum.avgPower, 0, 65534);
  set('maxPower', sum.maxPower, 0, 65534);
  set('avgHeartRate', sum.avgHeartRate, 0, 254);
  set('maxHeartRate', sum.maxHeartRate, 0, 254);
  set('avgCadence', sum.avgCadence, 0, 254);
  set('maxCadence', sum.maxCadence, 0, 254);
  if (sum.totalDistance !== undefined) f.totalDistance = Math.max(0, sum.totalDistance);
  if (sum.avgSpeed !== undefined) f.enhancedAvgSpeed = Math.max(0, sum.avgSpeed);
  if (sum.maxSpeed !== undefined) f.enhancedMaxSpeed = Math.max(0, sum.maxSpeed);
  set('totalAscent', sum.totalAscent, 0, 65534);
  if (sum.totalWork !== undefined) {
    f.totalWork = Math.round(sum.totalWork);
    // Environ 1 kcal par kJ de travail pour un rendement musculaire proche de 24 % : estimation, pas une mesure.
    f.totalCalories = Math.round(sum.totalWork / 1000);
  }
  return f;
}

/** Encode une sortie en fichier FIT Activity (cyclisme, activité virtuelle). */
export function encodeActivity(rec: Recording): Uint8Array {
  if (!rec.samples.length) throw new RangeError('Enregistrement vide : rien à encoder');

  const enc = new Encoder();
  const start = new Date(rec.startMs);
  const end = new Date(rec.endMs);

  write(enc, 'FILE_ID', {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    serialNumber: rec.startMs % 0xffffffff,
    timeCreated: start,
  });
  write(enc, 'EVENT', { timestamp: start, event: 'timer', eventType: 'start' });

  const pauses = [...rec.pauses].sort((a, b) => a.fromMs - b.fromMs);
  let p = 0;
  for (const s of rec.samples) {
    // Les évènements de pause s'intercalent entre les enregistrements, dans l'ordre du temps.
    while (p < pauses.length && pauses[p]!.fromMs <= s.t) {
      write(enc, 'EVENT', { timestamp: new Date(pauses[p]!.fromMs), event: 'timer', eventType: 'stopAll' });
      write(enc, 'EVENT', { timestamp: new Date(pauses[p]!.toMs), event: 'timer', eventType: 'start' });
      p++;
    }
    const r: Record<string, number | Date> = { timestamp: new Date(s.t) };
    if (s.powerW !== undefined) r.power = clamp(s.powerW, 0, 65534);
    if (s.cadenceRpm !== undefined) r.cadence = clamp(s.cadenceRpm, 0, 254);
    if (s.heartRateBpm !== undefined && s.heartRateBpm > 0) r.heartRate = clamp(s.heartRateBpm, 1, 254);
    if (s.speedMs !== undefined) r.enhancedSpeed = Math.max(0, s.speedMs);
    if (s.distanceM !== undefined) r.distance = Math.max(0, s.distanceM);
    if (s.altitudeM !== undefined) r.enhancedAltitude = s.altitudeM;
    write(enc, 'RECORD', r);
  }
  write(enc, 'EVENT', { timestamp: end, event: 'timer', eventType: 'stopAll' });

  const sum = summaryFields(summarize(rec.samples, rec.timerS));
  const common = {
    timestamp: end,
    startTime: start,
    totalElapsedTime: rec.elapsedS,
    totalTimerTime: rec.timerS,
    sport: 'cycling',
    subSport: 'virtualActivity',
    ...sum,
  };
  write(enc, 'LAP', { messageIndex: 0, event: 'lap', eventType: 'stop', lapTrigger: 'sessionEnd', ...common });
  write(enc, 'SESSION', {
    messageIndex: 0,
    event: 'session',
    eventType: 'stop',
    trigger: 'activityEnd',
    firstLapIndex: 0,
    numLaps: 1,
    ...common,
  });
  write(enc, 'ACTIVITY', {
    timestamp: end,
    totalTimerTime: rec.timerS,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  });
  return enc.close();
}

/** Nom de fichier horodaté, sans caractère interdit sous Windows. */
export function fitFileName(startMs: number): string {
  const d = new Date(startMs);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `zwift2-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.fit`;
}
