import { describe, expect, it } from 'vitest';
import decouverteZwo from '../../samples/workouts/decouverte.zwo?raw';
import rampeErg from '../../samples/workouts/rampe.erg?raw';
import sweetSpotMrc from '../../samples/workouts/sweet-spot.mrc?raw';
import { targetWatts, totalDurationS, WorkoutParseError } from './model';
import { parseZwo } from './parse-zwo';
import { parseErgMrc } from './parse-erg';
import { parseWorkout, WorkoutRunner } from './runner';
import { ErgFollower } from './erg-follower';
import { profileShapes, zoneOf } from './profile';

const SAMPLES: Record<string, string> = {
  'decouverte.zwo': decouverteZwo,
  'rampe.erg': rampeErg,
  'sweet-spot.mrc': sweetSpotMrc,
};
const sample = (name: string) => SAMPLES[name]!;

describe('lecture .zwo', () => {
  const w = parseZwo(sample('decouverte.zwo'));

  it('lit le nom, la description et décode les entités', () => {
    expect(w.name).toBe('Découverte & seuil');
    expect(w.description).toMatch(/23 min/);
    expect(w.warnings).toEqual([]);
  });

  it('déplie les intervalles et garde l\'ordre des blocs', () => {
    expect(w.steps.map((s) => s.kind)).toEqual([
      'warmup', 'on', 'off', 'on', 'off', 'on', 'off', 'on', 'off', 'steady', 'free', 'cooldown',
    ]);
    expect(totalDurationS(w)).toBe(23 * 60);
  });

  it('lit puissances, rampes et cadences', () => {
    expect(w.steps[0]).toEqual({ kind: 'warmup', durationS: 300, target: { kind: 'ftp', from: 0.45, to: 0.75 }, cadenceRpm: 90 });
    expect(w.steps[1]).toMatchObject({ kind: 'on', durationS: 60, target: { kind: 'ftp', from: 1.1, to: 1.1 }, cadenceRpm: 100 });
    expect(w.steps[2]).toMatchObject({ kind: 'off', target: { kind: 'ftp', from: 0.55, to: 0.55 }, cadenceRpm: 85 });
    expect(w.steps[10]).toMatchObject({ kind: 'free', target: { kind: 'free' } });
    // retour au calme descendant : PowerLow est la puissance de départ
    expect(w.steps[11]!.target).toEqual({ kind: 'ftp', from: 0.65, to: 0.4 });
  });

  it('place les messages en temps absolu, répétitions comprises', () => {
    expect(w.messages.map((m) => [m.atS, m.text])).toEqual([
      [300, 'Premier effort, cadence haute'],
      [660, 'Dernier effort !'],
      [930, 'Mi-palier, reste régulier'],
    ]);
  });

  it('accepte les variantes : attributs en minuscules, rampes dans les intervalles, PowerLow/High en palier', () => {
    const v = parseZwo(`<workout_file><workout>
      <steadystate duration='120' powerlow='0.8' powerhigh='0.9'/>
      <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" PowerOnLow="1.0" PowerOnHigh="1.2" PowerOffLow="0.5" PowerOffHigh="0.4"/>
      <MaxEffort Duration="20"/>
    </workout></workout_file>`);
    expect(v.name).toBe('Séance sans nom');
    expect(v.steps[0]!.target).toMatchObject({ kind: 'ftp', from: expect.closeTo(0.85), to: expect.closeTo(0.85) });
    expect(v.steps[1]!.target).toEqual({ kind: 'ftp', from: 1.0, to: 1.2 });
    expect(v.steps[2]!.target).toEqual({ kind: 'ftp', from: 0.5, to: 0.4 });
    expect(v.steps.at(-1)).toMatchObject({ kind: 'max', target: { kind: 'free' } });
  });

  it('ignore un bloc inconnu avec un avertissement', () => {
    const v = parseZwo('<workout_file><workout><SolidState Duration="60"/><SteadyState Duration="60" Power="0.7"/></workout></workout_file>');
    expect(v.steps).toHaveLength(1);
    expect(v.warnings).toEqual(['Bloc <solidstate> non pris en charge : ignoré']);
  });

  it('refuse un fichier sans séance ou un bloc incomplet', () => {
    expect(() => parseZwo('<workout_file><name>x</name></workout_file>')).toThrow(WorkoutParseError);
    expect(() => parseZwo('<workout_file><workout></workout></workout_file>')).toThrow(/vide/);
    expect(() => parseZwo('<workout_file><workout><SteadyState Power="0.7"/></workout></workout_file>')).toThrow(/Duration/);
  });
});

