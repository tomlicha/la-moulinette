import { encodeActivity, fitFileName } from './fit-activity';
import { RideRecorder } from './recorder';
import type { SensorHub } from '../sensors/hub';
import type { ConnectionState } from '../sensors/types';
import type { RideSnapshot } from '../sim/ride';

export interface ExportWiring {
  /** À appeler à chaque snapshot de la sortie virtuelle. */
  onRide(s: RideSnapshot): void;
  /** À appeler à chaque changement d'état du trainer : l'enregistrement se met en pause hors connexion. */
  onTrainerState(s: ConnectionState): void;
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Enregistre la sortie en continu et branche le bouton d'export FIT. */
export function setupExport(opts: {
  hub: SensorHub;
  button: HTMLButtonElement;
  log: (msg: string) => void;
}): ExportWiring {
  const { hub, button, log } = opts;
  const recorder = new RideRecorder();

  hub.on('measurement', (m) => {
    recorder.update({ powerW: m.powerW, cadenceRpm: m.cadenceRpm, heartRateBpm: m.heartRateBpm }, Date.now());
  });

  setInterval(() => {
    recorder.tick(Date.now());
    const n = recorder.sampleCount;
    button.disabled = n === 0;
    button.textContent = n ? `Exporter FIT (${n} s${recorder.state === 'paused' ? ', en pause' : ''})` : 'Exporter FIT';
  }, 1000);

  button.addEventListener('click', () => {
    const rec = recorder.finish(Date.now());
    if (!rec) {
      log('export FIT : rien à exporter');
      return;
    }
    const bytes = encodeActivity(rec);
    download(fitFileName(rec.startMs), bytes);
    log(`export FIT : ${rec.samples.length} échantillons, ${Math.round(bytes.length / 1024)} Ko`);
  });

  return {
    onRide: (s) =>
      recorder.update({ speedMs: s.speedKmh / 3.6, distanceM: s.distanceM, altitudeM: s.altitudeM }, Date.now()),
    onTrainerState: (s) => (s === 'connected' ? recorder.resume(Date.now()) : recorder.pause(Date.now())),
  };
}
