import { HeartRateMonitor } from './sensors/heart-rate-monitor';
import { SensorHub } from './sensors/hub';
import { SimulatedTrainer } from './sensors/simulator';
import { WebBluetoothTrainer, webBluetoothAvailable } from './sensors/web-bluetooth';
import { RideView } from './render/ride-view';
import { GradeThrottle } from './sim/grade-throttle';
import { DEFAULT_RIDER } from './sim/physics';
import { Ride } from './sim/ride';
import { setupExport } from './export/wiring';
import { DEMO_ROUTE } from './sim/route';
import type { ConnectionState, TrainerAdapter } from './sensors/types';
import { ErgFollower } from './workout/erg-follower';
import { STEP_LABEL, type Workout } from './workout/model';
import { profileShapes } from './workout/profile';
import { parseWorkout, WorkoutRunner, type WorkoutState } from './workout/runner';
import demoWorkout from '../samples/workouts/decouverte.zwo?raw';

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

/** Au-delà de ce délai sans mesure de puissance, le cycliste est considéré à l'arrêt dans la simulation. */
const POWER_STALE_MS = 3000;
const rideBtn = $<HTMLButtonElement>('ride-toggle');
const massInput = $<HTMLInputElement>('mass');
const throttle = new GradeThrottle();
/** ERG engagé : la consigne de puissance prime, et l'envoi de la pente du parcours est suspendu pour ne pas la remplacer. */
let ergActive = false;
let ride: Ride | undefined;
let rideTimer: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;
let lastPower = { w: 0, at: 0 };
let lastCadence = { rpm: 0, at: 0 };
let lastMeasurementAt = 0;
let view: RideView | undefined;
let currentState: ConnectionState = 'disconnected';

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
  currentState = s;
  exporter.onTrainerState(s);
  stateEl.dataset.s = s;
  stateEl.textContent = `trainer : ${detail ? `${s} · ${detail}` : s}`;
  const connected = s === 'connected';
  const busy = s === 'connecting' || connected;
  connectBle.disabled = busy;
  connectSim.disabled = busy;
  disconnectBtn.disabled = !connected;
  ergBtn.disabled = !connected || !trainer?.capabilities.targetPower;
  simBtn.disabled = !connected || !!ride || !trainer?.capabilities.simulation;
  rideBtn.disabled = !connected; // la puissance seule suffit : la pente n'est envoyée que si le trainer sait la simuler
  refreshWorkoutButtons();
  if (s === 'disconnected') {
    stopRide(false);
    setErgActive(false);
  }
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
  lastMeasurementAt = performance.now();
  if (m.powerW !== undefined) lastPower = { w: m.powerW, at: performance.now() };
  if (m.cadenceRpm !== undefined) lastCadence = { rpm: m.cadenceRpm, at: performance.now() };
  show('m-power', m.powerW);
  show('m-cadence', m.cadenceRpm);
  show('m-speed', m.speedKmh, 1);
  show('m-hr', m.heartRateBpm);
  show('m-distance', m.distanceM);
});

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function tickRide() {
  if (!ride) return;
  const now = performance.now();
  const power = now - lastPower.at > POWER_STALE_MS ? 0 : lastPower.w;
  const s = ride.advance((now - lastTick) / 1000, power);
  exporter.onRide(s);
  lastTick = now;
  view?.setState({
    distanceM: s.distanceM,
    speedKmh: s.speedKmh,
    cadenceRpm: now - lastCadence.at > POWER_STALE_MS ? 0 : lastCadence.rpm,
  });
  show('r-speed', s.speedKmh, 1);
  show('r-dist', s.distanceM / 1000, 2);
  show('r-grade', s.gradePct, 1);
  show('r-alt', s.altitudeM);
  $('r-time').textContent = fmtTime(s.elapsedS);

  if (currentState === 'connected' && trainer?.capabilities.simulation && !ergActive && throttle.shouldSend(s.gradePct, now)) {
    throttle.markSent(s.gradePct, now);
    hub.setSimulation({ gradePct: s.gradePct, massKg: ride.rider.massKg }).catch((e) => {
      log(`pente non envoyée : ${e instanceof Error ? e.message : e}`);
      setTimeout(() => throttle.reset(), 2000); // nouvel essai, sans marteler le trainer
    });
  }
}

function setErgActive(on: boolean) {
  ergActive = on;
  ergBtn.textContent = on ? "Désengager l'ERG" : "Engager l'ERG";
  ergBtn.classList.toggle('secondary', on);
  if (!on) throttle.reset(); // en sortie, la prochaine mise à jour renvoie la pente du parcours
}

