import { bytes, GattDevice } from './gatt-device';
import { errMsg } from '../util/errors';
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

/**
 * Home trainer FTMS via Web Bluetooth (Chrome, Edge, Android).
 * Si le trainer n'expose pas FTMS, repli sur Cycling Power (lecture seule) et, s'il existe, sur le contrôle Wahoo.
 */
export class WebBluetoothTrainer extends GattDevice implements TrainerAdapter {
  name = 'Web Bluetooth';
  capabilities: TrainerCapabilities = { targetPower: false, simulation: false };
  protected readonly fallbackName = 'Trainer inconnu';

  private controlPoint?: BluetoothRemoteGATTCharacteristic;
  private pending?: { op: number; resolve: (r: ControlResponse) => void };
  private queue: Promise<unknown> = Promise.resolve();
  private lastCrank?: CyclingPowerFrame['crank'];
  private lastCrankEventAt = 0;

  /** Sans nouvel évènement de manivelle depuis ce délai, le cycliste ne pédale plus : cadence 0. */
  cadenceTimeoutMs = 2000;
  private hasControl = false;
  private wahooCp?: BluetoothRemoteGATTCharacteristic;
  /** Paramètres du mode simulation Wahoo déjà écrits sur cette session ; inutile de les renvoyer à chaque pente. */
  private wahooSimKey?: string;
  /** Dernière consigne ERG ou SIM, rejouée après une reconnexion. */
  private lastCommand?: () => Promise<void>;

  protected requestOptions(nameHint?: string): RequestDeviceOptions {
    return {
      filters: nameHint ? [{ name: nameHint }] : [{ services: [SERVICE.fitnessMachine] }, { services: [SERVICE.cyclingPower] }],
      optionalServices: [SERVICE.fitnessMachine, SERVICE.cyclingPower, SERVICE.heartRate, WAHOO_SERVICE],
    };
  }

  override async disconnect(): Promise<void> {
    this.lastCommand = undefined;
    return super.disconnect();
  }

  protected override onLinkLost() {
    this.hasControl = false;
    this.controlPoint = undefined;
    this.wahooCp = undefined;
    this.wahooSimKey = undefined;
    this.lastCrank = undefined;
    this.lastCrankEventAt = 0;
    this.pending = undefined;
  }

  protected override async afterReconnect() {
    await this.lastCommand?.().catch((e) => this.emit('log', `consigne non rejouée : ${errMsg(e)}`, 'error'));
  }

  protected async setup() {
    const server = await this.gatt().connect();
    const services = await server.getPrimaryServices();
    const has = (u: number) => services.some((s) => s.uuid === BluetoothUUID.getService(u));
    this.emit('log', `Services : ${services.map((s) => s.uuid).join(', ')}`);

    if (has(SERVICE.fitnessMachine)) await this.setupFtms(server);
    else if (has(SERVICE.cyclingPower)) {
      await this.setupCyclingPower(server);
      await this.setupWahoo(services);
    } else throw new Error('Ni FTMS ni Cycling Power exposés par cet appareil');

    if (has(SERVICE.heartRate)) {
      await this.setupHeartRate(server).catch((e) => this.emit('log', `Cardio ignoré : ${errMsg(e)}`, 'error'));
    }
  }

  /**
   * Publie les champs portés par la trame reçue, et eux seuls : un champ absent n'est pas reconduit avec un horodatage
   * neuf. C'est au consommateur de garder la dernière valeur de chaque champ et de juger de sa fraîcheur.
   */
  private push(patch: Omit<Measurement, 't'>) {
    this.emit('measurement', { ...patch, t: performance.now() });
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
      this.push(decodeIndoorBikeData(b)),
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
      const patch: Omit<Measurement, 't'> = { powerW: f.powerW };
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
  private async setupWahoo(services: BluetoothRemoteGATTService[]) {
    for (const svc of [WAHOO_SERVICE, SERVICE.cyclingPower]) {
      const service = services.find((s) => s.uuid === BluetoothUUID.getService(svc));
      const c = await service?.getCharacteristic(WAHOO_CONTROL_CHAR).catch(() => undefined);
      if (!c) continue;
      await this.subscribe(c, 'Wahoo Control Point', () => {}).catch((e) =>
        this.emit('log', `Indications Wahoo non activées : ${errMsg(e)}`, 'error'),
      );
      this.wahooCp = c;
      this.capabilities = { targetPower: true, simulation: true };
      this.emit('log', 'Contrôle propriétaire Wahoo disponible (ERG et SIM)');
      return;
    }
    this.emit('log', 'Aucun contrôle disponible : lecture seule');
  }

  private async setupHeartRate(server: BluetoothRemoteGATTServer) {
    const c = await (await server.getPrimaryService(SERVICE.heartRate)).getCharacteristic(
      CHAR.heartRateMeasurement,
    );
    await this.subscribe(c, 'Heart Rate', (b) => this.push({ heartRateBpm: decodeHeartRate(b) }));
  }

  /** Exécute `run` après les écritures déjà en file : une seule commande à la fois vers le trainer. */
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Commande FTMS : écrite sur le Control Point, puis réponse attendue avant la commande suivante. */
  private command(payload: Uint8Array<ArrayBuffer>): Promise<ControlResponse> {
    return this.enqueue(async () => {
      const cp = this.controlPoint;
      if (!cp) throw new Error('Pas de Control Point : trainer non pilotable');
      const op = payload[0]!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = new Promise<ControlResponse>((resolve, reject) => {
        this.pending = { op, resolve };
        timer = setTimeout(() => {
          if (this.pending?.op !== op) return;
          this.pending = undefined;
          reject(new Error(`Pas de réponse à la commande 0x${op.toString(16)}`));
        }, RESPONSE_TIMEOUT_MS);
      });
      response.catch(() => {}); // évite un rejet non géré si l'écriture échoue avant
      try {
        await cp.writeValueWithResponse(payload);
        const r = await response;
        const label = RESULT_LABEL[r.result] ?? `code ${r.result}`;
        this.emit('log', `Commande 0x${op.toString(16)} : ${label}`);
        if (!r.ok) throw new Error(label);
        return r;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async ensureControl() {
    if (this.hasControl) return;
    await this.command(encodeRequestControl());
    await this.command(encodeStart()).catch(() => {}); // facultatif selon les appareils
    this.hasControl = true;
  }

  /** Écriture Wahoo sérialisée ; le résultat est lu dans les indications brutes du journal. */
  private writeWahoo(label: string, payload: Uint8Array<ArrayBuffer>[]): Promise<void> {
    return this.enqueue(async () => {
      const cp = this.wahooCp;
      if (!cp) throw new Error('Pas de contrôle Wahoo');
      for (const frame of payload) await cp.writeValueWithResponse(frame);
      this.emit('log', `Wahoo ${label} écrit`);
    });
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
