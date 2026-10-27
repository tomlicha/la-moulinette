import { vi } from 'vitest';

/** Faux GATT Web Bluetooth pour les tests : appareils, services, caractéristiques et coupures. */
export const uuid = (u: number | string) =>
  typeof u === 'string' ? u : `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const dv = (...n: number[]) => new DataView(Uint8Array.from(n).buffer);

export class FakeChar {
  value?: DataView;
  writes: number[][] = [];
  private listeners: (() => void)[] = [];
  constructor(
    readonly id: string,
    private onWrite?: (data: number[], self: FakeChar) => void,
    private readData?: DataView,
  ) {}
  addEventListener(_: string, fn: () => void) { this.listeners.push(fn); }
  async startNotifications() { return this; }
  async readValue() {
    if (!this.readData) throw new Error('pas lisible');
    return this.readData;
  }
  async writeValueWithResponse(data: Uint8Array) {
    const bytes = [...data];
    this.writes.push(bytes);
    this.onWrite?.(bytes, this);
  }
  emit(...n: number[]) {
    this.value = dv(...n);
    this.listeners.forEach((l) => l());
  }
}

export class FakeService {
  constructor(readonly uuid: string, readonly chars: FakeChar[]) {}
  async getCharacteristic(id: number | string) {
    const c = this.chars.find((x) => x.id === uuid(id));
    if (!c) throw new Error('NotFoundError');
    return c;
  }
}

export class FakeDevice {
  name = 'Faux trainer';
  connected = false;
  private listeners: (() => void)[] = [];
  constructor(readonly services: FakeService[]) {}
  addEventListener(_: string, fn: () => void) { this.listeners.push(fn); }
  gatt = {
    connect: async () => {
      this.connected = true;
      return {
        getPrimaryServices: async () => this.services,
        getPrimaryService: async (id: number | string) => {
          const s = this.services.find((x) => x.uuid === uuid(id));
          if (!s) throw new Error('NotFoundError');
          return s;
        },
      };
    },
    disconnect: () => {
      if (!this.connected) return;
      this.connected = false;
      this.listeners.forEach((l) => l());
    },
  };
  /** Coupure côté trainer (hors de portée, piles, etc.). */
  drop() { this.gatt.disconnect(); }
}


export function install(device: FakeDevice) {
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } });
  vi.stubGlobal('BluetoothUUID', { getService: uuid });
}

