import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRecallDevices, DeviceRegistry, recallDevices, type KeyValueStore } from './device-registry';
import { HeartRateMonitor } from './heart-rate-monitor';
import { WebBluetoothTrainer } from './web-bluetooth';
import { FakeChar, FakeDevice, FakeService, install, uuid } from './testing/fake-gatt';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('DeviceRegistry', () => {
  it('garde un appareil par rôle et remplace le précédent', () => {
    const r = new DeviceRegistry(memory());
    r.remember('trainer', { id: 'a', name: 'KICKR 81B5' }, 1);
    r.remember('hr', { id: 'b', name: 'HRM-Pro+' }, 2);
    r.remember('trainer', { id: 'c', name: 'Stages 8268' }, 3);
    expect(r.list()).toEqual([
      { role: 'hr', id: 'b', name: 'HRM-Pro+', lastConnectedAt: 2 },
      { role: 'trainer', id: 'c', name: 'Stages 8268', lastConnectedAt: 3 },
    ]);
    expect(r.get('trainer')?.name).toBe('Stages 8268');
  });

  it('oublie un rôle et nomme un appareil sans nom', () => {
    const r = new DeviceRegistry(memory());
    r.remember('hr', { id: 'b' });
    expect(r.get('hr')?.name).toBe('Appareil sans nom');
    r.forget('hr');
    expect(r.list()).toEqual([]);
  });

  it('survit à un stockage corrompu ou plein', () => {
    const store = memory();
    store.data.set('zwift2.devices', '{pas du json');
    expect(new DeviceRegistry(store).list()).toEqual([]);
    store.data.set('zwift2.devices', JSON.stringify([{ role: 'trainer', id: 'a', name: 'ok' }, { role: 'drone', id: 'x', name: 'y' }, 42]));
    expect(new DeviceRegistry(store).list().map((d) => d.id)).toEqual(['a']);
    const full: KeyValueStore = { ...store, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(() => new DeviceRegistry(full).remember('hr', { id: 'b', name: 'n' })).not.toThrow();
  });
});

describe('retrouver les appareils au lancement', () => {
  const trainerDevice = () => new FakeDevice([new FakeService(uuid(0x1818), [new FakeChar(uuid(0x2a63))])]);
  const beltDevice = () => new FakeDevice([new FakeService(uuid(0x180d), [new FakeChar(uuid(0x2a37))])]);

  it("sans getDevices(), on ne retrouve rien et on ne plante pas", async () => {
    install(trainerDevice());
    expect(canRecallDevices()).toBe(false);
    expect((await recallDevices([{ role: 'trainer', id: 'x', name: 'n', lastConnectedAt: 0 }])).size).toBe(0);
  });

  it('associe les appareils autorisés aux rôles connus, et ignore les inconnus', async () => {
    const t = trainerDevice();
    const h = beltDevice();
    const other = beltDevice();
    install(t, { authorized: [other, h, t] });
    expect(canRecallDevices()).toBe(true);
    const found = await recallDevices([
      { role: 'trainer', id: t.id, name: 'KICKR', lastConnectedAt: 0 },
      { role: 'hr', id: h.id, name: 'HRM', lastConnectedAt: 0 },
    ]);
    expect(found.get('trainer')).toBe(t);
    expect(found.get('hr')).toBe(h);
  });

  it('un appareil retiré des autorisations du site n\'est pas retrouvé', async () => {
    install(trainerDevice(), { authorized: [] });
    expect((await recallDevices([{ role: 'trainer', id: 'disparu', name: 'n', lastConnectedAt: 0 }])).size).toBe(0);
  });

  it('se connecte sans sélecteur au trainer retrouvé et expose son identifiant', async () => {
    const t = trainerDevice();
    const requestDevice = vi.fn();
    install(t, { authorized: [t] });
    (navigator.bluetooth as unknown as { requestDevice: unknown }).requestDevice = requestDevice;
    const trainer = new WebBluetoothTrainer();
    trainer.reconnectDelaysMs = [0];
    const states: string[] = [];
    trainer.on('state', (s) => states.push(s));
    await trainer.connectDevice(t as unknown as BluetoothDevice);
    expect(states).toEqual(['connecting', 'connected']);
    expect(trainer.deviceId).toBe(t.id);
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it('attend un appareil encore éteint avec keepTrying, puis se connecte quand il apparaît', async () => {
    const h = beltDevice();
    install(h, { authorized: [h] });
    const realConnect = h.gatt.connect;
    let attempts = 0;
    h.gatt.connect = async () => {
      if (++attempts < 3) throw new Error('hors de portée');
      return realConnect();
    };
    const belt = new HeartRateMonitor();
    belt.reconnectDelaysMs = [5];
    const states: string[] = [];
    belt.on('state', (s) => states.push(s));
    await belt.connectDevice(h as unknown as BluetoothDevice, true);
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    expect(attempts).toBe(3);
    expect(states[0]).toBe('connecting');
    expect(states).not.toContain('error');
  });

  it('sans keepTrying, un appareil injoignable est une erreur', async () => {
    const h = beltDevice();
    install(h, { authorized: [h] });
    h.gatt.connect = async () => {
      throw new Error('hors de portée');
    };
    const belt = new HeartRateMonitor();
    const states: string[] = [];
    belt.on('state', (s) => states.push(s));
    await expect(belt.connectDevice(h as unknown as BluetoothDevice)).rejects.toThrow('hors de portée');
    expect(states).toEqual(['connecting', 'error']);
  });
});
