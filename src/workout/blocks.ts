import { targetWatts, totalDurationS, type Workout, type WorkoutStep } from './model';

/**
 * Bloc tel que l'éditeur le manipule, avant dépliage : un bloc d'intervalles reste un seul bloc avec son nombre
 * de répétitions. Les puissances sont des fractions de FTP (0,9 = 90 %), comme dans les fichiers .zwo.
 */
export type EditorBlock =
  | { type: 'warmup' | 'cooldown' | 'ramp'; durationS: number; from: number; to: number; cadenceRpm?: number }
  | { type: 'steady'; durationS: number; power: number; cadenceRpm?: number }
  | {
      type: 'intervals';
      repeat: number;
      onS: number;
      offS: number;
      onPower: number;
      offPower: number;
      cadenceRpm?: number;
      restCadenceRpm?: number;
    }
  | { type: 'free'; durationS: number };

export type BlockType = EditorBlock['type'];

export const BLOCK_LABEL: Record<BlockType, string> = {
  warmup: 'Échauffement',
  steady: 'Palier',
  intervals: 'Intervalles',
  ramp: 'Rampe',
  cooldown: 'Retour au calme',
  free: 'Libre',
};

/** Bloc par défaut proposé à l'ajout : des valeurs raisonnables qu'on ajuste ensuite. */
export function defaultBlock(type: BlockType): EditorBlock {
  switch (type) {
    case 'warmup':
      return { type, durationS: 600, from: 0.45, to: 0.75 };
    case 'cooldown':
      return { type, durationS: 300, from: 0.65, to: 0.4 };
    case 'ramp':
      return { type, durationS: 300, from: 0.6, to: 1.0 };
    case 'steady':
      return { type, durationS: 300, power: 0.85 };
    case 'intervals':
      return { type, repeat: 5, onS: 60, offS: 60, onPower: 1.1, offPower: 0.55 };
    case 'free':
      return { type, durationS: 300 };
  }
}

export const blockDurationS = (b: EditorBlock) => (b.type === 'intervals' ? b.repeat * (b.onS + b.offS) : b.durationS);

const ftp = (from: number, to = from) => ({ kind: 'ftp' as const, from, to });

export function blockSteps(b: EditorBlock): WorkoutStep[] {
  switch (b.type) {
    case 'warmup':
    case 'cooldown':
    case 'ramp':
      return [{ kind: b.type, durationS: b.durationS, target: ftp(b.from, b.to), cadenceRpm: b.cadenceRpm }];
    case 'steady':
      return [{ kind: 'steady', durationS: b.durationS, target: ftp(b.power), cadenceRpm: b.cadenceRpm }];
    case 'intervals':
      return Array.from({ length: b.repeat }, () => [
        { kind: 'on' as const, durationS: b.onS, target: ftp(b.onPower), cadenceRpm: b.cadenceRpm },
        { kind: 'off' as const, durationS: b.offS, target: ftp(b.offPower), cadenceRpm: b.restCadenceRpm },
      ]).flat();
    case 'free':
      return [{ kind: 'free', durationS: b.durationS, target: { kind: 'free' } }];
  }
}

export function blocksToWorkout(name: string, description: string | undefined, blocks: EditorBlock[]): Workout {
  return { name: name.trim() || 'Séance sans nom', description: description?.trim() || undefined, steps: blocks.flatMap(blockSteps), messages: [], warnings: [] };
}

/** Problèmes qui empêchent d'enregistrer : chaque message cite le bloc concerné (numérotés à partir de 1). */
export function validateBlocks(blocks: EditorBlock[]): string[] {
  const errors: string[] = [];
  if (!blocks.length) errors.push('La séance ne contient aucun bloc.');
  blocks.forEach((b, i) => {
    const at = `Bloc ${i + 1} (${BLOCK_LABEL[b.type]})`;
    const durations = b.type === 'intervals' ? [b.onS, b.offS] : [b.durationS];
    if (durations.some((d) => !Number.isFinite(d) || d < 1)) errors.push(`${at} : durée d'au moins 1 s attendue.`);
    if (b.type === 'intervals' && (!Number.isInteger(b.repeat) || b.repeat < 1)) errors.push(`${at} : nombre de répétitions entier attendu.`);
    const powers = b.type === 'intervals' ? [b.onPower, b.offPower] : b.type === 'steady' ? [b.power] : b.type === 'free' ? [] : [b.from, b.to];
    if (powers.some((p) => !Number.isFinite(p) || p <= 0 || p > 3)) errors.push(`${at} : puissance entre 1 et 300 % de la FTP attendue.`);
  });
  return errors;
}

export interface WorkoutStats {
  durationS: number;
  /** Puissance moyenne visée, en W (les paliers libres comptés à 50 % de la FTP). */
  avgW: number;
  /** Intensité relative à la FTP, à partir d'une puissance « normalisée » approchée seconde par seconde. */
  intensity: number;
  /** Charge estimée : durée en heures × intensité² × 100. Une heure à la FTP vaut 100. */
  load: number;
}

