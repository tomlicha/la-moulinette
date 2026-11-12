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
import {
  decodeWahooResponse,
  WAHOO_CONTROL_CHAR,
  WAHOO_SERVICE,
  WAHOO_STATUS_OK,
  wahooSimulation,
  wahooTargetPower,
  wahooUnlock,
} from './wahoo';
import {
  decodeFecCommandStatus,
  decodeFecPage,
  decodeFecTrainerStatus,
  FEC_NOTIFY_CHAR,
  FEC_PAGE,
  FEC_SERVICE,
  FEC_STATUS,
  FEC_STATUS_LABEL,
  FEC_WRITE_CHAR,
  fecPages,
  fecRequestPage,
  fecTargetPower,
  fecTrackResistance,
  fecUserConfig,
  fecWindResistance,
  type FecCommandStatus,
} from './fec';
import {
  firmwareAdvice,
  identifyTrainer,
  PROTOCOL_LABEL,
  protocolOrder,
  TRAINER_NAME_PREFIXES,
  type ControlProtocol,
  type DeviceInfo,
  type TrainerProfile,
} from './trainer-profiles';
import type { Measurement, SimulationParams, TrainerAdapter, TrainerCapabilities } from './types';

const RESPONSE_TIMEOUT_MS = 3000;
/** Résultat FTMS « contrôle non accordé » : une autre application tient le trainer. */
const RESULT_CONTROL_NOT_PERMITTED = 5;
/** Machine Status FTMS. */
const STATUS_RESET = 0x01;
const STATUS_CONTROL_LOST = 0xff;
/** Masse du vélo retranchée de la masse totale pour les protocoles qui séparent cycliste et vélo (FE-C). */
const BIKE_KG = 8;
/** Délai minimal entre deux renvois de la configuration FE-C réclamée par le trainer. */
const FEC_CONFIG_RESEND_MS = 10_000;

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Configuration FE-C qui accompagne la pente : poids (page 55) puis traînée et vent (page 50). */
const fecConfigFrames = (p: SimulationParams) => [
  fecUserConfig(Math.max(30, (p.massKg ?? 80) - BIKE_KG), BIKE_KG),
  fecWindResistance(p.cw, p.windSpeedMs),
];
const fecSimKey = (p: SimulationParams) => `${p.massKg}|${p.cw}|${p.windSpeedMs}`;

/**
 * Services à déclarer au sélecteur : Web Bluetooth cache tout service non déclaré, même s'il existe sur l'appareil.
 * C'est ce qui masquait le contrôle Wahoo au début ; le service Tacx et Device Information sont dans le même cas.
 */
export const TRAINER_SERVICES: BluetoothServiceUUID[] = [
  SERVICE.fitnessMachine,
  SERVICE.cyclingPower,
  SERVICE.heartRate,
  SERVICE.deviceInformation,
  WAHOO_SERVICE,
  FEC_SERVICE,
];

/** Accessoires qui portent un nom de trainer sans en être un. */
const NOT_TRAINERS = ['KICKR CLIMB', 'KICKR HEADWIND', 'HEADWIND'];

/** Échec d'une commande FTMS, avec le code de résultat renvoyé par le trainer. */
class FtmsError extends Error {
  constructor(readonly result: number, message: string) {
    super(message);
  }
}

/** Écriture avec réponse si la caractéristique l'accepte ; sinon sans réponse (certains ports série BLE). */
function writeChar(c: BluetoothRemoteGATTCharacteristic, data: Uint8Array<ArrayBuffer>): Promise<void> {
  const p = c.properties;
  if (p && !p.write && p.writeWithoutResponse) return c.writeValueWithoutResponse(data);
  return c.writeValueWithResponse(data);
}

/** Ce que l'application sait du trainer connecté : utile à l'affichage, au journal et aux rapports d'erreur. */
export interface TrainerIdentity {
  profile: TrainerProfile;
  info: DeviceInfo;
  /** Protocole de pilotage retenu ; absent, le trainer est en lecture seule. */
  protocol?: ControlProtocol;
  services: string[];
  /** Conseil à montrer à l'utilisateur, par exemple une mise à jour du firmware. */
  advice?: string;
}

type DataSource = 'ftms' | 'cps' | 'fec';

