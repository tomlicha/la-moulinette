import { describe, expect, it } from 'vitest';
import { twoBoneJoint } from './ik';

const dist = (a: { y: number; z: number }, b: { y: number; z: number }) => Math.hypot(a.y - b.y, a.z - b.z);

describe('twoBoneJoint', () => {
  const hip = { y: 0.95, z: -0.28 };

  it('respecte la longueur des deux segments quelle que soit la cible', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const pedal = { y: 0.28 + 0.17 * Math.cos(a), z: -0.1 + 0.17 * Math.sin(a) };
      const knee = twoBoneJoint(hip, pedal, 0.44, 0.44, 1);
      expect(dist(hip, knee)).toBeCloseTo(0.44, 6);
      expect(dist(knee, pedal)).toBeCloseTo(0.44, 6);
    }
  });

  it('plie le genou vers l\'avant (+z) tout le long du tour de pédale', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const pedal = { y: 0.28 + 0.17 * Math.cos(a), z: -0.1 + 0.17 * Math.sin(a) };
      const knee = twoBoneJoint(hip, pedal, 0.44, 0.44, 1);
      const mid = (hip.z + pedal.z) / 2;
      expect(knee.z).toBeGreaterThan(mid);
    }
  });

  it("plie de l'autre côté avec bend = -1", () => {
    const pedal = { y: 0.3, z: -0.1 };
    const front = twoBoneJoint(hip, pedal, 0.44, 0.44, 1);
    const back = twoBoneJoint(hip, pedal, 0.44, 0.44, -1);
    expect(front.z).toBeGreaterThan(back.z);
  });

  it('tend le membre en ligne droite quand la cible est hors de portée', () => {
    const far = { y: -1, z: hip.z };
    const knee = twoBoneJoint(hip, far, 0.4, 0.4, 1);
    expect(dist(hip, knee)).toBeCloseTo(0.4, 3);
    expect(knee.y).toBeLessThan(hip.y);
    expect(Math.abs(knee.z - hip.z)).toBeLessThan(0.01);
  });
});
