import { Emitter } from './emitter';
import { errMsg } from '../util/errors';

export function webBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/** Copie les octets d'une valeur GATT : le `DataView` reçu peut être réutilisé par le navigateur. */
export const bytes = (dv: DataView) => new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));

/** Le sélecteur Bluetooth fermé sans choisir d'appareil : un geste de l'utilisateur, pas une panne. */
export function isChooserCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === 'NotFoundError' && /cancel/i.test(e.message);
}

type ValueListener = (this: BluetoothRemoteGATTCharacteristic, ev: Event) => void;

/**
 * Socle commun des appareils Web Bluetooth (trainer, ceinture cardio) : choix de l'appareil, connexion,
 * reconnexion automatique après une coupure, abonnements aux notifications. Les sous-classes ne décrivent
 * que leurs services, dans `setup`.
 */
export abstract class GattDevice extends Emitter {
  abstract name: string;

  /** Pauses entre tentatives de reconnexion ; la dernière valeur se répète jusqu'à `reconnectTimeoutMs`. */
  reconnectDelaysMs = [0, 500, 1000, 2000, 3000];
  reconnectTimeoutMs = 60_000;

  protected device?: BluetoothDevice;
  private userDisconnect = false;
  private reconnecting = false;
  /**
   * Un écouteur par caractéristique. Selon le navigateur, une reconnexion rend les mêmes objets caractéristique :
   * sans cette table, chaque reconnexion ajouterait un écouteur et chaque notification serait traitée plusieurs fois.
   */
  private readonly listeners = new WeakMap<BluetoothRemoteGATTCharacteristic, ValueListener>();

  /** Options du sélecteur Bluetooth ; `nameHint` le limite aux appareils de ce nom. */
  protected abstract requestOptions(nameHint?: string): RequestDeviceOptions;
  /** Nom affiché quand l'appareil n'en donne pas. */
  protected abstract readonly fallbackName: string;
  /** Ouvre la session GATT et s'abonne aux mesures. Lève si l'appareil n'est pas utilisable. */
  protected abstract setup(): Promise<void>;
  /** Liaison perdue : oublier tout état propre à la session GATT. */
  protected onLinkLost(): void {}
  /** Reconnexion réussie : rejouer ce qui doit l'être (consigne ERG…). */
  protected async afterReconnect(): Promise<void> {}

  async connect(nameHint?: string): Promise<void> {
    if (!webBluetoothAvailable()) {
      const msg = 'Web Bluetooth indisponible (Chrome ou Edge requis, en HTTPS ou sur localhost)';
      this.emit('state', 'error', msg);
      throw new Error(msg);
    }
    this.emit('state', 'connecting');
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice(this.requestOptions(nameHint));
    } catch (e) {
      if (isChooserCancelled(e)) {
        this.emit('state', 'disconnected', 'aucun appareil choisi');
        return;
      }
      this.emit('state', 'error', errMsg(e));
      throw e;
    }
    await this.open(device);
  }

  /**
   * Connexion à un appareil déjà choisi, par exemple retrouvé au lancement par `getDevices()` : pas de sélecteur,
   * donc pas de clic nécessaire. Avec `keepTrying`, un appareil éteint ou hors de portée est attendu pendant
   * `reconnectTimeoutMs` au lieu d'échouer aussitôt.
   */
  async connectDevice(device: BluetoothDevice, keepTrying = false): Promise<void> {
    this.emit('state', 'connecting', device.name ?? this.fallbackName);
    return this.open(device, keepTrying);
  }

  /** Identifiant de l'appareil pour cette origine, stable d'une session à l'autre : sert à le retrouver au lancement. */
  get deviceId(): string | undefined {
    return this.device?.id;
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.device?.gatt?.disconnect();
  }

  protected gatt(): BluetoothRemoteGATTServer {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error('Appareil sans serveur GATT');
    return gatt;
  }

  /** S'abonne aux notifications de `c` ; un abonnement précédent sur le même objet est remplacé, jamais doublé. */
  protected async subscribe(c: BluetoothRemoteGATTCharacteristic, label: string, fn: (b: Uint8Array) => void) {
    const previous = this.listeners.get(c);
    if (previous) c.removeEventListener('characteristicvaluechanged', previous);
    const listener: ValueListener = () => {
      if (!c.value) return;
      const b = bytes(c.value);
      this.emit('raw', label, b);
      try {
        fn(b);
      } catch (e) {
        this.emit('log', `${label} : trame illisible (${errMsg(e)})`, 'error');
      }
    };
    this.listeners.set(c, listener);
    c.addEventListener('characteristicvaluechanged', listener);
    await c.startNotifications();
  }

  private async open(device: BluetoothDevice, keepTrying = false): Promise<void> {
    this.userDisconnect = false;
    if (this.device !== device) device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
    this.device = device;
    this.name = device.name ?? this.fallbackName;
    try {
      await this.setup();
      this.emit('state', 'connected', this.name);
    } catch (e) {
      if (keepTrying) {
        this.emit('log', `${this.name} pas encore joignable (${errMsg(e)}) : nouvel essai`);
        void this.reconnect();
        return;
      }
      this.emit('state', 'error', errMsg(e));
      throw e;
    }
  }

  private onDisconnected() {
    if (this.reconnecting) return; // coupure provoquée par la boucle de reconnexion elle-même
    this.onLinkLost();
    this.emit('log', `${this.name} : GATT déconnecté`);
    if (this.userDisconnect) this.emit('state', 'disconnected');
    else void this.reconnect();
  }

  /** Reconnexion sans nouvelle sélection : Chrome garde l'autorisation tant que la page reste ouverte. */
  private async reconnect() {
    this.reconnecting = true;
    const started = performance.now();
    try {
      for (let attempt = 0; !this.userDisconnect; attempt++) {
        if (performance.now() - started > this.reconnectTimeoutMs) {
          this.emit('state', 'error', 'reconnexion abandonnée');
          return;
        }
        const delay = this.reconnectDelaysMs[Math.min(attempt, this.reconnectDelaysMs.length - 1)] ?? 0;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (this.userDisconnect) break;
        this.emit('state', 'connecting', `reconnexion, essai ${attempt + 1}`);
        try {
          await this.setup();
        } catch (e) {
          this.emit('log', `${this.name} : essai ${attempt + 1} échoué (${errMsg(e)})`);
          this.onLinkLost();
          this.device?.gatt?.disconnect(); // repart d'une session propre
          continue;
        }
        this.emit('log', `${this.name} : reconnecté en ${((performance.now() - started) / 1000).toFixed(1)} s`);
        this.emit('state', 'connected', this.name);
        await this.afterReconnect();
        return;
      }
      this.emit('state', 'disconnected');
    } finally {
      this.reconnecting = false;
    }
  }
}