function startRide() {
  const massKg = Number(massInput.value) || DEFAULT_RIDER.massKg;
  ride = new Ride(DEMO_ROUTE, { ...DEFAULT_RIDER, massKg });
  throttle.reset();
  lastTick = performance.now();
  rideTimer = setInterval(tickRide, 100);
  rideBtn.textContent = 'Arrêter la sortie';
  massInput.disabled = true;
  setState(currentState, trainer?.name);
  log(`sortie virtuelle démarrée (${massKg} kg)`);
}

function stopRide(resetTrainer = true) {
  if (!ride) return;
  clearInterval(rideTimer);
  setErgActive(false);
  view?.setState({ distanceM: ride.snapshot().distanceM, speedKmh: 0, cadenceRpm: 0 });
  ride = undefined;
  rideBtn.textContent = 'Démarrer la sortie';
  massInput.disabled = false;
  log('sortie virtuelle arrêtée');
  if (resetTrainer && currentState === 'connected') void hub.setSimulation({ gradePct: 0 }).catch(() => {});
  setState(currentState, trainer?.name);
}

rideBtn.addEventListener('click', () => (ride ? stopRide() : startRide()));

async function start(t: TrainerAdapter) {
  attach(t);
  try {
    await t.connect();
  } catch (e) {
    log(`échec de connexion : ${e instanceof Error ? e.message : e}`);
  }
}

async function send(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    log(`${label} envoyé`);
    return true;
  } catch (e) {
    log(`${label} refusé : ${e instanceof Error ? e.message : e}`);
    return false;
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
ergBtn.addEventListener('click', async () => {
  if (ergActive) {
    setErgActive(false);
    if (runner) {
      woErgOptOut = true;
      log('ERG désengagé : la séance continue sans imposer de consigne');
    }
    if (ride) {
      log("ERG désengagé : pente du parcours reprise");
    } else {
      // Hors sortie, le trainer ne quitte l'ERG qu'avec une consigne de pente.
      const g = Number(gradeInput.value);
      await send(`ERG désengagé, SIM ${g} %`, () => hub.setSimulation({ gradePct: g }));
    }
    return;
  }
  // Pendant une séance, réengager rend la main à la séance, qui renvoie aussitôt sa consigne du moment.
  if (runner) {
    woErgOptOut = false;
    follower.reset();
    log('ERG réengagé : la séance reprend sa consigne');
    return tickWorkout();
  }
  const w = Number(ergInput.value);
  if (await send(`ERG ${w} W`, () => hub.setTargetPower(w))) setErgActive(true);
});
// Changer la cible pendant que l'ERG est engagé l'applique aussitôt.
ergInput.addEventListener('change', () => {
  if (!ergActive || runner) return; // en séance, c'est la séance qui fixe la consigne
  const w = Number(ergInput.value);
  void send(`ERG ${w} W`, () => hub.setTargetPower(w));
});
simBtn.addEventListener('click', async () => {
  const g = Number(gradeInput.value);
  if (await send(`SIM ${g} %`, () => hub.setSimulation({ gradePct: g }))) setErgActive(false); // le SIM remplace l'ERG
});
gradeInput.addEventListener('input', () => {
  $('grade-out').textContent = `${gradeInput.value} %`;
});
// --- Séance structurée ---

const woFile = $<HTMLInputElement>('wo-file');
const woFtp = $<HTMLInputElement>('wo-ftp');
const woStart = $<HTMLButtonElement>('wo-start');
const woPause = $<HTMLButtonElement>('wo-pause');
const woSkip = $<HTMLButtonElement>('wo-skip');
const woStop = $<HTMLButtonElement>('wo-stop');
const woEasier = $<HTMLButtonElement>('wo-easier');
const woHarder = $<HTMLButtonElement>('wo-harder');
const woShapes = $('wo-shapes');
const PROFILE_W = 1000;
const PROFILE_H = 120;
/** Écart toléré entre puissance mesurée et consigne avant de l'afficher comme hors cible. */
const ON_TARGET_W = 10;
const FTP_KEY = 'zwift2.ftp';

const follower = new ErgFollower();
let workout: Workout | undefined;
let runner: WorkoutRunner | undefined;
let woTimer: ReturnType<typeof setInterval> | undefined;
let woPaused = false;
let woLastTick = 0;
/** L'ERG a été désengagé à la main pendant la séance : elle continue sans imposer de consigne jusqu'au réengagement. */
let woErgOptOut = false;
let woSending = false;
/** Après un envoi raté, on attend avant de réessayer pour ne pas marteler le trainer. */
let woHoldUntil = 0;

try {
  const saved = Number(localStorage.getItem(FTP_KEY));
  if (saved >= 50) woFtp.value = String(saved);
} catch {
  // stockage indisponible (navigation privée) : on garde la valeur par défaut
}
const readFtp = () => (Number(woFtp.value) >= 50 ? Number(woFtp.value) : 200);

function refreshWorkoutButtons() {
  const canErg = currentState === 'connected' && !!trainer?.capabilities.targetPower;
  woStart.disabled = !workout || !!runner || !canErg;
  for (const b of [woPause, woSkip, woStop, woEasier, woHarder]) b.disabled = !runner;
  woPause.textContent = woPaused ? 'Reprendre' : 'Pause';
}

function renderProfile() {
  woShapes.replaceChildren();
  if (!workout) return;
  for (const s of profileShapes(workout, readFtp(), PROFILE_W, PROFILE_H)) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', s.d);
    path.setAttribute('class', s.zone);
    woShapes.append(path);
  }
}

