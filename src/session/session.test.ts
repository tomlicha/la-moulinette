import { describe, expect, it } from 'vitest';
import { TrainingSession, type SessionTrainer } from './session';
import { DEMO_ROUTE } from '../sim/route';
import type { SimulationParams } from '../sensors/types';
import type { LogLevel } from '../util/log';
import type { Workout } from '../workout/model';

const CAPS = { targetPower: true, simulation: true };

class FakeTrainer implements SessionTrainer {
  targets: number[] = [];
  grades: number[] = [];
  fail = false;
  async setTargetPower(w: number) {
    if (this.fail) throw new Error('pas de réponse');
    this.targets.push(w);
  }
  async setSimulation(p: SimulationParams) {
    if (this.fail) throw new Error('pas de réponse');
    this.grades.push(p.gradePct);
  }
}

function setup() {
  const clock = { t: 1000 };
  const trainer = new FakeTrainer();
  const logs: [string, LogLevel | undefined][] = [];
  const session = new TrainingSession({
    trainer,
    route: DEMO_ROUTE,
    log: (m, l) => logs.push([m, l]),
    manualGradePct: () => 1,
    now: () => clock.t,
    later: () => {},
  });
  /** Avance l'horloge par pas de `step` ms en appelant `tick`, et laisse les promesses du faux trainer se résoudre. */
  const advance = async (ms: number, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      clock.t += step;
      session.tick();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    }
  };
  return { clock, trainer, logs, session, advance };
}

const WORKOUT: Workout = {
  name: 'test',
  steps: [
    { kind: 'steady', durationS: 10, target: { kind: 'ftp', from: 0.5, to: 0.5 } },
    { kind: 'free', durationS: 10, target: { kind: 'free' } },
    { kind: 'steady', durationS: 10, target: { kind: 'ftp', from: 1, to: 1 } },
  ],
  messages: [],
  warnings: [],
};

describe('TrainingSession, sortie virtuelle', () => {
  it('fait avancer la sortie avec la puissance mesurée', async () => {
    const { session, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startRide(80);
    for (let i = 0; i < 50; i++) {
      session.onMeasurement({ t: 0, powerW: 250 });
      await advance(200);
    }
    expect(session.lastRide!.distanceM).toBeGreaterThan(50);
    expect(session.lastRide!.speedKmh).toBeGreaterThan(15);
  });

  it("roule à 0 W quand la puissance n'est plus fraîche", async () => {
    const { session, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startRide(80);
    for (let i = 0; i < 50; i++) {
      session.onMeasurement({ t: 0, powerW: 250 });
      await advance(200);
    }
    const before = session.lastRide!.speedKmh;
    await advance(10_000); // plus aucune mesure : freinage
    expect(session.lastRide!.speedKmh).toBeLessThan(before / 2);
    expect(session.readings().powerW).toBeUndefined();
  });

  it("arrête la sortie et l'ERG quand la reconnexion du trainer est abandonnée", async () => {
    const { session } = setup();
    session.setConnection('connected', CAPS);
    session.startRide(80);
    await session.toggleErg(200);
    expect(session.ergActive).toBe(true);
    session.setConnection('error', CAPS);
    expect(session.riding).toBe(false);
    expect(session.ergActive).toBe(false);
  });

  it("envoie la pente du parcours en SIM, mais pas pendant l'ERG", async () => {
    const { session, trainer, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startRide(80);
    await advance(300);
    expect(trainer.grades).toHaveLength(1);
    await session.toggleErg(200);
    session.onMeasurement({ t: 0, powerW: 400 });
    await advance(30_000, 500);
    expect(trainer.grades).toHaveLength(1);
  });
});

describe('TrainingSession, séance', () => {
  it("engage l'ERG, le relâche sur un palier libre puis le reprend", async () => {
    const { session, trainer, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startWorkout(WORKOUT, 200);
    await advance(200);
    expect(trainer.targets).toEqual([100]);
    expect(session.ergActive).toBe(true);

    await advance(10_000); // palier libre
    expect(session.ergActive).toBe(false);
    expect(trainer.grades).toEqual([1]); // hors sortie : relâché par une consigne de pente

    await advance(10_000);
    expect(trainer.targets.at(-1)).toBe(200);
    expect(session.ergActive).toBe(true);
  });

  it("se termine seule et relâche l'ERG", async () => {
    const { session, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startWorkout(WORKOUT, 200);
    await advance(31_000);
    expect(session.workout).toBeUndefined();
    expect(session.ergActive).toBe(false);
  });

  it('ne compte pas le temps sans trainer connecté', async () => {
    const { session, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startWorkout(WORKOUT, 200);
    session.setConnection('connecting', CAPS);
    await advance(5000);
    expect(session.workoutState!.elapsedS).toBe(0);
  });

  it('attend avant de réessayer une consigne refusée, et la journalise comme erreur', async () => {
    const { session, trainer, logs, advance } = setup();
    session.setConnection('connected', CAPS);
    trainer.fail = true;
    session.startWorkout(WORKOUT, 200);
    await advance(1500);
    expect(logs.filter(([m, l]) => m.includes('non envoyée') && l === 'error')).toHaveLength(1);
    trainer.fail = false;
    await advance(1000);
    expect(trainer.targets).toEqual([100]);
  });

  it("continue sans consigne quand l'ERG est désengagé à la main, puis le reprend", async () => {
    const { session, trainer, advance } = setup();
    session.setConnection('connected', CAPS);
    session.startWorkout(WORKOUT, 200);
    await advance(200);
    await session.toggleErg(0); // désengager
    expect(session.ergActive).toBe(false);
    await advance(3000);
    expect(trainer.targets).toEqual([100]);
    await session.toggleErg(0); // réengager : la séance renvoie sa consigne
    await advance(100);
    expect(trainer.targets).toEqual([100, 100]);
  });

  it("borne l'intensité entre 50 et 150 %", () => {
    const { session } = setup();
    session.setConnection('connected', CAPS);
    session.startWorkout(WORKOUT, 200);
    for (let i = 0; i < 20; i++) session.nudgeIntensity(0.05);
    expect(session.workout!.intensity).toBe(1.5);
  });
});
