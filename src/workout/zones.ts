import { targetWatts, type Workout } from './model';
import { zoneOf, type Zone } from './profile';

export interface ZoneInfo {
  id: Exclude<Zone, 'free'>;
  name: string;
  /** Borne basse, en fraction de FTP. */
  from: number;
}

/** Zones de puissance usuelles, du plus facile au plus dur ; les bornes suivent `zoneOf`. */
export const ZONES: ZoneInfo[] = [
  { id: 'z1', name: 'Récupération', from: 0 },
  { id: 'z2', name: 'Endurance', from: 0.56 },
  { id: 'z3', name: 'Tempo', from: 0.76 },
  { id: 'z4', name: 'Seuil', from: 0.91 },
  { id: 'z5', name: 'VO2max', from: 1.06 },
  { id: 'z6', name: 'Anaérobie', from: 1.21 },
];

export interface ZoneRange {
  id: ZoneInfo['id'];
  name: string;
  /** Borne basse en watts ; absente pour la première zone. */
  fromW?: number;
  /** Borne haute en watts, comprise ; absente pour la dernière zone. */
  toW?: number;
}

/** Les zones de puissance en watts pour une FTP donnée, avec les mêmes bornes que `zoneOf` (la borne haute est la basse suivante moins 1 W). */
export function zoneRangesW(ftpW: number): ZoneRange[] {
  return ZONES.map((z, i) => {
    const next = ZONES[i + 1];
    return {
      id: z.id,
      name: z.name,
      ...(i > 0 ? { fromW: Math.round(z.from * ftpW) } : {}),
      ...(next ? { toW: Math.round(next.from * ftpW) - 1 } : {}),
    };
  });
}

export const zoneName = (z: Zone) => (z === 'free' ? 'Libre' : ZONES.find((x) => x.id === z)!.name);

export type ZoneTimes = Record<Zone, number>;

/** Secondes passées dans chaque zone d'après la consigne, échantillonnée à la seconde ; un palier libre compte à part. */
export function timeInZones(w: Workout, ftpW: number): ZoneTimes {
  const out: ZoneTimes = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, free: 0 };
  for (const s of w.steps) {
    for (let t = 0; t < s.durationS; t++) {
      const p = targetWatts(s, t + 0.5, ftpW);
      out[p === undefined ? 'free' : zoneOf(p / ftpW)]++;
    }
  }
  return out;
}

/** Temps d'effort : tempo et au-dessus. */
export const effortSeconds = (z: ZoneTimes) => z.z3 + z.z4 + z.z5 + z.z6;

export function intensityWord(intensity: number): string {
  if (intensity < 0.6) return 'facile';
  if (intensity < 0.8) return 'modérée';
  if (intensity < 0.9) return 'soutenue';
  if (intensity < 1) return 'difficile';
  return 'très difficile';
}

/** Une phrase de lecture du temps par zone, sans conseil médical. */
export function zoneReading(z: ZoneTimes, fmt: (s: number) => string): string {
  const above = z.z5 + z.z6;
  if (above > 0) return `${fmt(above)} au-dessus du seuil : séance intense.`;
  if (z.z4 > 0) return `${fmt(z.z4)} au seuil : séance soutenue.`;
  if (z.z3 > 0) return 'Pas de temps au seuil ni au-dessus : séance d’endurance active.';
  return 'Uniquement de l’endurance et de la récupération : séance facile.';
}
