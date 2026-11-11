import { describe, expect, it } from 'vitest';
import decouverteZwo from '../../samples/workouts/decouverte.zwo?raw';
import rampeErg from '../../samples/workouts/rampe.erg?raw';
import {
  blockDurationS,
  blocksToWorkout,
  defaultBlock,
  toZwo,
  validateBlocks,
  workoutStats,
  workoutToBlocks,
  type EditorBlock,
  type BlockType,
} from './blocks';
import { WorkoutLibrary } from './library';
import { parseErgMrc } from './parse-erg';
import { parseZwo } from './parse-zwo';
import type { KeyValueStore } from '../sensors/device-registry';

const ALL: BlockType[] = ['warmup', 'steady', 'intervals', 'ramp', 'cooldown', 'free'];

const sample: EditorBlock[] = [
  { type: 'warmup', durationS: 600, from: 0.45, to: 0.75, cadenceRpm: 90 },
  { type: 'intervals', repeat: 3, onS: 120, offS: 60, onPower: 1.05, offPower: 0.5, cadenceRpm: 95, restCadenceRpm: 85 },
  { type: 'steady', durationS: 300, power: 0.88 },
  { type: 'ramp', durationS: 120, from: 0.6, to: 1.2 },
  { type: 'free', durationS: 60 },
  { type: 'cooldown', durationS: 300, from: 0.6, to: 0.35 },
];

describe('blocs de l\'éditeur', () => {
  it('chaque type a un bloc par défaut valide', () => {
    expect(validateBlocks(ALL.map(defaultBlock))).toEqual([]);
  });

  it('déplie les intervalles et calcule les durées', () => {
    const w = blocksToWorkout('  ', undefined, sample);
    expect(w.name).toBe('Séance sans nom');
    expect(w.steps).toHaveLength(1 + 6 + 4);
    expect(blockDurationS(sample[1]!)).toBe(540);
    expect(w.steps.reduce((t, s) => t + s.durationS, 0)).toBe(600 + 540 + 300 + 120 + 60 + 300);
  });

  it('signale les blocs invalides en les numérotant', () => {
    const errors = validateBlocks([
      { type: 'steady', durationS: 0, power: 0.8 },
      { type: 'intervals', repeat: 2.5, onS: 30, offS: 30, onPower: 4, offPower: 0.5 },
    ]);
    expect(errors).toEqual([
      'Bloc 1 (Palier) : durée d\'au moins 1 s attendue.',
      'Bloc 2 (Intervalles) : nombre de répétitions entier attendu.',
      'Bloc 2 (Intervalles) : puissance entre 1 et 300 % de la FTP attendue.',
    ]);
    expect(validateBlocks([])).toEqual(['La séance ne contient aucun bloc.']);
  });
});

describe('écriture .zwo', () => {
  it('relue par notre lecteur, elle redonne exactement les mêmes paliers', () => {
    const xml = toZwo('Seuil <test> & co', 'Une "description"', sample);
    const back = parseZwo(xml);
    expect(back.name).toBe('Seuil <test> & co');
    expect(back.description).toBe('Une "description"');
    expect(back.warnings).toEqual([]);
    expect(back.steps).toEqual(blocksToWorkout('x', undefined, sample).steps);
  });

  it('les blocs reconstitués depuis le .zwo sont ceux de départ', () => {
    const back = workoutToBlocks(parseZwo(toZwo('n', '', sample)), 200);
    expect(back.blocks).toEqual(sample.map((b) => JSON.parse(JSON.stringify(b)))); // sans les champs undefined
    expect(back.warnings).toEqual([]);
  });
});

describe('ouvrir un fichier dans l\'éditeur', () => {
  it('regroupe les intervalles de la séance d\'exemple et signale les messages non repris', () => {
    const { blocks, warnings } = workoutToBlocks(parseZwo(decouverteZwo), 200);
    expect(blocks.map((b) => b.type)).toEqual(['warmup', 'intervals', 'steady', 'free', 'cooldown']);
    expect(blocks[1]).toMatchObject({ repeat: 4, onS: 60, offS: 60, onPower: 1.1, offPower: 0.55 });
    expect(warnings).toEqual(['Les messages de la séance ne sont pas encore éditables : ils ne sont pas repris.']);
  });

  it('convertit un .erg en watts vers des % de FTP', () => {
    const { blocks, warnings } = workoutToBlocks(parseErgMrc(rampeErg, 'rampe.erg'), 200);
    expect(blocks).toEqual([
      { type: 'steady', durationS: 300, power: 0.5 },
      { type: 'ramp', durationS: 300, from: 0.75, to: 1.25 },
      { type: 'steady', durationS: 300, power: 0.6 },
    ]);
    expect(warnings[0]).toBe('Consignes en watts converties en % de FTP sur la base de 200 W.');
  });

  it('ne fusionne pas des intervalles différents', () => {
    const w = blocksToWorkout('n', '', [
      { type: 'intervals', repeat: 2, onS: 60, offS: 60, onPower: 1.1, offPower: 0.5 },
      { type: 'intervals', repeat: 1, onS: 30, offS: 30, onPower: 1.3, offPower: 0.5 },
    ]);
    expect(workoutToBlocks(w, 200).blocks.map((b) => (b.type === 'intervals' ? b.repeat : 0))).toEqual([2, 1]);
  });
});

describe('statistiques estimées', () => {
  it('une heure à la FTP vaut une charge de 100 et une intensité de 1', () => {
    const w = blocksToWorkout('n', '', [{ type: 'steady', durationS: 3600, power: 1 }]);
    expect(workoutStats(w, 250)).toEqual({ durationS: 3600, avgW: 250, intensity: 1, load: 100 });
  });

  it('les efforts courts pèsent plus que leur moyenne', () => {
    const w = blocksToWorkout('n', '', [{ type: 'intervals', repeat: 10, onS: 60, offS: 60, onPower: 1.3, offPower: 0.5 }]);
    const s = workoutStats(w, 200);
    expect(s.avgW).toBe(180);
    expect(s.intensity).toBeGreaterThan(0.9);
  });
});

describe('bibliothèque', () => {
  const memory = (): KeyValueStore => {
    const data = new Map<string, string>();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it('crée, met à jour, trie par date et supprime', () => {
    let n = 0;
    const lib = new WorkoutLibrary(memory(), () => `id${++n}`);
    const a = lib.save({ name: 'A', blocks: sample }, 1);
    const b = lib.save({ name: 'B', blocks: [] }, 2);
    expect(lib.list().map((w) => w.name)).toEqual(['B', 'A']);
    lib.save({ ...a, name: 'A modifiée' }, 3);
    expect(lib.list().map((w) => w.name)).toEqual(['A modifiée', 'B']);
    expect(lib.get(a.id)?.blocks).toEqual(sample);
    lib.remove(b.id);
    expect(lib.list().map((w) => w.id)).toEqual(['id1']);
  });

  it('ignore un contenu corrompu', () => {
    const store = memory();
    store.setItem('zwift2.workouts', 'pas du json');
    expect(new WorkoutLibrary(store).list()).toEqual([]);
    store.setItem('zwift2.workouts', JSON.stringify([{ id: 'x', name: 'ok', blocks: [], updatedAt: 1 }, { nimporte: 'quoi' }]));
    expect(new WorkoutLibrary(store).list().map((w) => w.id)).toEqual(['x']);
  });
});
