import { Emitter } from './emitter';
import type { Measurement, SimulationParams, TrainerAdapter } from './types';

/** Au-delà de ce délai sans trame, la valeur cardio d'une ceinture n'est plus jugée fraîche. */
const HR_FRESH_MS = 5000;
/** Au-delà de ce délai sans nouvelle valeur, un champ du trainer (puissance, cadence…) n'est plus republié. */
export const TRAINER_FRESH_MS = 3000;

type Field = Exclude<keyof Measurement, 't'>;
const FIELDS: readonly Field[] = ['powerW', 'cadenceRpm', 'speedKmh', 'distanceM', 'heartRateBpm'];

/** Source de mesures secondaire (ceinture cardio, capteur de foulée…) : seul le sous-ensemble utile du contrat. */
export interface MeasurementSource {
  on: TrainerAdapter['on'];
}

/**
 * Point d'entrée unique pour l'application : un trainer pilotable et des sources annexes,
 * fusionnés en un flux de mesures. La ceinture cardio prime sur le cardio relayé par le trainer.
 *
 * Chaque champ garde l'heure de sa dernière valeur : une mesure publiée ne contient que des champs frais.
 * Sans cela, la ceinture cardio, qui continue d'émettre, ferait passer pour récente la dernière puissance
 * d'un trainer qui s'est tu.
 */
export class SensorHub extends Emitter {
  private trainer?: TrainerAdapter;
  private latest: Partial<Record<Field, { v: number; t: number }>> = {};
  private hr?: { bpm: number; t: number };

  attachTrainer(t: TrainerAdapter) {
    this.trainer = t;
    this.latest = {};
    t.on('measurement', (m) => {
      if (this.trainer !== t) return; // ancien trainer remplacé : ses trames éventuelles sont ignorées
      for (const k of FIELDS) {
        const v = m[k];
        if (v !== undefined) this.latest[k] = { v, t: m.t };
      }
      this.publish(m.t);
    });
    t.on('log', (l, level) => this.emit('log', l, level));
    t.on('raw', (s, d) => this.emit('raw', s, d));
  }

  attachHeartRate(src: MeasurementSource) {
    src.on('measurement', (m) => {
      if (m.heartRateBpm === undefined) return;
      this.hr = { bpm: m.heartRateBpm, t: m.t };
      this.publish(m.t);
    });
    src.on('log', (l, level) => this.emit('log', l, level));
    src.on('raw', (s, d) => this.emit('raw', s, d));
  }

  private publish(t: number) {
    const merged: Measurement = { t };
    for (const k of FIELDS) {
      const e = this.latest[k];
      if (e && t - e.t <= TRAINER_FRESH_MS) merged[k] = e.v;
    }
    if (this.hr && t - this.hr.t <= HR_FRESH_MS) merged.heartRateBpm = this.hr.bpm;
    this.emit('measurement', merged);
  }

  /** Sans trainer, la promesse est rejetée (jamais d'exception synchrone : les appelants ne gèrent que le rejet). */
  async setTargetPower(watts: number): Promise<void> {
    return this.requireTrainer().setTargetPower(watts);
  }

  async setSimulation(p: SimulationParams): Promise<void> {
    return this.requireTrainer().setSimulation(p);
  }

  private requireTrainer(): TrainerAdapter {
    if (!this.trainer) throw new Error('Aucun trainer connecté');
    return this.trainer;
  }
}
