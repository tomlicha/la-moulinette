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
  removeEventListener(_: string, fn: () => void) { this.listeners = this.listeners.filter((l) => l !== fn); }
  /** Nombre d'écouteurs de notification : un seul attendu, même après plusieurs reconnexions. */
  get listenerCount() { return this.listeners.length; }
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

let nextId = 1;

type Listener = { type: string; fn: () => void; once: boolean };

export class FakeDevice {
  readonly id = `fake-${nextId++}`;
  name = 'Faux trainer';
  connected = false;
  /** Surveillances d'annonces en cours (`watchAdvertisements`). */
  watching = 0;
  private listeners: Listener[] = [];
  constructor(readonly services: FakeService[]) {}
  addEventListener(type: string, fn: () => void, opts?: { once?: boolean; signal?: AbortSignal }) {
    if (opts?.signal?.aborted) return;
    const l: Listener = { type, fn, once: !!opts?.once };
    this.listeners.push(l);
    opts?.signal?.addEventListener('abort', () => (this.listeners = this.listeners.filter((x) => x !== l)));
  }
  private dispatch(type: string) {
    for (const l of this.listeners.filter((x) => x.type === type)) {
      if (l.once) this.listeners = this.listeners.filter((x) => x !== l);
      l.fn();
    }
  }
  /** Rend `watchAdvertisements` disponible, comme dans un Chrome qui expose `getDevices`. */
  enableAdvertisements() {
    Object.assign(this, {
      watchAdvertisements: async ({ signal }: { signal?: AbortSignal } = {}) => {
        this.watching++;
        signal?.addEventListener('abort', () => this.watching--);
      },
    });
  }
  /** L'appareil, rallumé ou revenu à portée, émet une annonce. */
  advertise() { if (this.watching > 0) this.dispatch('advertisementreceived'); }
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
      this.dispatch('gattserverdisconnected');
    },
  };
  /** Coupure côté trainer (hors de portée, piles, etc.). */
  drop() { this.gatt.disconnect(); }
}


/** Ce que lève Chrome quand l'utilisateur ferme le sélecteur sans choisir. */
export const chooserCancelled = () =>
  Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });

/**
 * `authorized` simule `getDevices()` (appareils déjà autorisés) ; absent, l'API n'existe pas, comme dans un Chrome qui ne l'expose pas.
 * `device` à `undefined` : le sélecteur est fermé sans choix.
 */
export function install(device: FakeDevice | undefined, opts: { authorized?: FakeDevice[] } = {}) {
  const bluetooth: Record<string, unknown> = {
    requestDevice: async () => {
      if (!device) throw chooserCancelled();
      return device;
    },
  };
  if (opts.authorized) bluetooth.getDevices = async () => opts.authorized;
  vi.stubGlobal('navigator', { bluetooth });
  vi.stubGlobal('BluetoothUUID', { getService: uuid });
}