/** Source des mesures selon le protocole de pilotage : celle qui va avec, puis les autres. */
const DATA_ORDER: Record<ControlProtocol | 'aucun', DataSource[]> = {
  ftms: ['ftms', 'cps', 'fec'],
  wahoo: ['cps', 'ftms', 'fec'],
  // Les clients de référence (GoldenCheetah, qdomyos-zwift) lisent les Tacx par Cycling Power, pas par les pages FE-C.
  fec: ['cps', 'fec', 'ftms'],
  aucun: ['ftms', 'cps', 'fec'],
};

/**
 * Home trainer via Web Bluetooth (Chrome, Edge, Android). Le trainer est identifié (nom, Device Information), puis
 * piloté par le premier protocole disponible dans l'ordre de son profil : FTMS, contrôle propriétaire Wahoo ou
 * FE-C over BLE (Tacx). Sans aucun des trois, il reste lisible via FTMS, Cycling Power ou FE-C.
 */
export class WebBluetoothTrainer extends GattDevice implements TrainerAdapter {
  name = 'Web Bluetooth';
  capabilities: TrainerCapabilities = { targetPower: false, simulation: false };
  identity?: TrainerIdentity;
  /** Protocole imposé par l'utilisateur ou le support ; essayé en premier, les autres restent en repli. */
  forcedProtocol?: ControlProtocol;
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
  private fecWrite?: BluetoothRemoteGATTCharacteristic;
  /** Paramètres de simulation déjà écrits sur cette session (Wahoo, FE-C) ; inutile de les renvoyer à chaque pente. */
  private simKey?: string;
  /** Dernière consigne ERG ou SIM, rejouée après une reconnexion. */
  private lastCommand?: () => Promise<void>;

  /**
   * Écritures BLE refusées par la pile (commande précédente pas terminée, sur les KICKR notamment) : nouvel essai,
   * comme GoldenCheetah qui renvoie la commande en tête de file.
   */
  writeAttempts = 3;
  writeRetryDelayMs = 200;
  /** Attente de l'accusé `01 <opcode> <statut>` du contrôle Wahoo ; sans accusé dès la première commande, on n'attend plus. */
  wahooResponseTimeoutMs = 1000;
  /** Renvoi périodique de la dernière consigne FE-C, comme GoldenCheetah : une trame perdue ne fige pas le trainer. */
  fecRefreshMs = 5000;

  /** `undefined` tant qu'aucune commande n'a été envoyée ; `false` si le trainer n'accuse jamais réception. */
  private wahooAcks?: boolean;
  private wahooPending?: { op: number; resolve: (status: number | undefined) => void };
  private fecNotify = false;
  /** Les pages FE-C servent aussi de mesures (pas de Cycling Power sur l'appareil). */
  private fecIsData = false;
  /** Dernière consigne FE-C (puissance ou pente), à confirmer par l'état de commande et à renvoyer périodiquement. */
  private fecLast?: { page: number; frame: Uint8Array<ArrayBuffer>; retried: boolean };
  private fecRefreshTimer?: ReturnType<typeof setInterval>;
  private fecConfigAt = -Infinity;
  private fecWarned = new Set<string>();
  private lastSim?: SimulationParams;

  protected requestOptions(nameHint?: string): RequestDeviceOptions {
    const options: RequestDeviceOptions & { exclusionFilters?: BluetoothLEScanFilter[] } = {
      filters: nameHint
        ? [{ name: nameHint }]
        : [
            { services: [SERVICE.fitnessMachine] },
            { services: [SERVICE.cyclingPower] },
            { services: [FEC_SERVICE] },
            ...TRAINER_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          ],
      optionalServices: TRAINER_SERVICES,
    };
    // Chrome 114 et plus ; les versions antérieures ignorent l'option.
    if (!nameHint) options.exclusionFilters = NOT_TRAINERS.map((namePrefix) => ({ namePrefix }));
    return options;
  }

  override async disconnect(): Promise<void> {
    this.lastCommand = undefined;
    return super.disconnect();
  }

  protected override onLinkLost() {
    this.resetSession();
  }

  protected override async afterReconnect() {
    await this.lastCommand?.().catch((e) => this.emit('log', `consigne non rejouée : ${errMsg(e)}`, 'error'));
  }

