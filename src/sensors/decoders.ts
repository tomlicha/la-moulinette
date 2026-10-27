import type { Measurement, TrainerCapabilities } from './types';

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Lecteur séquentiel little-endian ; lève une RangeError si la trame est tronquée. */
class Reader {
  private o = 0;
  private readonly v: DataView;
  constructor(b: Uint8Array) {
    this.v = view(b);
  }
  u8() { const x = this.v.getUint8(this.o); this.o += 1; return x; }
  u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  s16() { const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
  u24() { const x = this.v.getUint16(this.o, true) | (this.v.getUint8(this.o + 2) << 16); this.o += 3; return x; }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  skip(n: number) { this.o += n; this.v.getUint8(this.o - 1); }
}

/** FTMS Indoor Bike Data (0x2AD2). Le bit 0 est inversé : 0 = vitesse présente. */
export function decodeIndoorBikeData(b: Uint8Array, t: number): Measurement {
  const r = new Reader(b);
  const flags = r.u16();
  const m: Measurement = { t };
  if (!(flags & 0x0001)) m.speedKmh = r.u16() / 100;
  if (flags & 0x0002) r.skip(2); // vitesse moyenne
  if (flags & 0x0004) m.cadenceRpm = r.u16() / 2;
  if (flags & 0x0008) r.skip(2); // cadence moyenne
  if (flags & 0x0010) m.distanceM = r.u24();
  if (flags & 0x0020) r.skip(2); // niveau de résistance
  if (flags & 0x0040) m.powerW = r.s16();
  if (flags & 0x0080) r.skip(2); // puissance moyenne
  if (flags & 0x0100) r.skip(5); // énergie : total, par heure, par minute
  if (flags & 0x0200) m.heartRateBpm = r.u8() || undefined;
  return m;
}

/** Cycling Power Measurement (0x2A63) : puissance, et cadence si les données de manivelle sont présentes. */
export interface CyclingPowerFrame {
  powerW: number;
  crank?: { revs: number; time1024: number };
}

export function decodeCyclingPower(b: Uint8Array): CyclingPowerFrame {
  const r = new Reader(b);
  const flags = r.u16();
  const frame: CyclingPowerFrame = { powerW: r.s16() };
  if (flags & 0x0001) r.skip(1); // équilibre pédales
  if (flags & 0x0004) r.skip(2); // couple cumulé
  if (flags & 0x0010) r.skip(6); // roue : tours (u32) + temps (u16)
  if (flags & 0x0020) frame.crank = { revs: r.u16(), time1024: r.u16() };
  return frame;
}

/** Cadence à partir de deux trames successives de manivelle (compteurs 16 bits, temps en 1/1024 s). */
export function cadenceFromCrank(
  prev: NonNullable<CyclingPowerFrame['crank']>,
  cur: NonNullable<CyclingPowerFrame['crank']>,
): number | undefined {
  const dRevs = (cur.revs - prev.revs + 0x10000) & 0xffff;
  const dTime = (cur.time1024 - prev.time1024 + 0x10000) & 0xffff;
  if (dTime === 0) return undefined; // pas de nouvel évènement : l'appelant garde la valeur précédente
  return (dRevs / (dTime / 1024)) * 60;
}

/** Heart Rate Measurement (0x2A37). */
export function decodeHeartRate(b: Uint8Array): number {
  const r = new Reader(b);
  const flags = r.u8();
  return flags & 0x01 ? r.u16() : r.u8();
}

/** FTMS Fitness Machine Feature (0x2ACC) : deux champs 32 bits, machine puis cibles. */
export function decodeFtmsFeature(b: Uint8Array): Pick<TrainerCapabilities, 'targetPower' | 'simulation'> {
  const r = new Reader(b);
  r.u32();
  const target = r.u32();
  return {
    targetPower: !!(target & (1 << 3)),
    simulation: !!(target & (1 << 13)),
  };
}

export function decodePowerRange(b: Uint8Array): { min: number; max: number; step: number } {
  const r = new Reader(b);
  return { min: r.s16(), max: r.s16(), step: r.u16() };
}
