import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebBluetoothTrainer } from './web-bluetooth';
import type { ConnectionState } from './types';
import { dv, FakeChar, FakeDevice, FakeService, install, uuid } from './testing/fake-gatt';

const WAHOO_SVC = 'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b';
const WAHOO_CHAR = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

/** Control Point FTMS : répond succès (ou le résultat imposé) à chaque commande. */
function ftmsDevice(result = 1) {
  const bikeData = new FakeChar(uuid(0x2ad2));
  const cp = new FakeChar(uuid(0x2ad9), (data, self) => {
    queueMicrotask(() => self.emit(0x80, data[0]!, result));
  });
  // Feature : machine 0, cibles = puissance (bit 3) + simulation (bit 13)
  const feature = new FakeChar(uuid(0x2acc), undefined, dv(0, 0, 0, 0, 0x08, 0x20, 0, 0));
  const device = new FakeDevice([new FakeService(uuid(0x1826), [feature, bikeData, cp])]);
  return { device, bikeData, cp };
}

function trainer() {
  const t = new WebBluetoothTrainer();
  t.reconnectDelaysMs = [0];
  const states: ConnectionState[] = [];
  const logs: string[] = [];
  t.on('state', (s) => states.push(s));
  t.on('log', (l) => logs.push(l));
  return { t, states, logs };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('WebBluetoothTrainer, chemin FTMS', () => {
  it('lit les capacités et décode les mesures', async () => {
    const { device, bikeData } = ftmsDevice();
    install(device);
    const { t } = trainer();
    const got: number[] = [];
    t.on('measurement', (m) => got.push(m.powerW ?? -1));
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: true, simulation: true });
    bikeData.emit(0x44, 0x00, 0xb8, 0x0b, 0xaa, 0x00, 0xfa, 0x00);
    expect(got).toEqual([250]);
  });

  it('prend le contrôle avant la première commande, une seule fois', async () => {
    const { device, cp } = ftmsDevice();
    install(device);
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(200);
    await t.setTargetPower(220);
    // 0x00 prise de contrôle, 0x07 démarrage, puis les deux cibles (0x05)
    expect(cp.writes).toEqual([[0x00], [0x07], [0x05, 200, 0], [0x05, 220, 0]]);
  });

  it('remonte un contrôle refusé', async () => {
    const { device } = ftmsDevice(5);
    install(device);
    const { t } = trainer();
    await t.connect();
    await expect(t.setTargetPower(200)).rejects.toThrow('contrôle non accordé');
  });
});

describe('WebBluetoothTrainer, reconnexion', () => {
  it('se reconnecte seul après une coupure et rejoue la dernière consigne', async () => {
    const { device, cp } = ftmsDevice();
    install(device);
    const { t, states, logs } = trainer();
    await t.connect();
    await t.setTargetPower(200);

    device.drop();
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    await vi.waitFor(() => expect(cp.writes.filter((w) => w[0] === 0x05)).toHaveLength(2));

    expect(states).toEqual(['connecting', 'connected', 'connecting', 'connected']);
    expect(logs.some((l) => l.startsWith('reconnecté en'))).toBe(true);
    // le contrôle est repris sur la nouvelle session avant la consigne rejouée
    expect(cp.writes.slice(-3)).toEqual([[0x00], [0x07], [0x05, 200, 0]]);
  });

  it('ne se reconnecte pas après une déconnexion voulue', async () => {
    const { device } = ftmsDevice();
    install(device);
    const { t, states } = trainer();
    await t.connect();
    await t.disconnect();
    await new Promise((r) => setTimeout(r, 20));
    expect(states).toEqual(['connecting', 'connected', 'disconnected']);
    expect(device.connected).toBe(false);
  });

  it("abandonne après le délai maximal si l'appareil ne revient pas", async () => {
    const { device } = ftmsDevice();
    install(device);
    const { t, states } = trainer();
    t.reconnectTimeoutMs = 50;
    t.reconnectDelaysMs = [10];
    await t.connect();
    device.gatt.connect = async () => {
      throw new Error('hors de portée');
    };
    device.drop();
    await vi.waitFor(() => expect(states.at(-1)).toBe('error'));
  });
});

describe('WebBluetoothTrainer, chemin Wahoo', () => {
  it('pilote ERG et SIM par le service propriétaire', async () => {
    const power = new FakeChar(uuid(0x2a63));
    const wahooCp = new FakeChar(WAHOO_CHAR);
    const device = new FakeDevice([
      new FakeService(uuid(0x1818), [power]),
      new FakeService(WAHOO_SVC, [wahooCp]),
    ]);
    install(device);
    const { t } = trainer();
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: true, simulation: true });

    power.emit(0x00, 0x00, 0xc8, 0x00);
    await t.setTargetPower(150);
    await t.setSimulation({ gradePct: 0 });
    expect(wahooCp.writes).toEqual([
      [0x42, 0x96, 0x00],
      [0x43, 0x40, 0x1f, 0x28, 0x00, 0xfe, 0x01],
      [0x46, 0x00, 0x80],
    ]);
  });

  it('renvoie le mode simulation une seule fois, puis seulement la pente', async () => {
    const power = new FakeChar(uuid(0x2a63));
    const wahooCp = new FakeChar(WAHOO_CHAR);
    install(new FakeDevice([new FakeService(uuid(0x1818), [power]), new FakeService(WAHOO_SVC, [wahooCp])]));
    const { t } = trainer();
    await t.connect();
    await t.setSimulation({ gradePct: 2, massKg: 80 });
    await t.setSimulation({ gradePct: 3, massKg: 80 });
    expect(wahooCp.writes.map((w) => w[0])).toEqual([0x43, 0x46, 0x46]);

    await t.setSimulation({ gradePct: 3, massKg: 90 }); // masse changée : mode renvoyé
    await t.setTargetPower(150); // l'ERG sort du mode simulation
    await t.setSimulation({ gradePct: 3, massKg: 90 });
    expect(wahooCp.writes.map((w) => w[0])).toEqual([0x43, 0x46, 0x46, 0x43, 0x46, 0x42, 0x43, 0x46]);
  });

  it('passe la cadence à 0 quand les compteurs de manivelle ne bougent plus', async () => {
    const power = new FakeChar(uuid(0x2a63));
    install(new FakeDevice([new FakeService(uuid(0x1818), [power])]));
    const { t } = trainer();
    t.cadenceTimeoutMs = 30;
    const rpm: (number | undefined)[] = [];
    t.on('measurement', (m) => rpm.push(m.cadenceRpm));
    await t.connect();

    // flags 0x0020 : manivelle ; 100 W ; tours puis temps en 1/1024 s
    power.emit(0x20, 0x00, 100, 0, 10, 0, 0x00, 0x00);
    power.emit(0x20, 0x00, 100, 0, 11, 0, 0x00, 0x04); // 1 tour en 1 s : 60 rpm
    expect(rpm.at(-1)).toBeCloseTo(60);

    power.emit(0x20, 0x00, 100, 0, 11, 0, 0x00, 0x04); // compteurs inchangés, délai pas écoulé
    expect(rpm.at(-1)).toBeCloseTo(60);

    await new Promise((r) => setTimeout(r, 50));
    power.emit(0x20, 0x00, 0, 0, 11, 0, 0x00, 0x04); // toujours inchangés, délai écoulé
    expect(rpm.at(-1)).toBe(0);
  });
});