describe('lecture .erg et .mrc', () => {
  it('.erg : watts absolus, marches et rampes, messages', () => {
    const w = parseErgMrc(sample('rampe.erg'), 'rampe.erg');
    expect(w.name).toBe('Rampe 100 à 250 W');
    expect(w.steps).toEqual([
      { kind: 'steady', durationS: 300, target: { kind: 'watts', from: 100, to: 100 } },
      { kind: 'ramp', durationS: 300, target: { kind: 'watts', from: 150, to: 250 } },
      { kind: 'steady', durationS: 300, target: { kind: 'watts', from: 120, to: 120 } },
    ]);
    expect(w.messages).toEqual([{ atS: 300, text: 'Début de la rampe', durationS: 15 }]);
  });

  it('.mrc : pourcentages convertis en fraction de FTP', () => {
    const w = parseErgMrc(sample('sweet-spot.mrc'), 'sweet-spot.mrc');
    expect(w.name).toBe('2 x 8 min sweet spot');
    expect(w.steps).toHaveLength(5);
    expect(w.steps[0]!.target).toEqual({ kind: 'ftp', from: 0.5, to: 0.7 });
    expect(w.steps[1]).toEqual({ kind: 'steady', durationS: 480, target: { kind: 'ftp', from: 0.9, to: 0.9 } });
    expect(totalDurationS(w)).toBe(30 * 60);
  });

  it('accepte les fins de ligne Windows et prend le nom du fichier à défaut de description', () => {
    const w = parseErgMrc('[COURSE HEADER]\r\nMINUTES WATTS\r\n[END COURSE HEADER]\r\n[COURSE DATA]\r\n0 200\r\n1 200\r\n[END COURSE DATA]\r\n', 'C:\\x\\mon-test.erg');
    expect(w.name).toBe('mon-test');
    expect(w.steps).toEqual([{ kind: 'steady', durationS: 60, target: { kind: 'watts', from: 200, to: 200 } }]);
  });

  it('refuse un en-tête sans unité, des temps décroissants ou des données illisibles', () => {
    expect(() => parseErgMrc('[COURSE DATA]\n0 100\n1 100\n')).toThrow(/MINUTES/);
    expect(() => parseErgMrc('[COURSE HEADER]\nMINUTES WATTS\n[COURSE DATA]\n2 100\n1 100\n')).toThrow(/décroissant/);
    expect(() => parseErgMrc('[COURSE HEADER]\nMINUTES WATTS\n[COURSE DATA]\n0 abc\n')).toThrow(/illisible/);
  });
});

describe('choix du lecteur', () => {
  it('par extension, sinon par contenu', () => {
    expect(parseWorkout('a.zwo', sample('decouverte.zwo')).steps).toHaveLength(12);
    expect(parseWorkout('a.MRC', sample('sweet-spot.mrc')).steps).toHaveLength(5);
    expect(parseWorkout('sans-extension', sample('rampe.erg')).steps).toHaveLength(3);
    expect(parseWorkout('sans-extension', sample('decouverte.zwo')).steps).toHaveLength(12);
    expect(() => parseWorkout('notes.txt', 'bonjour')).toThrow(/Format non reconnu/);
  });
});

describe('consigne', () => {
  it('interpole les rampes, applique FTP et intensité, rien sur un palier libre', () => {
    const ramp = { kind: 'ramp' as const, durationS: 100, target: { kind: 'ftp' as const, from: 0.5, to: 1 } };
    expect(targetWatts(ramp, 0, 200)).toBe(100);
    expect(targetWatts(ramp, 50, 200)).toBe(150);
    expect(targetWatts(ramp, 100, 200)).toBe(200);
    expect(targetWatts(ramp, 500, 200)).toBe(200);
    expect(targetWatts(ramp, 50, 200, 1.1)).toBe(165);
    const watts = { kind: 'steady' as const, durationS: 60, target: { kind: 'watts' as const, from: 180, to: 180 } };
    expect(targetWatts(watts, 30, 999)).toBe(180); // la FTP ne change pas une consigne en watts
    expect(targetWatts({ kind: 'free', durationS: 60, target: { kind: 'free' } }, 10, 200)).toBeUndefined();
  });
});

