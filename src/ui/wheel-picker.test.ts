import { describe, expect, it } from 'vitest';
import { clampTo, joinDigits, splitDigits, wheelValues } from './wheel-picker';

describe('wheelValues', () => {
  it('va de min à max par pas', () => {
    expect(wheelValues(50, 70, 5, 60)).toEqual([50, 55, 60, 65, 70]);
  });

  it('ajoute la valeur actuelle quand elle est hors de la grille', () => {
    expect(wheelValues(50, 70, 5, 63)).toEqual([50, 55, 60, 63, 65, 70]);
  });

  it('ignore une valeur hors des bornes', () => {
    expect(wheelValues(30, 33, 1, 500)).toEqual([30, 31, 32, 33]);
  });
});

describe('chiffres', () => {
  it('sépare centaines, dizaines et unités', () => {
    expect(splitDigits(230)).toEqual([2, 3, 0]);
    expect(splitDigits(50)).toEqual([0, 5, 0]);
    expect(splitDigits(7)).toEqual([0, 0, 7]);
  });

  it('recompose la valeur', () => {
    expect(joinDigits([2, 3, 4])).toBe(234);
    expect(joinDigits(splitDigits(587))).toBe(587);
  });

  it('ramène une valeur hors bornes dans les bornes', () => {
    expect(clampTo(799, 50, 600)).toBe(600);
    expect(clampTo(12, 50, 600)).toBe(50);
    expect(clampTo(230, 50, 600)).toBe(230);
  });
});
