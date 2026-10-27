import { Emitter } from './emitter';
import type { Measurement, SimulationParams, TrainerAdapter, TrainerCapabilities } from './types';

/** Home trainer virtuel : développer et tester sans matériel. En ERG la puissance converge vers la cible. */
export class SimulatedTrainer extends Emitter implements TrainerAdapter {
  name = 'Trainer simulé';
  capabilities: TrainerCapabilities = {
    targetPower: true,
    simulation: true,
    powerRange: { min: 0, max: 2000, step: 1 },
  };

  private timer?: ReturnType<typeof setInterval>;
  private target?: number;
  private grade = 0;
  private power = 150;
  private distance = 0;

  async connect(): Promise<void> {
    this.emit('state', 'connecting');
    await new Promise((r) => setTimeout(r, 300));
    this.timer = setInterval(() => this.tick(), 250);
    this.emit('state', 'connected', this.name);
  }

  async disconnect(): Promise<void> {
    clearInterval(this.timer);
    this.emit('state', 'disconnected');
  }

  private tick() {
    const goal = this.target ?? 150 + this.grade * 12;
    this.power += (goal - this.power) * 0.4 + (Math.random() - 0.5) * 6;
    const speedKmh = Math.max(0, 8 + this.power / 9 - this.grade * 1.2);
    this.distance += (speedKmh / 3.6) * 0.25;
    const m: Measurement = {
      t: performance.now(),
      powerW: Math.round(Math.max(0, this.power)),
      cadenceRpm: Math.round(85 + (Math.random() - 0.5) * 4),
      speedKmh: Math.round(speedKmh * 10) / 10,
      distanceM: Math.round(this.distance),
      heartRateBpm: Math.round(95 + this.power / 4),
    };
    this.emit('measurement', m);
  }

  async setTargetPower(watts: number): Promise<void> {
    this.target = watts;
    this.emit('log', `[sim] cible ERG ${watts} W`);
  }

  async setSimulation(p: SimulationParams): Promise<void> {
    this.target = undefined;
    this.grade = p.gradePct;
    this.emit('log', `[sim] pente ${p.gradePct} %`);
  }
}
