import { GattDevice } from './gatt-device';
import { CHAR, SERVICE } from './uuids';
import { decodeHeartRate } from './decoders';

/** Ceinture ou montre cardio autonome (Heart Rate Service 0x180D), avec reconnexion automatique. */
export class HeartRateMonitor extends GattDevice {
  name = 'Cardio';
  protected readonly fallbackName = 'Cardio';

  protected requestOptions(nameHint?: string): RequestDeviceOptions {
    return {
      filters: nameHint ? [{ name: nameHint }] : [{ services: [SERVICE.heartRate] }],
      optionalServices: [SERVICE.heartRate],
    };
  }

  protected async setup() {
    const server = await this.gatt().connect();
    const svc = await server.getPrimaryService(SERVICE.heartRate);
    const c = await svc.getCharacteristic(CHAR.heartRateMeasurement);
    await this.subscribe(c, 'Heart Rate', (b) =>
      this.emit('measurement', { t: performance.now(), heartRateBpm: decodeHeartRate(b) }),
    );
  }
}
