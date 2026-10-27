/** Mesure normalisée, quel que soit le transport ou le profil BLE d'origine. */
export interface Measurement {
  /** Horodatage local en ms (performance.now ou Date.now selon l'appelant). */
  t: number;
  powerW?: number;
  /** Tours de pédale par minute. */
  cadenceRpm?: number;
  speedKmh?: number;
  distanceM?: number;
  heartRateBpm?: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TrainerCapabilities {
  /** Mode ERG : puissance cible. */
  targetPower: boolean;
  /** Mode SIM : pente simulée. */
  simulation: boolean;
  powerRange?: { min: number; max: number; step: number };
}

export interface SimulationParams {
  /** Pente en pourcent (ex. 4.5 pour 4,5 %). */
  gradePct: number;
  windSpeedMs?: number;
  /** Coefficient de roulement. */
  crr?: number;
  /** Coefficient de traînée (kg/m). */
  cw?: number;
  /** Masse cycliste + vélo en kg, pour les protocoles qui la portent (Wahoo). */
  massKg?: number;
}

export interface SensorEvents {
  measurement: (m: Measurement) => void;
  state: (s: ConnectionState, detail?: string) => void;
  /** Trames brutes, utiles pour la matrice de compatibilité matérielle. */
  raw: (source: string, data: Uint8Array) => void;
  log: (msg: string) => void;
}

/** Interface commune des transports : Web Bluetooth, simulateur, plus tard natif et relais. */
export interface TrainerAdapter {
  readonly name: string;
  readonly capabilities: TrainerCapabilities;
  on<K extends keyof SensorEvents>(ev: K, fn: SensorEvents[K]): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setTargetPower(watts: number): Promise<void>;
  setSimulation(p: SimulationParams): Promise<void>;
}
