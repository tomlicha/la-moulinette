import type { Route } from '../sim/route';
import { zoneOf } from '../workout/profile';
import { ZONES } from '../workout/zones';

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
