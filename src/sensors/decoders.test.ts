import { describe, expect, it } from 'vitest';
import {
  cadenceFromCrank,
  decodeCyclingPower,
  decodeFtmsFeature,
  decodeHeartRate,
  decodeIndoorBikeData,
} from './decoders';
import { decodeResponse, encodeSimulation, encodeTargetPower } from './control-point';
import { wahooGrade, wahooSimMode, wahooSimulation, wahooTargetPower } from './wahoo';

const u8 = (...n: number[]) => Uint8Array.from(n);

describe('Indoor Bike Data', () => {
  it('décode vitesse, cadence et puissance', () => {
    // flags 0x0044 : cadence (bit 2) + puissance (bit 6), vitesse présente (bit 0 à 0)
    // vitesse 3000 = 30,00 km/h ; cadence 170 = 85 rpm ; puissance 250 W
    const m = decodeIndoorBikeData(u8(0x44, 0x00, 0xb8, 0x0b, 0xaa, 0x00, 0xfa, 0x00));
    expect(m).toMatchObject({ speedKmh: 30, cadenceRpm: 85, powerW: 250 });
  });

  it('saute les champs non exploités pour atteindre la fréquence cardiaque', () => {
    // flags 0x0340 : puissance, énergie (5 octets), cardio
    const m = decodeIndoorBikeData(u8(0x40, 0x03, 0x00, 0x00, 0x64, 0x00, 1, 0, 2, 0, 3, 142));
    expect(m.powerW).toBe(100);
    expect(m.heartRateBpm).toBe(142);
  });

  it('refuse une trame tronquée', () => {
    expect(() => decodeIndoorBikeData(u8(0x44, 0x00, 0xb8))).toThrow(RangeError);
  });
});

describe('Cycling Power', () => {
  it('décode la puissance seule, y compris négative', () => {
    expect(decodeCyclingPower(u8(0, 0, 0xc8, 0x00)).powerW).toBe(200);
    expect(decodeCyclingPower(u8(0, 0, 0xfb, 0xff)).powerW).toBe(-5);
  });

  it('lit les données de manivelle après les champs optionnels', () => {
    // flags 0x0021 : équilibre (1 octet) + manivelle
    const f = decodeCyclingPower(u8(0x21, 0x00, 0x64, 0x00, 50, 0x0a, 0x00, 0x00, 0x04));
    expect(f.crank).toEqual({ revs: 10, time1024: 1024 });
  });

  it('calcule la cadence avec rebouclage des compteurs 16 bits', () => {
    expect(cadenceFromCrank({ revs: 100, time1024: 0 }, { revs: 102, time1024: 1536 })).toBeCloseTo(80);
    expect(cadenceFromCrank({ revs: 65535, time1024: 65000 }, { revs: 1, time1024: 500 })).toBeGreaterThan(0);
    expect(cadenceFromCrank({ revs: 5, time1024: 10 }, { revs: 5, time1024: 10 })).toBeUndefined();
  });
});

describe('Heart Rate', () => {
  it('gère les formats 8 et 16 bits', () => {
    expect(decodeHeartRate(u8(0x00, 150))).toBe(150);
    expect(decodeHeartRate(u8(0x01, 0x2c, 0x01))).toBe(300);
  });
});

describe('FTMS feature', () => {
  it('détecte puissance cible et simulation de pente', () => {
    expect(decodeFtmsFeature(u8(0, 0, 0, 0, 0x08, 0x20, 0x00, 0x00))).toEqual({ targetPower: true, simulation: true });
  });
  it('détecte leur absence', () => {
    expect(decodeFtmsFeature(u8(0, 0, 0, 0, 0, 0, 0, 0))).toEqual({ targetPower: false, simulation: false });
  });
});

describe('Control Point', () => {
  it('encode la puissance cible', () => {
    expect([...encodeTargetPower(250)]).toEqual([0x05, 0xfa, 0x00]);
  });

  it('encode la simulation avec pente négative', () => {
    // -3,5 % => -350 = 0xFEA2 ; vent 0 ; Crr 0,004 => 40 ; Cw 0,51 => 51
    expect([...encodeSimulation({ gradePct: -3.5 })]).toEqual([0x11, 0, 0, 0xa2, 0xfe, 40, 51]);
  });

  it('décode les réponses', () => {
    expect(decodeResponse(u8(0x80, 0x05, 0x01))).toEqual({ requestOp: 5, result: 1, ok: true });
    expect(decodeResponse(u8(0x80, 0x05, 0x05))?.ok).toBe(false);
    expect(decodeResponse(u8(0x01, 0x02))).toBeNull();
  });
});

describe('Wahoo propriétaire', () => {
  it('encode la puissance cible (0x42, 16 bits little-endian)', () => {
    expect([...wahooTargetPower(250)]).toEqual([0x42, 0xfa, 0x00]);
  });

  it('encode la pente : 0 % = 32768, +4 % = 34079', () => {
    expect([...wahooGrade(0)]).toEqual([0x46, 0x00, 0x80]);
    expect([...wahooGrade(4)]).toEqual([0x46, 0x1f, 0x85]);
  });

  it('encode le mode simulation : poids x100, Crr x10000, Cw x1000', () => {
    // 80 kg = 8000 = 0x1f40 ; Crr 0,004 = 40 = 0x28 ; Cw 0,51 = 510 = 0x01fe
    expect([...wahooSimMode(80, 0.004, 0.51)]).toEqual([0x43, 0x40, 0x1f, 0x28, 0x00, 0xfe, 0x01]);
  });

  it('utilise la masse fournie dans la séquence de simulation', () => {
    // 72 kg = 7200 = 0x1c20
    const [mode] = wahooSimulation({ gradePct: 0, massKg: 72 });
    expect([...mode!].slice(0, 3)).toEqual([0x43, 0x20, 0x1c]);
  });
});
