import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { RideRecorder, type Recording, type SampleValues } from './recorder';
import { encodeActivity, fitFileName } from './fit-activity';

const T0 = Date.UTC(2026, 9, 27, 18, 0, 0);

/** Enregistre `seconds` secondes à 1 Hz avec les valeurs fournies par `values(i)`. */
function record(seconds: number, values: (i: number) => SampleValues, rec = new RideRecorder(), from = 0) {
  for (let i = from; i < from + seconds; i++) {
    rec.update(values(i), T0 + i * 1000);
    rec.tick(T0 + i * 1000);
  }
  return rec;
}

function decode(bytes: Uint8Array) {
  const stream = Stream.fromByteArray(Array.from(bytes));
  expect(Decoder.isFIT(stream)).toBe(true);
  const decoder = new Decoder(stream);
  expect(decoder.checkIntegrity()).toBe(true);
  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]);
  return messages;
}

describe('RideRecorder', () => {
  it("ne démarre qu'avec une première donnée fraîche", () => {
    const rec = new RideRecorder();
    expect(rec.tick(T0)).toBeUndefined();
    expect(rec.state).toBe('idle');
    rec.update({ powerW: 200 }, T0 + 1000);
    expect(rec.tick(T0 + 1000)).toMatchObject({ powerW: 200 });
    expect(rec.state).toBe('recording');
  });

  it('un seul échantillon par seconde, même si les ticks sont irréguliers', () => {
    const rec = new RideRecorder();
    rec.update({ powerW: 200 }, T0);
    for (const dt of [0, 300, 700, 1000, 1400, 2100]) rec.tick(T0 + dt);
    const out = rec.finish(T0 + 3000)!;
    const times = out.samples.map((s) => s.t);
    expect(new Set(times).size).toBe(times.length);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('omet les champs périmés au lieu de répéter une vieille valeur', () => {
    const rec = new RideRecorder(3000);
    rec.update({ powerW: 200, heartRateBpm: 140 }, T0);
    rec.tick(T0);
    rec.update({ powerW: 210 }, T0 + 4000); // la cardio n'est plus arrivée depuis 4 s
    const s = rec.tick(T0 + 4000)!;
    expect(s.powerW).toBe(210);
    expect(s.heartRateBpm).toBeUndefined();
  });

  it('ignore les valeurs non finies', () => {
    const rec = new RideRecorder();
    rec.update({ powerW: Number.NaN, cadenceRpm: 80 }, T0);
    expect(rec.tick(T0)).toEqual({ t: T0, cadenceRpm: 80 });
  });

  it('retire les pauses du temps de pédalage et ne prend aucun échantillon en pause', () => {
    const rec = new RideRecorder();
    record(10, () => ({ powerW: 200 }), rec, 0);
    rec.pause(T0 + 10_000);
    for (let i = 10; i < 20; i++) {
      rec.update({ powerW: 200 }, T0 + i * 1000);
      expect(rec.tick(T0 + i * 1000)).toBeUndefined();
    }
    expect(rec.state).toBe('paused');
    rec.resume(T0 + 20_000);
    record(10, () => ({ powerW: 200 }), rec, 20);
    const out = rec.finish(T0 + 30_000)!;
    expect(out.samples).toHaveLength(20);
    expect(out.elapsedS).toBe(30);
    expect(out.timerS).toBe(20);
    expect(out.pauses).toEqual([{ fromMs: T0 + 10_000, toMs: T0 + 20_000 }]);
  });

  it('referme une pause encore ouverte à la fin', () => {
    const rec = new RideRecorder();
    record(5, () => ({ powerW: 150 }), rec);
    rec.pause(T0 + 5000);
    const out = rec.finish(T0 + 5000)!;
    expect(out.pauses).toEqual([]); // pause sans durée dans la sortie : ignorée
    expect(out.timerS).toBe(5);
  });

  it('finish sans donnée renvoie undefined et remet à zéro', () => {
    const rec = new RideRecorder();
    expect(rec.finish(T0)).toBeUndefined();
    record(3, () => ({ powerW: 100 }), rec);
    rec.finish(T0 + 3000);
    expect(rec.state).toBe('idle');
    expect(rec.sampleCount).toBe(0);
  });
});

describe('FIT Activity', () => {
  it('produit un fichier valide qui se relit identique', () => {
    const rec = record(60, (i) => ({
      powerW: 200 + (i % 10),
      cadenceRpm: 85,
      heartRateBpm: 130 + Math.floor(i / 10),
      speedMs: 10,
      distanceM: i * 10,
      altitudeM: 100 + i * 0.5,
    }));
    const recording = rec.finish(T0 + 60_000)!;
    const m = decode(encodeActivity(recording));

    expect(m.fileIdMesgs?.[0]).toMatchObject({ type: 'activity', manufacturer: 'development' });
    expect(m.recordMesgs).toHaveLength(60);
    const r5 = m.recordMesgs![5]!;
    expect(r5).toMatchObject({ power: 205, cadence: 85, heartRate: 130, distance: 50 });
    expect(r5.enhancedSpeed).toBeCloseTo(10, 2);
    expect(r5.enhancedAltitude).toBeCloseTo(102.5, 0); // précision du format : 0,2 m
    expect((r5.timestamp as Date).getTime()).toBe(T0 + 5000);

    const session = m.sessionMesgs![0]!;
    expect(session).toMatchObject({
      sport: 'cycling',
      subSport: 'virtualActivity',
      totalElapsedTime: 60,
      totalTimerTime: 60,
      maxPower: 209,
      maxCadence: 85,
      numLaps: 1,
    });
    expect(session.avgPower).toBe(205); // 204,5 arrondi
    expect(session.totalDistance).toBeCloseTo(590, 1);
    expect(session.totalAscent).toBe(30); // 29,5 m, champ entier en mètres
    expect(session.totalWork).toBe(12_270); // somme des 60 puissances, 1 s chacune
    expect(m.lapMesgs).toHaveLength(1);
    expect(m.activityMesgs?.[0]).toMatchObject({ numSessions: 1, type: 'manual' });
  });

  it('encadre la sortie par un évènement de début et de fin du chronomètre', () => {
    const recording = record(5, () => ({ powerW: 100 })).finish(T0 + 5000)!;
    const events = decode(encodeActivity(recording)).eventMesgs!;
    expect(events.map((e) => e.eventType)).toEqual(['start', 'stopAll']);
  });

  it('écrit les pauses comme des arrêts et reprises du chronomètre', () => {
    const rec = new RideRecorder();
    record(10, () => ({ powerW: 200 }), rec, 0);
    rec.pause(T0 + 10_000);
    rec.resume(T0 + 25_000);
    record(10, () => ({ powerW: 200 }), rec, 25);
    const m = decode(encodeActivity(rec.finish(T0 + 35_000)!));
    expect(m.eventMesgs!.map((e) => e.eventType)).toEqual(['start', 'stopAll', 'start', 'stopAll']);
    expect(m.recordMesgs).toHaveLength(20);
    const session = m.sessionMesgs![0]!;
    expect(session.totalElapsedTime).toBe(35);
    expect(session.totalTimerTime).toBe(20);
  });

  it("n'écrit pas les champs manquants et n'invente pas de résumé", () => {
    // Sortie sans cardio, sans cadence, sans distance : trainer à puissance seule.
    const recording = record(10, () => ({ powerW: 180 })).finish(T0 + 10_000)!;
    const m = decode(encodeActivity(recording));
    const r = m.recordMesgs![0]!;
    expect(r.power).toBe(180);
    expect(r.heartRate).toBeUndefined();
    expect(r.cadence).toBeUndefined();
    expect(r.distance).toBeUndefined();
    const s = m.sessionMesgs![0]!;
    expect(s.avgHeartRate).toBeUndefined();
    expect(s.totalDistance).toBeUndefined();
    expect(s.avgPower).toBe(180);
  });

  it('ne garde pas une fréquence cardiaque nulle (ceinture mal portée)', () => {
    const recording = record(5, () => ({ powerW: 150, heartRateBpm: 0 })).finish(T0 + 5000)!;
    const m = decode(encodeActivity(recording));
    expect(m.recordMesgs![0]!.heartRate).toBeUndefined();
  });

  it('borne les valeurs hors plage du format sans corrompre le fichier', () => {
    const recording = record(3, () => ({ powerW: 100_000, cadenceRpm: 900, speedMs: -3 })).finish(T0 + 3000)!;
    const m = decode(encodeActivity(recording));
    const r = m.recordMesgs![0]!;
    expect(r.power).toBe(65534);
    expect(r.cadence).toBe(254);
    expect(r.enhancedSpeed).toBe(0);
  });

  it('refuse une sortie vide', () => {
    const empty: Recording = { startMs: T0, endMs: T0, elapsedS: 0, timerS: 0, samples: [], pauses: [] };
    expect(() => encodeActivity(empty)).toThrow(RangeError);
  });

  it('tient une sortie de 2 h', () => {
    const rec = record(7200, (i) => ({ powerW: 180 + (i % 30), heartRateBpm: 140, distanceM: i * 9 }));
    const bytes = encodeActivity(rec.finish(T0 + 7_200_000)!);
    const m = decode(bytes);
    expect(m.recordMesgs).toHaveLength(7200);
    expect(bytes.length).toBeLessThan(300_000);
  });

  it('nomme le fichier sans caractère interdit', () => {
    expect(fitFileName(new Date(2026, 9, 27, 18, 5).getTime())).toBe('zwift2-20261027-1805.fit');
  });
});
