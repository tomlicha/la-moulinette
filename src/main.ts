import { HeartRateMonitor } from './sensors/heart-rate-monitor';
import { SensorHub } from './sensors/hub';
import { SimulatedTrainer } from './sensors/simulator';
import { WebBluetoothTrainer, webBluetoothAvailable } from './sensors/web-bluetooth';
import { RideView } from './render/ride-view';
import { GradeThrottle } from './sim/grade-throttle';
import { DEFAULT_RIDER } from './sim/physics';
import { Ride } from './sim/ride';
import { setupExport } from './export/wiring';
import { setupTelemetry } from './telemetry/wiring';
import { DEMO_ROUTE } from './sim/route';
import type { ConnectionState, TrainerAdapter } from './sensors/types';
import { ErgFollower } from './workout/erg-follower';
import { STEP_LABEL, type Workout } from './workout/model';
import { profileShapes } from './workout/profile';
import { parseWorkout, WorkoutRunner, type WorkoutState } from './workout/runner';
import { browserStore, canRecallDevices, DeviceRegistry, recallDevices, type DeviceRole } from './sensors/device-registry';
import { ALL_PROTOCOLS, PROTOCOL_LABEL, type ControlProtocol } from './sensors/trainer-profiles';
import { formatDuration } from './ui/duration';
import { setBlocked, setupBlockedHints, type BlockReason } from './ui/blocked';
import { setupRouter } from './ui/router';
import { setupWorkoutEditor } from './ui/workout-editor';
import { RideHud } from './ui/hud';
import { createRadar } from './ui/radar';
import { setupHomeBackground } from './ui/home-background';
import { controlModes } from './ui/radar-model';
import { ClimbCounter, PowerAverage } from './ui/hud-model';
import type { RideSnapshot } from './sim/ride';
import { blocksToWorkout } from './workout/blocks';
import { WorkoutLibrary } from './workout/library';
import { SAMPLE_WORKOUTS } from './workout/samples';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
setupBlockedHints();

/** Raison « pas de trainer », avec le raccourci qui mène à l'écran des appareils. */
const needTrainer = (text: string): BlockReason => ({
  text,
  action: { label: 'Connecter le trainer', run: () => router.go('appareils') },
});
const noControl = (what: string): BlockReason => ({
  text: `${trainer?.name ?? 'Cet appareil'} mesure ta puissance mais ne pilote pas la résistance (pas de ${what}). Il faut un home trainer connecté pour ça.`,
  action: { label: 'Changer d’appareil', run: () => router.go('appareils') },
});

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

/** Protocole de pilotage imposé depuis l'aide de l'écran Appareils ; vide = choix automatique selon le modèle. */
const PROTOCOL_KEY = 'zwift2.trainerProtocol';
const prefs = browserStore();
const protocolSelect = $<HTMLSelectElement>('trainer-protocol');
const savedProtocol = prefs.getItem(PROTOCOL_KEY) as ControlProtocol | null;
protocolSelect.value = savedProtocol && ALL_PROTOCOLS.includes(savedProtocol) ? savedProtocol : '';
protocolSelect.addEventListener('change', () => {
  try {
    if (protocolSelect.value) prefs.setItem(PROTOCOL_KEY, protocolSelect.value);
    else prefs.removeItem(PROTOCOL_KEY);
  } catch {
    // stockage bloqué : le choix vaut pour cette session
  }
  log(`protocole de pilotage : ${protocolSelect.value ? PROTOCOL_LABEL[protocolSelect.value as ControlProtocol] : 'automatique'}, appliqué à la prochaine connexion`);
});

function newBleTrainer(): WebBluetoothTrainer {
  const t = new WebBluetoothTrainer();
  t.forcedProtocol = (protocolSelect.value || undefined) as ControlProtocol | undefined;
  return t;
}
let hrMonitor: HeartRateMonitor | undefined;

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
let lastHr = { bpm: 0, at: 0 };
let lastSpeed = { kmh: 0, at: 0 };
/** Puissance moyenne sur 3 s et dénivelé positif, pour le HUD. */
const power3s = new PowerAverage();
const climb = new ClimbCounter();
let lastRide: RideSnapshot | undefined;
let lastWoState: WorkoutState | undefined;
let view: RideView | undefined;
let currentState: ConnectionState = 'disconnected';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

