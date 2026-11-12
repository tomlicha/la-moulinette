import { describe, expect, it } from 'vitest';
import {
  decodeFec,
  decodeFecCommandStatus,
  decodeFecTrainerStatus,
  fecPages,
  fecRequestPage,
  fecTargetPower,
  fecTrackResistance,
  fecUserConfig,
  fecWindResistance,
} from './fec';

/** Message ANT de diffusion, somme XOR calculée ici indépendamment de l'encodeur. */
const broadcast = (...page: number[]) => {
  const m = [0xa4, 0x09, 0x4e, 0x05, ...page];
  return [...m, m.reduce((x, b) => x ^ b, 0)];
};

describe('FE-C over BLE, encodage', () => {
  it('puissance cible en 0,25 W, message acquitté avec somme XOR', () => {
    expect([...fecTargetPower(200)]).toEqual([0xa4, 0x09, 0x4f, 0x05, 0x31, 0xff, 0xff, 0xff, 0xff, 0xff, 0x20, 0x03, 0x0a]);
  });

  it('pente décalée de 200 % en 0,01 %, Crr en 5×10⁻⁵', () => {
    expect([...fecTrackResistance(0)]).toEqual([0xa4, 0x09, 0x4f, 0x05, 0x33, 0xff, 0xff, 0xff, 0xff, 0x20, 0x4e, 0x50, 0xea]);
    const descent = fecTrackResistance(-5.5);
    expect(descent[9]! | (descent[10]! << 8)).toBe(19450);
  });

  it('traînée, vent et aspiration', () => {
    const m = fecWindResistance(0.51, 0, 1);
    expect([...m.slice(4, 12)]).toEqual([0x32, 0xff, 0xff, 0xff, 0xff, 51, 127, 100]);
  });

  it('poids cycliste et vélo, diamètre de roue', () => {
    const m = fecUserConfig(72, 8, 0.7);
    // 7200 = 0x1C20 ; vélo 8 kg = 160 × 0,05 kg = 0x0A0, réparti sur deux demi-octets
    expect([...m.slice(4, 12)]).toEqual([0x37, 0x20, 0x1c, 0xff, 0x00, 0x0a, 70, 0x00]);
  });
});

describe('FE-C over BLE, décodage', () => {
  it('lit puissance et cadence (page 25)', () => {
    // cadence 90, puissance 250 sur 12 bits (0x0FA)
    expect(decodeFec(Uint8Array.from(broadcast(0x19, 0x01, 90, 0, 0, 0xfa, 0x30, 0x00)))).toEqual({ powerW: 250, cadenceRpm: 90 });
  });

  it('lit vitesse et cardio (page 16)', () => {
    // 10 000 mm/s = 36 km/h ; cardio 140
    const m = decodeFec(Uint8Array.from(broadcast(0x10, 0x19, 0, 0, 0x10, 0x27, 140, 0x00)));
    expect(m.speedKmh).toBeCloseTo(36);
    expect(m.heartRateBpm).toBe(140);
  });

  it('ignore les valeurs marquées invalides', () => {
    expect(decodeFec(Uint8Array.from(broadcast(0x19, 0x01, 0xff, 0, 0, 0xff, 0x0f, 0x00)))).toEqual({});
  });

  it('lit plusieurs messages dans une notification et rejette une somme fausse', () => {
    const good = broadcast(0x19, 0x01, 80, 0, 0, 100, 0x00, 0x00);
    const bad = broadcast(0x10, 0x19, 0, 0, 0x10, 0x27, 140, 0x00);
    bad[12] = bad[12]! ^ 0x01;
    expect(fecPages(Uint8Array.from([...bad, ...good]))).toHaveLength(1);
    expect(decodeFec(Uint8Array.from([...bad, ...good]))).toEqual({ powerW: 100, cadenceRpm: 80 });
  });
});

describe('FE-C over BLE, pages de reprise', () => {
  it("demande l'état de commande une seule fois (page 70 → 71)", () => {
    expect([...fecRequestPage(0x47).slice(4, 12)]).toEqual([0x46, 0xff, 0xff, 0xff, 0xff, 0x01, 0x47, 0x01]);
  });

  it('lit la dernière commande reçue et son état (page 71)', () => {
    expect(decodeFecCommandStatus(Uint8Array.of(0x47, 0x33, 0x07, 0x01, 0xff, 0x20, 0x4e, 0x50))).toEqual({
      lastCommand: 0x33,
      sequence: 7,
      status: 1,
    });
    expect(decodeFecCommandStatus(Uint8Array.of(0x19, 0, 0, 0, 0, 0, 0, 0))).toBeUndefined();
  });

  it('lit ce que réclame le trainer (page 25, octet 6)', () => {
    expect(decodeFecTrainerStatus(Uint8Array.of(0x19, 1, 90, 0, 0, 0xfa, 0x40, 0x30))).toEqual({
      userConfigRequired: true,
      calibrationRequired: false,
    });
    expect(decodeFecTrainerStatus(Uint8Array.of(0x19, 1, 90, 0, 0, 0xfa, 0x10, 0x30))).toEqual({
      userConfigRequired: false,
      calibrationRequired: true,
    });
  });
});
