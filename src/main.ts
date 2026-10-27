import { HeartRateMonitor } from './sensors/heart-rate-monitor';
import { SensorHub } from './sensors/hub';
import { SimulatedTrainer } from './sensors/simulator';
import { WebBluetoothTrainer, webBluetoothAvailable } from './sensors/web-bluetooth';
import type { ConnectionState, TrainerAdapter } from './sensors/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stateEl = $('state');
const stateHrEl = $('state-hr');
const connectHr = $<HTMLButtonElement>('connect-hr');
const disconnectHr = $<HTMLButtonElement>('disconnect-hr');
const logEl = $('log');
const connectBle = $<HTMLButtonElement>('connect-ble');
const connectSim = $<HTMLButtonElement>('connect-sim');
const disconnectBtn = $<HTMLButtonElement>('disconnect');
const ergBtn = $<HTMLButtonElement>('erg-send');
const simBtn = $<HTMLButtonElement>('sim-send');
const ergInput = $<HTMLInputElement>('erg');
const gradeInput = $<HTMLInputElement>('grade');

const hub = new SensorHub();
let trainer: TrainerAdapter | undefined;
let hrMonitor: HeartRateMonitor | undefined;
let frames = 0;

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const show = (id: string, v: number | undefined, digits = 0) => {
  $(id).textContent = v === undefined ? '–' : v.toFixed(digits);
};

function log(msg: string) {
  const ts = new Date().toLocaleTimeString('fr-FR');
  logEl.textContent += `${ts}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setState(s: ConnectionState, detail?: string) {
  stateEl.dataset.s = s;
  stateEl.textContent = `trainer : ${detail ? `${s} · ${detail}` : s}`;
  const connected = s === 'connected';
  const busy = s === 'connecting' || connected;
  connectBle.disabled = busy;
  connectSim.disabled = busy;
  disconnectBtn.disabled = !connected;
  ergBtn.disabled = !connected || !trainer?.capabilities.targetPower;
  simBtn.disabled = !connected || !trainer?.capabilities.simulation;
  if (connected && trainer) {
    const c = trainer.capabilities;
    const range = c.powerRange ? `, plage ${c.powerRange.min}–${c.powerRange.max} W` : '';
    $('caps').textContent = `ERG : ${c.targetPower ? 'oui' : 'non'} · SIM : ${c.simulation ? 'oui' : 'non'}${range}`;
  }
}

function attach(t: TrainerAdapter) {
  trainer = t;
  hub.attachTrainer(t);
  t.on('state', (s, d) => {
    setState(s, d);
    log(`trainer : ${s}${d ? ` (${d})` : ''}`);
  });
}

hub.on('log', log);
hub.on('raw', (src, data) => {
  // Les trames brutes servent à documenter chaque modèle de trainer ; on ne journalise pas tout le flux.
  if (src !== 'Indoor Bike Data' && src !== 'Heart Rate' && src !== 'Cycling Power') log(`${src} : ${hex(data)}`);
});
hub.on('measurement', (m) => {
  frames++;
  show('m-power', m.powerW);
  show('m-cadence', m.cadenceRpm);
  show('m-speed', m.speedKmh, 1);
  show('m-hr', m.heartRateBpm);
  show('m-distance', m.distanceM);
});

async function start(t: TrainerAdapter) {
  attach(t);
  try {
    await t.connect();
  } catch (e) {
    log(`échec de connexion : ${e instanceof Error ? e.message : e}`);
  }
}

async function send(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    log(`${label} envoyé`);
  } catch (e) {
    log(`${label} refusé : ${e instanceof Error ? e.message : e}`);
  }
}

connectHr.addEventListener('click', async () => {
  hrMonitor = new HeartRateMonitor();
  hub.attachHeartRate(hrMonitor);
  hrMonitor.on('state', (s, d) => {
    stateHrEl.dataset.s = s;
    stateHrEl.textContent = `cardio : ${d ? `${s} · ${d}` : s}`;
    connectHr.disabled = s === 'connecting' || s === 'connected';
    disconnectHr.disabled = s !== 'connected';
    log(`cardio : ${s}${d ? ` (${d})` : ''}`);
  });
  await hrMonitor.connect().catch((e) => log(`échec cardio : ${e instanceof Error ? e.message : e}`));
});
disconnectHr.addEventListener('click', () => void hrMonitor?.disconnect());
connectBle.addEventListener('click', () => void start(new WebBluetoothTrainer()));
connectSim.addEventListener('click', () => void start(new SimulatedTrainer()));
disconnectBtn.addEventListener('click', () => void trainer?.disconnect());
ergBtn.addEventListener('click', () => {
  const w = Number(ergInput.value);
  void send(`ERG ${w} W`, () => hub.setTargetPower(w));
});
simBtn.addEventListener('click', () => {
  const g = Number(gradeInput.value);
  void send(`SIM ${g} %`, () => hub.setSimulation({ gradePct: g }));
});
gradeInput.addEventListener('input', () => {
  $('grade-out').textContent = `${gradeInput.value} %`;
});
$('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(logEl.textContent ?? ''));

setInterval(() => {
  show('m-rate', frames);
  frames = 0;
}, 1000);

if (webBluetoothAvailable()) {
  $('support').textContent = 'Web Bluetooth disponible.';
} else {
  connectBle.disabled = true;
  connectHr.disabled = true;
  $('support').textContent =
    'Web Bluetooth indisponible ici (Chrome ou Edge, en HTTPS ou sur localhost). Le trainer simulé reste utilisable.';
}
