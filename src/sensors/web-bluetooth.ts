import { Emitter } from './emitter';
import { CHAR, SERVICE } from './uuids';
import {
  cadenceFromCrank,
  decodeCyclingPower,
  decodeFtmsFeature,
  decodeHeartRate,
  decodeIndoorBikeData,
  decodePowerRange,
  type CyclingPowerFrame,
} from './decoders';
import {
  decodeResponse,
  encodeRequestControl,
  encodeSimulation,
  encodeStart,
  encodeTargetPower,
  RESULT_LABEL,
  type ControlResponse,
} from './control-point';
import { WAHOO_CONTROL_CHAR, WAHOO_SERVICE, wahooSimulation, wahooTargetPower } from './wahoo';
import type { Measurement, SimulationParams, TrainerAdapter, TrainerCapabilities } from './types';

const RESPONSE_TIMEOUT_MS = 3000;

const bytes = (dv: DataView) => new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));

export function webBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Home trainer FTMS via Web Bluetooth (Chrome, Edge, Android).
 * Si le trainer n'expose pas FTMS, repli sur Cycling Power (lecture seule).
 */
export class WebBluetoothTrainer extends Emitter implements TrainerAdapter {
  name = 'Web Bluetooth';
  capabilities: TrainerCapabilities = { targetPower: false, simulation: false };

  private device?: BluetoothDevice;
  private controlPoint?: BluetoothRemoteGATTCharacteristic;
  private pending?: { op: number; resolve: (r: ControlResponse) => void };
  private queue: Promise<unknown> = Promise.resolve();
  private last: Measurement = { t: 0 };
  private lastCrank?: CyclingPowerFrame['crank'];
  private lastCrankEventAt = 0;

  /** Sans nouvel évènement de manivelle depuis ce délai, le cycliste ne pédale plus : cadence 0. */
  cadenceTimeoutMs = 2000;
  private hasControl = false;
  private wahooCp?: BluetoothRemoteGATTCharacteristic;
  /** Paramètres du mode simulation Wahoo déjà écrits sur cette session ; inutile de les renvoyer à chaque pente. */
  private wahooSimKey?: string;
  private userDisconnect = false;
  private reconnecting = false;
  /** Dernière consigne ERG ou SIM, rejouée après une reconnexion. */
  private lastCommand?: () => Promise<void>;

  /** Pauses entre tentatives de reconnexion ; la dernière valeur se répète jusqu'à `reconnectTimeoutMs`. */
  reconnectDelaysMs = [0, 500, 1000, 2000, 3000];
  reconnectTimeoutMs = 60_000;

