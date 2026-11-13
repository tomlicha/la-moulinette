import { describe, expect, it } from 'vitest';
import { DEMO_ROUTE, Route } from '../sim/route';
import type { StepKind, WorkoutStep } from '../workout/model';
import {
  ClimbCounter,
  findSeries,
  fmt1,
  nextSummitM,
  PowerAverage,
  repetitionAt,
  routeProfile,
  signed,
  summitsOf,
  upcoming,
  zoneLabel,
} from './hud-model';

describe('PowerAverage', () => {
  it('moyenne les mesures des 3 dernières secondes', () => {
    const p = new PowerAverage();
    p.push(100, 0);
    p.push(200, 1000);
    p.push(300, 2000);
    expect(p.value(2000)).toBe(200);
    p.push(400, 3500); // la mesure à 0 s sort de la fenêtre
    expect(p.value(3500)).toBe(300);
  });

  it('se tait quand le capteur se tait', () => {
    const p = new PowerAverage();
    p.push(250, 0);
    expect(p.value(3001)).toBeUndefined();
  });
});

describe('ClimbCounter', () => {
  it('ne cumule que les montées', () => {
    const c = new ClimbCounter();
    for (const a of [100, 105, 103, 110, 90]) c.add(a);
    expect(c.total).toBe(12);
    c.reset();
    c.add(50);
    expect(c.total).toBe(0);
  });
});

describe('sommets', () => {
  it('trouve le haut de la montée du parcours de démonstration', () => {
    expect(summitsOf(DEMO_ROUTE)).toEqual([3000]);
  });

  it('compte jusqu’au prochain sommet, tour suivant compris', () => {
    expect(nextSummitM(DEMO_ROUTE, 400)).toBe(2600);
    expect(nextSummitM(DEMO_ROUTE, 3500)).toBe(5500);
    expect(nextSummitM(DEMO_ROUTE, 6400)).toBe(2600);
  });

  it('ne trouve rien sur un parcours plat', () => {
    expect(nextSummitM(new Route('Plat', [{ lengthM: 1000, gradePct: 0 }]), 10)).toBeUndefined();
  });
});

describe('routeProfile', () => {
  it('place le sommet en haut et le départ en bas du repère', () => {
    const p = routeProfile(DEMO_ROUTE, 600, 34);
    expect(p.x(3000)).toBe(300);
    expect(p.y(DEMO_ROUTE.altitudeAt(3000))).toBeCloseTo(3);
    expect(p.y(DEMO_ROUTE.altitudeAt(0))).toBeCloseTo(31);
    expect(p.area.endsWith('Z')).toBe(true);
  });
});

describe('formats', () => {
  it('écrit les nombres à la française', () => {
    expect(fmt1(18.44)).toBe('18,4');
    expect(signed(4.2, 1)).toBe('+4,2');
    expect(signed(-3)).toBe('−3');
    expect(signed(-0.2)).toBe('+0');
  });

  it('nomme la zone d’après la FTP', () => {
    expect(zoneLabel(215, 260)).toEqual({ id: 'z3', label: 'Z3 · Tempo' });
    expect(zoneLabel(270, 260).id).toBe('z4');
  });
});

const st = (kind: StepKind, durationS: number, from?: number, to = from): WorkoutStep => ({
  kind,
  durationS,
  target: from === undefined ? { kind: 'free' } : { kind: 'ftp', from, to: to! },
});
const rep = (n: number, a: WorkoutStep, b: WorkoutStep) => Array.from({ length: n }, () => [a, b]).flat();
// Échauffement, 30/30 × 10, récupération 5 min, 40/20 × 8, retour au calme.
const VO2 = [
  st('warmup', 600, 0.5, 0.75),
  ...rep(9, st('on', 30, 1.2), st('off', 30, 0.5)),
  st('on', 30, 1.2),
  st('off', 300, 0.55),
  ...rep(8, st('on', 40, 1.3), st('off', 20, 0.5)),
  st('cooldown', 480, 0.6, 0.45),
];

describe('findSeries', () => {
  it('repère les séries d’intervalles et leurs répétitions', () => {
    expect(findSeries(VO2)).toEqual([
      { start: 1, end: 19, reps: 10 },
      { start: 21, end: 36, reps: 8 },
    ]);
  });

  it('ignore les paliers qui ne se répètent pas', () => {
    expect(findSeries([st('warmup', 600, 0.5, 0.75), st('steady', 300, 0.8), st('on', 60, 1.1), st('cooldown', 300, 0.5)])).toEqual([]);
    expect(findSeries([st('steady', 60, 0.8), st('steady', 60, 0.8), st('steady', 60, 0.8)])).toEqual([]);
  });

  it('numérote la répétition de l’effort comme de sa récupération', () => {
    const s = findSeries(VO2);
    expect(repetitionAt(s, 5)).toEqual({ rep: 3, reps: 10 });
    expect(repetitionAt(s, 6)).toEqual({ rep: 3, reps: 10 });
    expect(repetitionAt(s, 20)).toBeUndefined();
  });
});

describe('upcoming', () => {
  const series = findSeries(VO2);

  it('pendant un effort : la série en tête, sa récupération à venir', () => {
    const { items, rest } = upcoming(VO2, series, 5, 260);
    expect(items.map((i) => i.kind)).toEqual(['series', 'step', 'series', 'step']);
    const first = items[0]!;
    expect(first.kind === 'series' && { nextIs: first.nextIs, rep: first.rep, reps: first.reps }).toEqual({ nextIs: 1, rep: 3, reps: 10 });
    expect(first.kind === 'series' && first.steps.map((x) => [x.fromW, x.durationS, x.zoneFrom])).toEqual([
      [312, 30, 'z5'],
      [130, 30, 'z1'],
    ]);
    const next = items[2]!;
    expect(next.kind === 'series' && { nextIs: next.nextIs, rep: next.rep, reps: next.reps }).toEqual({ nextIs: undefined, rep: 1, reps: 8 });
    expect(rest).toBe(0);
  });

  it('pendant une récupération : la répétition suivante arrive', () => {
    const first = upcoming(VO2, series, 6, 260).items[0]!;
    expect(first.kind === 'series' && [first.nextIs, first.rep]).toEqual([0, 4]);
  });

  it('montre seul le dernier effort d’une série', () => {
    const first = upcoming(VO2, series, 18, 260).items[0]!;
    expect(first).toEqual({ kind: 'step', step: { fromW: 312, toW: 312, durationS: 30, zoneFrom: 'z5', zoneTo: 'z5' } });
  });

  it('suit l’intensité, les rampes et les paliers libres', () => {
    const steps = [st('steady', 60, 1), st('cooldown', 300, 0.6, 0.45), st('free', 120)];
    const { items } = upcoming(steps, [], 0, 200, 1.1);
    expect(items).toEqual([
      { kind: 'step', step: { fromW: 132, toW: 99, durationS: 300, zoneFrom: 'z2', zoneTo: 'z1' } },
      { kind: 'step', step: { fromW: undefined, toW: undefined, durationS: 120, zoneFrom: 'free', zoneTo: 'free' } },
    ]);
  });

  it('s’arrête au nombre d’éléments demandé et compte le reste', () => {
    const steps = Array.from({ length: 8 }, (_, k) => st('steady', 60 + k, 0.7));
    const { items, rest } = upcoming(steps, [], 0, 260);
    expect(items).toHaveLength(4);
    expect(rest).toBe(3);
    expect(upcoming(steps, [], 7, 260)).toEqual({ items: [], rest: 0 });
  });
});