  private resetSession() {
    this.hasControl = false;
    this.controlPoint = undefined;
    this.wahooCp = undefined;
    this.fecWrite = undefined;
    this.simKey = undefined;
    this.lastCrank = undefined;
    this.lastCrankEventAt = 0;
    this.pending = undefined;
    this.wahooAcks = undefined;
    this.wahooPending?.resolve(undefined);
    this.wahooPending = undefined;
    this.fecNotify = false;
    this.fecIsData = false;
    this.fecLast = undefined;
    clearInterval(this.fecRefreshTimer);
    this.fecRefreshTimer = undefined;
  }

  protected async setup() {
    this.resetSession();
    this.capabilities = { targetPower: false, simulation: false };
    const server = await this.gatt().connect();
    const services = await server.getPrimaryServices();
    const find = (u: number | string) => services.find((s) => s.uuid === BluetoothUUID.getService(u));
    this.emit('log', `Services : ${services.map((s) => s.uuid).join(', ')}`);

    const info = await this.readDeviceInfo(find(SERVICE.deviceInformation));
    const profile = identifyTrainer(this.device?.name, info);

    let protocol: ControlProtocol | undefined;
    for (const p of protocolOrder(profile, this.forcedProtocol)) {
      try {
        if (await this.setupControl(p, find)) {
          protocol = p;
          break;
        }
      } catch (e) {
        this.emit('log', `${PROTOCOL_LABEL[p]} inutilisable : ${errMsg(e)}`);
      }
    }
    if (this.forcedProtocol && protocol !== this.forcedProtocol) {
      this.emit('log', `Protocole imposé ${PROTOCOL_LABEL[this.forcedProtocol]} absent de cet appareil : repli automatique`);
    }

    const source = await this.setupData(protocol, find);
    if (!source) throw new Error('Ni FTMS, ni Cycling Power, ni FE-C exposés par cet appareil');

    const advice = protocol ? undefined : firmwareAdvice(profile, info);
    this.identity = { profile, info, protocol, services: services.map((s) => s.uuid), advice };
    const details = [info.manufacturer, info.model, info.firmware && `firmware ${info.firmware}`, info.hardware && `matériel ${info.hardware}`]
      .filter(Boolean)
      .join(', ');
    this.emit(
      'log',
      `Identifié : ${profile.label}${details ? ` (${details})` : ''} · pilotage ${protocol ? PROTOCOL_LABEL[protocol] : 'aucun'} · mesures ${source.toUpperCase()}`,
    );
    if (advice) this.emit('log', advice);

    const hr = find(SERVICE.heartRate);
    if (hr) await this.setupHeartRate(hr).catch((e) => this.emit('log', `Cardio ignoré : ${errMsg(e)}`, 'error'));
  }

  /** Fabricant, modèle et versions, lus un par un : beaucoup de piles BLE refusent les lectures simultanées. */
  private async readDeviceInfo(svc?: BluetoothRemoteGATTService): Promise<DeviceInfo> {
    if (!svc) return {};
    const text = async (id: number) => {
      try {
        const v = await (await svc.getCharacteristic(id)).readValue();
        return new TextDecoder().decode(bytes(v)).replace(/\0+$/, '').trim() || undefined;
      } catch {
        return undefined;
      }
    };
    const info: DeviceInfo = {};
    const fields: [keyof DeviceInfo, number][] = [
      ['manufacturer', CHAR.manufacturerName],
      ['model', CHAR.modelNumber],
      ['hardware', CHAR.hardwareRevision],
      ['firmware', CHAR.firmwareRevision],
      ['software', CHAR.softwareRevision],
    ];
    for (const [key, id] of fields) {
      const v = await text(id);
      if (v) info[key] = v;
    }
    return info;
  }

  /** Prépare un protocole de pilotage ; `false` s'il n'existe pas sur cet appareil. */
  private async setupControl(p: ControlProtocol, find: (u: number | string) => BluetoothRemoteGATTService | undefined) {
    switch (p) {
      case 'ftms':
        return this.setupFtmsControl(find(SERVICE.fitnessMachine));
      case 'wahoo':
        return this.setupWahoo([find(WAHOO_SERVICE), find(SERVICE.cyclingPower)]);
      case 'fec':
        return this.setupFecControl(find(FEC_SERVICE));
    }
  }

