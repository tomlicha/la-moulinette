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
  /** Au-delà, une connexion GATT sans réponse est abandonnée : sous Windows, elle peut sinon rester pendante. */
  connectTimeoutMs = 20_000;
  /** Pause entre deux essais quand le navigateur ne sait pas signaler le retour de l'appareil. */
  idlePollMs = 5_000;

  protected device?: BluetoothDevice;
  private userDisconnect = false;
  private reconnecting = false;
  private waiting = false;
  private stopWaiting?: () => void;
  /** `watchAdvertisements()` a déjà échoué : inutile de le redemander à chaque attente. */
  private advertisementsUnavailable = false;
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

  /**
   * Appareil injoignable (éteint, hors de portée) : on attend qu'il se signale, sans limite de durée.
   * L'état reste « connexion » mais rien n'est en cours : l'interface peut proposer d'en choisir un autre.
   */
  get waitingForDevice(): boolean {
    return this.waiting;
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.stopWaiting?.();
    this.device?.gatt?.disconnect();
  }

  protected gatt(): BluetoothRemoteGATTServer {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error('Appareil sans serveur GATT');
    return gatt;
  }

  /** `gatt.connect()` borné par `connectTimeoutMs` ; la boucle de reconnexion annule ensuite l'essai pendant. */
  protected async connectGatt(): Promise<BluetoothRemoteGATTServer> {
    const gatt = this.gatt();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`pas de réponse en ${Math.round(this.connectTimeoutMs / 1000)} s`)), this.connectTimeoutMs);
    });
    try {
      return await Promise.race([gatt.connect(), timeout]);
    } finally {
      clearTimeout(timer);
    }
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
        this.emit('log', `${this.name} pas encore joignable (${errMsg(e)})`);
        this.onLinkLost();
        this.device?.gatt?.disconnect(); // annule un essai resté pendant
        void this.reconnect('launch');
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
    else void this.reconnect('drop');
  }

  /**
   * Reconnexion sans nouvelle sélection : Chrome garde l'autorisation tant que la page reste ouverte.
   * Après une coupure (`drop`), essais rapprochés pendant `reconnectTimeoutMs`, puis « reconnexion abandonnée » :
   * la sortie s'arrête. Dans les deux cas, on attend ensuite sans limite que l'appareil se signale de nouveau
   * (rallumé, revenu à portée) pour s'y reconnecter. Au lancement (`launch`), l'appareil est souvent encore
   * éteint : pas d'essais rapprochés, on attend directement son signal.
   */
  private async reconnect(cause: 'drop' | 'launch') {
    this.reconnecting = true;
    const started = performance.now();
    const quickUntil = cause === 'drop' ? started + this.reconnectTimeoutMs : started;
    let announce = true; // l'état « en attente » est à (re)publier : première attente, ou essai échoué après un signal
    try {
      for (let attempt = 0; !this.userDisconnect; attempt++) {
        if (performance.now() < quickUntil) {
          const delay = this.reconnectDelaysMs[Math.min(attempt, this.reconnectDelaysMs.length - 1)] ?? 0;
          if (delay) await new Promise((r) => setTimeout(r, delay));
          if (this.userDisconnect) break;
          this.emit('state', 'connecting', `reconnexion, essai ${attempt + 1}`);
        } else {
          this.waiting = true;
          if (announce) {
            announce = false;
            if (cause === 'drop') this.emit('state', 'error', 'reconnexion abandonnée');
            else this.emit('state', 'connecting', `en attente de ${this.name}`);
            this.emit('log', `${this.name} : en attente de son signal, reconnexion dès qu'il sera allumé`);
          }
          const woke = await this.waitUntilNearby();
          this.waiting = false;
          if (woke === 'stopped') break;
          if (woke === 'seen') {
            announce = true;
            this.emit('state', 'connecting', `${this.name} détecté`);
          }
        }
        try {
          await this.setup();
        } catch (e) {
          this.emit('log', `${this.name} : essai ${attempt + 1} échoué (${errMsg(e)})`);
          this.onLinkLost();
          this.device?.gatt?.disconnect(); // repart d'une session propre, et annule un essai resté pendant
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
      this.waiting = false;
    }
  }

  /**
   * Attend que l'appareil émette une annonce Bluetooth (`watchAdvertisements`, disponible là où `getDevices` l'est).
   * Sans cette API, simple pause de `idlePollMs` avant l'essai suivant (`tick`). Rend `stopped` si l'attente est
   * interrompue par une déconnexion voulue.
   */
  private async waitUntilNearby(): Promise<'seen' | 'tick' | 'stopped'> {
    const device = this.device;
    if (!device || this.userDisconnect) return 'stopped';
    const stop = new AbortController();
    this.stopWaiting = () => stop.abort();
    try {
      if (!this.advertisementsUnavailable && typeof device.watchAdvertisements === 'function') {
        try {
          await new Promise<void>((resolve, reject) => {
            device.addEventListener('advertisementreceived', () => resolve(), { once: true, signal: stop.signal });
            stop.signal.addEventListener('abort', () => resolve(), { once: true });
            device.watchAdvertisements({ signal: stop.signal }).catch(reject);
          });
          return this.userDisconnect ? 'stopped' : 'seen';
        } catch (e) {
          if (this.userDisconnect) return 'stopped';
          this.advertisementsUnavailable = true;
          this.emit('log', `${this.name} : signal Bluetooth non surveillable (${errMsg(e)}), essai toutes les ${this.idlePollMs / 1000} s`);
        }
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.idlePollMs);
        stop.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
      });
      return this.userDisconnect ? 'stopped' : 'tick';
    } finally {
      this.stopWaiting = undefined;
      stop.abort(); // arrête la surveillance des annonces
    }
  }
}
