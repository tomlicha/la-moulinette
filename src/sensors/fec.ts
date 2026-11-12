import type { Measurement } from './types';

/**
 * « FE-C over BLE » (Tacx) : les pages ANT+ FE-C, emballées dans des messages ANT, transitent par un service série
 * de type Nordic UART. Tous les Tacx Smart le parlent, y compris ceux qui n'ont jamais reçu FTMS (NEO 1, Vortex,
 * Bushido, Genius, FLUX 2 avant le firmware 5.0.0).
 *
 * Message ANT : A4, longueur (9), identifiant (4E diffusion, 4F acquitté), canal, page de 8 octets, somme XOR.
 *
 * Encodage recoupé le 11 novembre 2026 avec l'implémentation ANT de GoldenCheetah (ANTMessage.cpp, ANT.h), le décodeur
 * de FortiusANT (antDongle.py) et le client Tacx de qdomyos-zwift (tacxneo2.cpp). Les commandes partent en message
 * acquitté (4F) comme chez GoldenCheetah ; qdomyos-zwift envoie 4E et le trainer l'accepte aussi.
 */
export const FEC_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
/** Notifications du trainer vers l'application. */
export const FEC_NOTIFY_CHAR = '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e';
/** Écritures de l'application vers le trainer. */
export const FEC_WRITE_CHAR = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e';

const SYNC = 0xa4;
const MSG_BROADCAST = 0x4e;
const MSG_ACKNOWLEDGED = 0x4f;
const CHANNEL = 0x05;

export const FEC_PAGE = {
  generalFe: 0x10,
  trainerData: 0x19,
  targetPower: 0x31,
  windResistance: 0x32,
  trackResistance: 0x33,
  userConfig: 0x37,
  requestData: 0x46,
  commandStatus: 0x47,
} as const;

/** Page 71, octet 3 : état de la dernière commande reçue (spécification FE-C ; non recoupé dans le code libre). */
export const FEC_STATUS = { pass: 0, fail: 1, notSupported: 2, rejected: 3, pending: 4, none: 255 } as const;

export const FEC_STATUS_LABEL: Record<number, string> = {
  0: 'réussie',
  1: 'échouée',
  2: 'non supportée',
  3: 'refusée',
  4: 'en cours',
  255: 'aucune commande reçue',
};

/** Page 25, octet 6, demi-octet haut : ce que le trainer réclame (masques de GoldenCheetah, ANT.h). */
const TRAINER_STATUS_POWER_CALIBRATION = 0x10;
const TRAINER_STATUS_RESISTANCE_CALIBRATION = 0x20;
const TRAINER_STATUS_USER_CONFIG = 0x40;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));

/** Enveloppe une page de 8 octets dans un message ANT acquitté, somme de contrôle comprise. */
export function fecMessage(page: number[]): Uint8Array<ArrayBuffer> {
  if (page.length !== 8) throw new Error('une page FE-C fait 8 octets');
  const out = new Uint8Array(13);
  out.set([SYNC, 9, MSG_ACKNOWLEDGED, CHANNEL, ...page]);
  out[12] = out.subarray(0, 12).reduce((x, b) => x ^ b, 0);
  return out;
}

/** Page 49 : puissance cible (ERG), en 0,25 W. */
export function fecTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const v = clamp(watts * 4, 0, 4000 * 4);
  return fecMessage([FEC_PAGE.targetPower, 0xff, 0xff, 0xff, 0xff, 0xff, v & 0xff, v >> 8]);
}

/** Page 51 : pente en 0,01 % décalée de 200 %, et coefficient de roulement en 5×10⁻⁵. */
export function fecTrackResistance(gradePct: number, crr = 0.004): Uint8Array<ArrayBuffer> {
  const g = clamp((gradePct + 200) * 100, 0, 40000);
  return fecMessage([FEC_PAGE.trackResistance, 0xff, 0xff, 0xff, 0xff, g & 0xff, g >> 8, clamp(crr / 0.00005, 0, 254)]);
}

/** Page 50 : traînée en 0,01 kg/m, vent de face en km/h décalé de 127, facteur d'aspiration en %. */
export function fecWindResistance(cw = 0.51, windSpeedMs = 0, draftingFactor = 1): Uint8Array<ArrayBuffer> {
  return fecMessage([
    FEC_PAGE.windResistance,
    0xff,
    0xff,
    0xff,
    0xff,
    clamp(cw * 100, 0, 254),
    clamp(windSpeedMs * 3.6 + 127, 0, 254),
    clamp(draftingFactor * 100, 0, 100),
  ]);
}