  /** Abonne la première source de mesures disponible, en commençant par celle du protocole retenu. */
  private async setupData(
    protocol: ControlProtocol | undefined,
    find: (u: number | string) => BluetoothRemoteGATTService | undefined,
  ): Promise<DataSource | undefined> {
    for (const source of DATA_ORDER[protocol ?? 'aucun']) {
      try {
        if (source === 'ftms') {
          const svc = find(SERVICE.fitnessMachine);
          if (!svc) continue;
          await this.subscribe(await svc.getCharacteristic(CHAR.indoorBikeData), 'Indoor Bike Data', (b) =>
            this.push(decodeIndoorBikeData(b)),
          );
        } else if (source === 'cps') {
          const svc = find(SERVICE.cyclingPower);
          if (!svc) continue;
          await this.setupCyclingPower(svc);
        } else {
          const svc = find(FEC_SERVICE);
          if (!svc) continue;
          await this.subscribeFec(svc);
          this.fecIsData = true;
        }
        return source;
      } catch (e) {
        this.emit('log', `Mesures ${source.toUpperCase()} indisponibles : ${errMsg(e)}`);
      }
    }
    return undefined;
  }

  /**
   * Publie les champs portés par la trame reçue, et eux seuls : un champ absent n'est pas reconduit avec un horodatage
   * neuf. C'est au consommateur de garder la dernière valeur de chaque champ et de juger de sa fraîcheur.
   */
  private push(patch: Partial<Measurement>) {
    this.emit('measurement', { ...patch, t: performance.now() });
  }

  private async setupFtmsControl(svc?: BluetoothRemoteGATTService): Promise<boolean> {
    if (!svc) return false;
    const read = (id: number) =>
      svc.getCharacteristic(id).then((c) => c.readValue()).catch(() => undefined);

    const cp = await svc.getCharacteristic(CHAR.controlPoint).catch(() => undefined);
    if (!cp) {
      this.emit('log', 'FTMS sans Control Point : pas de pilotage par FTMS');
      return false;
    }
    const feature = await read(CHAR.ftmsFeature);
    let caps: Pick<TrainerCapabilities, 'targetPower' | 'simulation'> = { targetPower: true, simulation: true };
    if (feature) {
      this.emit('raw', 'FTMS Feature', bytes(feature));
      caps = decodeFtmsFeature(bytes(feature));
      if (!caps.targetPower && !caps.simulation) {
        this.emit('log', 'FTMS annonce ni ERG ni SIM : pas de pilotage par FTMS');
        return false;
      }
    } // caractéristique absente : on tente quand même les commandes
    const range = await read(CHAR.supportedPowerRange);

    await svc
      .getCharacteristic(CHAR.machineStatus)
      .then((c) => this.subscribe(c, 'Machine Status', (b) => this.onMachineStatus(b)))
      .catch(() => {});
    await this.subscribe(cp, 'Control Point', (b) => {
      const r = decodeResponse(b);
      if (r && this.pending?.op === r.requestOp) {
        this.pending.resolve(r);
        this.pending = undefined;
      }
    });
    this.controlPoint = cp;
    this.capabilities = { ...caps, ...(range ? { powerRange: decodePowerRange(bytes(range)) } : {}) };
    return true;
  }

  /** Une autre application qui prend la main, ou un reset du trainer, annule notre prise de contrôle. */
  private onMachineStatus(b: Uint8Array) {
    if (b[0] === STATUS_CONTROL_LOST) {
      this.hasControl = false;
      this.emit('log', 'FTMS : contrôle perdu (une autre application a pris la main ?)');
    } else if (b[0] === STATUS_RESET) {
      this.hasControl = false;
      this.emit('log', 'FTMS : trainer réinitialisé');
    }
  }

