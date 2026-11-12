export const SERVICE = {
  fitnessMachine: 0x1826,
  cyclingPower: 0x1818,
  heartRate: 0x180d,
  cyclingSpeedCadence: 0x1816,
  deviceInformation: 0x180a,
} as const;

export const CHAR = {
  ftmsFeature: 0x2acc,
  indoorBikeData: 0x2ad2,
  controlPoint: 0x2ad9,
  machineStatus: 0x2ada,
  supportedPowerRange: 0x2ad8,
  cyclingPowerMeasurement: 0x2a63,
  heartRateMeasurement: 0x2a37,
  // Device Information : le numéro de série (0x2A25) est bloqué par Chrome, on ne le lit pas.
  manufacturerName: 0x2a29,
  modelNumber: 0x2a24,
  hardwareRevision: 0x2a27,
  firmwareRevision: 0x2a26,
  softwareRevision: 0x2a28,
} as const;