/** Statistiques estimées sur la consigne, seconde par seconde : un ordre de grandeur, pas une mesure. */
export function workoutStats(w: Workout, ftpW: number): WorkoutStats {
  let sum = 0;
  let sum4 = 0;
  let n = 0;
  for (const s of w.steps) {
    for (let t = 0; t < s.durationS; t++) {
      const p = targetWatts(s, t + 0.5, ftpW) ?? 0.5 * ftpW;
      sum += p;
      sum4 += p ** 4;
      n++;
    }
  }
  const durationS = totalDurationS(w);
  if (!n || ftpW <= 0) return { durationS, avgW: 0, intensity: 0, load: 0 };
  const intensity = Math.pow(sum4 / n, 0.25) / ftpW;
  return { durationS, avgW: Math.round(sum / n), intensity: +intensity.toFixed(2), load: Math.round((durationS / 3600) * intensity ** 2 * 100) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r = (x: number) => String(+x.toFixed(3));

/** Écrit la séance au format .zwo, lisible par Zwift et par notre propre lecteur. */
export function toZwo(name: string, description: string | undefined, blocks: EditorBlock[]): string {
  const cad = (c?: number, attr = 'Cadence') => (c ? ` ${attr}="${Math.round(c)}"` : '');
  const body = blocks.map((b) => {
    switch (b.type) {
      case 'warmup':
      case 'cooldown':
      case 'ramp': {
        const tag = { warmup: 'Warmup', cooldown: 'Cooldown', ramp: 'Ramp' }[b.type];
        return `    <${tag} Duration="${Math.round(b.durationS)}" PowerLow="${r(b.from)}" PowerHigh="${r(b.to)}"${cad(b.cadenceRpm)}/>`;
      }
      case 'steady':
        return `    <SteadyState Duration="${Math.round(b.durationS)}" Power="${r(b.power)}"${cad(b.cadenceRpm)}/>`;
      case 'intervals':
        return (
          `    <IntervalsT Repeat="${b.repeat}" OnDuration="${Math.round(b.onS)}" OffDuration="${Math.round(b.offS)}"` +
          ` OnPower="${r(b.onPower)}" OffPower="${r(b.offPower)}"${cad(b.cadenceRpm)}${cad(b.restCadenceRpm, 'CadenceResting')}/>`
        );
      case 'free':
        return `    <FreeRide Duration="${Math.round(b.durationS)}" FlatRoad="1"/>`;
    }
  });
  return [
    '<workout_file>',
    '  <author>La Moulinette</author>',
    `  <name>${esc(name.trim() || 'Séance sans nom')}</name>`,
    `  <description>${esc(description?.trim() ?? '')}</description>`,
    '  <sportType>bike</sportType>',
    '  <workout>',
    ...body,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

const sameTarget = (a: WorkoutStep, b: WorkoutStep) =>
  a.durationS === b.durationS && a.cadenceRpm === b.cadenceRpm && JSON.stringify(a.target) === JSON.stringify(b.target);

/**
 * Reconstitue des blocs éditables à partir d'une séance lue dans un fichier. Les paires effort/récupération
 * identiques et consécutives redeviennent un bloc d'intervalles ; les consignes en watts (.erg) sont converties
 * en fraction de la FTP donnée.
 */
export function workoutToBlocks(w: Workout, ftpW: number): { blocks: EditorBlock[]; warnings: string[] } {
  const warnings: string[] = [];
  let converted = false;
  const frac = (s: WorkoutStep): [number, number] | undefined => {
    const t = s.target;
    if (t.kind === 'free') return undefined;
    if (t.kind === 'watts') {
      converted = true;
      return [+(t.from / ftpW).toFixed(3), +(t.to / ftpW).toFixed(3)];
    }
    return [t.from, t.to];
  };

  const blocks: EditorBlock[] = [];
  const steps = w.steps;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const next = steps[i + 1];
    if (s.kind === 'on' && next?.kind === 'off') {
      let repeat = 1;
      while (steps[i + 2 * repeat] && steps[i + 2 * repeat + 1] && sameTarget(steps[i + 2 * repeat]!, s) && sameTarget(steps[i + 2 * repeat + 1]!, next)) {
        repeat++;
      }
      const on = frac(s);
      const off = frac(next);
      if (on && off && on[0] === on[1] && off[0] === off[1]) {
        blocks.push({ type: 'intervals', repeat, onS: s.durationS, offS: next.durationS, onPower: on[0], offPower: off[0], cadenceRpm: s.cadenceRpm, restCadenceRpm: next.cadenceRpm });
        i += 2 * repeat - 1;
        continue;
      }
    }
    const p = frac(s);
    if (!p) {
      if (s.kind === 'max') warnings.push('Effort maximal converti en bloc libre.');
      blocks.push({ type: 'free', durationS: s.durationS });
    } else if (s.kind === 'warmup' || s.kind === 'cooldown') {
      blocks.push({ type: s.kind, durationS: s.durationS, from: p[0], to: p[1], cadenceRpm: s.cadenceRpm });
    } else if (p[0] === p[1]) {
      blocks.push({ type: 'steady', durationS: s.durationS, power: p[0], cadenceRpm: s.cadenceRpm });
    } else {
      blocks.push({ type: 'ramp', durationS: s.durationS, from: p[0], to: p[1], cadenceRpm: s.cadenceRpm });
    }
  }
  if (converted) warnings.push(`Consignes en watts converties en % de FTP sur la base de ${ftpW} W.`);
  if (w.messages.length) warnings.push('Les messages de la séance ne sont pas encore éditables : ils ne sont pas repris.');
  return { blocks, warnings };
}
