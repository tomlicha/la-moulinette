import { describe, expect, it } from 'vitest';
import { controlModes, radarTag } from './radar-model';

describe('bulle du radar', () => {
  it('donne le rôle puis le nom réel de l’appareil connecté', () => {
    expect(radarTag('trainer', { state: 'connected', name: 'Wahoo KICKR 81B5', detail: 'ERG et SIM' })).toEqual({
      role: 'Trainer',
      name: 'Wahoo KICKR 81B5',
      status: 'Connecté · ERG et SIM',
      tone: 'ok',
    });
  });

  it('garde le nom mémorisé pendant la recherche et quand l’appareil est absent', () => {
    expect(radarTag('hr', { state: 'connecting', name: 'Polar H10 7B2E1C' })).toMatchObject({
      role: 'Cardio',
      name: 'Polar H10 7B2E1C',
      status: 'Recherche en cours…',
      tone: 'busy',
    });
    expect(radarTag('hr', { state: 'disconnected', name: 'Polar H10 7B2E1C' })).toMatchObject({ status: 'Non connecté', tone: 'off' });
  });

  it('dit qu’aucun appareil n’est connu plutôt que de laisser un blanc', () => {
    expect(radarTag('trainer', { state: 'disconnected' })).toMatchObject({ name: 'Aucun appareil connu', tone: 'off' });
  });

  it('signale une erreur', () => {
    expect(radarTag('trainer', { state: 'error', name: 'KICKR' })).toMatchObject({ status: 'Erreur de connexion', tone: 'error' });
  });

  it('n’ajoute pas de précision vide à « Connecté »', () => {
    expect(radarTag('hr', { state: 'connected', name: 'H10', detail: '' }).status).toBe('Connecté');
  });
});

describe('modes pilotables', () => {
  it('liste ceux que le trainer sait piloter', () => {
    expect(controlModes({ targetPower: true, simulation: true })).toBe('ERG et SIM');
    expect(controlModes({ targetPower: false, simulation: true })).toBe('SIM');
    expect(controlModes({ targetPower: false, simulation: false })).toBe('');
    expect(controlModes(undefined)).toBe('');
  });
});
