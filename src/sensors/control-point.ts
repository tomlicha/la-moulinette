import type { SimulationParams } from './types';

export const OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetPower: 0x05,
  start: 0x07,
  stop: 0x08,
  setSimulation: 0x11,
  response: 0x80,
} as const;

export const RESULT_LABEL: Record<number, string> = {
  1: 'succès',
  2: 'commande non supportée',
  3: 'paramètre invalide',
  4: 'échec',
  5: 'contrôle non accordé',
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function encodeRequestControl(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OP.requestControl);
}

export function encodeStart(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OP.start);
}

export function encodeTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(3);
  out[0] = OP.setTargetPower;
  new DataView(out.buffer).setInt16(1, clamp(Math.round(watts), 0, 4000), true);
  return out;
}

/** Valeurs par défaut de la spécification : Crr 0,004 et Cw 0,51 kg/m, sans vent. */
export function encodeSimulation(p: SimulationParams): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(7);
  const dv = new DataView(out.buffer);
  out[0] = OP.setSimulation;
  dv.setInt16(1, clamp(Math.round((p.windSpeedMs ?? 0) * 1000), -32768, 32767), true);
  dv.setInt16(3, clamp(Math.round(p.gradePct * 100), -10000, 10000), true);
  dv.setUint8(5, clamp(Math.round((p.crr ?? 0.004) * 10000), 0, 255));
  dv.setUint8(6, clamp(Math.round((p.cw ?? 0.51) * 100), 0, 255));
  return out;
}

export interface ControlResponse {
  requestOp: number;
  result: number;
  ok: boolean;
}

/** Réponse du Control Point : 0x80, opcode de la requête, code de résultat. */
export function decodeResponse(b: Uint8Array): ControlResponse | null {
  if (b.length < 3 || b[0] !== OP.response) return null;
  return { requestOp: b[1]!, result: b[2]!, ok: b[2] === 1 };
}
