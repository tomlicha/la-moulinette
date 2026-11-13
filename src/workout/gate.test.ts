import { describe, expect, it } from 'vitest';
import { nextIntervalGate, GATE_LEAD_S } from './gate';
import type { Workout } from './model';
import { WorkoutRunner } from './runner';

const workout: Workout = {
  name: 'test',
  messages: [],
  warnings: [],
  steps: [
    { kind: 'warmup', durationS: 120, target: { kind: 'ftp', from: 0.5, to: 0.5 } },
    { kind: 'on', durationS: 60, target: { kind: 'ftp', from: 1.1, to: 1.1 } },
    { kind: 'free', durationS: 60, target: { kind: 'free' } },
  ],
};

describe('porte du palier suivant', () => {
  it("n'apparaît qu'à l'approche du changement de palier", () => {
    const r = new WorkoutRunner(workout, 200);
    expect(nextIntervalGate(r.advance(120 - GATE_LEAD_S - 1), 200, 36)).toBeUndefined();
    expect(nextIntervalGate(r.advance(2), 200, 36)).toBeDefined();
  });

  it('se place à la distance parcourue à la vitesse du moment, et prend la couleur de la zone qui commence', () => {
    const r = new WorkoutRunner(workout, 200);
    const g = nextIntervalGate(r.advance(110), 200, 36)!; // 10 s à 10 m/s
    expect(g).toEqual({ key: 1, zone: 'z5', aheadM: 100 });
  });

  it("garde une avance minimale à l'arrêt et une portée bornée à grande vitesse", () => {
    const r = new WorkoutRunner(workout, 200);
    const s = r.advance(100);
    expect(nextIntervalGate(s, 200, 0)!.aheadM).toBe(40);
    expect(nextIntervalGate(s, 200, 90)!.aheadM).toBe(400);
  });

  it('suit l’intensité réglée en cours de route', () => {
    const r = new WorkoutRunner(workout, 200, 0.8); // 110 % × 0,8 = 88 % : tempo
    expect(nextIntervalGate(r.advance(110), 200, 36)!.zone).toBe('z3');
  });

  it('est neutre devant un palier libre, absente sur le dernier palier et en pause', () => {
    const r = new WorkoutRunner(workout, 200);
    expect(nextIntervalGate(r.advance(170), 200, 36)).toMatchObject({ key: 2, zone: 'free' });
    expect(nextIntervalGate(r.state(), 200, 36, true)).toBeUndefined();
    expect(nextIntervalGate(r.advance(60), 200, 36)).toBeUndefined();
  });
});
