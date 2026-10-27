export const SERVICE = {
  fitnessMachine: 0x1826,
  cyclingPower: 0x1818,
  heartRate: 0x180d,
  cyclingSpeedCadence: 0x1816,
} as const;

export const CHAR = {
  ftmsFeature: 0x2acc,
  indoorBikeData: 0x2ad2,
  controlPoint: 0x2ad9,
  machineStatus: 0x2ada,
  supportedPowerRange: 0x2ad8,
  cyclingPowerMeasurement: 0x2a63,
  heartRateMeasurement: 0x2a37,
} as const;