function loadWorkout(fileName: string, text: string) {
  if (runner) return log("séance en cours : l'arrêter avant d'en charger une autre");
  try {
    workout = parseWorkout(fileName, text);
  } catch (e) {
    log(`séance illisible (${fileName}) : ${e instanceof Error ? e.message : e}`);
    return;
  }
  for (const w of workout.warnings) log(`séance : ${w}`);
  const total = workout.steps.reduce((t, s) => t + s.durationS, 0);
  $('wo-name').textContent = `${workout.name} · ${fmtTime(total)}${workout.description ? ` · ${workout.description}` : ''}`;
  renderProfile();
  renderWorkout(undefined);
  refreshWorkoutButtons();
  log(`séance chargée : ${workout.name} (${workout.steps.length} paliers, ${fmtTime(total)})`);
}

function renderWorkout(s: WorkoutState | undefined) {
  const cursor = $('wo-cursor');
  const x = s ? (s.elapsedS / (s.totalS || 1)) * PROFILE_W : 0;
  cursor.setAttribute('x1', String(x));
  cursor.setAttribute('x2', String(x));
  woShapes.querySelectorAll('path').forEach((p, i) => p.classList.toggle('past', !!s && i < s.stepIndex));

  const delta = $('wo-delta');
  delta.className = '';
  const msg = $('wo-message');
  if (!s) {
    for (const id of ['wo-target', 'wo-step-left', 'wo-left']) $(id).textContent = '–';
    delta.textContent = '–';
    $('wo-step-label').textContent = 'palier';
    $('wo-next').textContent = '';
    msg.hidden = true;
    return;
  }
  $('wo-target').textContent = s.targetW === undefined ? 'libre' : String(s.targetW);
  const powerFresh = performance.now() - lastPower.at <= POWER_STALE_MS;
  if (s.targetW !== undefined && powerFresh) {
    const d = Math.round(lastPower.w - s.targetW);
    delta.textContent = `${d > 0 ? '+' : ''}${d} W`;
    delta.className = Math.abs(d) <= ON_TARGET_W ? 'ok' : 'off';
  } else {
    delta.textContent = '–';
  }
  $('wo-step-left').textContent = fmtTime(s.stepRemainingS);
  $('wo-step-label').textContent = `${STEP_LABEL[s.step.kind]}${s.step.cadenceRpm ? ` · ${s.step.cadenceRpm} rpm` : ''}`;
  $('wo-left').textContent = fmtTime(s.totalS - s.elapsedS);
  $('wo-next').textContent = s.next
    ? `Ensuite : ${STEP_LABEL[s.next.kind]}, ${s.nextTargetW === undefined ? 'libre' : `${s.nextTargetW} W`}, ${fmtTime(s.next.durationS)}`
    : 'Dernier palier';
  msg.hidden = !s.message;
  msg.textContent = s.message ?? '';
}

/** Relâche l'ERG pris par la séance : hors sortie virtuelle, le trainer ne le quitte qu'avec une consigne de pente. */
function releaseErg(reason: string) {
  if (!ergActive) return;
  setErgActive(false);
  if (ride || currentState !== 'connected') return log(reason);
  const g = Number(gradeInput.value);
  void send(`${reason}, SIM ${g} %`, () => hub.setSimulation({ gradePct: g }));
}

function tickWorkout() {
  if (!runner) return;
  const now = performance.now();
  const dt = (now - woLastTick) / 1000;
  woLastTick = now;
  // Sans trainer connecté, le temps de séance s'arrête : on ne compte pas un palier que personne ne pédale.
  const running = !woPaused && currentState === 'connected';
  const s = running ? runner.advance(dt) : runner.state();
  renderWorkout(s);
  if (s.done) return finishWorkout('séance terminée');
  if (!running || woErgOptOut || woSending || now < woHoldUntil) return;

  if (s.targetW === undefined) {
    follower.reset();
    return releaseErg(`palier ${STEP_LABEL[s.step.kind].toLowerCase()} : ERG relâché`);
  }
  if (!ergActive) follower.reset(); // ERG relâché ailleurs (fin de sortie, reconnexion) : on le reprend aussitôt
  const w = follower.next(s, now);
  if (w === undefined) return;
  woSending = true;
  hub
    .setTargetPower(w)
    .then(() => {
      if (!ergActive) {
        setErgActive(true);
        log(`séance : ERG engagé à ${w} W`);
      }
    })
    .catch((e) => {
      log(`séance : consigne ${w} W non envoyée (${e instanceof Error ? e.message : e})`);
      follower.reset();
      woHoldUntil = performance.now() + 2000;
    })
    .finally(() => (woSending = false));
}