  private async setupCyclingPower(svc: BluetoothRemoteGATTService) {
    const c = await svc.getCharacteristic(CHAR.cyclingPowerMeasurement);
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

  /**
   * Contrôle propriétaire Wahoo : la caractéristique est cherchée dans le service Wahoo, puis dans Cycling Power
   * (où certains firmwares la rangent). Le déverrouillage est envoyé une fois par connexion, comme qdomyos-zwift ;
   * inutile sur les KICKR récents (GoldenCheetah ne l'envoie jamais), son refus n'empêche rien.
   */
  private async setupWahoo(services: (BluetoothRemoteGATTService | undefined)[]): Promise<boolean> {
    for (const service of services) {
      const c = await service?.getCharacteristic(WAHOO_CONTROL_CHAR).catch(() => undefined);
      if (!c) continue;
      await this.subscribe(c, 'Wahoo Control Point', (b) => {
        const r = decodeWahooResponse(b);
        if (r && this.wahooPending?.op === r.op) {
          const p = this.wahooPending;
          this.wahooPending = undefined;
          p.resolve(r.status);
        }
      }).catch((e) => this.emit('log', `Indications Wahoo non activées : ${errMsg(e)}`, 'error'));
      this.wahooCp = c;
      const status = await this.wahooSend(c, wahooUnlock()).catch((e) => {
        this.emit('log', `Déverrouillage Wahoo non écrit : ${errMsg(e)}`);
        return undefined;
      });
      if (status !== undefined && status !== WAHOO_STATUS_OK) {
        this.emit('log', `Déverrouillage Wahoo refusé (statut ${hex(status)}) : sans effet sur les KICKR récents`);
      }
      this.capabilities = { targetPower: true, simulation: true };
      return true;
    }
    return false;
  }

  /**
   * FE-C over BLE : consignes écrites sur le port série Tacx. Les notifications portent l'état de commande (page 71)
   * et l'état du trainer (page 25) qui servent à la reprise ; elles ne sont pas indispensables au pilotage.
   */
  private async setupFecControl(svc?: BluetoothRemoteGATTService): Promise<boolean> {
    if (!svc) return false;
    this.fecWrite = await svc.getCharacteristic(FEC_WRITE_CHAR);
    await this.subscribeFec(svc).catch((e) =>
      this.emit('log', `Notifications FE-C indisponibles, consignes sans confirmation : ${errMsg(e)}`),
    );
    this.capabilities = { targetPower: true, simulation: true };
    clearInterval(this.fecRefreshTimer);
    this.fecRefreshTimer = setInterval(() => {
      const last = this.fecLast;
      if (last) void this.serial(() => this.writeWithRetry(this.fecWrite, last.frame)).catch(() => {});
    }, this.fecRefreshMs);
    return true;
  }

  private async subscribeFec(svc: BluetoothRemoteGATTService) {
    if (this.fecNotify) return;
    await this.subscribe(await svc.getCharacteristic(FEC_NOTIFY_CHAR), 'FE-C', (b) => this.onFec(b));
    this.fecNotify = true;
  }

  private onFec(b: Uint8Array) {
    for (const page of fecPages(b)) {
      if (this.fecIsData) {
        const m = decodeFecPage(page);
        if (Object.keys(m).length) this.push(m);
      }
      if (!this.fecWrite) continue;
      const status = decodeFecCommandStatus(page);
      if (status) this.onFecCommandStatus(status);
      const trainer = decodeFecTrainerStatus(page);
      if (trainer?.userConfigRequired) void this.fecResendConfig();
      if (trainer?.calibrationRequired) {
        this.warnOnce('calibration', "FE-C : le trainer demande un étalonnage ; lance-le depuis l'app Tacx Training");
      }
    }
  }

  private warnOnce(key: string, msg: string) {
    if (this.fecWarned.has(key)) return;
    this.fecWarned.add(key);
    this.emit('log', msg);
  }

  /** Page 71 : une consigne échouée ou refusée est renvoyée une fois ; le renvoi périodique couvre le reste. */
  private onFecCommandStatus(s: FecCommandStatus) {
    const last = this.fecLast;
    if (!last || s.lastCommand !== last.page) return;
    if (s.status === FEC_STATUS.pass || s.status === FEC_STATUS.pending) return;
    this.emit('log', `FE-C : commande ${hex(s.lastCommand)} ${FEC_STATUS_LABEL[s.status] ?? `code ${s.status}`}`);
    if ((s.status === FEC_STATUS.fail || s.status === FEC_STATUS.rejected) && !last.retried) {
      last.retried = true;
      void this.serial(() => this.writeWithRetry(this.fecWrite, last.frame)).catch(() => {});
    }
  }

  /** Page 25, bit « configuration requise » : poids et traînée renvoyés, puis la dernière consigne. */
  private async fecResendConfig() {
    const now = performance.now();
    if (now - this.fecConfigAt < FEC_CONFIG_RESEND_MS) return;
    this.fecConfigAt = now;
    this.warnOnce('config', 'FE-C : le trainer réclame poids et traînée, configuration renvoyée');
    const p = this.lastSim ?? { gradePct: 0 };
    const last = this.fecLast;
    await this.serial(async () => {
      for (const frame of [...fecConfigFrames(p), ...(last ? [last.frame] : [])]) await this.writeWithRetry(this.fecWrite, frame);
    }).catch((e) => this.emit('log', `configuration FE-C non renvoyée : ${errMsg(e)}`, 'error'));
    this.simKey = fecSimKey(p);
  }

  private async setupHeartRate(svc: BluetoothRemoteGATTService) {
    const c = await svc.getCharacteristic(CHAR.heartRateMeasurement);
    await this.subscribe(c, 'Heart Rate', (b) => this.push({ heartRateBpm: decodeHeartRate(b) }));
  }

  /** Commande FTMS : écrite sur le Control Point, puis réponse attendue avant la commande suivante. */
  private command(payload: Uint8Array<ArrayBuffer>): Promise<ControlResponse> {
    return this.serial(async () => {
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
        if (!r.ok) throw new FtmsError(r.result, label);
        return r;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /**
   * Prise de contrôle FTMS. Un refus explicite (une autre application tient le trainer) est remonté ; une absence
   * de réponse ou « non supporté » ne l'est pas : certains trainers acceptent les consignes sans cette étape.
   */
  private async ensureControl() {
    if (this.hasControl) return;
    try {
      await this.command(encodeRequestControl());
    } catch (e) {
      if (e instanceof FtmsError && e.result === RESULT_CONTROL_NOT_PERMITTED) throw e;
      this.emit('log', `Prise de contrôle FTMS sans accord (${errMsg(e)}) : consignes tentées quand même`);
    }
    await this.command(encodeStart()).catch(() => {}); // facultatif selon les appareils
    this.hasControl = true;
  }

  /** Consigne FTMS ; si le contrôle a été perdu entre-temps, il est repris une fois avant d'abandonner. */
  private async ftms(payload: Uint8Array<ArrayBuffer>) {
    await this.ensureControl();
    try {
      await this.command(payload);
    } catch (e) {
      if (!(e instanceof FtmsError) || e.result !== RESULT_CONTROL_NOT_PERMITTED) throw e;
      this.hasControl = false;
      await this.ensureControl();
      await this.command(payload);
    }
  }

  /** Toutes les écritures de contrôle passent l'une après l'autre : les piles BLE refusent les opérations simultanées. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  private async writeWithRetry(c: BluetoothRemoteGATTCharacteristic | undefined, frame: Uint8Array<ArrayBuffer>) {
    if (!c) throw new Error('Pas de caractéristique de contrôle');
    for (let attempt = 1; ; attempt++) {
      try {
        return await writeChar(c, frame);
      } catch (e) {
        if (attempt >= this.writeAttempts) throw e;
        this.emit('log', `écriture ${hex(frame[0]!)} refusée (${errMsg(e)}) : essai ${attempt + 1}/${this.writeAttempts}`);
        await sleep(this.writeRetryDelayMs);
      }
    }
  }

  /** Écrit une trame Wahoo et attend son accusé ; rend le statut, ou `undefined` si le trainer n'accuse pas. */
  private async wahooSend(c: BluetoothRemoteGATTCharacteristic, frame: Uint8Array<ArrayBuffer>): Promise<number | undefined> {
    const op = frame[0]!;
    let response: Promise<number | undefined> = Promise.resolve(undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (this.wahooAcks !== false) {
      response = new Promise((resolve) => {
        this.wahooPending = { op, resolve };
        timer = setTimeout(() => {
          if (this.wahooPending?.op !== op) return;
          this.wahooPending = undefined;
          resolve(undefined);
        }, this.wahooResponseTimeoutMs);
      });
    }
    try {
      await this.writeWithRetry(c, frame);
    } catch (e) {
      if (this.wahooPending?.op === op) this.wahooPending = undefined;
      clearTimeout(timer);
      throw e;
    }
    const status = await response;
    clearTimeout(timer);
    if (status !== undefined) this.wahooAcks = true;
    else if (this.wahooAcks === undefined) {
      this.wahooAcks = false;
      this.emit('log', "Wahoo : pas d'accusé de réception, commandes envoyées sans attente");
    }
    return status;
  }

  /** Commande Wahoo ; refusée, elle est rejouée une fois après un nouveau déverrouillage (reprise de qdomyos-zwift). */
  private async wahooCommand(frame: Uint8Array<ArrayBuffer>) {
    const c = this.wahooCp;
    if (!c) throw new Error('Pas de contrôle Wahoo');
    const status = await this.wahooSend(c, frame);
    if (status === undefined || status === WAHOO_STATUS_OK) return;
    this.emit('log', `Wahoo : commande ${hex(frame[0]!)} refusée (statut ${hex(status)}) : déverrouillage puis nouvel essai`);
    await this.wahooSend(c, wahooUnlock());
    const again = await this.wahooSend(c, frame);
    if (again !== undefined && again !== WAHOO_STATUS_OK) {
      this.emit('log', `Wahoo : commande ${hex(frame[0]!)} toujours refusée (statut ${hex(again)})`);
    }
  }

  private wahooFrames(label: string, frames: Uint8Array<ArrayBuffer>[]): Promise<void> {
    return this.serial(async () => {
      for (const frame of frames) await this.wahooCommand(frame);
      this.emit('log', `Wahoo ${label} écrit`);
    });
  }

  /** Trames FE-C ; la dernière est la consigne, suivie d'une demande d'état de commande (page 70 → 71). */
  private fecFrames(label: string, frames: Uint8Array<ArrayBuffer>[]): Promise<void> {
    return this.serial(async () => {
      for (const frame of frames) await this.writeWithRetry(this.fecWrite, frame);
      const control = frames.at(-1)!;
      this.fecLast = { page: control[4]!, frame: control, retried: false };
      if (this.fecNotify) {
        await this.writeWithRetry(this.fecWrite, fecRequestPage(FEC_PAGE.commandStatus)).catch((e) =>
          this.emit('log', `état de commande FE-C non demandé : ${errMsg(e)}`),
        );
      }
      this.emit('log', `FE-C ${label} écrit`);
    });
  }

  /** Pente ramenée à ce que le trainer sait rendre, d'après son profil. */
  private clampGrade(gradePct: number): number {
    const max = this.identity?.profile.maxGradePct;
    return max === undefined ? gradePct : Math.min(max, gradePct);
  }

  async setTargetPower(watts: number): Promise<void> {
    const apply = async () => {
      if (this.wahooCp) {
        this.simKey = undefined; // l'ERG Wahoo quitte le mode simulation : il faudra le reprogrammer
        return this.wahooFrames(`ERG ${watts} W`, [wahooTargetPower(watts)]);
      }
      if (this.fecWrite) return this.fecFrames(`ERG ${watts} W`, [fecTargetPower(watts)]);
      await this.ftms(encodeTargetPower(watts));
    };
    await apply();
    this.lastCommand = apply;
  }

  async setSimulation(params: SimulationParams): Promise<void> {
    const p = { ...params, gradePct: this.clampGrade(params.gradePct) };
    this.lastSim = p;
    const label = `SIM ${p.gradePct.toFixed(1)} %`;
    const apply = async () => {
      if (this.wahooCp) {
        const [mode, grade] = wahooSimulation(p);
        const key = `${p.massKg}|${p.crr}|${p.cw}`;
        await this.wahooFrames(label, key === this.simKey ? [grade!] : [mode!, grade!]);
        this.simKey = key;
        return;
      }
      if (this.fecWrite) {
        const key = fecSimKey(p);
        const setup = key === this.simKey ? [] : fecConfigFrames(p);
        await this.fecFrames(label, [...setup, fecTrackResistance(p.gradePct, p.crr)]);
        this.simKey = key;
        return;
      }
      await this.ftms(encodeSimulation(p));
    };
    await apply();
    this.lastCommand = apply;
  }
}
