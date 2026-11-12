import { describe, expect, it } from 'vitest';
import { zoneOf } from './profile';
import { zoneRangesW } from './zones';

describe('zoneRangesW', () => {
  it('donne six zones continues, de la récupération à l’anaérobie', () => {
    const z = zoneRangesW(230);
    expect(z.map((r) => r.id)).toEqual(['z1', 'z2', 'z3', 'z4', 'z5', 'z6']);
    expect(z[0]).toMatchObject({ toW: 128 });
    expect(z[0]!.fromW).toBeUndefined();
    expect(z[1]).toMatchObject({ fromW: 129, toW: 174 });
    expect(z[5]).toMatchObject({ fromW: 278 });
    expect(z[5]!.toW).toBeUndefined();
  });

  it('ne laisse aucun trou entre deux zones', () => {
    for (const ftp of [150, 200, 233, 301, 450]) {
      const z = zoneRangesW(ftp);
      for (let i = 1; i < z.length; i++) expect(z[i]!.fromW).toBe(z[i - 1]!.toW! + 1);
    }
  });

  it('place chaque borne dans la zone annoncée', () => {
    const ftp = 250;
    for (const r of zoneRangesW(ftp)) {
      if (r.fromW !== undefined) expect(zoneOf(r.fromW / ftp)).toBe(r.id);
      if (r.toW !== undefined) expect(zoneOf(r.toW / ftp)).toBe(r.id);
    }
  });
});
