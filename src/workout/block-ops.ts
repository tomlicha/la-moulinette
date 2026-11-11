import { BLOCK_LABEL, blockDurationS, type EditorBlock } from './blocks';
import { zoneOf } from './profile';
import { zoneName } from './zones';

const MIN_S = 5;
const round2 = (x: number) => Math.round(x * 100) / 100;
const clampPower = (x: number) => Math.min(3, Math.max(0.05, round2(x)));

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const pct = (f: number) => `${Math.round(f * 100)} %`;
const watts = (f: number, ftpW: number) => `${Math.round(f * ftpW)} W`;

/** Puissance principale d'un bloc (l'effort pour des intervalles), relevée ou abaissée de `delta` (fraction de FTP). */
export function nudgePower(b: EditorBlock, delta: number): EditorBlock {
  switch (b.type) {
    case 'steady':
      return { ...b, power: clampPower(b.power + delta) };
    case 'intervals':
      return { ...b, onPower: clampPower(b.onPower + delta) };
    case 'warmup':
    case 'cooldown':
    case 'ramp':
      return { ...b, from: clampPower(b.from + delta), to: clampPower(b.to + delta) };
    case 'free':
      return b;
  }
}

/** Durée principale d'un bloc (l'effort pour des intervalles), allongée ou raccourcie de `delta` secondes. */
export function nudgeDuration(b: EditorBlock, delta: number): EditorBlock {
  if (b.type === 'intervals') return { ...b, onS: Math.max(MIN_S, b.onS + delta) };
  return { ...b, durationS: Math.max(MIN_S, b.durationS + delta) };
}

/** Transforme un bloc d'intervalles en paliers séparés, pour modifier une répétition sans toucher aux autres. */
export function splitIntervals(b: EditorBlock): EditorBlock[] {
  if (b.type !== 'intervals') return [b];
  const out: EditorBlock[] = [];
  for (let i = 0; i < b.repeat; i++) {
    out.push({ type: 'steady', durationS: b.onS, power: b.onPower, ...(b.cadenceRpm ? { cadenceRpm: b.cadenceRpm } : {}) });
    out.push({ type: 'steady', durationS: b.offS, power: b.offPower, ...(b.restCadenceRpm ? { cadenceRpm: b.restCadenceRpm } : {}) });
  }
  return out;
}

/** Début et fin de chaque bloc, en secondes depuis le départ. */
export function blockRanges(blocks: EditorBlock[]): { start: number; end: number }[] {
  let t = 0;
  return blocks.map((b) => {
    const start = t;
    t += blockDurationS(b);
    return { start, end: t };
  });
}

/** Bloc couvrant l'instant `t` ; au-delà de la fin, le dernier. */
export function blockIndexAt(blocks: EditorBlock[], t: number): number {
  const ranges = blockRanges(blocks);
  const i = ranges.findIndex((r) => t >= r.start && t < r.end);
  return i < 0 ? ranges.length - 1 : i;
}

/** Résumé court pour la bande de structure : « 10:00 · 45→75 % », « 3 × (10:00 à 95 % + 5:00 à 55 %) ». */
export function blockShort(b: EditorBlock): string {
  switch (b.type) {
    case 'warmup':
    case 'cooldown':
    case 'ramp':
      return `${mmss(b.durationS)} · ${Math.round(b.from * 100)}→${pct(b.to)}`;
    case 'steady':
      return `${mmss(b.durationS)} · ${pct(b.power)}`;
    case 'intervals':
      return `${b.repeat} × (${mmss(b.onS)} à ${pct(b.onPower)} + ${mmss(b.offS)} à ${pct(b.offPower)})`;
    case 'free':
      return `${mmss(b.durationS)} · libre`;
  }
}

/** Phrase complète du bloc sélectionné, avec watts et zone : ce que le cycliste va réellement faire. */
export function describeBlock(b: EditorBlock, ftpW: number): string {
  const zone = (f: number) => zoneName(zoneOf(f));
  switch (b.type) {
    case 'warmup':
    case 'cooldown':
    case 'ramp':
      return `${BLOCK_LABEL[b.type]} · ${mmss(b.durationS)} de ${pct(b.from)} à ${pct(b.to)} (${watts(b.from, ftpW)} → ${watts(b.to, ftpW)})`;
    case 'steady':
      return `Palier · ${mmss(b.durationS)} à ${pct(b.power)} (${watts(b.power, ftpW)}, ${zone(b.power)})`;
    case 'intervals':
      return `Intervalles · ${b.repeat} × ${mmss(b.onS)} à ${pct(b.onPower)} (${watts(b.onPower, ftpW)}, ${zone(b.onPower)}), récupération ${mmss(b.offS)} à ${pct(b.offPower)} (${watts(b.offPower, ftpW)})`;
    case 'free':
      return `Libre · ${mmss(b.durationS)} sans consigne de puissance`;
  }
}
