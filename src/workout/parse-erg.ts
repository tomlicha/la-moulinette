import { WorkoutParseError, type Workout, type WorkoutMessage, type WorkoutStep } from './model';

/**
 * Lecteur `.erg` (watts absolus) et `.mrc` (pourcentage de FTP) : une liste de points (minutes, valeur),
 * reliés par des segments. Deux points au même instant marquent une marche ; deux valeurs différentes, une rampe.
 */
export function parseErgMrc(text: string, fileName = ''): Workout {
  const lines = text.replace(/\r/g, '').split('\n');
  const header: Record<string, string> = {};
  const points: [number, number][] = [];
  const messages: WorkoutMessage[] = [];
  let unit: 'watts' | 'percent' | undefined;
  let section = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1]!.toUpperCase();
      continue;
    }
    if (section === 'COURSE HEADER') {
      const cols = line.toUpperCase().split(/\s+/);
      if (cols[0] === 'MINUTES' && (cols[1] === 'WATTS' || cols[1] === 'PERCENT')) {
        unit = cols[1] === 'WATTS' ? 'watts' : 'percent';
        continue;
      }
      const kv = line.match(/^([^=]+)=(.*)$/);
      if (kv) header[kv[1]!.trim().toUpperCase()] = kv[2]!.trim();
    } else if (section === 'COURSE DATA') {
      const [t, v] = line.split(/\s+/).map(Number);
      if (!Number.isFinite(t) || !Number.isFinite(v)) throw new WorkoutParseError(`Ligne de données illisible : « ${line} »`);
      points.push([t!, v!]);
    } else if (section === 'COURSE TEXT') {
      // secondes <tab> message <tab> durée en secondes
      const [at, msg, dur] = raw.split('\t');
      if (Number.isFinite(Number(at)) && msg?.trim()) {
        messages.push({ atS: Number(at), text: msg.trim(), durationS: Number(dur) || 10 });
      }
    }
  }

  if (!unit) throw new WorkoutParseError('En-tête sans « MINUTES WATTS » ni « MINUTES PERCENT »');
  if (points.length < 2) throw new WorkoutParseError('Il faut au moins deux points dans [COURSE DATA]');

  const steps: WorkoutStep[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [t0, v0] = points[i]!;
    const [t1, v1] = points[i + 1]!;
    if (t1 < t0) throw new WorkoutParseError(`Temps décroissant à la ligne de données ${i + 2}`);
    const durationS = Math.round((t1 - t0) * 60);
    if (durationS === 0) continue; // marche : la valeur change sans durée
    const [from, to] = unit === 'percent' ? [v0 / 100, v1 / 100] : [v0, v1];
    steps.push({
      kind: from === to ? 'steady' : 'ramp',
      durationS,
      target: { kind: unit === 'percent' ? 'ftp' : 'watts', from, to },
    });
  }
  if (!steps.length) throw new WorkoutParseError('Séance vide : aucun segment de durée non nulle');

  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.(erg|mrc)$/i, '');
  return {
    name: header['DESCRIPTION'] || header['FILE NAME'] || baseName || 'Séance sans nom',
    description: header['DESCRIPTION'] && header['FILE NAME'] ? header['FILE NAME'] : undefined,
    steps,
    messages,
    warnings: [],
  };
}
