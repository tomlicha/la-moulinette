import { Emitter } from './emitter';
import type { Measurement, SimulationParams, TrainerAdapter } from './types';

/** Au-delà de ce délai sans trame, la valeur cardio d'une ceinture n'est plus jugée fraîche. */
const HR_FRESH_MS = 5000;

/** Source de mesures secondaire (ceinture cardio, capteur de foulée…) : seul le sous-ensemble utile du contrat. */
export interface MeasurementSource {
  on: TrainerAdapter['on'];
}

/**
 * Point d'entrée unique pour l'application : un trainer pilotable et des sources annexes,
 * fusionnés en un flux de mesures. La ceinture cardio prime sur le cardio relayé par le trainer.
 */
export class SensorHub extends Emitter {
  private trainer?: TrainerAdapter;
  private lastTrainer: Measurement = { t: 0 };
  private hr?: { bpm: number; t: number };

  attachTrainer(t: TrainerAdapter) {
    this.trainer = t;
    this.lastTrainer = { t: 0 };
    t.on('measurement', (m) => {
      this.lastTrainer = m;
      this.publish(m.t);
    });
    t.on('log', (l) => this.emit('log', l));
    t.on('raw', (s, d) => this.emit('raw', s, d));
  }

  attachHeartRate(src: MeasurementSource) {
    src.on('measurement', (m) => {
      if (m.heartRateBpm === undefined) return;
      this.hr = { bpm: m.heartRateBpm, t: m.t };
      this.publish(m.t);
    });
    src.on('log', (l) => this.emit('log', l));
    src.on('raw', (s, d) => this.emit('raw', s, d));
  }

  private publish(t: number) {
    const merged: Measurement = { ...this.lastTrainer, t };
    if (this.hr && t - this.hr.t <= HR_FRESH_MS) merged.heartRateBpm = this.hr.bpm;
    this.emit('measurement', merged);
  }

  setTargetPower(watts: number): Promise<void> {
    return this.requireTrainer().setTargetPower(watts);
  }

  setSimulation(p: SimulationParams): Promise<void> {
    return this.requireTrainer().setSimulation(p);
  }

  private requireTrainer(): TrainerAdapter {
    if (!this.trainer) throw new Error('Aucun trainer connecté');
    return this.trainer;
  }
}