describe('déroulement', () => {
  const w = parseZwo(sample('decouverte.zwo'));

  it('suit les paliers dans le temps', () => {
    const r = new WorkoutRunner(w, 200);
    let s = r.state();
    expect(s).toMatchObject({ stepIndex: 0, targetW: 90, stepRemainingS: 300, nextTargetW: 220, done: false });
    s = r.advance(150);
    expect(s.targetW).toBe(120); // mi-échauffement : 60 % de 200 W
    s = r.advance(150);
    expect(s).toMatchObject({ stepIndex: 1, targetW: 220, stepElapsedS: 0, message: 'Premier effort, cadence haute' });
    s = r.advance(60);
    expect(s).toMatchObject({ stepIndex: 2, targetW: 110 });
  });

  it("n'a pas de consigne sur le palier libre, et termine proprement", () => {
    const r = new WorkoutRunner(w, 200);
    expect(r.advance(1100).targetW).toBeUndefined(); // dans le FreeRide (1080 à 1140 s)
    const end = r.advance(10_000);
    expect(end).toMatchObject({ done: true, elapsedS: 1380, targetW: undefined, stepIndex: 11 });
  });

  it('saute au palier suivant et applique un changement d\'intensité en cours de route', () => {
    const r = new WorkoutRunner(w, 200);
    r.advance(10);
    expect(r.skip()).toMatchObject({ stepIndex: 1, elapsedS: 300 });
    r.intensity = 0.9;
    expect(r.state().targetW).toBe(198);
    for (let i = 0; i < 20; i++) r.skip();
    expect(r.state().done).toBe(true);
  });

  it('ignore un pas de temps négatif', () => {
    const r = new WorkoutRunner(w, 200);
    r.advance(30);
    expect(r.advance(-100).elapsedS).toBe(30);
  });
});

describe('envoi des consignes ERG', () => {
  const steps = (targetW: number | undefined, stepIndex: number, done = false) =>
    ({ targetW, stepIndex, done }) as unknown as import('./runner').WorkoutState;

  it('envoie tout de suite au premier palier et à chaque changement de palier', () => {
    const f = new ErgFollower(1000, 2);
    expect(f.next(steps(150, 0), 0)).toBe(150);
    expect(f.next(steps(150, 0), 100)).toBeUndefined();
    expect(f.next(steps(220, 1), 150)).toBe(220); // nouveau palier : pas d'attente
  });

  it('pendant une rampe, au plus une fois par seconde et seulement si la consigne bouge assez', () => {
    const f = new ErgFollower(1000, 2);
    f.next(steps(100, 0), 0);
    expect(f.next(steps(110, 0), 500)).toBeUndefined(); // trop tôt
    expect(f.next(steps(101, 0), 1500)).toBeUndefined(); // trop faible
    expect(f.next(steps(110, 0), 1500)).toBe(110);
  });

  it("n'envoie rien sur un palier libre ni une fois la séance finie, et repart après un reset", () => {
    const f = new ErgFollower();
    expect(f.next(steps(undefined, 3), 0)).toBeUndefined();
    expect(f.next(steps(200, 4, true), 0)).toBeUndefined();
    f.next(steps(200, 5), 0);
    f.reset();
    expect(f.next(steps(200, 5), 10)).toBe(200);
  });
});

describe('profil de séance', () => {
  it('un polygone par palier, zones par fraction de FTP, palier libre neutre', () => {
    const w = parseZwo(sample('decouverte.zwo'));
    const shapes = profileShapes(w, 200, 1380, 100);
    expect(shapes).toHaveLength(12);
    expect(shapes[0]!.d).toMatch(/^M0 100L0 /); // commence au bord gauche, au sol
    expect(shapes.at(-1)!.d).toMatch(/L1380 100Z$/); // finit au bord droit
    expect(shapes.map((s) => s.zone)).toEqual(['z2', 'z5', 'z1', 'z5', 'z1', 'z5', 'z1', 'z5', 'z1', 'z4', 'free', 'z1']);
  });

  it('classe les zones aux bornes usuelles', () => {
    expect([0.5, 0.6, 0.8, 1.0, 1.1, 1.5].map(zoneOf)).toEqual(['z1', 'z2', 'z3', 'z4', 'z5', 'z6']);
  });
});
