import type { SimulationParams } from './types';

/**
 * Protocole propriétaire Wahoo (KICKR sans FTMS). Encodage relevé dans GoldenCheetah (BT40Device.cpp) :
 * opcode + entiers 16 bits little-endian.
 *
 * Recoupé le 11 novembre 2026 avec GoldenCheetah (BT40Device.cpp) et qdomyos-zwift (wahookickrsnapbike.cpp) : mêmes
 * opcodes et mêmes échelles, sauf le Crr du mode simulation (× 10 000 chez GoldenCheetah, retenu ici et validé au
 * ressenti sur le KICKR ; × 1 000 chez qdomyos-zwift). Le trainer accuse réception par une indication
 * `01 <opcode> <statut> …` ; seul 01 est documenté (succès, dans un commentaire de qdomyos-zwift).
 */
export const WAHOO_SERVICE = 'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b';
export const WAHOO_CONTROL_CHAR = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

export const WAHOO_OP = {
  unlock: 0x20,
  setErg: 0x42,
  setSimMode: 0x43,
  setSimGrade: 0x46,
} as const;

const clamp16 = (x: number) => Math.min(0xffff, Math.max(0, Math.round(x)));

function frame(op: number, ...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + values.length * 2);
  const dv = new DataView(out.buffer);
  out[0] = op;
  values.forEach((v, i) => dv.setUint16(1 + i * 2, clamp16(v), true));
  return out;
}

/**
 * Déverrouillage (0x20 puis le code EE FC) attendu par les anciens firmwares avant toute consigne ; les KICKR récents
 * n'en ont pas besoin et l'acceptent. Séquence reprise des clients libres (qdomyos-zwift), non documentée par Wahoo.
 */
export const WAHOO_RESPONSE = 0x01;
export const WAHOO_STATUS_OK = 0x01;

/** Indication du Control Point : opcode acquitté et statut ; `undefined` pour toute autre trame. */
export function decodeWahooResponse(b: Uint8Array): { op: number; status: number } | undefined {
  if (b.length < 3 || b[0] !== WAHOO_RESPONSE) return undefined;
  return { op: b[1]!, status: b[2]! };
}

export const wahooUnlock =() => Uint8Array.of(WAHOO_OP.unlock, 0xee, 0xfc);

export const wahooTargetPower =(watts: number) => frame(WAHOO_OP.setErg, watts);

/** Poids total (cycliste + vélo) en kg, Crr, coefficient de traînée Cw en kg/m. */
export const wahooSimMode = (weightKg: number, crr: number, cw: number) =>
  frame(WAHOO_OP.setSimMode, weightKg * 100, crr * 10000, cw * 1000);

/** 0 % vaut 32768 ; la plage utile va d'environ -100 % à +100 %. */
export const wahooGrade = (gradePct: number) => frame(WAHOO_OP.setSimGrade, (gradePct / 100 + 1) * 32768);

/** Séquence complète pour une simulation : paramètres physiques puis pente. */
export function wahooSimulation(p: SimulationParams): Uint8Array<ArrayBuffer>[] {
  return [wahooSimMode(p.massKg ?? 80, p.crr ?? 0.004, p.cw ?? 0.51), wahooGrade(p.gradePct)];
}