function startWorkout() {
  if (!workout) return;
  runner = new WorkoutRunner(workout, readFtp());
  woPaused = false;
  woErgOptOut = false;
  woHoldUntil = 0;
  follower.reset();
  woLastTick = performance.now();
  woTimer = setInterval(tickWorkout, 250);
  $('wo-intensity').textContent = '100 %';
  refreshWorkoutButtons();
  log(`séance démarrée : ${workout.name}, FTP ${runner.ftpW} W`);
  tickWorkout();
}

function finishWorkout(reason: string) {
  if (!runner) return;
  clearInterval(woTimer);
  runner = undefined;
  woPaused = false;
  woErgOptOut = false;
  if (ergActive) releaseErg(reason);
  else log(reason);
  renderWorkout(undefined);
  refreshWorkoutButtons();
}

woFile.addEventListener('change', async () => {
  const f = woFile.files?.[0];
  if (f) loadWorkout(f.name, await f.text());
  woFile.value = ''; // recharger le même fichier redéclenche l'évènement
});
$('wo-demo').addEventListener('click', () => loadWorkout('decouverte.zwo', demoWorkout));
woFtp.addEventListener('change', () => {
  try {
    localStorage.setItem(FTP_KEY, String(readFtp()));
  } catch {
    // préférence non mémorisée, sans conséquence
  }
  if (runner) runner.ftpW = readFtp();
  renderProfile();
});
woStart.addEventListener('click', startWorkout);
woPause.addEventListener('click', () => {
  woPaused = !woPaused;
  follower.reset();
  log(woPaused ? 'séance en pause' : 'séance reprise');
  refreshWorkoutButtons();
});
woSkip.addEventListener('click', () => {
  if (!runner) return;
  const s = runner.skip();
  follower.reset();
  log(`séance : palier suivant (${STEP_LABEL[s.step.kind]})`);
  tickWorkout();
});
woStop.addEventListener('click', () => finishWorkout('séance arrêtée'));
for (const [btn, delta] of [
  [woEasier, -0.05],
  [woHarder, 0.05],
] as const) {
  btn.addEventListener('click', () => {
    if (!runner) return;
    runner.intensity = Math.min(1.5, Math.max(0.5, Math.round((runner.intensity + delta) * 100) / 100));
    $('wo-intensity').textContent = `${Math.round(runner.intensity * 100)} %`;
    follower.reset();
  });
}

$('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(logEl.textContent ?? ''));

const exporter = setupExport({
  hub,
  button: $<HTMLButtonElement>('export-fit'),
  stravaButton: $<HTMLButtonElement>('export-strava'),
  intervalsButton: $<HTMLButtonElement>('export-intervals'),
  log,
});

setInterval(() => {
  show('m-rate', frames);
  frames = 0;
  // Capteur muet : mieux vaut un tiret que la dernière valeur affichée comme si elle était actuelle.
  if (lastMeasurementAt && performance.now() - lastMeasurementAt > POWER_STALE_MS) {
    for (const id of ['m-power', 'm-cadence', 'm-speed', 'm-hr']) show(id, undefined);
  }
}, 1000);

if (webBluetoothAvailable()) {
  $('support').textContent = 'Web Bluetooth disponible.';
} else {
  connectBle.disabled = true;
  connectHr.disabled = true;
  $('support').textContent =
    'Web Bluetooth indisponible ici (Chrome ou Edge, en HTTPS ou sur localhost). Le trainer simulé reste utilisable.';
}

const params = new URLSearchParams(location.search);
RideView.create($<HTMLCanvasElement>('view'), DEMO_ROUTE, {
  forceWebGL: params.get('renderer') === 'webgl2',
  quality: params.get('quality') === 'low' ? 'low' : 'high',
})
  .then((v) => {
    view = v;
    v.onStats = (s) => {
      $('view-stats').textContent =
        `${s.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${s.fps.toFixed(0)} i/s · ` +
        `p50 ${s.frameP50Ms.toFixed(1)} ms · p95 ${s.frameP95Ms.toFixed(1)} ms · ` +
        `${(s.triangles / 1000).toFixed(0)} k triangles · ${s.drawCalls} appels`;
    };
    log(`rendu 3D : ${v.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}`);
  })
  .catch((e) => {
    $('view-stats').textContent = 'rendu 3D indisponible';
    log(`rendu 3D indisponible : ${e instanceof Error ? e.message : e}`);
  });
