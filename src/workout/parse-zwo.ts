import { WorkoutParseError, type Target, type Workout, type WorkoutMessage, type WorkoutStep } from './model';

/**
 * Lecteur `.zwo` (XML Zwift) sans DOM, pour tourner aussi dans les tests et côté serveur.
 * Il ne couvre que le sous-ensemble utilisé par les séances : blocs de `<workout>` et leurs `<textevent>`.
 * Référence : https://github.com/h4l/zwift-workout-file-reference
 */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e]!)
    .trim();

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? '');
  }
  return out;
}

const textOf = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i'));
  return m ? decode(m[1]!) || undefined : undefined;
};

interface Block {
  type: string;
  a: Record<string, string>;
  events: { offsetS: number; text: string; durationS: number }[];
}

export function parseZwo(xml: string): Workout {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  const body = clean.match(/<workout\b[^>]*>([\s\S]*?)<\/workout\s*>/i);
  if (!body) throw new WorkoutParseError('Fichier .zwo sans élément <workout>');

  const blocks: Block[] = [];
  let open: Block | undefined;
  for (const m of body[1]!.matchAll(/<\s*(\/)?\s*([A-Za-z_][\w-]*)([^>]*?)(\/)?\s*>/g)) {
    const [, closing, name, raw, selfClosing] = m;
    const type = name!.toLowerCase();
    if (type === 'textevent') {
      const a = attrs(raw!);
      if (!closing && open && a.message) {
        open.events.push({ offsetS: num(a.timeoffset) ?? 0, text: a.message, durationS: num(a.duration) ?? 10 });
      }
      continue;
    }
    if (closing) {
      if (open?.type === type) open = undefined;
      continue;
    }
    const block: Block = { type, a: attrs(raw!), events: [] };
    blocks.push(block);
    open = selfClosing ? undefined : block;
  }

  const steps: WorkoutStep[] = [];
  const messages: WorkoutMessage[] = [];
  const warnings: string[] = [];
  let t = 0;
  for (const b of blocks) {
    const expanded = expand(b, warnings);
    // Les décalages des textevent sont relatifs au début du bloc, répétitions comprises.
    for (const e of b.events) messages.push({ atS: t + e.offsetS, text: e.text, durationS: e.durationS });
    for (const s of expanded) {
      steps.push(s);
      t += s.durationS;
    }
  }
  if (!steps.length) throw new WorkoutParseError('Séance vide : aucun bloc reconnu dans <workout>');

  return {
    name: textOf(clean, 'name') ?? 'Séance sans nom',
    description: textOf(clean, 'description'),
    steps,
    messages: messages.sort((x, y) => x.atS - y.atS),
    warnings,
  };
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const ftp = (from: number, to = from): Target => ({ kind: 'ftp', from, to });

function expand(b: Block, warnings: string[]): WorkoutStep[] {
  const a = b.a;
  const duration = num(a.duration);
  const cadence = num(a.cadence);
  const need = (v: number | undefined, what: string) => {
    if (v === undefined) throw new WorkoutParseError(`Bloc <${b.type}> sans ${what}`);
    return v;
  };

  switch (b.type) {
    case 'warmup':
    case 'cooldown':
    case 'ramp': {
      // PowerLow est la puissance de départ et PowerHigh celle d'arrivée, y compris pour un retour au calme descendant.
      const from = need(num(a.powerlow), 'PowerLow');
      const to = need(num(a.powerhigh), 'PowerHigh');
      return [{ kind: b.type, durationS: need(duration, 'Duration'), target: ftp(from, to), cadenceRpm: cadence }];
    }
    case 'steadystate': {
      const p = num(a.power) ?? avg(num(a.powerlow), num(a.powerhigh));
      return [{ kind: 'steady', durationS: need(duration, 'Duration'), target: ftp(need(p, 'Power')), cadenceRpm: cadence }];
    }
    case 'intervalst': {
      const repeat = Math.max(1, Math.round(num(a.repeat) ?? 1));
      const onD = need(num(a.onduration), 'OnDuration');
      const offD = need(num(a.offduration), 'OffDuration');
      const on = num(a.onpower) !== undefined ? ftp(num(a.onpower)!) : ftp(need(num(a.poweronlow), 'OnPower'), num(a.poweronhigh) ?? num(a.poweronlow)!);
      const off = num(a.offpower) !== undefined ? ftp(num(a.offpower)!) : ftp(need(num(a.powerofflow), 'OffPower'), num(a.poweroffhigh) ?? num(a.powerofflow)!);
      const out: WorkoutStep[] = [];
      for (let i = 0; i < repeat; i++) {
        out.push({ kind: 'on', durationS: onD, target: on, cadenceRpm: cadence });
        out.push({ kind: 'off', durationS: offD, target: off, cadenceRpm: num(a.cadenceresting) });
      }
      return out;
    }
    case 'freeride':
      return [{ kind: 'free', durationS: need(duration, 'Duration'), target: { kind: 'free' }, cadenceRpm: cadence }];
    case 'maxeffort':
      return [{ kind: 'max', durationS: need(duration, 'Duration'), target: { kind: 'free' } }];
    default:
      warnings.push(`Bloc <${b.type}> non pris en charge : ignoré`);
      return [];
  }
}

const avg = (x?: number, y?: number) => (x !== undefined && y !== undefined ? (x + y) / 2 : (x ?? y));
