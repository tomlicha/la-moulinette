import { Emitter } from './emitter';
import { CHAR, SERVICE } from './uuids';
import { decodeHeartRate } from './decoders';
import { webBluetoothAvailable } from './web-bluetooth';

const bytes = (dv: DataView) => new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));

/** Ceinture ou montre cardio autonome (Heart Rate Service 0x180D), avec reconnexion automatique. */
export class HeartRateMonitor extends Emitter {
  name = 'Cardio';
  reconnectDelaysMs = [0, 500, 1000, 2000, 3000];
  reconnectTimeoutMs = 60_000;

  private device?: BluetoothDevice;
  private userDisconnect = false;
  private reconnecting = false;

  async connect(nameHint?: string): Promise<void> {
    if (!webBluetoothAvailable()) {
      const msg = 'Web Bluetooth indisponible';
      this.emit('state', 'error', msg);
      throw new Error(msg);
    }
    this.emit('state', 'connecting');
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: nameHint ? [{ name: nameHint }] : [{ services: [SERVICE.heartRate] }],
        optionalServices: [SERVICE.heartRate],
      });
    } catch (e) {
      this.emit('state', 'error', e instanceof Error ? e.message : String(e));
      throw e;
    }
    await this.open(device);
  }

  /** Connexion sans sélecteur à un appareil déjà autorisé ; voir `WebBluetoothTrainer.connectDevice`. */
  async connectDevice(device: BluetoothDevice, keepTrying = false): Promise<void> {
    this.emit('state', 'connecting', device.name ?? 'Cardio');
    return this.open(device, keepTrying);
  }

  private async open(device: BluetoothDevice, keepTrying = false): Promise<void> {
    this.userDisconnect = false;
    if (this.device !== device) device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
    this.device = device;
    this.name = device.name ?? 'Cardio';
    try {
      await this.subscribe();
      this.emit('state', 'connected', this.name);
    } catch (e) {
      if (keepTrying) {
        this.emit('log', `${this.name} pas encore joignable (${e instanceof Error ? e.message : e}) : nouvel essai`);
        void this.reconnect();
        return;
      }
      this.emit('state', 'error', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /** Identifiant de l'appareil pour cette origine, stable d'une session à l'autre : sert à le retrouver au lancement. */
  get deviceId(): string | undefined {
    return this.device?.id;
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.device?.gatt?.disconnect();
  }

  private async subscribe() {
    const server = await this.device!.gatt!.connect();
    const svc = await server.getPrimaryService(SERVICE.heartRate);
    const c = await svc.getCharacteristic(CHAR.heartRateMeasurement);
    c.addEventListener('characteristicvaluechanged', () => {
      const b = bytes(c.value!);
      this.emit('raw', 'Heart Rate', b);
      try {
        this.emit('measurement', { t: performance.now(), heartRateBpm: decodeHeartRate(b) });
      } catch (e) {
        this.emit('log', `Cardio : trame illisible (${e instanceof Error ? e.message : e})`);
      }
    });
    await c.startNotifications();
  }

  private onDisconnected() {
    if (this.reconnecting) return;
    this.emit('log', `${this.name} : déconnecté`);
    if (this.userDisconnect) this.emit('state', 'disconnected');
    else void this.reconnect();
  }

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
          await this.subscribe();
        } catch {
          this.device?.gatt?.disconnect();
          continue;
        }
        this.emit('log', `${this.name} : reconnecté en ${((performance.now() - started) / 1000).toFixed(1)} s`);
        this.emit('state', 'connected', this.name);
        return;
      }
      this.emit('state', 'disconnected');
    } finally {
      this.reconnecting = false;
    }
  }
}
