import { webBluetoothAvailable } from './gatt-device';

export type DeviceRole = 'trainer' | 'hr';

export interface KnownDevice {
  role: DeviceRole;
  /** Identifiant Web Bluetooth, propre à l'origine et stable tant que l'autorisation est conservée. */
  id: string;
  name: string;
  lastConnectedAt: number;
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'zwift2.devices';

/** Stockage du navigateur s'il est utilisable ; sinon une mémoire de session (navigation privée, stockage bloqué). */
export function browserStore(): KeyValueStore {
  try {
    const probe = '__zwift2_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

/** Mémoire des appareils déjà utilisés, un par rôle : c'est la liste que l'application tente de retrouver au lancement. */
export class DeviceRegistry {
  constructor(private readonly store: KeyValueStore = browserStore()) {}

  list(): KnownDevice[] {
    try {
      const raw = JSON.parse(this.store.getItem(KEY) ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter(isKnownDevice) : [];
    } catch {
      return []; // contenu corrompu : on repart d'une liste vide plutôt que d'empêcher le lancement
    }
  }

  get(role: DeviceRole): KnownDevice | undefined {
    return this.list().find((d) => d.role === role);
  }

  remember(role: DeviceRole, device: { id: string; name?: string }, now = Date.now()) {
    const others = this.list().filter((d) => d.role !== role);
    this.write([...others, { role, id: device.id, name: device.name || 'Appareil sans nom', lastConnectedAt: now }]);
  }

  forget(role: DeviceRole) {
    this.write(this.list().filter((d) => d.role !== role));
  }

  private write(list: KnownDevice[]) {
    try {
      this.store.setItem(KEY, JSON.stringify(list));
    } catch {
      // quota ou stockage bloqué : l'appareil sera simplement redemandé au prochain lancement
    }
  }
}

function isKnownDevice(x: unknown): x is KnownDevice {
  const d = x as KnownDevice;
  return !!d && (d.role === 'trainer' || d.role === 'hr') && typeof d.id === 'string' && typeof d.name === 'string';
}

/**
 * `getDevices()` rend, sans clic, les appareils que l'utilisateur a déjà autorisés pour ce site.
 * Selon la version de Chrome, il peut être absent ou derrière un réglage : on le détecte, sans présumer du navigateur.
 */
export function canRecallDevices(): boolean {
  return webBluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function';
}

/** Retrouve, parmi les appareils autorisés, ceux qui correspondent aux appareils connus. */
export async function recallDevices(known: KnownDevice[]): Promise<Map<DeviceRole, BluetoothDevice>> {
  const found = new Map<DeviceRole, BluetoothDevice>();
  if (!canRecallDevices() || !known.length) return found;
  const authorized = await navigator.bluetooth.getDevices();
  for (const k of known) {
    const d = authorized.find((a) => a.id === k.id);
    if (d) found.set(k.role, d);
  }
  return found;
}
