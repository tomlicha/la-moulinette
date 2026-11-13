import { afterEach, describe, expect, it, vi } from 'vitest';
import { SensorHub } from './hub';
import { HeartRateMonitor } from './heart-rate-monitor';
import { Emitter } from './emitter';
import type { Measurement, SimulationParams, TrainerAdapter } from './types';
import { FakeChar, FakeDevice, FakeService, install, uuid } from './testing/fake-gatt';

class FakeTrainer extends Emitter implements TrainerAdapter {
  name = 'fake';
  capabilities = { targetPower: true, simulation: true };
  targets: number[] = [];
  async connect() {}
  async disconnect() {}
  async setTargetPower(w: number) { this.targets.push(w); }
  async setSimulation(_: SimulationParams) {}
  send(m: Measurement) { this.emit('measurement', m); }
}

afterEach(() => vi.unstubAllGlobals());

describe('SensorHub', () => {
  it('la ceinture cardio prime sur le cardio du trainer', () => {
    const hub = new SensorHub();
    const trainer = new FakeTrainer();
    const belt = new FakeTrainer();
    hub.attachTrainer(trainer);
    hub.attachHeartRate(belt);
    const out: Measurement[] = [];
    hub.on('measurement', (m) => out.push(m));

    trainer.send({ t: 100, powerW: 200, heartRateBpm: 120 });
    belt.send({ t: 110, heartRateBpm: 150 });
    trainer.send({ t: 200, powerW: 210, heartRateBpm: 121 });

    expect(out.map((m) => [m.powerW, m.heartRateBpm])).toEqual([
      [200, 120], // pas encore de ceinture : cardio du trainer
      [200, 150], // la ceinture arrive, la puissance reste celle du trainer
      [210, 150], // la ceinture prime
    ]);
  });

  it('retombe sur le cardio du trainer quand la ceinture se tait', () => {
    const hub = new SensorHub();
    const trainer = new FakeTrainer();
    const belt = new FakeTrainer();
    hub.attachTrainer(trainer);
    hub.attachHeartRate(belt);
    const out: Measurement[] = [];
    hub.on('measurement', (m) => out.push(m));

    belt.send({ t: 0, heartRateBpm: 150 });
    trainer.send({ t: 6000, powerW: 200, heartRateBpm: 120 });

    expect(out.at(-1)?.heartRateBpm).toBe(120);
  });

  it("ne republie pas la puissance d'un trainer qui s'est tu quand la ceinture continue d'émettre", () => {
    const hub = new SensorHub();
    const trainer = new FakeTrainer();
    const belt = new FakeTrainer();
    hub.attachTrainer(trainer);
    hub.attachHeartRate(belt);
    const out: Measurement[] = [];
    hub.on('measurement', (m) => out.push(m));

    trainer.send({ t: 1000, powerW: 250, cadenceRpm: 90 });
    belt.send({ t: 2000, heartRateBpm: 150 }); // trainer encore frais
    belt.send({ t: 61_000, heartRateBpm: 152 }); // 60 s sans trame du trainer

    expect(out[1]).toEqual({ t: 2000, powerW: 250, cadenceRpm: 90, heartRateBpm: 150 });
    expect(out[2]).toEqual({ t: 61_000, heartRateBpm: 152 });
  });

  it("garde chaque champ du trainer avec sa propre fraîcheur", () => {
    const hub = new SensorHub();
    const trainer = new FakeTrainer();
    hub.attachTrainer(trainer);
    const out: Measurement[] = [];
    hub.on('measurement', (m) => out.push(m));
    trainer.send({ t: 0, speedKmh: 30 });
    trainer.send({ t: 1000, powerW: 200 }); // vitesse encore fraîche
    trainer.send({ t: 5000, powerW: 210 }); // vitesse périmée
    expect(out.map((m) => m.speedKmh)).toEqual([30, 30, undefined]);
  });

  it("ignore un ancien trainer remplacé", () => {
    const hub = new SensorHub();
    const old = new FakeTrainer();
    const fresh = new FakeTrainer();
    hub.attachTrainer(old);
    hub.attachTrainer(fresh);
    const out: Measurement[] = [];
    hub.on('measurement', (m) => out.push(m));
    old.send({ t: 0, powerW: 999 });
    fresh.send({ t: 0, powerW: 100 });
    expect(out.map((m) => m.powerW)).toEqual([100]);
  });

  it('transmet les consignes au trainer et refuse sans trainer', async () => {
    const hub = new SensorHub();
    await expect(hub.setTargetPower(100)).rejects.toThrow('Aucun trainer');
    const trainer = new FakeTrainer();
    hub.attachTrainer(trainer);
    await hub.setTargetPower(180);
    expect(trainer.targets).toEqual([180]);
  });
});

describe('HeartRateMonitor', () => {
  function belt() {
    const hr = new FakeChar(uuid(0x2a37));
    const device = new FakeDevice([new FakeService(uuid(0x180d), [hr])]);
    install(device);
    const m = new HeartRateMonitor();
    m.reconnectDelaysMs = [0];
    return { m, hr, device };
  }

  it('décode les mesures 8 et 16 bits', async () => {
    const { m, hr } = belt();
    const bpm: (number | undefined)[] = [];
    m.on('measurement', (x) => bpm.push(x.heartRateBpm));
    await m.connect();
    hr.emit(0x00, 142);
    hr.emit(0x01, 0x2c, 0x01);
    expect(bpm).toEqual([142, 300]);
  });

  it("garde un seul écouteur après plusieurs reconnexions", async () => {
    const { m, hr, device } = belt();
    const states: string[] = [];
    const bpm: (number | undefined)[] = [];
    m.on('state', (s) => states.push(s));
    m.on('measurement', (x) => bpm.push(x.heartRateBpm));
    await m.connect();
    for (let i = 0; i < 3; i++) {
      device.drop();
      await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    }
    hr.emit(0x00, 140);
    expect(hr.listenerCount).toBe(1);
    expect(bpm).toEqual([140]);
  });

  it('se reconnecte seule après une coupure', async () => {
    const { m, device } = belt();
    const states: string[] = [];
    m.on('state', (s) => states.push(s));
    await m.connect();
    device.drop();
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    expect(states).toEqual(['connecting', 'connected', 'connecting', 'connected']);
  });
});
