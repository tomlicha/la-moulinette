import { describe, expect, it } from 'vitest';
import { wheelValues } from './wheel-picker';

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
