import { describe, expect, it } from 'vitest';
import { firmwareAdvice, identifyTrainer, protocolOrder } from './trainer-profiles';

describe('identifyTrainer', () => {
  it.each([
    ['KICKR 81B5', 'kickr', 'wahoo'],
    ['KICKR CORE 1A2B', 'kickr-core', 'wahoo'],
    ['KICKR SNAP 0042', 'kickr-snap', 'wahoo'],
    ['KICKR BIKE 1234', 'kickr-bike', 'wahoo'],
    ['Tacx Neo 2T 12345', 'tacx-neo', 'tacx'],
    ['Tacx Flux-2 23456', 'tacx-flux-2', 'tacx'],
    ['Tacx Flux S 34567', 'tacx-flux', 'tacx'],
    ['Tacx Vortex 45678', 'tacx-vortex', 'tacx'],
    ['DIRETO XR 01234', 'elite-direto-xr', 'elite'],
    ['Direto X 01234', 'elite-direto-x', 'elite'],
    ['SUITO 56789', 'elite-suito', 'elite'],
    ['Zwift Hub 1234', 'generique', 'autre'],
  ])('%s → %s', (name, id, brand) => {
    expect(identifyTrainer(name)).toMatchObject({ id, brand });
  });

  it.each([
    ['KICKR 81B5', 20],
    ['KICKR CORE 1', 16],
    ['KICKR SNAP 1', 12],
    ['KICKR ROLLR 1', 10],
    ['Tacx Neo 2T 1', 25],
    ['Tacx Flux-2 1', 16],
    ['Tacx Genius 1', 20],
    ['SUITO 1', 15],
    ['ZUMO 1', 12],
    ['TUO 1', 10],
    ['AVANTI 1', 18],
    ['DIRETO II 1', undefined],
  ])('pente maximale vérifiée : %s → %s %', (name, max) => {
    expect(identifyTrainer(name).maxGradePct).toBe(max);
  });

  it('reconnaît la marque par le fabricant quand le nom est muet', () => {
    expect(identifyTrainer('Trainer 1234', { manufacturer: 'Wahoo Fitness' })).toMatchObject({ brand: 'wahoo', id: 'kickr' });
    expect(identifyTrainer('T2875', { manufacturer: 'Tacx', model: 'NEO 2T' })).toMatchObject({ id: 'tacx-neo' });
  });

  it('préfère le contrôle propriétaire chez Wahoo, FTMS puis FE-C chez Tacx', () => {
    expect(protocolOrder(identifyTrainer('KICKR 81B5'))).toEqual(['wahoo', 'ftms', 'fec']);
    expect(protocolOrder(identifyTrainer('Tacx Neo 2T'))).toEqual(['ftms', 'fec', 'wahoo']);
    expect(protocolOrder(identifyTrainer('SUITO 1'))).toEqual(['ftms', 'wahoo', 'fec']);
  });

  it('place le protocole imposé en tête, sans doublon', () => {
    expect(protocolOrder(identifyTrainer('KICKR 81B5'), 'ftms')).toEqual(['ftms', 'wahoo', 'fec']);
  });

  it("conseille l'app de mise à jour de la marque", () => {
    expect(firmwareAdvice(identifyTrainer('Tacx Vortex 1'), { firmware: '0.0.12' })).toContain("Tacx Vortex (firmware 0.0.12)");
    expect(firmwareAdvice(identifyTrainer('Tacx Vortex 1'))).toContain('Tacx Training');
    expect(firmwareAdvice(identifyTrainer('KICKR 81B5'))).toContain("l'app Wahoo");
  });
});
