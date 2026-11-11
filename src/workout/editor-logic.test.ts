import { describe, expect, it } from 'vitest';
import { blocksToWorkout, type EditorBlock } from './blocks';
import { blockIndexAt, blockRanges, blockShort, describeBlock, nudgeDuration, nudgePower, splitIntervals } from './block-ops';
import { UndoHistory } from './history';
import { profilePeakW } from './profile';
import { effortSeconds, intensityWord, timeInZones, zoneReading } from './zones';

const sweetSpot: EditorBlock[] = [
  { type: 'warmup', durationS: 600, from: 0.45, to: 0.75 },
  { type: 'intervals', repeat: 3, onS: 600, offS: 300, onPower: 0.9, offPower: 0.55 },
  { type: 'cooldown', durationS: 300, from: 0.65, to: 0.4 },
];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

describe('temps par zone', () => {
  it("ventile la séance d'exemple comme sur la maquette", () => {
    const z = timeInZones(blocksToWorkout('n', '', sweetSpot), 200);
    expect(z.z3).toBe(1800); // 30:00 en tempo
    expect(z.z1 + z.z2 + z.z3).toBe(3600);
    // Récupération sous 112 W (56 %, consigne arrondie au watt) : 215 s d'échauffement, 15 min de récupérations,
    // 189 s de retour au calme.
    expect(z.z1).toBe(215 + 900 + 189);
    expect(z.z2).toBe(385 + 111);
    expect(effortSeconds(z)).toBe(1800);
  });

  it('passe les efforts au seuil quand on monte à 95 %', () => {
    const z = timeInZones(blocksToWorkout('n', '', [nudgePower(sweetSpot[1]!, 0.05)]), 200);
    expect(z.z4).toBe(1800);
    expect(z.z3).toBe(0);
  });

  it('compte un palier libre à part et lit le résultat en une phrase', () => {
    const z = timeInZones(
      blocksToWorkout('n', '', [{ type: 'free', durationS: 60 }, { type: 'steady', durationS: 120, power: 1.1 }]),
      200,
    );
    expect(z.free).toBe(60);
    expect(z.z5).toBe(120);
    expect(zoneReading(z, mmss)).toBe('2:00 au-dessus du seuil : séance intense.');
    expect(zoneReading(timeInZones(blocksToWorkout('n', '', sweetSpot), 200), mmss)).toMatch(/endurance active/);
  });

  it("nomme l'intensité", () => {
    expect([0.5, 0.79, 0.82, 0.95, 1.05].map(intensityWord)).toEqual(['facile', 'modérée', 'soutenue', 'difficile', 'très difficile']);
  });
});

describe('opérations sur les blocs', () => {
  it("ajuste la puissance principale par pas, sans sortir des bornes ni accumuler d'arrondis", () => {
    let b: EditorBlock = sweetSpot[1]!;
    for (let i = 0; i < 3; i++) b = nudgePower(b, 0.05);
    expect(b).toMatchObject({ onPower: 1.05, offPower: 0.55 });
    expect(nudgePower(sweetSpot[0]!, 0.05)).toMatchObject({ from: 0.5, to: 0.8 });
    expect(nudgePower({ type: 'steady', durationS: 60, power: 0.05 }, -0.05)).toMatchObject({ power: 0.05 });
    const free: EditorBlock = { type: 'free', durationS: 60 };
    expect(nudgePower(free, 0.05)).toBe(free);
  });

  it('ajuste la durée principale, jamais sous 5 s', () => {
    expect(nudgeDuration(sweetSpot[1]!, 15)).toMatchObject({ onS: 615, offS: 300 });
    expect(nudgeDuration({ type: 'steady', durationS: 10, power: 1 }, -15)).toMatchObject({ durationS: 5 });
  });

  it('sépare des intervalles en paliers sans changer le profil', () => {
    const split = splitIntervals({ ...sweetSpot[1]!, cadenceRpm: 95 } as EditorBlock);
    expect(split).toHaveLength(6);
    expect(split[0]).toEqual({ type: 'steady', durationS: 600, power: 0.9, cadenceRpm: 95 });
    expect(split[1]).toEqual({ type: 'steady', durationS: 300, power: 0.55 });
    const before = blocksToWorkout('n', '', [sweetSpot[1]!]).steps.map((s) => [s.durationS, s.target]);
    const after = blocksToWorkout('n', '', split).steps.map((s) => [s.durationS, s.target]);
    expect(after).toEqual(before);
  });

  it('situe les blocs dans le temps', () => {
    expect(blockRanges(sweetSpot)).toEqual([
      { start: 0, end: 600 },
      { start: 600, end: 3300 },
      { start: 3300, end: 3600 },
    ]);
    expect([0, 599, 600, 3299, 3300, 3600, 9999].map((t) => blockIndexAt(sweetSpot, t))).toEqual([0, 0, 1, 1, 2, 2, 2]);
  });

  it('résume et décrit un bloc avec watts et zone', () => {
    expect(blockShort(sweetSpot[1]!)).toBe('3 × (10:00 à 90 % + 5:00 à 55 %)');
    expect(blockShort(sweetSpot[0]!)).toBe('10:00 · 45→75 %');
    expect(describeBlock(nudgePower(sweetSpot[1]!, 0.05), 200)).toBe(
      'Intervalles · 3 × 10:00 à 95 % (190 W, Seuil), récupération 5:00 à 55 % (110 W)',
    );
    expect(describeBlock({ type: 'steady', durationS: 90, power: 0.7 }, 250)).toBe('Palier · 1:30 à 70 % (175 W, Endurance)');
  });

  it("aligne l'échelle du profil sur 130 % de la FTP, ou plus si un palier dépasse", () => {
    expect(profilePeakW(blocksToWorkout('n', '', sweetSpot), 200)).toBe(260);
    expect(profilePeakW(blocksToWorkout('n', '', [{ type: 'steady', durationS: 30, power: 1.5 }]), 200)).toBeCloseTo(324);
  });
});

describe('annuler et rétablir', () => {
  it('rejoue les états dans les deux sens et vide le futur à une nouvelle modification', () => {
    const h = new UndoHistory<number[]>();
    let cur = [1];
    h.record(cur);
    cur = [1, 2];
    h.record(cur);
    cur = [1, 2, 3];
    expect(h.canUndo).toBe(true);
    cur = h.undo(cur)!;
    expect(cur).toEqual([1, 2]);
    cur = h.undo(cur)!;
    expect(cur).toEqual([1]);
    expect(h.undo(cur)).toBeUndefined();
    cur = h.redo(cur)!;
    expect(cur).toEqual([1, 2]);
    h.record(cur);
    expect(h.canRedo).toBe(false);
  });

  it("garde des copies : modifier l'état courant ne change pas l'historique", () => {
    const h = new UndoHistory<{ v: number }>();
    const s = { v: 1 };
    h.record(s);
    s.v = 2;
    expect(h.undo(s)).toEqual({ v: 1 });
  });

  it("borne la taille de l'historique", () => {
    const h = new UndoHistory<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    let n = 0;
    let cur = 10;
    for (let x = h.undo(cur); x !== undefined; x = h.undo(cur)) {
      cur = x;
      n++;
    }
    expect(n).toBe(3);
  });
});