  async connect(nameHint?: string): Promise<void> {
    if (!webBluetoothAvailable()) {
      const msg = 'Web Bluetooth indisponible (Chrome ou Edge requis, en HTTPS ou sur localhost)';
      this.emit('state', 'error', msg);
      throw new Error(msg);
    }
    this.emit('state', 'connecting');
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: nameHint ? [{ name: nameHint }] : [{ services: [SERVICE.fitnessMachine] }, { services: [SERVICE.cyclingPower] }],
        optionalServices: [SERVICE.fitnessMachine, SERVICE.cyclingPower, SERVICE.heartRate, WAHOO_SERVICE],
      });
    } catch (e) {
      this.emit('state', 'error', e instanceof Error ? e.message : String(e));
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
    this.emit('state', 'connecting', device.name ?? 'Trainer inconnu');
    return this.open(device, keepTrying);
  }

  private async open(device: BluetoothDevice, keepTrying = false): Promise<void> {
    this.userDisconnect = false;
    if (this.device !== device) device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
    this.device = device;
    this.name = device.name ?? 'Trainer inconnu';
    try {
      await this.setup();
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
    this.lastCommand = undefined;
    this.device?.gatt?.disconnect();
  }

  private onDisconnected() {
    if (this.reconnecting) return; // coupure provoquée par la boucle de reconnexion elle-même
    this.hasControl = false;
    this.controlPoint = undefined;
    this.wahooCp = undefined;
    this.wahooSimKey = undefined;
    this.lastCrank = undefined;
    this.lastCrankEventAt = 0;
    this.pending = undefined;
    this.emit('log', 'GATT déconnecté');
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
          this.emit('log', `essai ${attempt + 1} échoué : ${e instanceof Error ? e.message : e}`);
          this.device?.gatt?.disconnect(); // repart d'une session propre : évite les abonnements en double
          continue;
        }
        this.emit('log', `reconnecté en ${((performance.now() - started) / 1000).toFixed(1)} s`);
        this.emit('state', 'connected', this.name);
        await this.lastCommand?.().catch((e) => this.emit('log', `consigne non rejouée : ${e}`));
        return;
      }
      this.emit('state', 'disconnected');
    } finally {
      this.reconnecting = false;
    }
  }

  private async setup() {
    const server = await this.device!.gatt!.connect();
    const services = await server.getPrimaryServices();
    const has = (u: number) => services.some((s) => s.uuid === BluetoothUUID.getService(u));
    this.emit('log', `Services : ${services.map((s) => s.uuid).join(', ')}`);

    if (has(SERVICE.fitnessMachine)) await this.setupFtms(server);
    else if (has(SERVICE.cyclingPower)) {
      await this.setupCyclingPower(server);
      await this.setupWahoo(server, services);
    }
    else throw new Error('Ni FTMS ni Cycling Power exposés par cet appareil');

    if (has(SERVICE.heartRate)) {
      await this.setupHeartRate(server).catch((e) => this.emit('log', `Cardio ignoré : ${e}`));
    }
  }

  private push(patch: Partial<Measurement>) {
    this.last = { ...this.last, ...patch, t: performance.now() };
    this.emit('measurement', this.last);
  }

  private async subscribe(c: BluetoothRemoteGATTCharacteristic, label: string, fn: (b: Uint8Array) => void) {
    c.addEventListener('characteristicvaluechanged', () => {
      const b = bytes(c.value!);
      this.emit('raw', label, b);
      try {
        fn(b);
      } catch (e) {
        this.emit('log', `${label} : trame illisible (${e instanceof Error ? e.message : e})`);
      }
    });
    await c.startNotifications();
  }

  private async setupFtms(server: BluetoothRemoteGATTServer) {
    const svc = await server.getPrimaryService(SERVICE.fitnessMachine);

    const read = (id: number) =>
      svc.getCharacteristic(id).then((c) => c.readValue()).catch(() => undefined);

    const feature = await read(CHAR.ftmsFeature);
    if (feature) {
      this.capabilities = { ...this.capabilities, ...decodeFtmsFeature(bytes(feature)) };
      this.emit('raw', 'FTMS Feature', bytes(feature));
    } else {
      // Caractéristique absente : on tente quand même les commandes.
      this.capabilities = { targetPower: true, simulation: true };
    }
    const range = await read(CHAR.supportedPowerRange);
    if (range) this.capabilities.powerRange = decodePowerRange(bytes(range));

    await this.subscribe(await svc.getCharacteristic(CHAR.indoorBikeData), 'Indoor Bike Data', (b) =>
      this.push(decodeIndoorBikeData(b, 0)),
    );
    await svc
      .getCharacteristic(CHAR.machineStatus)
      .then((c) => this.subscribe(c, 'Machine Status', () => {}))
      .catch(() => {});

    const cp = await svc.getCharacteristic(CHAR.controlPoint);
    await this.subscribe(cp, 'Control Point', (b) => {
      const r = decodeResponse(b);
      if (r && this.pending?.op === r.requestOp) {
        this.pending.resolve(r);
        this.pending = undefined;
      }
    });
    this.controlPoint = cp;
  }

  private async setupCyclingPower(server: BluetoothRemoteGATTServer) {
    this.emit('log', 'Pas de FTMS : lecture de la puissance via Cycling Power');
    const c = await (await server.getPrimaryService(SERVICE.cyclingPower)).getCharacteristic(
      CHAR.cyclingPowerMeasurement,
    );
    await this.subscribe(c, 'Cycling Power', (b) => {
      const f = decodeCyclingPower(b);
      const patch: Partial<Measurement> = { powerW: f.powerW };
      if (f.crank) {
        if (this.lastCrank) {
          const rpm = cadenceFromCrank(this.lastCrank, f.crank);
          const now = performance.now();
          if (rpm !== undefined) {
            patch.cadenceRpm = rpm;
            this.lastCrankEventAt = now;
          } else if (now - this.lastCrankEventAt > this.cadenceTimeoutMs) {
            // Les compteurs de manivelle ne bougent plus : sans ce repli, la dernière cadence resterait affichée.
            patch.cadenceRpm = 0;
          }
        }
        this.lastCrank = f.crank;
      }
      this.push(patch);
    });
  }

  /** Contrôle propriétaire Wahoo : la caractéristique est cherchée dans le service Wahoo, puis dans Cycling Power. */
  private async setupWahoo(server: BluetoothRemoteGATTServer, services: BluetoothRemoteGATTService[]) {
    for (const svc of [WAHOO_SERVICE, SERVICE.cyclingPower]) {
      const service = services.find((s) => s.uuid === BluetoothUUID.getService(svc));
      const c = await service?.getCharacteristic(WAHOO_CONTROL_CHAR).catch(() => undefined);
      if (!c) continue;
      await this.subscribe(c, 'Wahoo Control Point', () => {}).catch((e) =>
        this.emit('log', `Indications Wahoo non activées : ${e}`),
      );
      this.wahooCp = c;
      this.capabilities = { targetPower: true, simulation: true };
      this.emit('log', 'Contrôle propriétaire Wahoo disponible (ERG et SIM)');
      return;
    }
    this.emit('log', 'Aucun contrôle disponible : lecture seule');
    void server;
  }

  private async setupHeartRate(server: BluetoothRemoteGATTServer) {
    const c = await (await server.getPrimaryService(SERVICE.heartRate)).getCharacteristic(
      CHAR.heartRateMeasurement,
    );
    await this.subscribe(c, 'Heart Rate', (b) => this.push({ heartRateBpm: decodeHeartRate(b) }));
  }

  /** Les écritures sur le Control Point sont sérialisées : une réponse est attendue avant la commande suivante. */
  private command(payload: Uint8Array<ArrayBuffer>): Promise<ControlResponse> {
    const run = async (): Promise<ControlResponse> => {
      const cp = this.controlPoint;
      if (!cp) throw new Error('Pas de Control Point : trainer non pilotable');
      const op = payload[0]!;
      const response = new Promise<ControlResponse>((resolve, reject) => {
        this.pending = { op, resolve };
        setTimeout(() => {
          if (this.pending?.op === op) {
            this.pending = undefined;
            reject(new Error(`Pas de réponse à la commande 0x${op.toString(16)}`));
          }
        }, RESPONSE_TIMEOUT_MS);
      });
      response.catch(() => {}); // évite un rejet non géré si l'écriture échoue avant
      await cp.writeValueWithResponse(payload);
      const r = await response;
      const label = RESULT_LABEL[r.result] ?? `code ${r.result}`;
      this.emit('log', `Commande 0x${op.toString(16)} : ${label}`);
      if (!r.ok) throw new Error(label);
      return r;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  private async ensureControl() {
    if (this.hasControl) return;
    await this.command(encodeRequestControl());
    await this.command(encodeStart()).catch(() => {}); // facultatif selon les appareils
    this.hasControl = true;
  }

  /** Écriture Wahoo sérialisée ; le résultat est lu dans les indications brutes du journal. */
  private writeWahoo(label: string, payload: Uint8Array<ArrayBuffer>[]): Promise<void> {
    const run = async () => {
      const cp = this.wahooCp;
      if (!cp) throw new Error('Pas de contrôle Wahoo');
      for (const frame of payload) await cp.writeValueWithResponse(frame);
      this.emit('log', `Wahoo ${label} écrit`);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async setTargetPower(watts: number): Promise<void> {
    const apply = async () => {
      if (this.wahooCp) {
        this.wahooSimKey = undefined; // l'ERG quitte le mode simulation : il faudra le reprogrammer
        return this.writeWahoo(`ERG ${watts} W`, [wahooTargetPower(watts)]);
      }
      await this.ensureControl();
      await this.command(encodeTargetPower(watts));
    };
    await apply();
    this.lastCommand = apply;
  }

  async setSimulation(p: SimulationParams): Promise<void> {
    const apply = async () => {
      if (this.wahooCp) {
        const [mode, grade] = wahooSimulation(p);
        const key = `${p.massKg}|${p.crr}|${p.cw}`;
        const frames = key === this.wahooSimKey ? [grade!] : [mode!, grade!];
        await this.writeWahoo(`SIM ${p.gradePct.toFixed(1)} %`, frames);
        this.wahooSimKey = key;
        return;
      }
      await this.ensureControl();
      await this.command(encodeSimulation(p));
    };
    await apply();
    this.lastCommand = apply;
  }
}