/**
 * Page 55 : poids du cycliste (0,01 kg), du vélo (0,05 kg sur 12 bits) et diamètre de roue (0,01 m).
 * Le diamètre ne sert qu'aux trainers à roue (Vortex, FLUX…) pour la vitesse ; 0,7 m vaut une roue de 700×25.
 */
export function fecUserConfig(riderKg: number, bikeKg = 8, wheelDiameterM = 0.7): Uint8Array<ArrayBuffer> {
  const rider = clamp(riderKg * 100, 0, 0xfffe);
  const bike = clamp(bikeKg / 0.05, 0, 0x0ffe);
  return fecMessage([
    FEC_PAGE.userConfig,
    rider & 0xff,
    rider >> 8,
    0xff,
    (bike & 0x0f) << 4, // bits 0-3 : décalage du diamètre de roue en mm, laissé à 0
    bike >> 4,
    clamp(wheelDiameterM * 100, 0, 254),
    0x00, // rapport de transmission : non renseigné
  ]);
}

/**
 * Page 70 : demande au trainer d'émettre une page, ici une seule fois. Sert à obtenir l'état de commande (page 71)
 * après une consigne, comme le prévoit la norme pour confirmer une commande.
 */
export function fecRequestPage(page: number, times = 1): Uint8Array<ArrayBuffer> {
  return fecMessage([FEC_PAGE.requestData, 0xff, 0xff, 0xff, 0xff, clamp(times, 1, 0x7f), page, 0x01]);
}

export interface FecCommandStatus {
  /** Numéro de la page de la dernière commande reçue (0x31, 0x33…). */
  lastCommand: number;
  sequence: number;
  status: number;
}

/** Page 71 : dernière commande reçue par le trainer et son état. */
export function decodeFecCommandStatus(p: Uint8Array): FecCommandStatus | undefined {
  if (p[0] !== FEC_PAGE.commandStatus) return undefined;
  return { lastCommand: p[1]!, sequence: p[2]!, status: p[3]! };
}

export interface FecTrainerStatus {
  userConfigRequired: boolean;
  calibrationRequired: boolean;
}

/** Page 25 : ce que le trainer réclame avant de bien rendre les consignes. */
export function decodeFecTrainerStatus(p: Uint8Array): FecTrainerStatus | undefined {
  if (p[0] !== FEC_PAGE.trainerData) return undefined;
  const bits = p[6]! & 0xf0;
  return {
    userConfigRequired: !!(bits & TRAINER_STATUS_USER_CONFIG),
    calibrationRequired: !!(bits & (TRAINER_STATUS_POWER_CALIBRATION | TRAINER_STATUS_RESISTANCE_CALIBRATION)),
  };
}

/** Pages reconnues dans une notification : une notification peut contenir plusieurs messages ANT. */
export function fecPages(b: Uint8Array): Uint8Array[] {
  const pages: Uint8Array[] = [];
  let o = 0;
  while (o + 4 <= b.length) {
    if (b[o] !== SYNC) {
      o++;
      continue;
    }
    const len = b[o + 1]!;
    const end = o + 4 + len; // A4, longueur, identifiant, contenu (canal + page), somme
    if (end > b.length) break;
    const id = b[o + 2]!;
    const sum = b.subarray(o, end - 1).reduce((x, v) => x ^ v, 0);
    if (sum === b[end - 1] && (id === MSG_BROADCAST || id === MSG_ACKNOWLEDGED) && len === 9) {
      pages.push(b.slice(o + 4, o + 12));
    }
    o = end;
  }
  return pages;
}

/** Mesures portées par une page FE-C ; les pages inconnues ne donnent rien. */
export function decodeFecPage(p: Uint8Array): Partial<Measurement> {
  switch (p[0]) {
    case FEC_PAGE.generalFe: {
      const m: Partial<Measurement> = { speedKmh: ((p[4]! | (p[5]! << 8)) / 1000) * 3.6 };
      if (p[6] !== 0xff && p[6] !== 0) m.heartRateBpm = p[6];
      return m;
    }
    case FEC_PAGE.trainerData: {
      const m: Partial<Measurement> = {};
      if (p[2] !== 0xff) m.cadenceRpm = p[2];
      const power = p[5]! | ((p[6]! & 0x0f) << 8);
      if (power !== 0xfff) m.powerW = power;
      return m;
    }
    default:
      return {};
  }
}

/** Toutes les mesures d'une notification FE-C. */
export function decodeFec(b: Uint8Array): Partial<Measurement> {
  return fecPages(b).reduce<Partial<Measurement>>((m, p) => ({ ...m, ...decodeFecPage(p) }), {});
}