function log(msg: string) {
  const ts = new Date().toLocaleTimeString('fr-FR');
  logEl.textContent += `${ts}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  telemetry.record(msg);
}

// Envoie le journal au serveur de logs dès qu'une erreur survient (voir src/telemetry/). `roleState` n'est lu qu'à l'envoi,
// bien après l'évaluation du module.
const telemetry = setupTelemetry({
  log,
  context: () => ({
    trainer: trainer?.name,
    trainerState: currentState,
    capabilities: trainer?.capabilities,
    trainerIdentity: trainer instanceof WebBluetoothTrainer ? trainer.identity : undefined,
    heartRateState: roleState.hr,
    rideRunning: !!ride,
  }),
});

function setState(s: ConnectionState, detail?: string) {
  currentState = s;
  exporter.onTrainerState(s);
  stateEl.dataset.s = s;
  stateEl.textContent = `trainer : ${detail ? `${s} · ${detail}` : s}`;
  const connected = s === 'connected';
  const busy = s === 'connecting' || connected;
  // Les boutons de connexion sont réglés par renderDevices, plus bas.
  setBlocked(disconnectBtn, connected ? undefined : 'Aucun trainer connecté.');
  setBlocked(
    ergBtn,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une puissance.')
      : !trainer?.capabilities.targetPower
        ? noControl('mode ERG')
        : undefined,
  );
  setBlocked(
    simBtn,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une pente.')
      : !trainer?.capabilities.simulation
        ? noControl('mode SIM')
        : ride
          ? 'Pendant la sortie virtuelle, la pente vient du parcours. Arrête la sortie pour régler la pente à la main.'
          : undefined,
  );
  // La puissance seule suffit à rouler : la pente n'est envoyée que si le trainer sait la simuler.
  const needPowerToRide = connected ? undefined : needTrainer('La sortie avance avec la puissance de ton home trainer : connecte-le d’abord.');
  setBlocked(rideBtn, needPowerToRide);
  setBlocked(homeRideBtn, needPowerToRide);
  refreshWorkoutButtons();
  if (s === 'disconnected') {
    stopRide(false);
    setErgActive(false);
  }
  if (connected && trainer) {
    const c = trainer.capabilities;
    const range = c.powerRange ? `, plage ${c.powerRange.min}–${c.powerRange.max} W` : '';
    const id = trainer instanceof WebBluetoothTrainer ? trainer.identity : undefined;
    const model = id ? `${id.profile.label}${id.info.firmware ? ` (firmware ${id.info.firmware})` : ''} · pilotage ${id.protocol ? PROTOCOL_LABEL[id.protocol] : 'aucun'} · ` : '';
    $('caps').textContent = `${model}ERG : ${c.targetPower ? 'oui' : 'non'} · SIM : ${c.simulation ? 'oui' : 'non'}${range}${id?.advice ? `. ${id.advice}` : ''}`;
  }
  roleState.trainer = s;
  renderDevices();
}

function attach(t: TrainerAdapter) {
  trainer = t;
  hub.attachTrainer(t);
  t.on('state', (s, d) => {
    if (trainer !== t) return; // ancien adaptateur remplacé par un nouveau choix d'appareil
    setState(s, d);
    log(`trainer : ${s}${d ? ` (${d})` : ''}`);
    if (s === 'connected' && t instanceof WebBluetoothTrainer && t.deviceId) {
      registry.remember('trainer', { id: t.deviceId, name: t.name });
      renderDevices();
    }
    maybeLeaveDevices();
  });
}

hub.on('log', log);
hub.on('raw', (src, data) => {
  // Les trames brutes servent à documenter chaque modèle de trainer ; on ne journalise pas tout le flux.
  if (src !== 'Indoor Bike Data' && src !== 'Heart Rate' && src !== 'Cycling Power' && src !== 'FE-C') log(`${src} : ${hex(data)}`);
});
hub.on('measurement', (m) => {
  if (m.powerW !== undefined) lastPower = { w: m.powerW, at: performance.now() };
  if (m.cadenceRpm !== undefined) lastCadence = { rpm: m.cadenceRpm, at: performance.now() };
  if (m.powerW !== undefined) power3s.push(m.powerW, performance.now());
  if (m.heartRateBpm !== undefined) lastHr = { bpm: m.heartRateBpm, at: performance.now() };
  if (m.speedKmh !== undefined) lastSpeed = { kmh: m.speedKmh, at: performance.now() };
});

const fmtTime = (s: number) => formatDuration(Math.floor(s));

function tickRide() {
  if (!ride) return;
  const now = performance.now();
  const power = now - lastPower.at > POWER_STALE_MS ? 0 : lastPower.w;
  const s = ride.advance((now - lastTick) / 1000, power);
  exporter.onRide(s);
  lastTick = now;
  lastRide = s;
  climb.add(s.altitudeM);
  view?.setState({
    distanceM: s.distanceM,
    speedKmh: s.speedKmh,
    cadenceRpm: now - lastCadence.at > POWER_STALE_MS ? 0 : lastCadence.rpm,
  });

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
  lastRide = ride.snapshot();
  climb.reset();
  throttle.reset();
  lastTick = performance.now();
  rideTimer = setInterval(tickRide, 100);
  rideBtn.textContent = 'Arrêter la sortie';
  massInput.readOnly = true;
  massInput.title = 'La masse se règle avant de démarrer la sortie.';
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
  massInput.readOnly = false;
  massInput.title = '';
  log('sortie virtuelle arrêtée');
  if (resetTrainer && currentState === 'connected') void hub.setSimulation({ gradePct: 0 }).catch(() => {});
  setState(currentState, trainer?.name);
}

rideBtn.addEventListener('click', () => (ride ? stopRide() : startRide()));

async function start(t: TrainerAdapter, nameHint?: string) {
  attach(t);
  try {
    await t.connect(nameHint);
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

function newHeartRateMonitor(): HeartRateMonitor {
  const m = new HeartRateMonitor();
  hrMonitor = m;
  hub.attachHeartRate(m);
  m.on('state', (s, d) => {
    if (hrMonitor !== m) return;
    roleState.hr = s;
    stateHrEl.dataset.s = s;
    stateHrEl.textContent = `cardio : ${d ? `${s} · ${d}` : s}`;
    log(`cardio : ${s}${d ? ` (${d})` : ''}`);
    if (s === 'connected' && m.deviceId) registry.remember('hr', { id: m.deviceId, name: m.name });
    renderDevices();
    maybeLeaveDevices();
  });
  return m;
}

const connectHrWith = (hint?: string) =>
  void newHeartRateMonitor()
    .connect(hint)
    .catch((e) => log(`échec cardio : ${e instanceof Error ? e.message : e}`));

connectHr.addEventListener('click', () => connectHrWith(registry.get('hr')?.name));
$('connect-hr-other').addEventListener('click', () => connectHrWith());
disconnectHr.addEventListener('click', () => void hrMonitor?.disconnect());
connectBle.addEventListener('click', () => void start(newBleTrainer(), registry.get('trainer')?.name));
$('connect-ble-other').addEventListener('click', () => void start(newBleTrainer()));
connectSim.addEventListener('click', () => void start(new SimulatedTrainer()));
for (const role of ['trainer', 'hr'] as const) {
  $(`forget-${role}`).addEventListener('click', () => {
    const known = registry.get(role);
    if (!known || !confirm(`Oublier « ${known.name} » ? Il ne sera plus reconnecté au lancement.`)) return;
    registry.forget(role);
    log(`appareil oublié : ${known.name}`);
    renderDevices();
  });
}
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

const woSelect = $<HTMLSelectElement>('wo-select');
const woFtp = $<HTMLInputElement>('wo-ftp');
const woStart = $<HTMLButtonElement>('wo-start');
const woPause = $<HTMLButtonElement>('wo-pause');
const woSkip = $<HTMLButtonElement>('wo-skip');
const woStop = $<HTMLButtonElement>('wo-stop');
const woEasier = $<HTMLButtonElement>('wo-easier');
const woHarder = $<HTMLButtonElement>('wo-harder');
const woShapes = $('wo-shapes');
// Aperçu de la séance sur l'écran d'accueil : même séance, même profil que celui de la sortie.
const homeShapes = $('home-wo-shapes');
const homeSelect = $<HTMLSelectElement>('home-wo-select');
const homeWoStart = $<HTMLButtonElement>('home-wo-start');
const homeRideBtn = $<HTMLButtonElement>('home-ride');
// Fond de l'accueil : trois scènes qui se relaient toutes les minutes.
setupHomeBackground($('home-scenes'), $('home-title'), $('home-desc'));
const PROFILE_W = 1000;
const PROFILE_H = 120;
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
  const startReason = runner
    ? 'La séance est déjà en cours.'
    : !workout
      ? 'Choisis d’abord une séance dans la liste.'
      : currentState !== 'connected'
        ? needTrainer('La séance pilote la résistance de ton home trainer : connecte-le d’abord.')
        : !canErg
          ? noControl('mode ERG')
          : undefined;
  setBlocked(woStart, startReason);
  setBlocked(homeWoStart, startReason);
  for (const b of [woPause, woSkip, woStop, woEasier, woHarder]) setBlocked(b, runner ? undefined : 'Démarre d’abord la séance.');
  woPause.textContent = woPaused ? 'Reprendre' : 'Pause';
}

function renderProfile() {
  woShapes.replaceChildren();
  homeShapes.replaceChildren();
  $('home-wo-meta').textContent = workout ? `${workout.name} · ${fmtTime(workout.steps.reduce((t, s) => t + s.durationS, 0))}` : 'Aucune séance choisie.';
  if (!workout) return;
  for (const s of profileShapes(workout, readFtp(), PROFILE_W, PROFILE_H)) {
    for (const target of [woShapes, homeShapes]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', s.d);
      path.setAttribute('class', s.zone);
      target.append(path);
    }
  }
}

/** Valeur du sélecteur : `lib:<id>` pour une séance de l'utilisateur, `sample:<id>` pour un modèle. */
function workoutFromChoice(value: string): Workout | undefined {
  const [kind, id] = value.split(':');
  if (kind === 'lib') {
    const saved = library.get(id ?? '');
    return saved && blocksToWorkout(saved.name, saved.description, saved.blocks);
  }
  const sample = SAMPLE_WORKOUTS.find((s) => s.id === id);
  if (!sample) return undefined;
  try {
    return parseWorkout(sample.fileName, sample.text);
  } catch (e) {
    log(`séance illisible (${sample.fileName}) : ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

function refreshWorkoutChoices() {
  const keep = woSelect.value;
  const opt = (value: string, label: string) => Object.assign(document.createElement('option'), { value, textContent: label });
  const mine = document.createElement('optgroup');
  mine.label = 'Mes séances';
  mine.append(...library.list().map((w) => opt(`lib:${w.id}`, w.name)));
  const samples = document.createElement('optgroup');
  samples.label = 'Modèles';
  samples.append(...SAMPLE_WORKOUTS.map((s) => opt(`sample:${s.id}`, parseWorkout(s.fileName, s.text).name)));
  woSelect.replaceChildren(opt('', '— choisir une séance —'), ...(mine.children.length ? [mine] : []), samples);
  woSelect.value = [...woSelect.options].some((o) => o.value === keep) ? keep : '';
  syncHomeSelect();
}

/** Le sélecteur de l'accueil reprend les choix de celui de la sortie, et sa valeur. */
function syncHomeSelect() {
  homeSelect.replaceChildren(...[...woSelect.children].map((c) => c.cloneNode(true)));
  homeSelect.value = woSelect.value;
}

function chooseWorkout(value: string) {
  if (runner) {
    log("séance en cours : l'arrêter avant d'en choisir une autre");
    return;
  }
  woSelect.value = value;
  homeSelect.value = value;
  const w = value ? workoutFromChoice(value) : undefined;
  if (!w) {
    workout = undefined;
    $('wo-name').textContent = 'Aucune séance choisie.';
    renderProfile();
    renderWorkout(undefined);
    refreshWorkoutButtons();
    return;
  }
  workout = w;
  for (const x of workout.warnings) log(`séance : ${x}`);
  const total = workout.steps.reduce((t, s) => t + s.durationS, 0);
  $('wo-name').textContent = `${workout.name} · ${fmtTime(total)}${workout.description ? ` · ${workout.description}` : ''}`;
  renderProfile();
  renderWorkout(undefined);
  refreshWorkoutButtons();
  log(`séance choisie : ${workout.name} (${workout.steps.length} paliers, ${fmtTime(total)})`);
}

function renderWorkout(s: WorkoutState | undefined) {
  lastWoState = s;
  const cursor = $('wo-cursor');
  const x = s ? (s.elapsedS / (s.totalS || 1)) * PROFILE_W : 0;
  cursor.setAttribute('x1', String(x));
  cursor.setAttribute('x2', String(x));
  woShapes.querySelectorAll('path').forEach((p, i) => p.classList.toggle('past', !!s && i < s.stepIndex));

  const msg = $('wo-message');
  if (!s) {
    $('wo-next').textContent = '';
    msg.hidden = true;
    return;
  }
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
  // La séance se roule sur le parcours : sans sortie en cours, le cycliste resterait immobile dans la vue.
  if (!ride && currentState === 'connected') startRide();
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

woSelect.addEventListener('change', () => chooseWorkout(woSelect.value));
homeSelect.addEventListener('change', () => chooseWorkout(homeSelect.value));
homeWoStart.addEventListener('click', () => {
  router.go('sortie');
  startWorkout();
});
homeRideBtn.addEventListener('click', () => {
  router.go('sortie');
  if (!ride) startRide();
});
woFtp.addEventListener('change', () => {
  try {
    localStorage.setItem(FTP_KEY, String(readFtp()));
  } catch {
    // préférence non mémorisée, sans conséquence
  }
  if (runner) runner.ftpW = readFtp();
  renderProfile();
  editor.refresh();
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

// --- Écrans, appareils connus et reconnexion au lancement ---

const library = new WorkoutLibrary();
const editor = setupWorkoutEditor({
  library,
  readFtp,
  log,
  onLibraryChange: refreshWorkoutChoices,
  onUse: (id) => {
    router.go('sortie');
    chooseWorkout(`lib:${id}`);
  },
  onUseSample: (id) => {
    router.go('sortie');
    chooseWorkout(`sample:${id}`);
  },
});
refreshWorkoutChoices();

const router = setupRouter((v) => view?.setActive(v === 'sortie'));

const registry = new DeviceRegistry();
const roleState: Record<DeviceRole, ConnectionState> = { trainer: 'disconnected', hr: 'disconnected' };
/** Appareils que l'application tente de retrouver seule au lancement ; vide une fois cette phase terminée. */
const launchPending = new Set<DeviceRole>();
/** Même radar sur l'écran Appareils (grand) et sur l'accueil (réduit) : rôle de l'appareil et nom réel dans chaque bulle. */
const radars = [createRadar($('radar-devices'), 'full'), createRadar($('radar-home'), 'mini')];

function renderDevices() {
  const t = registry.get('trainer');
  const h = registry.get('hr');
  const busyT = roleState.trainer === 'connecting' || roleState.trainer === 'connected';
  const busyH = roleState.hr === 'connecting' || roleState.hr === 'connected';
  $('trainer-known').textContent = t ? `Connu : ${t.name}` : 'Aucun trainer connu.';
  $('hr-known').textContent = h ? `Connue : ${h.name}` : 'Aucune ceinture connue. Facultatif.';
  connectBle.textContent = t ? `Reconnecter ${t.name}` : 'Rechercher un trainer';
  connectHr.textContent = h ? `Reconnecter ${h.name}` : 'Rechercher une ceinture';
  const bt = webBluetoothAvailable();
  const noBt = 'Le Bluetooth web n’existe que dans Chrome ou Edge, sur ordinateur ou Android. Ici, seul le trainer simulé est disponible.';
  const trainerBusy =
    roleState.trainer === 'connected' ? 'Un trainer est déjà connecté : déconnecte-le d’abord pour en changer.' : 'Connexion du trainer en cours…';
  const hrBusy =
    roleState.hr === 'connected' ? 'Une ceinture est déjà connectée : déconnecte-la d’abord pour en changer.' : 'Connexion de la ceinture en cours…';
  setBlocked(connectBle, !bt ? noBt : busyT ? trainerBusy : undefined);
  setBlocked(connectHr, !bt ? noBt : busyH ? hrBusy : undefined);
  setBlocked(connectSim, busyT ? trainerBusy : undefined);
  $<HTMLButtonElement>('connect-ble-other').hidden = !t;
  setBlocked($<HTMLButtonElement>('connect-ble-other'), !bt ? noBt : busyT ? trainerBusy : undefined);
  $<HTMLButtonElement>('connect-hr-other').hidden = !h;
  setBlocked($<HTMLButtonElement>('connect-hr-other'), !bt ? noBt : busyH ? hrBusy : undefined);
  $<HTMLButtonElement>('forget-trainer').hidden = !t;
  $<HTMLButtonElement>('forget-hr').hidden = !h;
  setBlocked(disconnectHr, roleState.hr === 'connected' ? undefined : 'Aucune ceinture connectée.');
  setBlocked(
    $<HTMLButtonElement>('go-ride'),
    roleState.trainer === 'connected' ? undefined : 'Connecte d’abord ton home trainer, ou choisis « Continuer sans trainer » juste à côté.',
  );
  $('sortie-hint').hidden = roleState.trainer === 'connected';
  for (const [role, label] of [['trainer', 'trainer'], ['hr', 'cardio']] as const) {
    const pill = $(`status-${role}`);
    pill.dataset.s = roleState[role];
    pill.textContent = `${label} : ${roleState[role] === 'connected' ? 'connecté' : roleState[role] === 'connecting' ? 'connexion…' : roleState[role] === 'error' ? 'erreur' : 'déconnecté'}`;
  }
  $('card-trainer').dataset.s = roleState.trainer;
  $('card-hr').dataset.s = roleState.hr;
  // Nom réel : celui de l'appareil connecté ; sinon le dernier appareil mémorisé, que la reconnexion cherche.
  const radarDevices = {
    trainer: {
      state: roleState.trainer,
      name: (roleState.trainer === 'connected' ? trainer?.name : undefined) ?? t?.name,
      detail: roleState.trainer === 'connected' ? controlModes(trainer?.capabilities) : undefined,
    },
    hr: { state: roleState.hr, name: (roleState.hr === 'connected' ? hrMonitor?.name : undefined) ?? h?.name },
  };
  for (const r of radars) r.update(radarDevices);
}

/**
 * Pendant la reconnexion du lancement : dès que le trainer est connecté et que les autres appareils connus
 * ont abouti (connectés ou en échec), on passe à la sortie sans attendre de clic.
 */
function maybeLeaveDevices() {
  if (!launchPending.size || roleState.trainer !== 'connected') return;
  const settled = [...launchPending].every((r) => roleState[r] === 'connected' || roleState[r] === 'error');
  if (!settled) return;
  launchPending.clear();
  if (router.current() !== 'appareils') return;
  log("appareils connus reconnectés : passage à l'accueil");
  setTimeout(() => router.current() === 'appareils' && router.go('accueil'), 800);
}

async function reconnectKnownDevices() {
  const known = registry.list();
  const note = $('recall-note');
  renderDevices();
  if (!webBluetoothAvailable()) return;
  if (!known.length) {
    note.textContent = 'Première utilisation : connecte ton home trainer pour commencer. Il sera reconnu aux prochains lancements.';
    return;
  }
  if (!canRecallDevices()) {
    note.textContent = 'Ce navigateur ne permet pas de retrouver les appareils sans clic : un clic sur « Reconnecter » par appareil suffit.';
    log('reconnexion automatique indisponible : navigator.bluetooth.getDevices() absent');
    return;
  }
  note.textContent = 'Reconnexion automatique aux appareils connus…';
  let found: Map<DeviceRole, BluetoothDevice>;
  try {
    found = await recallDevices(known);
  } catch (e) {
    note.textContent = 'Reconnexion automatique impossible : un clic sur « Reconnecter » par appareil suffit.';
    log(`getDevices() a échoué : ${e instanceof Error ? e.message : e}`);
    return;
  }
  for (const k of known) {
    if (!found.has(k.role)) log(`${k.name} : autorisation du site perdue, à reconnecter d'un clic`);
  }
  if (!found.size) {
    note.textContent = 'Les autorisations Bluetooth de ce site ont été effacées : un clic sur « Reconnecter » par appareil suffit.';
    return;
  }
  for (const role of found.keys()) launchPending.add(role);
  const td = found.get('trainer');
  if (td) {
    const t = newBleTrainer();
    attach(t);
    void t.connectDevice(td, true);
  }
  const hd = found.get('hr');
  if (hd) void newHeartRateMonitor().connectDevice(hd, true);
  note.textContent = `Reconnexion automatique : ${[...found.values()].map((d) => d.name ?? 'appareil').join(', ')}. Allume-les si ce n'est pas déjà fait.`;
}

$('go-ride').addEventListener('click', () => router.go('accueil'));

$('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(logEl.textContent ?? ''));

const exporter = setupExport({
  hub,
  button: $<HTMLButtonElement>('export-fit'),
  stravaButton: $<HTMLButtonElement>('export-strava'),
  intervalsButton: $<HTMLButtonElement>('export-intervals'),
  log,
});


if (webBluetoothAvailable()) {
  $('support').textContent = 'Web Bluetooth disponible.';
} else {
  $('support').textContent =
    'Web Bluetooth indisponible ici (Chrome ou Edge, en HTTPS ou sur localhost). Le trainer simulé reste utilisable.';
}

const params = new URLSearchParams(location.search);

// HUD posé sur la vue 3D (docs/design/hud.md). En qualité réduite, panneaux sans flou.
const hud = new RideHud($('hud'), DEMO_ROUTE, { flat: params.get('quality') === 'low' });
const fresh = (at: number) => performance.now() - at <= POWER_STALE_MS;
function renderHud() {
  if (router.current() !== 'sortie') return;
  hud.update({
    powerW: power3s.value(performance.now()),
    heartRateBpm: fresh(lastHr.at) ? lastHr.bpm : undefined,
    cadenceRpm: fresh(lastCadence.at) ? lastCadence.rpm : undefined,
    // Pendant la sortie, la vitesse virtuelle (celle qui fait avancer la vue) ; sinon celle mesurée par le trainer.
    speedKmh: ride && lastRide ? lastRide.speedKmh : fresh(lastSpeed.at) ? lastSpeed.kmh : undefined,
    ftpW: runner?.ftpW ?? readFtp(),
    ride: ride && lastRide ? { snapshot: lastRide, climbM: climb.total } : undefined,
    workout: runner && lastWoState ? { workout: runner.workout, state: lastWoState, ftpW: runner.ftpW } : undefined,
    control: ergActive ? 'erg' : ride && trainer?.capabilities.simulation ? 'sim' : undefined,
    trainerConnected: roleState.trainer === 'connected',
    heartRateConnected: roleState.hr === 'connected',
  });
}
setInterval(renderHud, 250);
RideView.create($<HTMLCanvasElement>('view'), DEMO_ROUTE, {
  forceWebGL: params.get('renderer') === 'webgl2',
  quality: params.get('quality') === 'low' ? 'low' : 'high',
})
  .then((v) => {
    view = v;
    v.setActive(router.current() === 'sortie');
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

// En dernier : tout l'état de la page est initialisé avant la première connexion.
setState(currentState); // chaque bouton reçoit dès le départ sa raison d'être indisponible
void reconnectKnownDevices();
